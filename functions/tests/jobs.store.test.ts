// AC-028: job state rules (shared by the Firestore and memory stores) and the memory store itself.
import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  estimateBatchCount,
  failedProgress,
  normalizeProgress,
  succeededProgress,
  toAnalyzerResult,
  toRequestPayload,
} from '../src/jobs/jobRecord';
import { MemoryJobStore } from '../src/jobs/memoryJobStore';
import { createInlineJobRunner } from '../src/jobs/runners';
import { SAMPLE_TEXT, twoChapterPlan } from './helpers/fixtures';

describe('jobRecord rules', () => {
  it('clamps progress', () => {
    expect([clampPercent(-5), clampPercent(42.6), clampPercent(180), clampPercent(Number.NaN)]).toEqual([0, 43, 100, 0]);
    expect(normalizeProgress({ percent: 50, stage: '  ', processedBatches: -1, totalBatches: 0 })).toEqual({
      percent: 50,
      stage: '排队中',
      processedBatches: 0,
      totalBatches: 1,
    });
  });

  it('estimates 4 pages per batch', () => {
    const plan = twoChapterPlan();
    expect(estimateBatchCount(plan)).toBe(1);
    plan.chapters[0].slides.push({ subtitle: 'x', visualMode: 'table' });
    expect(estimateBatchCount(plan)).toBe(2);
  });

  it('builds terminal progress', () => {
    const previous = { percent: 40, stage: '正在生成内容（批次 1/3）', processedBatches: 1, totalBatches: 3 };
    expect(succeededProgress(previous)).toEqual({ percent: 100, stage: '已完成', processedBatches: 3, totalBatches: 3 });
    expect(failedProgress(previous)).toEqual({ ...previous, stage: '执行失败' });
    expect(failedProgress(undefined)).toEqual({ percent: 0, stage: '执行失败', processedBatches: 0, totalBatches: 1 });
  });

  it('validates stored payloads', () => {
    expect(() => toRequestPayload({ textContent: ' ', frameworkPlan: {} })).toThrow('invalid_job_request_payload');
    expect(toRequestPayload({ textContent: 'x', frameworkPlan: {}, sourceFilename: 3 }).sourceFilename).toBeUndefined();
    expect(() => toAnalyzerResult({ slidePlan: [] })).toThrow('invalid_job_result_payload');
  });
});

describe('MemoryJobStore', () => {
  it('walks a job through its states', async () => {
    const store = new MemoryJobStore(() => 'job-1');
    const job = await store.create({ frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT, sourceFilename: 'a.docx' });
    expect(job).toMatchObject({
      id: 'job-1',
      status: 'queued',
      attempts: 0,
      progress: { percent: 0, stage: '排队中', processedBatches: 0, totalBatches: 1 },
      requestStoragePath: 'generation-jobs/job-1/request.json',
      requestSummary: { chapterCount: 2, totalSlides: 4, textLength: SAMPLE_TEXT.length, sourceFilename: 'a.docx' },
    });
    expect(job.expiresAt.getTime() - job.createdAt.getTime()).toBe(72 * 3600 * 1000);

    await store.markRunning('job-1', 1);
    expect(await store.get('job-1')).toMatchObject({ status: 'running', attempts: 1, progress: { percent: 2, stage: '正在准备任务' } });

    await store.updateProgress('job-1', { percent: 140, stage: '正在生成内容（批次 1/1）', processedBatches: 1, totalBatches: 1 });
    expect((await store.get('job-1'))?.progress.percent).toBe(100);

    const path = await store.writeResult('job-1', { slidePlan: [], generatedAt: 'x' } as never);
    await store.markSucceeded('job-1', path, { mode: 'normal' });
    expect(await store.get('job-1')).toMatchObject({ status: 'succeeded', resultStoragePath: path, generationMeta: { mode: 'normal' } });
    expect(await store.readResult(path)).toEqual({ slidePlan: [], generatedAt: 'x' });
    expect((await store.readRequest(job.requestStoragePath)).sourceFilename).toBe('a.docx');
  });

  it('cleans up expired jobs and their files', async () => {
    const store = new MemoryJobStore(() => 'old');
    const job = await store.create({ frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT });
    store.patch(job.id, { expiresAt: new Date(Date.now() - 1000) });
    await expect(store.cleanupExpired()).resolves.toEqual({ deletedJobs: 1, deletedFiles: 1 });
    expect(await store.get('old')).toBeNull();
    await expect(store.readRequest(job.requestStoragePath)).rejects.toThrow('storage_object_not_found');
  });

  it('returns copies so callers cannot mutate stored state', async () => {
    const store = new MemoryJobStore(() => 'copy');
    const job = await store.create({ frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT });
    job.status = 'failed';
    expect((await store.get('copy'))?.status).toBe('queued');
  });
});

describe('inline job runner', () => {
  it('runs the worker after enqueue and drains', async () => {
    const store = new MemoryJobStore(() => 'inline');
    const runner = createInlineJobRunner(store, { geminiApiKey: '' });
    await store.create({ frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT });
    await runner.enqueue('inline');
    expect((await store.get('inline'))?.status).toBe('queued');
    await runner.drain();
    expect((await store.get('inline'))?.error?.code).toBe('missing_api_key');
  });
});
