// Store-independent job rules shared by the Firestore and memory stores.
import type { AnalyzerResult, GenerationJobProgress } from '../contracts/analyzer';
import type { FrameworkPlan } from '../contracts/framework';
import { isRecord } from '../shared/text';
import type { GenerateContentJobRequestPayload } from './types';

export const JOB_STORAGE_PREFIX = 'generation-jobs';
export const JOB_REQUEST_FILE = 'request.json';
export const JOB_RESULT_FILE = 'result.json';
export const JOB_DEFAULT_TTL_HOURS = 72;
export const JOB_CONTENT_BATCH_SIZE = 4;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 100) {
    return 100;
  }
  return Math.round(value);
}

export function normalizeProgress(progress: GenerationJobProgress): GenerationJobProgress {
  return {
    percent: clampPercent(progress.percent),
    stage: (progress.stage ?? '').trim() || '排队中',
    processedBatches: Math.max(0, Math.floor(progress.processedBatches ?? 0)),
    totalBatches: Math.max(1, Math.floor(progress.totalBatches ?? 1)),
  };
}

export function countSlides(plan: FrameworkPlan): number {
  return plan.chapters.reduce((sum, chapter) => sum + chapter.slides.length, 0);
}

export function estimateBatchCount(plan: FrameworkPlan): number {
  const slideCount = countSlides(plan);
  return Math.max(1, Math.ceil(slideCount / JOB_CONTENT_BATCH_SIZE));
}

export function buildRequestStoragePath(jobId: string): string {
  return `${JOB_STORAGE_PREFIX}/${jobId}/${JOB_REQUEST_FILE}`;
}

export function buildResultStoragePath(jobId: string): string {
  return `${JOB_STORAGE_PREFIX}/${jobId}/${JOB_RESULT_FILE}`;
}

export function isGenerateContentJobRequestPayload(value: unknown): value is GenerateContentJobRequestPayload {
  return (
    isRecord(value) &&
    typeof value.textContent === 'string' &&
    value.textContent.trim().length > 0 &&
    isRecord(value.frameworkPlan)
  );
}

export function isAnalyzerResult(value: unknown): value is AnalyzerResult {
  return (
    isRecord(value) &&
    Array.isArray((value as Partial<AnalyzerResult>).slidePlan) &&
    typeof (value as Partial<AnalyzerResult>).generatedAt === 'string'
  );
}

export function toRequestPayload(payload: unknown): GenerateContentJobRequestPayload {
  if (!isGenerateContentJobRequestPayload(payload)) {
    throw new Error('invalid_job_request_payload');
  }
  return {
    frameworkPlan: payload.frameworkPlan as FrameworkPlan,
    textContent: payload.textContent,
    sourceFilename: typeof payload.sourceFilename === 'string' ? payload.sourceFilename : undefined,
  };
}

export function toAnalyzerResult(payload: unknown): AnalyzerResult {
  if (!isAnalyzerResult(payload)) {
    throw new Error('invalid_job_result_payload');
  }
  return payload;
}

export function initialProgress(plan: FrameworkPlan): GenerationJobProgress {
  return {
    percent: 0,
    stage: '排队中',
    processedBatches: 0,
    totalBatches: estimateBatchCount(plan),
  };
}

export function runningProgress(totalBatches: number): GenerationJobProgress {
  return normalizeProgress({
    percent: 2,
    stage: '正在准备任务',
    processedBatches: 0,
    totalBatches: Math.max(1, totalBatches),
  });
}

export function succeededProgress(previous: GenerationJobProgress | undefined): GenerationJobProgress {
  const totalBatches = Math.max(1, previous?.totalBatches ?? 1);
  return normalizeProgress({ percent: 100, stage: '已完成', processedBatches: totalBatches, totalBatches });
}

export function failedProgress(previous: GenerationJobProgress | undefined): GenerationJobProgress {
  const base = previous ?? { percent: 0, stage: '执行失败', processedBatches: 0, totalBatches: 1 };
  return normalizeProgress({ ...base, stage: '执行失败' });
}
