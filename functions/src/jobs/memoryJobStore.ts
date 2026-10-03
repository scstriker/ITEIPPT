// Local JobStore: same rules as the Firestore store, kept in process memory.
import { randomUUID } from 'node:crypto';
import type { AnalyzerResult, GenerationJobError, GenerationJobProgress } from '../contracts/analyzer';
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
import type { GenerateContentJobRequestPayload, GenerationJobRecord, JobStore } from './types';

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, GenerationJobRecord>();
  private readonly files = new Map<string, string>();

  constructor(private readonly newId: () => string = () => randomUUID().replace(/-/g, '').slice(0, 20)) {}

  /** Test hook: change stored fields directly (for example to simulate a stale running job). */
  patch(jobId: string, patch: Partial<GenerationJobRecord>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      this.jobs.set(jobId, { ...job, ...patch });
    }
  }

  private update(jobId: string, patch: Partial<GenerationJobRecord>): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`generation job not found: ${jobId}`);
    }
    this.jobs.set(jobId, { ...job, ...patch });
  }

  async create(payload: GenerateContentJobRequestPayload): Promise<GenerationJobRecord> {
    const id = this.newId();
    const now = new Date();
    const requestStoragePath = buildRequestStoragePath(id);
    this.files.set(requestStoragePath, JSON.stringify(payload));
    const record: GenerationJobRecord = {
      id,
      status: 'queued',
      progress: initialProgress(payload.frameworkPlan),
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + JOB_DEFAULT_TTL_HOURS * 60 * 60 * 1000),
      attempts: 0,
      requestStoragePath,
      requestSummary: {
        chapterCount: payload.frameworkPlan.chapters.length,
        totalSlides: countSlides(payload.frameworkPlan),
        textLength: payload.textContent.length,
        sourceFilename: payload.sourceFilename,
      },
    };
    this.jobs.set(id, record);
    return { ...record };
  }

  async get(jobId: string): Promise<GenerationJobRecord | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async markRunning(jobId: string, totalBatches: number): Promise<void> {
    const now = new Date();
    const job = this.jobs.get(jobId);
    this.update(jobId, {
      status: 'running',
      updatedAt: now,
      startedAt: now,
      attempts: (job?.attempts ?? 0) + 1,
      progress: runningProgress(totalBatches),
      error: undefined,
    });
  }

  async updateProgress(jobId: string, progress: GenerationJobProgress): Promise<void> {
    this.update(jobId, { status: 'running', progress: normalizeProgress(progress), updatedAt: new Date() });
  }

  async markSucceeded(
    jobId: string,
    resultStoragePath: string,
    generationMeta?: AnalyzerResult['generationMeta'],
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    const now = new Date();
    this.update(jobId, {
      status: 'succeeded',
      updatedAt: now,
      finishedAt: now,
      resultStoragePath,
      generationMeta,
      progress: succeededProgress(job.progress),
      error: undefined,
    });
  }

  async markFailed(jobId: string, error: GenerationJobError): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    const now = new Date();
    this.update(jobId, {
      status: 'failed',
      updatedAt: now,
      finishedAt: now,
      error,
      progress: failedProgress(job.progress),
    });
  }

  async writeResult(jobId: string, result: AnalyzerResult): Promise<string> {
    const path = buildResultStoragePath(jobId);
    this.files.set(path, JSON.stringify(result));
    return path;
  }

  async readRequest(storagePath: string): Promise<GenerateContentJobRequestPayload> {
    return toRequestPayload(this.readJson(storagePath));
  }

  async readResult(storagePath: string): Promise<AnalyzerResult> {
    return toAnalyzerResult(this.readJson(storagePath));
  }

  async cleanupExpired(limit = 200): Promise<{ deletedJobs: number; deletedFiles: number }> {
    const now = Date.now();
    let deletedJobs = 0;
    let deletedFiles = 0;
    for (const [id, job] of this.jobs) {
      if (deletedJobs >= Math.max(1, limit)) {
        break;
      }
      if (job.expiresAt.getTime() > now) {
        continue;
      }
      for (const path of [job.requestStoragePath, job.resultStoragePath]) {
        if (path && this.files.delete(path)) {
          deletedFiles += 1;
        }
      }
      this.jobs.delete(id);
      deletedJobs += 1;
    }
    return { deletedJobs, deletedFiles };
  }

  private readJson(path: string): unknown {
    const raw = this.files.get(path);
    if (raw === undefined) {
      throw new Error('storage_object_not_found');
    }
    return raw ? (JSON.parse(raw) as unknown) : {};
  }
}
