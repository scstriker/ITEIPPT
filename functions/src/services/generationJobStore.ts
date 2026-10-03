import { PubSub } from '@google-cloud/pubsub';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type {
  AnalyzerResult,
  GenerationJobError,
  GenerationJobProgress,
  GenerationJobStatus,
} from '../types/analyzer';
import type { FrameworkPlan } from '../types/framework';

const JOB_COLLECTION = 'generationJobs';
const JOB_STORAGE_PREFIX = 'generation-jobs';
const JOB_REQUEST_FILE = 'request.json';
const JOB_RESULT_FILE = 'result.json';
const JOB_DEFAULT_TTL_HOURS = 72;
const JOB_CONTENT_BATCH_SIZE = 4;
const GENERATION_JOB_BUCKET = (process.env.GENERATION_JOB_BUCKET ?? '').trim();

export const GENERATION_JOB_TOPIC =
  (process.env.GENERATION_JOB_TOPIC ?? 'iteippt-generation-content-jobs').trim() || 'iteippt-generation-content-jobs';

export interface GenerateContentJobRequestPayload {
  frameworkPlan: FrameworkPlan;
  textContent: string;
  sourceFilename?: string;
}

export interface GenerationJobRequestSummary {
  chapterCount: number;
  totalSlides: number;
  textLength: number;
  sourceFilename?: string;
}

export interface GenerationJobRecord {
  id: string;
  status: GenerationJobStatus;
  progress: GenerationJobProgress;
  error?: GenerationJobError;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  attempts: number;
  requestStoragePath: string;
  resultStoragePath?: string;
  requestSummary: GenerationJobRequestSummary;
  generationMeta?: AnalyzerResult['generationMeta'];
}

interface GenerationJobDocument {
  status: GenerationJobStatus;
  progress: GenerationJobProgress;
  error?: GenerationJobError;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  attempts: number;
  requestStoragePath: string;
  resultStoragePath?: string;
  requestSummary: GenerationJobRequestSummary;
  generationMeta?: AnalyzerResult['generationMeta'];
}

const pubsub = new PubSub();

function ensureAdminInitialized(): void {
  if (!getApps().length) {
    initializeApp();
  }
}

function jobsCollection() {
  ensureAdminInitialized();
  return getFirestore().collection(JOB_COLLECTION);
}

function storageBucket() {
  ensureAdminInitialized();
  return GENERATION_JOB_BUCKET ? getStorage().bucket(GENERATION_JOB_BUCKET) : getStorage().bucket();
}

function toDate(value?: Timestamp): Date | undefined {
  if (!value) {
    return undefined;
  }
  return value.toDate();
}

function fromSnapshotData(id: string, data: GenerationJobDocument): GenerationJobRecord {
  return {
    id,
    status: data.status,
    progress: data.progress,
    error: data.error,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
    expiresAt: data.expiresAt.toDate(),
    startedAt: toDate(data.startedAt),
    finishedAt: toDate(data.finishedAt),
    attempts: data.attempts,
    requestStoragePath: data.requestStoragePath,
    resultStoragePath: data.resultStoragePath,
    requestSummary: data.requestSummary,
    generationMeta: data.generationMeta,
  };
}

function clampPercent(value: number): number {
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

function normalizeProgress(progress: GenerationJobProgress): GenerationJobProgress {
  return {
    percent: clampPercent(progress.percent),
    stage: (progress.stage ?? '').trim() || '排队中',
    processedBatches: Math.max(0, Math.floor(progress.processedBatches ?? 0)),
    totalBatches: Math.max(1, Math.floor(progress.totalBatches ?? 1)),
  };
}

function countSlides(plan: FrameworkPlan): number {
  return plan.chapters.reduce((sum, chapter) => sum + chapter.slides.length, 0);
}

function estimateBatchCount(plan: FrameworkPlan): number {
  const slideCount = countSlides(plan);
  return Math.max(1, Math.ceil(slideCount / JOB_CONTENT_BATCH_SIZE));
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const file = storageBucket().file(path);
  await file.save(JSON.stringify(data), {
    resumable: false,
    contentType: 'application/json; charset=utf-8',
    metadata: {
      cacheControl: 'no-store',
    },
  });
}

async function readJsonFile(path: string): Promise<unknown> {
  const file = storageBucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error('storage_object_not_found');
  }
  const [content] = await file.download();
  const raw = content.toString('utf8');
  return raw ? (JSON.parse(raw) as unknown) : {};
}

async function deleteFileIfExists(path: string): Promise<boolean> {
  const file = storageBucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    return false;
  }
  await file.delete();
  return true;
}

function buildRequestStoragePath(jobId: string): string {
  return `${JOB_STORAGE_PREFIX}/${jobId}/${JOB_REQUEST_FILE}`;
}

