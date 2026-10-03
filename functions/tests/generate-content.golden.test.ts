// AC-017: characterization snapshot of the generated AnalyzerResult.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/generationJobStore', () => import('./helpers/fakeGenerationJobStore'));

import { generateContentWithGemini } from '../src/services/apiProxyServer';
import { startGeminiStub, type GeminiStub } from './helpers/geminiStub';
import { FIXED_NOW, SAMPLE_TEXT, twoChapterPlan } from './helpers/fixtures';

let stub: GeminiStub;

beforeAll(async () => {
  stub = await startGeminiStub();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(() => {
  stub.setHandler(undefined);
  stub.requests.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

function options() {
  return { geminiApiKey: 'test-key', geminiBaseUrl: stub.baseUrl, geminiContentModel: 'content-model' };
}

describe('generateContentWithGemini', () => {
  it('produces the documented slide structure', async () => {
    const progress: number[] = [];
    const result = await generateContentWithGemini(
      options(),
      { frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT, sourceFilename: '送审稿（示例）.docx' },
      {
        onProgress: (update) => {
          progress.push(update.percent);
        },
      },
    );

    expect(result.slidePlan.map((slide) => slide.type)).toEqual([
      'cover',
      'toc_section',
      'content',
      'content',
      'toc_section',
      'content',
      'content',
      'ending',
    ]);
    const content = result.slidePlan.filter((slide) => slide.type === 'content');
    for (const slide of content) {
      expect((slide.bodyText ?? '').length).toBeLessThanOrEqual(220);
      expect((slide.highlightRanges ?? []).length).toBeLessThanOrEqual(2);
      if (slide.visualMode === 'table') {
        expect(slide.tableData?.headers.length).toBeGreaterThan(0);
      }
      if (slide.visualMode === 'images') {
        expect(slide.imagePrompts?.length).toBeGreaterThan(0);
      }
    }
    expect(result.slidePlan[0]).toMatchObject({
      standardName: '医用呼吸机压力传感器技术要求（示例）',
      presenter: '张三（示例）',
      organization: '机械工业仪器仪表综合技术经济研究所',
    });
    expect(result.slidePlan.at(-1)).toMatchObject({ thanks: '敬请指正' });
    expect(progress[0]).toBe(2);
    expect(progress.at(-1)).toBe(98);
    expect(stub.requests.every((request) => request.model === 'content-model')).toBe(true);
    expect(result).toMatchSnapshot();
  });

  it('marks failed batches as degraded and missing', async () => {
    stub.setHandler((request) => (request.kind === 'content' ? { status: 500, rawText: '{}' } : undefined));
    const plan = twoChapterPlan();
    // 5 content pages -> 2 batches; both fail.
    plan.chapters[1].slides.push({ subtitle: '试验方法', visualMode: 'table', contentHint: '环境条件' });
    const result = await generateContentWithGemini(options(), { frameworkPlan: plan, textContent: SAMPLE_TEXT });
    expect(result.generationMeta).toEqual({ mode: 'degraded', reason: 'batch_generation_failed' });
    const contentPages = result.slidePlan.filter((slide) => slide.type === 'content').map((slide) => slide.page);
    const missingPages = new Set(result.missingInfo.map((item) => item.page));
    for (const page of contentPages) {
      expect(missingPages.has(page)).toBe(true);
    }
    expect(result).toMatchSnapshot();
  });

  it('rewrites pages that came back empty', async () => {
    stub.setHandler((request) => {
      if (request.kind !== 'content') {
        return undefined;
      }
      return { json: { slides: [{ page: 3, bodyText: '' }] } };
    });
    const result = await generateContentWithGemini(options(), { frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT });
    expect(stub.requests.map((request) => request.kind)).toContain('rewrite');
    const page3 = result.slidePlan.find((slide) => slide.page === 3);
    expect(page3?.bodyText?.length).toBeGreaterThan(30);
    expect(result).toMatchSnapshot();
  });

  it('rejects invalid input', async () => {
    await expect(generateContentWithGemini(options(), { frameworkPlan: {}, textContent: 'x' })).rejects.toThrow(
      'invalid_framework_plan',
    );
    await expect(
      generateContentWithGemini(options(), { frameworkPlan: twoChapterPlan(), textContent: '' }),
    ).rejects.toThrow('missing_text_content');
    await expect(
      generateContentWithGemini({ ...options(), geminiApiKey: '' }, { frameworkPlan: twoChapterPlan(), textContent: SAMPLE_TEXT }),
    ).rejects.toThrow('missing_api_key');
  });
});
