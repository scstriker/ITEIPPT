// AC-026: HTTP contract for /api/health, /api/plan and /api/generate-content/batch.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startGeminiStub, type GeminiStub } from './helpers/geminiStub';
import { SAMPLE_TEXT, twoChapterPlan } from './helpers/fixtures';
import { batchRequestFor } from './helpers/batch';
import { BODY_LIMITS } from '../src/http/app';
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
    expect(res.json).toEqual({ ok: true, service: 'iteislides-api' });
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

describe('POST /api/generate-content/batch', () => {
  const url = () => `${app.baseUrl}/api/generate-content/batch`;

  it('returns the generated slides of the batch', async () => {
    const request = batchRequestFor(twoChapterPlan(), SAMPLE_TEXT, 0);
    const res = await postJson(url(), request);
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.slides.map((slide: { page: number }) => slide.page).sort()).toEqual(request.contexts.map((item) => item.page).sort());
    expect(res.json.fallbackPages).toEqual([]);
    expect(stub.requests.map((item) => item.kind)).toEqual(['content']);
    expect(stub.requests.every((item) => item.apiKey === 'test-key' && !item.keyInUrl)).toBe(true);
  });

  it('fills the pages from the evidence when every Gemini call fails', async () => {
    stub.setHandler(() => ({ status: 500, rawText: '{"error":{"message":"boom"}}' }));
    const request = batchRequestFor(twoChapterPlan(), SAMPLE_TEXT, 0);
    const res = await postJson(url(), request);
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(false);
    expect(res.json.fallbackPages).toEqual(request.contexts.map((item) => item.page));
    for (const slide of res.json.slides) {
      expect(slide.bodyText.length).toBeGreaterThan(0);
    }
  });

  it('503 missing_api_key', async () => {
    const res = await postJson(`${noKeyApp.baseUrl}/api/generate-content/batch`, batchRequestFor(twoChapterPlan(), SAMPLE_TEXT, 0));
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('missing_api_key');
  });

  it('400 invalid_preset', async () => {
    const res = await postJson(url(), { ...batchRequestFor(twoChapterPlan(), SAMPLE_TEXT, 0), presetId: 'nope' });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_preset');
  });

  it.each([
    ['no pages', (body: any) => ({ ...body, contexts: [] })],
    ['more than 4 pages', (body: any) => ({ ...body, contexts: [1, 2, 3, 4, 5].map((page) => ({ ...body.contexts[0], page })) })],
    ['a repeated page', (body: any) => ({ ...body, contexts: [body.contexts[0], body.contexts[0]] })],
    ['an unknown layout', (body: any) => ({ ...body, contexts: [{ ...body.contexts[0], visualMode: 'video' }] })],
    ['an oversized excerpt', (body: any) => ({ ...body, excerpts: { ...body.excerpts, full: { text: 'x'.repeat(40_000), truncated: true } } })],
    ['missing excerpts', (body: any) => ({ ...body, excerpts: undefined })],
  ])('400 invalid_batch_request for %s, without calling Gemini', async (_name, mutate) => {
    const res = await postJson(url(), mutate(batchRequestFor(twoChapterPlan(), SAMPLE_TEXT, 0)));
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_batch_request');
    expect(stub.requests).toHaveLength(0);
  });

  it('400 invalid_json', async () => {
    const res = await postJson(url(), '{not json');
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_json');
  });

  it('413 payload_too_large', async () => {
    const res = await postJson(url(), { padding: 'x'.repeat(BODY_LIMITS.batch + 1) });
    expect(res.status).toBe(413);
    expect(res.json.error.code).toBe('payload_too_large');
    expect(stub.requests).toHaveLength(0);
  });
});

describe('access check', () => {
  let guarded: RunningApp;
  const seen: string[] = [];

  beforeAll(async () => {
    guarded = await startTestApp({ geminiApiKey: 'test-key', geminiBaseUrl: stub.baseUrl }, async (request) => {
      seen.push(new URL(request.url).pathname);
      return request.headers.get('cf-access-jwt-assertion') === 'good'
        ? { ok: true, email: 'staff@example.com' }
        : { ok: false, status: 401, code: 'access_denied', message: 'denied' };
    });
  });

  afterAll(async () => {
    await guarded.close();
  });

  it('refuses plan and batch calls without a valid token and never reaches Gemini', async () => {
    const plan = await postJson(`${guarded.baseUrl}/api/plan`, { presetId: 'standard_review', textContent: SAMPLE_TEXT });
    const batch = await postJson(`${guarded.baseUrl}/api/generate-content/batch`, batchRequestFor(twoChapterPlan(), SAMPLE_TEXT, 0));
    expect([plan.status, batch.status]).toEqual([401, 401]);
    expect(plan.json.error.code).toBe('access_denied');
    expect(stub.requests).toHaveLength(0);
  });

  it('lets a valid token through', async () => {
    const res = await postJson(`${guarded.baseUrl}/api/plan`, { presetId: 'standard_review', textContent: SAMPLE_TEXT }, {
      'cf-access-jwt-assertion': 'good',
    });
    expect(res.status).toBe(200);
  });

  it('keeps /api/health and unknown routes outside the check', async () => {
    seen.length = 0;
    expect((await getJson(`${guarded.baseUrl}/api/health`)).status).toBe(200);
    expect((await getJson(`${guarded.baseUrl}/api/nope`)).status).toBe(404);
    expect(seen).toEqual([]);
  });
});

describe('unknown /api routes (AC-027)', () => {
  it.each([
    ['POST', '/api/models'],
    ['GET', '/api/models/gemini-2.5-flash'],
    ['POST', '/api'],
    ['GET', '/api/'],
    ['GET', '/api/plan'],
    ['POST', '/api/generate-content'],
    ['POST', '/api/generate-content/jobs'],
    ['GET', '/api/generate-content/jobs/job-0001/result'],
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
