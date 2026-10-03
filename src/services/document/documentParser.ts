import * as mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

export type ParsedFileType = 'pdf' | 'docx';

export interface DocumentSection {
  title: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedDocument {
  filename: string;
  fileType: ParsedFileType;
  textContent: string;
  sections?: DocumentSection[];
}

export type DocumentParseErrorCode =
  | 'file_too_large'
  | 'unsupported_format'
  | 'parse_timeout'
  | 'parse_failed'
  | 'empty_content';

export interface ParseDocumentOptions {
  timeoutMs?: number;
  maxFileSizeBytes?: number;
}

export interface UploadErrorInfo {
  code: DocumentParseErrorCode | 'unknown';
  message: string;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

let pdfWorkerInitialized = false;

export class DocumentParseError extends Error {
  readonly code: DocumentParseErrorCode;
  readonly details?: string;

  constructor(code: DocumentParseErrorCode, message: string, details?: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DocumentParseError';
    this.code = code;
    this.details = details;
  }
}

function ensurePdfWorker(): void {
  if (pdfWorkerInitialized) {
    return;
  }
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  pdfWorkerInitialized = true;
}

function getFileType(filename: string): ParsedFileType {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'pdf';
  }
  if (lower.endsWith('.docx')) {
    return 'docx';
  }
  if (lower.endsWith('.doc')) {
    throw new DocumentParseError(
      'unsupported_format',
      'Legacy .doc format is not supported.',
      'legacy_doc_not_supported',
    );
  }
  throw new DocumentParseError(
    'unsupported_format',
    'Unsupported file type.',
    'Only .pdf and .docx files are supported.',
  );
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function extractPdfText(file: File): Promise<string> {
  ensurePdfWorker();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  try {
    const pages: string[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const textContent = await page.getTextContent();
      const chunks: string[] = [];
      for (const item of textContent.items) {
        if ('str' in item && typeof item.str === 'string') {
          chunks.push(item.str);
          if (item.hasEOL) {
            chunks.push('\n');
          }
        }
      }
      pages.push(normalizeText(chunks.join(' ')));
      page.cleanup();
    }
    return normalizeText(pages.join('\n\n'));
  } finally {
    await pdf.destroy();
  }
}

async function extractWordText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return normalizeText(result.value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new DocumentParseError('parse_timeout', 'Document parsing timed out.'));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (typeof timeoutId !== 'undefined') {
      globalThis.clearTimeout(timeoutId);
    }
  }) as Promise<T>;
}

export async function parseDocument(file: File, options: ParseDocumentOptions = {}): Promise<ParsedDocument> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

  if (file.size > maxFileSizeBytes) {
    throw new DocumentParseError(
      'file_too_large',
      'File exceeds allowed size.',
      `Max size is ${Math.round(maxFileSizeBytes / (1024 * 1024))}MB.`,
    );
  }

  const fileType = getFileType(file.name);

  try {
    const extractedText = await withTimeout(
      fileType === 'pdf' ? extractPdfText(file) : extractWordText(file),
      timeoutMs,
    );

    if (!extractedText) {
      throw new DocumentParseError(
        'empty_content',
        'No text content extracted from document.',
        'Document may be scanned or protected.',
      );
    }

    return {
      filename: file.name,
      fileType,
      textContent: extractedText,
    };
  } catch (error) {
    if (error instanceof DocumentParseError) {
      throw error;
    }
    throw new DocumentParseError('parse_failed', 'Failed to parse document.', undefined, error);
  }
}

export function getUploadErrorInfo(error: unknown): UploadErrorInfo {
  if (!(error instanceof DocumentParseError)) {
    return {
      code: 'unknown',
      message: '文档处理失败，请稍后重试。',
    };
  }

  switch (error.code) {
    case 'file_too_large':
      return {
        code: error.code,
        message: '文件过大，请上传不超过 20MB 的 PDF/DOCX 文件。',
      };
    case 'unsupported_format':
      if (error.details === 'legacy_doc_not_supported') {
        return {
          code: error.code,
          message: '暂不支持 legacy .doc，请先另存为 .docx 后上传。',
        };
      }
      return {
        code: error.code,
        message: '文件格式不支持，仅允许 .pdf、.docx。',
      };
    case 'parse_timeout':
      return {
        code: error.code,
        message: '解析超时，请压缩文件体积或稍后重试。',
      };
    case 'empty_content':
      return {
        code: error.code,
        message: '未提取到有效文本，请确认文件不是扫描图片或加密文档。',
      };
    case 'parse_failed':
      return {
        code: error.code,
        message: '文档解析失败，请检查文件是否损坏后重试。',
      };
    default:
      return {
        code: 'unknown',
        message: '文档处理失败，请稍后重试。',
      };
  }
}
