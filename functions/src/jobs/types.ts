import type { AnalyzerResult, GenerationJobError, GenerationJobProgress, GenerationJobStatus } from '../contracts/analyzer';
import type { FrameworkPlan } from '../contracts/framework';

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

/** Persistence for generation jobs: Firestore + Cloud Storage in production, memory locally. */
export interface JobStore {
  create(payload: GenerateContentJobRequestPayload): Promise<GenerationJobRecord>;
  get(jobId: string): Promise<GenerationJobRecord | null>;
  markRunning(jobId: string, totalBatches: number): Promise<void>;
  updateProgress(jobId: string, progress: GenerationJobProgress): Promise<void>;
  markSucceeded(jobId: string, resultStoragePath: string, generationMeta?: AnalyzerResult['generationMeta']): Promise<void>;
  markFailed(jobId: string, error: GenerationJobError): Promise<void>;
  writeResult(jobId: string, result: AnalyzerResult): Promise<string>;
  readRequest(storagePath: string): Promise<GenerateContentJobRequestPayload>;
  readResult(storagePath: string): Promise<AnalyzerResult>;
  cleanupExpired(limit?: number): Promise<{ deletedJobs: number; deletedFiles: number }>;
}

/** Hands a created job to the worker: Pub/Sub in production, in-process locally. */
export interface JobRunner {
  enqueue(jobId: string): Promise<void>;
}
