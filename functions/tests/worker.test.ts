// AC-028: worker rules and Pub/Sub message parsing.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/generationJobStore', () => import('./helpers/fakeGenerationJobStore'));

import {
  __getFakeJob,
  __patchFakeJob,
  __resetFakeJobStore,
  cleanupExpiredGenerationJobs,
  createGenerationJob,
} from './helpers/fakeGenerationJobStore';
import { parseJobIdFromPubSubMessage, processGenerationJob } from '../src/services/generationJobWorker';
import { startGeminiStub, type GeminiStub } from './helpers/geminiStub';
import { SAMPLE_TEXT, twoChapterPlan } from './helpers/fixtures';

let stub: GeminiStub;

beforeAll(async () => {
  stub = await startGeminiStub();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(() => {
  __resetFakeJobStore({ autoRun: false });
  stub.setHandler(undefined);
  stub.requests.length = 0;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

function options(apiKey = 'test-key') {
  return { geminiApiKey: apiKey, geminiBaseUrl: stub.baseUrl };
}

async function newJob() {
  return createGenerationJob({ frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT });
}

describe('processGenerationJob', () => {
  it('runs a queued job to succeeded', async () => {
    const job = await newJob();
    await processGenerationJob(job.id, options());
    const stored = __getFakeJob(job.id);
    expect(stored?.status).toBe('succeeded');
    expect(stored?.attempts).toBe(1);
    expect(stored?.resultStoragePath).toBe(`generation-jobs/${job.id}/result.json`);
  });

  it('skips finished jobs', async () => {
    const job = await newJob();
    __patchFakeJob(job.id, { status: 'failed' });
    await processGenerationJob(job.id, options());
    expect(stub.requests).toHaveLength(0);
    expect(__getFakeJob(job.id)?.status).toBe('failed');
  });

  it('skips jobs that are running and were updated within 10 minutes', async () => {
    const job = await newJob();
    __patchFakeJob(job.id, { status: 'running', updatedAt: new Date(Date.now() - 9 * 60 * 1000) });
    await processGenerationJob(job.id, options());
    expect(stub.requests).toHaveLength(0);
  });

  it('takes over stale running jobs', async () => {
    const job = await newJob();
    __patchFakeJob(job.id, { status: 'running', updatedAt: new Date(Date.now() - 11 * 60 * 1000) });
    await processGenerationJob(job.id, options());
    expect(__getFakeJob(job.id)?.status).toBe('succeeded');
  });

  it('fails with missing_api_key', async () => {
    const job = await newJob();
    await processGenerationJob(job.id, options(''));
    expect(__getFakeJob(job.id)).toMatchObject({
      status: 'failed',
      error: { code: 'missing_api_key', message: '服务端未配置 GEMINI_API_KEY。' },
      progress: { stage: '执行失败' },
    });
  });

  it('fails when the request payload is missing', async () => {
    const job = await newJob();
    __patchFakeJob(job.id, { requestStoragePath: 'generation-jobs/missing/request.json' });
    await processGenerationJob(job.id, options());
    expect(__getFakeJob(job.id)).toMatchObject({
      status: 'failed',
      error: { code: 'generation_job_failed', details: 'storage_object_not_found' },
    });
  });

  it('ignores unknown and blank job ids', async () => {
    await expect(processGenerationJob('   ', options())).resolves.toBeUndefined();
    await expect(processGenerationJob('nope', options())).resolves.toBeUndefined();
  });
});

describe('cleanupExpiredGenerationJobs (in-memory)', () => {
  it('deletes expired jobs and their files', async () => {
    const job = await newJob();
    __patchFakeJob(job.id, { expiresAt: new Date(Date.now() - 1000) });
    await expect(cleanupExpiredGenerationJobs()).resolves.toEqual({ deletedJobs: 1, deletedFiles: 1 });
    expect(__getFakeJob(job.id)).toBeUndefined();
  });
});

describe('parseJobIdFromPubSubMessage', () => {
  it('reads message.json', () => {
    expect(parseJobIdFromPubSubMessage({ message: { json: { jobId: ' abc ' } } })).toBe('abc');
  });

  it('reads base64 message.data', () => {
    const data = Buffer.from(JSON.stringify({ jobId: 'xyz' })).toString('base64');
    expect(parseJobIdFromPubSubMessage({ message: { data } })).toBe('xyz');
  });

  it('returns null for invalid messages', () => {
    expect(parseJobIdFromPubSubMessage(undefined)).toBeNull();
    expect(parseJobIdFromPubSubMessage({ message: { data: 'not-base64-json' } })).toBeNull();
    expect(parseJobIdFromPubSubMessage({ message: { json: { jobId: '' } } })).toBeNull();
  });
});
