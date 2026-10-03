// Production JobStore: job state in Firestore (generationJobs), request and result JSON in Cloud Storage.
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { AnalyzerResult, GenerationJobError, GenerationJobProgress, GenerationJobStatus } from '../contracts/analyzer';
import {
  JOB_DEFAULT_TTL_HOURS,
  buildRequestStoragePath,
  buildResultStoragePath,
  countSlides,
  failedProgress,
  initialProgress,
  normalizeProgress,
  runningProgress,
  succeededProgress,
  toAnalyzerResult,
  toRequestPayload,
} from './jobRecord';
import type {
  GenerateContentJobRequestPayload,
  GenerationJobRecord,
  GenerationJobRequestSummary,
  JobStore,
} from './types';

const JOB_COLLECTION = 'generationJobs';
const GENERATION_JOB_BUCKET = (process.env.GENERATION_JOB_BUCKET ?? '').trim();

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

async function create(payload: GenerateContentJobRequestPayload): Promise<GenerationJobRecord> {
  const docRef = jobsCollection().doc();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + JOB_DEFAULT_TTL_HOURS * 60 * 60 * 1000);
  const requestStoragePath = buildRequestStoragePath(docRef.id);

  await writeJsonFile(requestStoragePath, payload);

  const doc: GenerationJobDocument = {
    status: 'queued',
    progress: initialProgress(payload.frameworkPlan),
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromDate(expiresAt),
    attempts: 0,
    requestStoragePath,
    requestSummary: {
      chapterCount: payload.frameworkPlan.chapters.length,
      totalSlides: countSlides(payload.frameworkPlan),
      textLength: payload.textContent.length,
      sourceFilename: payload.sourceFilename,
    },
  };

  await docRef.set(doc);
  return fromSnapshotData(docRef.id, doc);
}

async function get(jobId: string): Promise<GenerationJobRecord | null> {
  const snapshot = await jobsCollection().doc(jobId).get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() as GenerationJobDocument;
  return fromSnapshotData(snapshot.id, data);
}

async function markRunning(jobId: string, totalBatches: number): Promise<void> {
  const now = Timestamp.now();
  await jobsCollection()
    .doc(jobId)
    .update({
      status: 'running',
      updatedAt: now,
      startedAt: now,
      attempts: FieldValue.increment(1),
      progress: runningProgress(totalBatches),
      error: FieldValue.delete(),
    });
}

async function updateProgress(jobId: string, progress: GenerationJobProgress): Promise<void> {
  await jobsCollection()
    .doc(jobId)
    .update({
      status: 'running',
      progress: normalizeProgress(progress),
      updatedAt: Timestamp.now(),
    });
}

async function markSucceeded(
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
    tx.update(ref, {
      status: 'succeeded',
      updatedAt: Timestamp.now(),
      finishedAt: Timestamp.now(),
      resultStoragePath,
      generationMeta: generationMeta ?? null,
      progress: succeededProgress(data.progress),
      error: FieldValue.delete(),
    });
  });
}

async function markFailed(jobId: string, error: GenerationJobError): Promise<void> {
  const ref = jobsCollection().doc(jobId);
  await getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      return;
    }
    const data = snapshot.data() as GenerationJobDocument;
    tx.update(ref, {
      status: 'failed',
      updatedAt: Timestamp.now(),
      finishedAt: Timestamp.now(),
      error,
      progress: failedProgress(data.progress),
    });
  });
}

async function writeResult(jobId: string, result: AnalyzerResult): Promise<string> {
  const resultStoragePath = buildResultStoragePath(jobId);
  await writeJsonFile(resultStoragePath, result);
  return resultStoragePath;
}

async function readRequest(storagePath: string): Promise<GenerateContentJobRequestPayload> {
  return toRequestPayload(await readJsonFile(storagePath));
}

async function readResult(storagePath: string): Promise<AnalyzerResult> {
  return toAnalyzerResult(await readJsonFile(storagePath));
}

async function cleanupExpired(limit = 200): Promise<{ deletedJobs: number; deletedFiles: number }> {
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

export const firestoreJobStore: JobStore = {
  create,
  get,
  markRunning,
  updateProgress,
  markSucceeded,
  markFailed,
  writeResult,
  readRequest,
  readResult,
  cleanupExpired,
};
