// AC-026 / AC-028: async generation job routes, end to end with an in-memory job store.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startGeminiStub, type GeminiStub } from './helpers/geminiStub';
import { SAMPLE_TEXT, twoChapterPlan } from './helpers/fixtures';
import { getJson, postJson, startTestApp, type RunningApp } from './helpers/testApp';

let stub: GeminiStub;
let app: RunningApp;
let noKeyApp: RunningApp;

beforeAll(async () => {
  stub = await startGeminiStub();
  app = await startTestApp({ geminiApiKey: 'test-key', geminiBaseUrl: stub.baseUrl });
  noKeyApp = await startTestApp({ geminiApiKey: '', geminiBaseUrl: stub.baseUrl });
});

afterAll(async () => {
  await app.close();
  await noKeyApp.close();
  await stub.close();
});

beforeEach(() => {
  app.setAutoRun(true);
  stub.setHandler(undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

async function createJob() {
  return postJson(`${app.baseUrl}/api/generate-content/jobs`, {
    frameworkPlan: twoChapterPlan(),
    textContent: SAMPLE_TEXT,
    sourceFilename: '送审稿（示例）.docx',
  });
}

describe('POST /api/generate-content/jobs', () => {
  it('202 with job urls', async () => {
    const res = await createJob();
    expect(res.status).toBe(202);
    expect(res.json).toMatchObject({
      jobId: expect.any(String),
      status: 'queued',
      createdAt: expect.any(String),
    });
    expect(res.json.pollUrl).toBe(`/api/generate-content/jobs/${res.json.jobId}`);
    expect(res.json.resultUrl).toBe(`/api/generate-content/jobs/${res.json.jobId}/result`);
    await app.runner.drain();
  });

  it('400 invalid_framework_plan / missing_text_content, 503 missing_api_key', async () => {
    const bad = await postJson(`${app.baseUrl}/api/generate-content/jobs`, { frameworkPlan: { presetId: 'x' }, textContent: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('invalid_framework_plan');

    const empty = await postJson(`${app.baseUrl}/api/generate-content/jobs`, { frameworkPlan: twoChapterPlan(), textContent: ' ' });
    expect(empty.status).toBe(400);
    expect(empty.json.error.code).toBe('missing_text_content');

    const noKey = await postJson(`${noKeyApp.baseUrl}/api/generate-content/jobs`, {
      frameworkPlan: twoChapterPlan(),
      textContent: SAMPLE_TEXT,
    });
    expect(noKey.status).toBe(503);
    expect(noKey.json.error.code).toBe('missing_api_key');
  });
});

describe('job status and result', () => {
  it('runs to succeeded and serves the result', async () => {
    const created = await createJob();
    await app.runner.drain();

    const status = await getJson(`${app.baseUrl}/api/generate-content/jobs/${created.json.jobId}`);
    expect(status.status).toBe(200);
    expect(status.json).toMatchObject({
      jobId: created.json.jobId,
      status: 'succeeded',
      resultReady: true,
      progress: { percent: 100, stage: '已完成', processedBatches: 1, totalBatches: 1 },
    });

    const result = await getJson(`${app.baseUrl}/api/generate-content/jobs/${created.json.jobId}/result`);
    expect(result.status).toBe(200);
    expect(result.json.slidePlan).toHaveLength(8);
    expect(result.json.sourceFiles[0].filename).toBe('送审稿（示例）.docx');
  });

  it('reports queued progress before the worker runs and 409 for the result', async () => {
    app.setAutoRun(false);
    const created = await createJob();
    const status = await getJson(`${app.baseUrl}/api/generate-content/jobs/${created.json.jobId}`);
    expect(status.json).toMatchObject({
      status: 'queued',
      resultReady: false,
      progress: { percent: 0, stage: '排队中', processedBatches: 0, totalBatches: 1 },
    });
    const result = await getJson(`${app.baseUrl}/api/generate-content/jobs/${created.json.jobId}/result`);
    expect(result.status).toBe(409);
    expect(result.json.error.code).toBe('job_not_completed');
  });

  it('404 for unknown jobs', async () => {
    const status = await getJson(`${app.baseUrl}/api/generate-content/jobs/does-not-exist`);
    expect(status.status).toBe(404);
    expect(status.json.error.code).toBe('generation_job_not_found');
    const result = await getJson(`${app.baseUrl}/api/generate-content/jobs/does-not-exist/result`);
    expect(result.status).toBe(404);
    expect(result.json.error.code).toBe('generation_job_not_found');
  });

  it('succeeds in degraded mode when Gemini keeps failing', async () => {
    stub.setHandler(() => ({ status: 503, rawText: '{"error":{"message":"overloaded"}}' }));
    const created = await createJob();
    await app.runner.drain();
    const status = await getJson(`${app.baseUrl}/api/generate-content/jobs/${created.json.jobId}`);
    expect(status.json.status).toBe('succeeded');
    const result = await getJson(`${app.baseUrl}/api/generate-content/jobs/${created.json.jobId}/result`);
    expect(result.json.generationMeta.mode).toBe('degraded');
  });
});
