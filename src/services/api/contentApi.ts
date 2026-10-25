import type { ContentBatchRequest, ContentBatchResult, ContentBatchRunner } from '@worker/content/types';

interface ContentApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: string;
  };
}

export class ContentApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: string;

  constructor(status: number, code: string, message: string, details?: string) {
    super(message);
    this.name = 'ContentApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** A batch normally takes 10-60 s (up to 3 Gemini calls with retries); beyond this the request is abandoned. */
export const CONTENT_BATCH_TIMEOUT_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentBatchResult(value: unknown): value is ContentBatchResult {
  return (
    isRecord(value) &&
    typeof value.ok === 'boolean' &&
    Array.isArray(value.slides) &&
    Array.isArray(value.weakPages) &&
    Array.isArray(value.fallbackPages) &&
    isRecord(value.diagnostics)
  );
}

async function parseJsonResponse(response: Response): Promise<{ rawText: string; parsed: unknown }> {
  const rawText = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  let parsed: unknown;
  if (contentType.includes('application/json') && rawText) {
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      parsed = undefined;
    }
  }
  return { rawText, parsed };
}

function throwApiError(response: Response, rawText: string, parsed: unknown, fallbackMessage: string): never {
  const body = (parsed ?? {}) as ContentApiErrorBody;
  const details =
    body.error?.details ??
    (typeof rawText === 'string' && rawText.trim().length > 0 ? rawText.trim().slice(0, 600) : undefined);
  throw new ContentApiError(response.status, body.error?.code ?? 'content_api_error', body.error?.message ?? fallbackMessage, details);
}

/** One batch of content pages: POST /api/generate-content/batch. */
export async function requestContentBatch(request: ContentBatchRequest, signal?: AbortSignal): Promise<ContentBatchResult> {
  const timeout = AbortSignal.timeout(CONTENT_BATCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch('/api/generate-content/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (timeout.aborted) {
      throw new ContentApiError(408, 'generation_batch_timeout', '生成请求等待超时，请点击“重新生成”。');
    }
    throw error;
  }
  const { rawText, parsed } = await parseJsonResponse(response);
  if (!response.ok) {
    throwApiError(response, rawText, parsed, 'Failed to request /api/generate-content/batch');
  }
  if (!isContentBatchResult(parsed)) {
    throw new ContentApiError(response.status, 'invalid_generate_content_batch_response', 'Invalid response from /api/generate-content/batch');
  }
  return parsed;
}

export function createHttpBatchRunner(signal?: AbortSignal): ContentBatchRunner {
  return (request) => requestContentBatch(request, signal);
}

function mapDetailToReadableMessage(details?: string): string | null {
  if (!details) {
    return null;
  }
  const lowered = details.toLowerCase();
  if (lowered.includes('missing_api_key')) {
    return '服务端未配置 GEMINI_API_KEY。';
  }
  if (lowered.includes('429') || lowered.includes('quota') || lowered.includes('rate limit')) {
    return 'Gemini 调用频率或额度受限，请稍后重试。';
  }
  if (
    (lowered.includes('400') || lowered.includes('413')) &&
    (lowered.includes('token') ||
      lowered.includes('too large') ||
      lowered.includes('too long') ||
      lowered.includes('length') ||
      lowered.includes('request size'))
  ) {
    return '输入内容过长触发上游限制，请减少文档长度后重试。';
  }
  if (lowered.includes('502') || lowered.includes('503') || lowered.includes('504') || lowered.includes('timeout')) {
    return 'Gemini 上游服务暂时不可用，请稍后重试。';
  }
  if (lowered.includes('gemini_invalid_json') || lowered.includes('gemini_upstream_invalid_json')) {
    return 'Gemini 返回格式异常，请稍后重新生成。';
  }
  return null;
}

export function mapGenerateContentError(error: unknown): string {
  if (!(error instanceof ContentApiError)) {
    return '内容生成失败，请稍后重试。';
  }

  if (error.code === 'missing_api_key') {
    return '服务端未配置 GEMINI_API_KEY，无法调用内容生成。';
  }
  if (error.code === 'invalid_framework_plan') {
    return '框架数据无效，请返回 Step 2 重新确认章节结构。';
  }
  if (error.code === 'missing_text_content') {
    return '文档正文为空，请先在 Step 1 上传并解析文档。';
  }
  if (error.code === 'access_denied') {
    return '访问验证已失效，请刷新页面重新登录后再生成。';
  }
  if (error.code === 'access_not_configured' || error.code === 'access_unavailable') {
    return '服务端访问控制不可用，请联系系统管理员。';
  }

  const detailMessage = mapDetailToReadableMessage(error.details);
  if (detailMessage) {
    return `内容生成失败：${detailMessage}`;
  }

  if (error.details) {
    return `内容生成失败：${error.message}（${error.details}）`;
  }
  return `内容生成失败：${error.message}`;
}