function buildResultStoragePath(jobId: string): string {
  return `${JOB_STORAGE_PREFIX}/${jobId}/${JOB_RESULT_FILE}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGenerateContentJobRequestPayload(value: unknown): value is GenerateContentJobRequestPayload {
  return (
    isRecord(value) &&
    typeof value.textContent === 'string' &&
    value.textContent.trim().length > 0 &&
    isRecord(value.frameworkPlan)
  );
}

function isAnalyzerResult(value: unknown): value is AnalyzerResult {
  return (
    isRecord(value) &&
    Array.isArray((value as Partial<AnalyzerResult>).slidePlan) &&
    typeof (value as Partial<AnalyzerResult>).generatedAt === 'string'
  );
}

export async function createGenerationJob(payload: GenerateContentJobRequestPayload): Promise<GenerationJobRecord> {
  const docRef = jobsCollection().doc();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + JOB_DEFAULT_TTL_HOURS * 60 * 60 * 1000);
  const requestStoragePath = buildRequestStoragePath(docRef.id);
  const totalSlides = countSlides(payload.frameworkPlan);
  const totalBatches = estimateBatchCount(payload.frameworkPlan);

  await writeJsonFile(requestStoragePath, payload);

  const doc: GenerationJobDocument = {
    status: 'queued',
    progress: {
      percent: 0,
      stage: '排队中',
      processedBatches: 0,
      totalBatches,
    },
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromDate(expiresAt),
    attempts: 0,
    requestStoragePath,
    requestSummary: {
      chapterCount: payload.frameworkPlan.chapters.length,
      totalSlides,
      textLength: payload.textContent.length,
      sourceFilename: payload.sourceFilename,
    },
  };

  await docRef.set(doc);
  return fromSnapshotData(docRef.id, doc);
}

export async function enqueueGenerationJob(jobId: string): Promise<string> {
  return pubsub.topic(GENERATION_JOB_TOPIC).publishMessage({
    json: { jobId },
  });
}

export async function getGenerationJob(jobId: string): Promise<GenerationJobRecord | null> {
  const snapshot = await jobsCollection().doc(jobId).get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() as GenerationJobDocument;
  return fromSnapshotData(snapshot.id, data);
}

export async function markGenerationJobRunning(jobId: string, totalBatches: number): Promise<void> {
  const now = Timestamp.now();
  await jobsCollection()
    .doc(jobId)
    .update({
      status: 'running',
      updatedAt: now,
      startedAt: now,
      attempts: FieldValue.increment(1),
      progress: normalizeProgress({
        percent: 2,
        stage: '正在准备任务',
        processedBatches: 0,
        totalBatches: Math.max(1, totalBatches),
      }),
      error: FieldValue.delete(),
    });
}

export async function updateGenerationJobProgress(jobId: string, progress: GenerationJobProgress): Promise<void> {
  await jobsCollection()
    .doc(jobId)
    .update({
      status: 'running',
      progress: normalizeProgress(progress),
      updatedAt: Timestamp.now(),
    });
}

export async function markGenerationJobSucceeded(
  jobId: string,
  resultStoragePath: string,
  generationMeta?: AnalyzerResult['generationMeta'],
): Promise<void> {
  const ref = jobsCollection().doc(jobId);
  await getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      return;
    }
    const data = snapshot.data() as GenerationJobDocument;
    const totalBatches = Math.max(1, data.progress?.totalBatches ?? 1);
    tx.update(ref, {
      status: 'succeeded',
      updatedAt: Timestamp.now(),
      finishedAt: Timestamp.now(),
      resultStoragePath,
      generationMeta: generationMeta ?? null,
      progress: normalizeProgress({
        percent: 100,
        stage: '已完成',
        processedBatches: totalBatches,
        totalBatches,
      }),
      error: FieldValue.delete(),
    });
  });
}

export async function markGenerationJobFailed(jobId: string, error: GenerationJobError): Promise<void> {
  const ref = jobsCollection().doc(jobId);
  await getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      return;
    }
    const data = snapshot.data() as GenerationJobDocument;
    const previousProgress = data.progress ?? {
      percent: 0,
      stage: '执行失败',
      processedBatches: 0,
      totalBatches: 1,
    };
    tx.update(ref, {
      status: 'failed',
      updatedAt: Timestamp.now(),
      finishedAt: Timestamp.now(),
      error,
      progress: normalizeProgress({
        ...previousProgress,
        stage: '执行失败',
      }),
    });
  });
}

export async function writeGenerationJobResult(jobId: string, result: AnalyzerResult): Promise<string> {
  const resultStoragePath = buildResultStoragePath(jobId);
  await writeJsonFile(resultStoragePath, result);
  return resultStoragePath;
}

export async function readGenerationJobRequest(storagePath: string): Promise<GenerateContentJobRequestPayload> {
  const payload = await readJsonFile(storagePath);
  if (!isGenerateContentJobRequestPayload(payload)) {
    throw new Error('invalid_job_request_payload');
  }
  return {
    frameworkPlan: payload.frameworkPlan as FrameworkPlan,
    textContent: payload.textContent,
    sourceFilename: typeof payload.sourceFilename === 'string' ? payload.sourceFilename : undefined,
  };
}

export async function readGenerationJobResult(storagePath: string): Promise<AnalyzerResult> {
  const payload = await readJsonFile(storagePath);
  if (!isAnalyzerResult(payload)) {
    throw new Error('invalid_job_result_payload');
  }
  return payload;
}

export async function cleanupExpiredGenerationJobs(limit = 200): Promise<{ deletedJobs: number; deletedFiles: number }> {
  const snapshots = await jobsCollection()
    .where('expiresAt', '<=', Timestamp.now())
    .limit(Math.max(1, limit))
    .get();

  let deletedJobs = 0;
  let deletedFiles = 0;

  for (const doc of snapshots.docs) {
    const data = doc.data() as GenerationJobDocument;
    const filePaths = [data.requestStoragePath, data.resultStoragePath].filter((item): item is string => Boolean(item));
    for (const path of filePaths) {
      try {
        const deleted = await deleteFileIfExists(path);
        if (deleted) {
          deletedFiles += 1;
        }
      } catch {
        // Ignore cleanup failures for individual files.
      }
    }
    await doc.ref.delete();
    deletedJobs += 1;
  }

  return {
    deletedJobs,
    deletedFiles,
  };
}
