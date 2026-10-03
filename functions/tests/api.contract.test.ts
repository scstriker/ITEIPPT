// AC-026: HTTP contract for /api/health, /api/plan and /api/generate-content error semantics.
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
  stub.setHandler(undefined);
  stub.requests.length = 0;
});

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await getJson(`${app.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, service: 'local-gemini-proxy' });
  });
});

describe('POST /api/plan errors', () => {
  it('400 invalid_preset', async () => {
    const res = await postJson(`${app.baseUrl}/api/plan`, { presetId: 'nope', textContent: SAMPLE_TEXT });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_preset');
  });

  it('400 missing_text_content for blank text', async () => {
    const res = await postJson(`${app.baseUrl}/api/plan`, { presetId: 'standard_review', textContent: '  \n ' });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('missing_text_content');
  });

  it('503 missing_api_key', async () => {
    const res = await postJson(`${noKeyApp.baseUrl}/api/plan`, { presetId: 'standard_review', textContent: SAMPLE_TEXT });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('missing_api_key');
  });
});

describe('POST /api/generate-content (sync)', () => {
  it('400 invalid_framework_plan', async () => {
    const res = await postJson(`${app.baseUrl}/api/generate-content`, { frameworkPlan: {}, textContent: 'x' });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_framework_plan');
  });

  it('400 missing_text_content', async () => {
    const res = await postJson(`${app.baseUrl}/api/generate-content`, { frameworkPlan: twoChapterPlan(), textContent: '' });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('missing_text_content');
  });

  it('503 missing_api_key', async () => {
    const res = await postJson(`${noKeyApp.baseUrl}/api/generate-content`, {
      frameworkPlan: twoChapterPlan(),
      textContent: SAMPLE_TEXT,
    });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('missing_api_key');
  });

  it('returns an AnalyzerResult', async () => {
    const res = await postJson(`${app.baseUrl}/api/generate-content`, {
      frameworkPlan: twoChapterPlan(),
      textContent: SAMPLE_TEXT,
      sourceFilename: '送审稿（示例）.docx',
    });
    expect(res.status).toBe(200);
    expect(res.json.slidePlan).toHaveLength(8);
    expect(res.json.generationMeta).toEqual({ mode: 'normal' });
  });

  it('returns a degraded result when every Gemini call fails', async () => {
    stub.setHandler(() => ({ status: 500, rawText: '{"error":{"message":"boom"}}' }));
    const res = await postJson(`${app.baseUrl}/api/generate-content`, {
      frameworkPlan: twoChapterPlan(),
      textContent: SAMPLE_TEXT,
    });
    expect(res.status).toBe(200);
    expect(res.json.generationMeta.mode).toBe('degraded');
    expect(res.json.generationMeta.reason).toContain('batch_generation_failed');
    const contentSlides = res.json.slidePlan.filter((slide: { type: string }) => slide.type === 'content');
    for (const slide of contentSlides) {
      expect(slide.bodyText.length).toBeGreaterThan(0);
    }
  });
});

describe('unknown /api routes (AC-027)', () => {
  it.each([
    ['POST', '/api/models'],
    ['GET', '/api/models/gemini-2.5-flash'],
    ['POST', '/api'],
    ['GET', '/api/'],
  ])('%s %s returns 404 not_found without calling Gemini', async (method, path) => {
    const res = await fetch(`${app.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
    expect(stub.requests).toHaveLength(0);
  });
});
