// In-memory stand-in for src/services/generationJobStore.ts (Firestore + Storage + Pub/Sub).
// Used with vi.mock so the HTTP job routes and the worker can run without Firebase.
import type { AnalyzerResult, GenerationJobError, GenerationJobProgress } from '../../src/types/analyzer';
import type {
  GenerateContentJobRequestPayload,
  GenerationJobRecord,
} from '../../src/services/generationJobStore';

export type { GenerateContentJobRequestPayload, GenerationJobRecord };

export const GENERATION_JOB_TOPIC = 'iteippt-generation-content-jobs';

const JOB_DEFAULT_TTL_HOURS = 72;
const JOB_CONTENT_BATCH_SIZE = 4;

interface StoredJob {
  record: GenerationJobRecord;
}

const jobs = new Map<string, StoredJob>();
const files = new Map<string, string>();
let nextId = 1;
let autoRun = true;
const pendingRuns: Promise<void>[] = [];

export function __resetFakeJobStore(options: { autoRun?: boolean } = {}): void {
  jobs.clear();
  files.clear();
  nextId = 1;
  autoRun = options.autoRun ?? true;
  pendingRuns.length = 0;
}

export async function __drainFakeJobRuns(): Promise<void> {
  while (pendingRuns.length) {
    await pendingRuns.shift();
  }
}

export function __getFakeJob(jobId: string): GenerationJobRecord | undefined {
  return jobs.get(jobId)?.record;
}

export function __patchFakeJob(jobId: string, patch: Partial<GenerationJobRecord>): void {
  const stored = jobs.get(jobId);
  if (stored) {
    stored.record = { ...stored.record, ...patch };
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 100) {
    return 100;
  }
  return Math.round(value);
}

function normalizeProgress(progress: GenerationJobProgress): GenerationJobProgress {
  return {
    percent: clampPercent(progress.percent),
    stage: (progress.stage ?? '').trim() || '排队中',
    processedBatches: Math.max(0, Math.floor(progress.processedBatches ?? 0)),
    totalBatches: Math.max(1, Math.floor(progress.totalBatches ?? 1)),
  };
}

function update(jobId: string, patch: Partial<GenerationJobRecord>): void {
  const stored = jobs.get(jobId);
  if (!stored) {
    throw new Error(`fake job not found: ${jobId}`);
  }
  stored.record = { ...stored.record, ...patch };
}

export async function createGenerationJob(payload: GenerateContentJobRequestPayload): Promise<GenerationJobRecord> {
  const id = `job-${String(nextId).padStart(4, '0')}`;
  nextId += 1;
  const now = new Date();
  const totalSlides = payload.frameworkPlan.chapters.reduce((sum, chapter) => sum + chapter.slides.length, 0);
  const requestStoragePath = `generation-jobs/${id}/request.json`;
  files.set(requestStoragePath, JSON.stringify(payload));
  const record: GenerationJobRecord = {
    id,
    status: 'queued',
    progress: { percent: 0, stage: '排队中', processedBatches: 0, totalBatches: Math.max(1, Math.ceil(totalSlides / JOB_CONTENT_BATCH_SIZE)) },
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + JOB_DEFAULT_TTL_HOURS * 3600 * 1000),
    attempts: 0,
    requestStoragePath,
    requestSummary: {
      chapterCount: payload.frameworkPlan.chapters.length,
      totalSlides,
      textLength: payload.textContent.length,
      sourceFilename: payload.sourceFilename,
    },
  };
  jobs.set(id, { record });
  return { ...record };
}

export async function enqueueGenerationJob(jobId: string): Promise<string> {
  if (autoRun) {
    const { processGenerationJob } = await import('../../src/services/generationJobWorker');
    pendingRuns.push(processGenerationJob(jobId));
  }
  return `message-${jobId}`;
}

export async function getGenerationJob(jobId: string): Promise<GenerationJobRecord | null> {
  const stored = jobs.get(jobId);
  return stored ? { ...stored.record } : null;
}

export async function markGenerationJobRunning(jobId: string, totalBatches: number): Promise<void> {
  const now = new Date();
  const stored = jobs.get(jobId);
  update(jobId, {
    status: 'running',
    updatedAt: now,
    startedAt: now,
    attempts: (stored?.record.attempts ?? 0) + 1,
    progress: normalizeProgress({ percent: 2, stage: '正在准备任务', processedBatches: 0, totalBatches: Math.max(1, totalBatches) }),
    error: undefined,
  });
}

export async function updateGenerationJobProgress(jobId: string, progress: GenerationJobProgress): Promise<void> {
  update(jobId, { status: 'running', progress: normalizeProgress(progress), updatedAt: new Date() });
}

export async function markGenerationJobSucceeded(
  jobId: string,
  resultStoragePath: string,
  generationMeta?: AnalyzerResult['generationMeta'],
): Promise<void> {
  const stored = jobs.get(jobId);
  if (!stored) {
    return;
  }
  const totalBatches = Math.max(1, stored.record.progress.totalBatches ?? 1);
  update(jobId, {
    status: 'succeeded',
    updatedAt: new Date(),
    finishedAt: new Date(),
    resultStoragePath,
    generationMeta,
    progress: normalizeProgress({ percent: 100, stage: '已完成', processedBatches: totalBatches, totalBatches }),
    error: undefined,
  });
}

export async function markGenerationJobFailed(jobId: string, error: GenerationJobError): Promise<void> {
  const stored = jobs.get(jobId);
  if (!stored) {
    return;
  }
  update(jobId, {
    status: 'failed',
    updatedAt: new Date(),
    finishedAt: new Date(),
    error,
    progress: normalizeProgress({ ...stored.record.progress, stage: '执行失败' }),
  });
}

export async function writeGenerationJobResult(jobId: string, result: AnalyzerResult): Promise<string> {
  const path = `generation-jobs/${jobId}/result.json`;
  files.set(path, JSON.stringify(result));
  return path;
}

export async function readGenerationJobRequest(storagePath: string): Promise<GenerateContentJobRequestPayload> {
  const raw = files.get(storagePath);
  if (!raw) {
    throw new Error('storage_object_not_found');
  }
  return JSON.parse(raw) as GenerateContentJobRequestPayload;
}

export async function readGenerationJobResult(storagePath: string): Promise<AnalyzerResult> {
  const raw = files.get(storagePath);
  if (!raw) {
    throw new Error('storage_object_not_found');
  }
  return JSON.parse(raw) as AnalyzerResult;
}

export async function cleanupExpiredGenerationJobs(): Promise<{ deletedJobs: number; deletedFiles: number }> {
  const now = Date.now();
  let deletedJobs = 0;
  let deletedFiles = 0;
  for (const [id, stored] of jobs) {
    if (stored.record.expiresAt.getTime() > now) {
      continue;
    }
    for (const path of [stored.record.requestStoragePath, stored.record.resultStoragePath]) {
      if (path && files.delete(path)) {
        deletedFiles += 1;
      }
    }
    jobs.delete(id);
    deletedJobs += 1;
  }
  return { deletedJobs, deletedFiles };
}
