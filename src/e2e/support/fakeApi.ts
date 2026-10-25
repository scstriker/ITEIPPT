// Browser-level fake of the /api/* backend. Shapes follow docs/API.md.
import type { Page, Route } from '@playwright/test';

type Json = Record<string, any>;

export interface FakeApiOptions {
  planError?: { status: number; code: string; message?: string };
  /** Answer the first `times` batch requests with this HTTP error. */
  batchError?: { status: number; code: string; message: string; details?: string; times?: number };
  /** Every batch comes back as failed (`ok: false`), so the result is degraded. */
  degraded?: boolean;
  /** Delay before each batch answer, to observe the progress bar. */
  batchDelayMs?: number;
  /** Never answer batches after the first one (keeps the progress dialog open). */
  hangAfterFirstBatch?: boolean;
  /** Visual mode by slide index (1-based) inside each chapter. Default: odd -> table, even -> images. */
  visualModeFor?: (chapterIndex: number, slideIndex: number) => 'table' | 'images' | 'none';
  /** AI suggestions give every sub-chapter a table, so there are no image pages. */
  noImages?: boolean;
}

export interface FakeApi {
  planRequests: Json[];
  batchRequests: Json[];
}

const BLANK_CHAPTERS = [
  '一、背景与目标',
  '二、关键问题分析',
  '三、方案与实施路径',
  '四、资源与保障',
  '五、效益与风险',
  '六、结论与建议',
];
const COVERAGE = ['sufficient', 'moderate', 'sparse'];

function defaultVisualMode(_chapterIndex: number, slideIndex: number): 'table' | 'images' {
  return slideIndex % 2 ? 'table' : 'images';
}

export function buildPlanResponse(body: Json, options: FakeApiOptions = {}): Json {
  const modeFor = options.noImages ? () => 'table' as const : (options.visualModeFor ?? defaultVisualMode);
  const requested: Json[] = Array.isArray(body.chapters) ? body.chapters : [];
  const chapters = (requested.length
    ? requested
    : BLANK_CHAPTERS.map((title, index) => ({
        chapterIndex: index + 1,
        chapterTitle: title,
        slides: [
          { subtitle: `${title.slice(2)}要点一`, visualMode: 'table', contentHint: '示例提示' },
          { subtitle: `${title.slice(2)}要点二`, visualMode: 'images', contentHint: '示例提示' },
        ],
      }))
  ).map((chapter: Json, index: number) => ({
    ...chapter,
    chapterIndex: index + 1,
    aiReason: `第${index + 1}章与文档内容匹配（示例理由）。`,
    coverageLevel: COVERAGE[index % COVERAGE.length],
    sourceHint: `示例线索 ${index + 1}`,
    slides: chapter.slides.map((slide: Json, slideIndex: number) => ({
      ...slide,
      visualMode: modeFor(index + 1, slideIndex + 1),
    })),
  }));
  return {
    presetId: body.presetId,
    coverInfo: {},
    endingInfo: {},
    chapters,
    apiPlanMeta: {
      provider: 'gemini:fake',
      recommendedAt: '2026-10-03T08:00:00.000Z',
      chapterInsights: chapters.map((chapter: Json) => ({
        chapterIndex: chapter.chapterIndex,
        reason: chapter.aiReason,
        coverageLevel: chapter.coverageLevel,
        sourceHint: chapter.sourceHint,
      })),
      slideInsights: chapters.flatMap((chapter: Json) =>
        chapter.slides.map((slide: Json, slideIndex: number) => ({
          chapterIndex: chapter.chapterIndex,
          slideIndex: slideIndex + 1,
          subtitle: slide.subtitle,
          visualMode: slide.visualMode,
          reason: `子页面 ${chapter.chapterIndex}-${slideIndex + 1} 示例理由。`,
        })),
      ),
    },
  };
}

/** Answer for POST /api/generate-content/batch: one slide per page, even pages weakly grounded. */
export function buildBatchResult(body: Json, options: FakeApiOptions = {}): Json {
  const slides = (body.contexts as Json[]).map((context) => {
    const current = context.page as number;
    const slide: Json = {
      page: current,
      bodyText: `${context.subtitle}：测量范围 0～10 kPa，准确度优于 1%（示例第 ${current} 页）。`,
      sourceRef: `示例原文第 ${current} 段`,
      sourceConfidence: current % 2 ? 'exact' : 'ai_constructed',
      aiSupplements: current % 2 ? [] : [{ description: `第 ${current} 页补充（示例）`, type: 'ai_summary' }],
    };
    if (context.visualMode === 'table') {
      slide.tableData = { headers: ['项目', '要求', '依据'], rows: [['测量范围', '0～10 kPa', '第 5 章'], ['准确度', '≤1%', '第 6 章']] };
    }
    if (context.visualMode === 'images') {
      slide.imagePrompts = [
        { description: `第 ${current} 页图 1`, iteiDrawPrompt: `diagram page ${current} a` },
        { description: `第 ${current} 页图 2`, iteiDrawPrompt: `diagram page ${current} b` },
      ];
    }
    return slide;
  });
  const pages = slides.map((slide) => slide.page as number);
  const weakPages = options.degraded ? pages : pages.filter((page) => page % 2 === 0);
  return {
    ok: !options.degraded,
    slides,
    weakPages,
    fallbackPages: options.degraded ? pages : [],
    diagnostics: { initialMissingPages: [], rewriteRecoveredPages: [], autoCompletedPages: [], finalMissingPages: [] },
  };
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export async function installFakeApi(page: Page, options: FakeApiOptions = {}): Promise<FakeApi> {
  const planRequests: Json[] = [];
  const batchRequests: Json[] = [];
  let batchErrorsLeft = options.batchError ? (options.batchError.times ?? 1) : 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/plan' && request.method() === 'POST') {
      const body = request.postDataJSON() as Json;
      planRequests.push(body);
      if (options.planError) {
        return json(route, options.planError.status, {
          error: { code: options.planError.code, message: options.planError.message ?? options.planError.code },
        });
      }
      return json(route, 200, buildPlanResponse(body, options));
    }

    if (path === '/api/generate-content/batch' && request.method() === 'POST') {
      const body = request.postDataJSON() as Json;
      batchRequests.push(body);
      if (options.hangAfterFirstBatch && batchRequests.length > 1) {
        return new Promise<void>(() => undefined);
      }
      if (options.batchDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.batchDelayMs));
      }
      if (options.batchError && batchErrorsLeft > 0) {
        batchErrorsLeft -= 1;
        const { status, code, message, details } = options.batchError;
        return json(route, status, { error: { code, message, details } });
      }
      return json(route, 200, buildBatchResult(body, options));
    }

    return json(route, 404, { error: { code: 'not_found', message: 'fake api: no route' } });
  });

  return { planRequests, batchRequests };
}
