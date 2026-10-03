// AC-028: worker rules and Pub/Sub message parsing.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryJobStore } from '../src/jobs/memoryJobStore';
import { parseJobIdFromPubSubMessage, processGenerationJob } from '../src/jobs/worker';
import { startGeminiStub, type GeminiStub } from './helpers/geminiStub';
import { SAMPLE_TEXT, twoChapterPlan } from './helpers/fixtures';

let stub: GeminiStub;
let store: MemoryJobStore;

beforeAll(async () => {
  stub = await startGeminiStub();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(() => {
  store = new MemoryJobStore();
  stub.setHandler(undefined);
  stub.requests.length = 0;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

function deps(apiKey = 'test-key') {
  return { store, gemini: { geminiApiKey: apiKey, geminiBaseUrl: stub.baseUrl } };
}

async function newJob() {
  return store.create({ frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT });
}

describe('processGenerationJob', () => {
  it('runs a queued job to succeeded', async () => {
    const job = await newJob();
    await processGenerationJob(job.id, deps());
    const stored = await store.get(job.id);
    expect(stored?.status).toBe('succeeded');
    expect(stored?.attempts).toBe(1);
    expect(stored?.resultStoragePath).toBe(`generation-jobs/${job.id}/result.json`);
  });

  it('skips finished jobs', async () => {
    const job = await newJob();
    store.patch(job.id, { status: 'failed' });
    await processGenerationJob(job.id, deps());
    expect(stub.requests).toHaveLength(0);
    expect((await store.get(job.id))?.status).toBe('failed');
  });

  it('skips jobs that are running and were updated within 10 minutes', async () => {
    const job = await newJob();
    store.patch(job.id, { status: 'running', updatedAt: new Date(Date.now() - 9 * 60 * 1000) });
    await processGenerationJob(job.id, deps());
    expect(stub.requests).toHaveLength(0);
  });

  it('takes over stale running jobs', async () => {
    const job = await newJob();
    store.patch(job.id, { status: 'running', updatedAt: new Date(Date.now() - 11 * 60 * 1000) });
    await processGenerationJob(job.id, deps());
    expect((await store.get(job.id))?.status).toBe('succeeded');
  });

  it('fails with missing_api_key', async () => {
    const job = await newJob();
    await processGenerationJob(job.id, deps(''));
    expect(await store.get(job.id)).toMatchObject({
      status: 'failed',
      error: { code: 'missing_api_key', message: '服务端未配置 GEMINI_API_KEY。' },
      progress: { stage: '执行失败' },
    });
  });

  it('fails when the request payload is missing', async () => {
    const job = await newJob();
    store.patch(job.id, { requestStoragePath: 'generation-jobs/missing/request.json' });
    await processGenerationJob(job.id, deps());
    expect(await store.get(job.id)).toMatchObject({
      status: 'failed',
      error: { code: 'generation_job_failed', details: 'storage_object_not_found' },
    });
  });

  it('ignores unknown and blank job ids', async () => {
    await expect(processGenerationJob('   ', deps())).resolves.toBeUndefined();
    await expect(processGenerationJob('nope', deps())).resolves.toBeUndefined();
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
