import type { FrameworkPlan, TemplatePreset } from '@contracts/framework';
import type { VisualMode } from '@contracts/template';

export interface PlanApiSlideInput {
  subtitle: string;
  visualMode: VisualMode;
  contentHint?: string;
}

export interface PlanApiChapterInput {
  chapterIndex: number;
  chapterTitle: string;
  slides: PlanApiSlideInput[];
}

export interface PlanApiRequest {
  presetId: TemplatePreset['id'];
  textContent: string;
  chapters?: PlanApiChapterInput[];
}

interface PlanApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: string;
  };
}

export class PlanApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: string;

  constructor(status: number, code: string, message: string, details?: string) {
    super(message);
    this.name = 'PlanApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isFrameworkPlan(value: unknown): value is FrameworkPlan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<FrameworkPlan>;
  return typeof candidate.presetId === 'string' && Array.isArray(candidate.chapters);
}

export async function requestFrameworkPlan(payload: PlanApiRequest, signal?: AbortSignal): Promise<FrameworkPlan> {
  const response = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  const rawText = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const parsed: unknown = contentType.includes('application/json') && rawText ? JSON.parse(rawText) : undefined;

  if (!response.ok) {
    const body = (parsed ?? {}) as PlanApiErrorBody;
    throw new PlanApiError(
      response.status,
      body.error?.code ?? 'plan_api_error',
      body.error?.message ?? 'Failed to request /api/plan',
      body.error?.details,
    );
  }

  if (!isFrameworkPlan(parsed)) {
    throw new PlanApiError(response.status, 'invalid_plan_response', 'Invalid FrameworkPlan response from /api/plan');
  }

  return parsed;
}

export function mapPlanErrorToMessage(error: unknown): string {
  if (!(error instanceof PlanApiError)) {
    return 'AI 规划请求失败，请稍后重试。';
  }
  if (error.code === 'missing_api_key') {
    return '服务端未配置 GEMINI_API_KEY，无法生成 AI 推荐结果。';
  }
  if (error.code === 'missing_text_content') {
    return '文档文本为空，请先在 Step 1 上传并解析文档。';
  }
  if (error.code === 'invalid_preset') {
    return '模板参数无效，请重新选择模板后重试。';
  }
  return `AI 规划失败：${error.message}`;
}
