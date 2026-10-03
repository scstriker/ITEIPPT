// AC-012: /api/plan behaviour against a scripted Gemini stub.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/generationJobStore', () => import('./helpers/fakeGenerationJobStore'));

import { startGeminiStub, type GeminiStub } from './helpers/geminiStub';
import { FIXED_NOW, SAMPLE_TEXT, twoChapterPlan } from './helpers/fixtures';
import { postJson, startTestApp, type RunningApp } from './helpers/testApp';

let stub: GeminiStub;
let app: RunningApp;

beforeAll(async () => {
  stub = await startGeminiStub();
  app = await startTestApp({ geminiApiKey: 'test-key', geminiBaseUrl: stub.baseUrl, geminiPlanModel: 'plan-model' });
});

afterAll(async () => {
  await app.close();
  await stub.close();
});

beforeEach(() => {
  stub.setHandler(undefined);
  stub.requests.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function requestChapters() {
  return twoChapterPlan().chapters.map((chapter) => ({
    chapterIndex: chapter.chapterIndex,
    chapterTitle: chapter.chapterTitle,
    slides: chapter.slides,
  }));
}

describe('POST /api/plan', () => {
  it('applies AI insights to the given chapters', async () => {
    const res = await postJson(`${app.baseUrl}/api/plan`, {
      presetId: 'standard_review',
      textContent: SAMPLE_TEXT,
      chapters: requestChapters(),
    });
    expect(res.status).toBe(200);
    expect(stub.requests.map((item) => item.kind)).toEqual(['plan_insights']);
    expect(stub.requests[0].model).toBe('plan-model');
    expect(res.json.apiPlanMeta.provider).toBe('gemini:plan-model');
    expect(res.json.chapters.map((c: any) => c.chapterTitle)).toEqual(['一、项目背景与必要性', '二、主要技术内容']);
    // stub: odd slideIndex -> table, even -> images
    expect(res.json.chapters[0].slides.map((s: any) => s.visualMode)).toEqual(['table', 'images']);
    expect(res.json.chapters.map((c: any) => c.coverageLevel)).toEqual(['sufficient', 'moderate']);
    expect(res.json).toMatchSnapshot();
  });

  it('fills an empty blank plan with the fixed 6 x 2 fallback chapters (no AI draft call)', async () => {
    const res = await postJson(`${app.baseUrl}/api/plan`, { presetId: 'blank', textContent: SAMPLE_TEXT, chapters: [] });
    expect(res.status).toBe(200);
    // Characterization: applyBlankPlanMinimum runs before the draft branch, so Gemini is only asked for insights.
    expect(stub.requests.map((item) => item.kind)).toEqual(['plan_insights']);
    expect(res.json.chapters).toHaveLength(6);
    for (const chapter of res.json.chapters) {
      expect(chapter.slides.length).toBeGreaterThanOrEqual(2);
    }
    expect(res.json.chapters.map((c: any) => c.chapterTitle)).toEqual([
      '一、背景与目标',
      '二、关键问题分析',
      '三、方案与实施路径',
      '四、资源与保障',
      '五、效益与风险',
      '六、结论与建议',
    ]);
    expect(res.json).toMatchSnapshot();
  });

  it('tops up a short blank plan to 6 chapters x 2 slides', async () => {
    const res = await postJson(`${app.baseUrl}/api/plan`, {
      presetId: 'blank',
      textContent: SAMPLE_TEXT,
      chapters: [{ chapterIndex: 1, chapterTitle: '自拟章节（示例）', slides: [{ subtitle: '自拟子章节', visualMode: 'table' }] }],
    });
    expect(res.status).toBe(200);
    expect(res.json.chapters).toHaveLength(6);
    expect(res.json.chapters[0].chapterTitle).toBe('自拟章节（示例）');
    expect(res.json.chapters[0].slides.map((s: any) => s.subtitle)).toEqual(['自拟子章节', '建设范围与边界']);
  });

  it('falls back to local heuristics when Gemini fails', async () => {
    stub.setHandler(() => ({ status: 500, rawText: '{"error":{"message":"boom"}}' }));
    const res = await postJson(`${app.baseUrl}/api/plan`, {
      presetId: 'standard_review',
      textContent: SAMPLE_TEXT,
      chapters: requestChapters(),
    });
    expect(res.status).toBe(200);
    expect(res.json.apiPlanMeta.provider).toMatch(/:fallback$/);
    expect(res.json.chapters[0].aiReason).toContain('已基于章节标题');
    expect(res.json).toMatchSnapshot();
  });

  it('falls back when Gemini returns non-JSON text', async () => {
    stub.setHandler(() => ({ json: undefined, rawText: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }) }));
    const res = await postJson(`${app.baseUrl}/api/plan`, {
      presetId: 'academic_research',
      textContent: SAMPLE_TEXT,
      chapters: requestChapters(),
    });
    expect(res.status).toBe(200);
    expect(res.json.apiPlanMeta.provider).toMatch(/:fallback$/);
  });
});
