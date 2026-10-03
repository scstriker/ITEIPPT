import type {
  AnalyzerResult,
  GenerationJobError,
  GenerationJobProgress,
  GenerationJobStatus,
} from '../types/analyzer';
import type { FrameworkPlan } from '../types/framework';

interface ContentApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: string;
  };
}

export interface GenerateContentRequest {
  frameworkPlan: FrameworkPlan;
  textContent: string;
  sourceFilename?: string;
}

export interface GenerateContentJobCreateResponse {
  jobId: string;
  status: GenerationJobStatus;
  createdAt: string;
  pollUrl: string;
  resultUrl: string;
}

export interface GenerateContentJobStatusResponse {
  jobId: string;
  status: GenerationJobStatus;
  progress: GenerationJobProgress;
  error?: GenerationJobError;
  updatedAt: string;
  createdAt: string;
  resultReady: boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGenerationJobStatus(value: unknown): value is GenerationJobStatus {
  return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed';
}

function isGenerationJobProgress(value: unknown): value is GenerationJobProgress {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.percent === 'number' &&
    typeof value.stage === 'string' &&
    typeof value.processedBatches === 'number' &&
    typeof value.totalBatches === 'number'
  );
}

function isGenerationJobError(value: unknown): value is GenerationJobError {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.code === 'string' && typeof value.message === 'string';
}

function isAnalyzerResult(value: unknown): value is AnalyzerResult {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.slidePlan) && typeof value.generatedAt === 'string';
}

function isGenerateContentJobCreateResponse(value: unknown): value is GenerateContentJobCreateResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.jobId === 'string' &&
    isGenerationJobStatus(value.status) &&
    typeof value.createdAt === 'string' &&
    typeof value.pollUrl === 'string' &&
    typeof value.resultUrl === 'string'
  );
}

function isGenerateContentJobStatusResponse(value: unknown): value is GenerateContentJobStatusResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.jobId === 'string' &&
    isGenerationJobStatus(value.status) &&
    isGenerationJobProgress(value.progress) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.resultReady === 'boolean' &&
    (typeof value.error === 'undefined' || isGenerationJobError(value.error))
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

export async function requestCreateGenerateContentJob(
  payload: GenerateContentRequest,
  signal?: AbortSignal,
): Promise<GenerateContentJobCreateResponse> {
  const response = await fetch('/api/generate-content/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const { rawText, parsed } = await parseJsonResponse(response);
  if (!response.ok) {
    throwApiError(response, rawText, parsed, 'Failed to request /api/generate-content/jobs');
  }
  if (!isGenerateContentJobCreateResponse(parsed)) {
    throw new ContentApiError(
      response.status,
      'invalid_generate_content_job_create_response',
      'Invalid response from /api/generate-content/jobs',
    );
  }
  return parsed;
}

export async function requestGenerateContentJobStatus(
  jobId: string,
  signal?: AbortSignal,
): Promise<GenerateContentJobStatusResponse> {
  const response = await fetch(`/api/generate-content/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    signal,
  });
  const { rawText, parsed } = await parseJsonResponse(response);
  if (!response.ok) {
    throwApiError(response, rawText, parsed, 'Failed to request generation job status');
  }
  if (!isGenerateContentJobStatusResponse(parsed)) {
    throw new ContentApiError(
      response.status,
      'invalid_generate_content_job_status_response',
      'Invalid response from /api/generate-content/jobs/:jobId',
    );
  }
  return parsed;
}

export async function requestGenerateContentJobResult(jobId: string, signal?: AbortSignal): Promise<AnalyzerResult> {
  const response = await fetch(`/api/generate-content/jobs/${encodeURIComponent(jobId)}/result`, {
    method: 'GET',
    signal,
  });
  const { rawText, parsed } = await parseJsonResponse(response);
  if (!response.ok) {
    throwApiError(response, rawText, parsed, 'Failed to request generation job result');
  }
  if (!isAnalyzerResult(parsed)) {
    throw new ContentApiError(
      response.status,
      'invalid_generate_content_job_result_response',
      'Invalid AnalyzerResult response from /api/generate-content/jobs/:jobId/result',
    );
  }
  return parsed;
}

export async function requestGenerateContent(
  payload: GenerateContentRequest,
  signal?: AbortSignal,
): Promise<AnalyzerResult> {
  const response = await fetch('/api/generate-content', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  const { rawText, parsed } = await parseJsonResponse(response);

  if (!response.ok) {
    throwApiError(response, rawText, parsed, 'Failed to request /api/generate-content');
  }

  if (!isAnalyzerResult(parsed)) {
    throw new ContentApiError(
      response.status,
      'invalid_generate_content_response',
      'Invalid AnalyzerResult response from /api/generate-content',
    );
  }

  return parsed;
}

function mapDetailToReadableMessage(details?: string): string | null {
  if (!details) {
    return null;
  }
  const lowered = details.toLowerCase();
  if (lowered.includes('missing_api_key')) {
    return '服务端未配置 GEMINI_API_KEY。';
  }
  if (lowered.includes('job_not_completed')) {
    return '任务尚未完成，请继续等待。';
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
  if (error.code === 'job_not_completed') {
    return '异步任务尚未完成，请继续等待。';
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
