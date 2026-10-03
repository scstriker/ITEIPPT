import type { ParsedDocument } from '../../services/document/documentParser';

export const ALLOWED_EXTENSIONS = ['.pdf', '.docx'];
export const DEFAULT_TARGET_SLIDES = 20;
export const MIN_TARGET_SLIDES = 4;
export const DEFAULT_ORGANIZATION = '机械工业仪器仪表综合技术经济研究所';
export const MAX_FILE_SIZE_MB = 20;
export const PARSE_TIMEOUT_MS = 45_000;

export function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function formatSizeKb(sizeBytes: number): string {
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

/** First problem with the chosen files, in the order the UI checks them; null when the file can be parsed. */
export function validateSelection(files: ArrayLike<File>, maxFileSizeMb = MAX_FILE_SIZE_MB): string | null {
  if (files.length > 1) {
    return '一次仅支持上传一个文件，请重新选择。';
  }
  const file = files[0];
  if (!hasAllowedExtension(file.name)) {
    return '文件格式不支持，仅允许 .pdf / .docx。';
  }
  if (file.size > maxFileSizeMb * 1024 * 1024) {
    return `文件过大，请上传不超过 ${maxFileSizeMb}MB 的文档。`;
  }
  return null;
}

export function clampTargetSlides(value: number): number {
  return Math.max(MIN_TARGET_SLIDES, Number(value) || MIN_TARGET_SLIDES);
}

export interface DocumentSummary {
  title: string;
  domain: string;
  keywords: string;
  abstract: string;
}

export function buildSummary(parsedDocument: ParsedDocument | null): DocumentSummary {
  if (!parsedDocument) {
    return {
      title: '待上传文档',
      domain: '-',
      keywords: '-',
      abstract: '上传并解析后将显示文档摘要。',
    };
  }

  const lines = parsedDocument.textContent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const title = lines[0] ?? parsedDocument.filename;
  const abstract = parsedDocument.textContent.slice(0, 160) || '未提取到摘要内容。';
  const keywords =
    lines
      .slice(1, 20)
      .join(' ')
      .replace(/[，。、“”‘’；：,.!?]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 2)
      .slice(0, 8)
      .join('、') || '-';

  return {
    title,
    domain: parsedDocument.fileType.toUpperCase(),
    keywords,
    abstract,
  };
}
