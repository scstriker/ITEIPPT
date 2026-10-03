// Browser-level fake of the /api/* backend. Shapes follow docs/API.md.
import type { Page, Route } from '@playwright/test';

type Json = Record<string, any>;

export interface JobStep {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  percent: number;
  stage: string;
  error?: { code: string; message: string; details?: string };
}

export interface FakeApiOptions {
  planError?: { status: number; code: string; message?: string };
  jobSteps?: JobStep[];
  generationMeta?: { mode: 'normal' | 'degraded'; reason?: string };
  /** Visual mode by slide index (1-based) inside each chapter. Default: odd -> table, even -> images. */
  visualModeFor?: (chapterIndex: number, slideIndex: number) => 'table' | 'images' | 'none';
  /** Force every content slide to one visual mode in the generated result. */
  noImages?: boolean;
  /** Jobs that already exist on the server, keyed by jobId, with their original request body. */
  seedJobs?: Record<string, Json>;
}

export interface FakeApi {
  planRequests: Json[];
  jobRequests: Json[];
  statusRequests: string[];
  lastResult: () => Json | null;
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

export const DEFAULT_JOB_STEPS: JobStep[] = [
  { status: 'queued', percent: 0, stage: '排队中' },
  { status: 'running', percent: 40, stage: '正在生成内容（批次 1/2）' },
  { status: 'succeeded', percent: 100, stage: '已完成' },
];

function defaultVisualMode(_chapterIndex: number, slideIndex: number): 'table' | 'images' {
  return slideIndex % 2 ? 'table' : 'images';
}

export function buildPlanResponse(body: Json, options: FakeApiOptions = {}): Json {
  const modeFor = options.visualModeFor ?? defaultVisualMode;
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

export function buildAnalyzerResult(job: Json, options: FakeApiOptions = {}): Json {
  const plan = job.frameworkPlan;
  const slides: Json[] = [];
  const missingInfo: Json[] = [];
  let page = 1;
  slides.push({
    page: page++,
    type: 'cover',
    standardName: plan.coverInfo?.standardName,
    presenter: plan.coverInfo?.presenter,
    date: '2026-10-03',
    organization: plan.endingInfo?.organization,
  });
  const sectionItems = plan.chapters.map((chapter: Json, index: number) => ({
    number: String(index + 1).padStart(2, '0'),
    title: chapter.chapterTitle,
  }));
  for (const chapter of plan.chapters) {
    slides.push({ page: page++, type: 'toc_section', pageTitle: '汇报内容', highlightChapter: chapter.chapterIndex, sectionItems });
    chapter.slides.forEach((sub: Json) => {
      const visualMode = options.noImages && sub.visualMode === 'images' ? 'table' : sub.visualMode;
      const current = page++;
      const slide: Json = {
        page: current,
        type: 'content',
        chapterTitle: chapter.chapterTitle,
        subtitle: sub.subtitle,
        visualMode,
        bodyText: `${sub.subtitle}：测量范围 0～10 kPa，准确度优于 1%（示例第 ${current} 页）。`,
        highlightRanges: [[0, 4]],
        sourceRef: `示例原文第 ${current} 段`,
        sourceConfidence: current % 2 ? 'exact' : 'ai_constructed',
        aiSupplements: current % 2 ? [] : [{ description: `第 ${current} 页补充（示例）`, type: 'ai_summary' }],
      };
      if (visualMode === 'table') {
        slide.tableData = { headers: ['项目', '要求', '依据'], rows: [['测量范围', '0～10 kPa', '第 5 章'], ['准确度', '≤1%', '第 6 章']] };
      }
      if (visualMode === 'images') {
        slide.imagePrompts = [
          { description: `第 ${current} 页图 1`, iteiDrawPrompt: `diagram page ${current} a` },
          { description: `第 ${current} 页图 2`, iteiDrawPrompt: `diagram page ${current} b` },
        ];
      }
      if (current % 2 === 0) {
        missingInfo.push({ page: current, description: '示例缺失项。', solution: '示例补充方式。' });
      }
      slides.push(slide);
    });
  }
  slides.push({ page: page++, type: 'ending', thanks: '敬请指正', organization: plan.endingInfo?.organization, contactInfo: [] });

  const content = slides.filter((slide) => slide.type === 'content');
  const exact = content.filter((slide) => slide.sourceConfidence === 'exact').length;
  return {
    frameworkPlan: plan,
    slidePlan: slides,
    sourceFiles: [{ id: 1, filename: job.sourceFilename ?? 'uploaded-document', shortName: job.sourceFilename ?? 'uploaded-document' }],
    missingInfo,
    imagePromptsTotal: content.reduce((sum, slide) => sum + (slide.imagePrompts?.length ?? 0), 0),
    auditSummary: {
      totalSlides: slides.length,
      exactSourcePercent: content.length ? Number(((exact / content.length) * 100).toFixed(2)) : 0,
      aiSupplementCount: content.reduce((sum, slide) => sum + slide.aiSupplements.length, 0),
      missingCount: missingInfo.length,
    },
    generationMeta: options.generationMeta ?? { mode: 'normal' },
    generatedAt: '2026-10-03T08:00:00.000Z',
  };
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export async function installFakeApi(page: Page, options: FakeApiOptions = {}): Promise<FakeApi> {
  const planRequests: Json[] = [];
  const jobRequests: Json[] = [];
  const statusRequests: string[] = [];
  const jobs = new Map<string, { request: Json; step: number }>();
  for (const [jobId, request] of Object.entries(options.seedJobs ?? {})) {
    jobs.set(jobId, { request, step: 0 });
  }
  let result: Json | null = null;
  const steps = options.jobSteps ?? DEFAULT_JOB_STEPS;

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

    if (path === '/api/generate-content/jobs' && request.method() === 'POST') {
      const body = request.postDataJSON() as Json;
      jobRequests.push(body);
      const jobId = `job-${jobRequests.length}`;
      jobs.set(jobId, { request: body, step: 0 });
      return json(route, 202, {
        jobId,
        status: 'queued',
        createdAt: '2026-10-03T08:00:00.000Z',
        pollUrl: `/api/generate-content/jobs/${jobId}`,
        resultUrl: `/api/generate-content/jobs/${jobId}/result`,
      });
    }

    const statusMatch = /^\/api\/generate-content\/jobs\/([^/]+)$/.exec(path);
    if (statusMatch) {
      const jobId = decodeURIComponent(statusMatch[1]);
      statusRequests.push(jobId);
      const job = jobs.get(jobId);
      if (!job) {
        return json(route, 404, { error: { code: 'generation_job_not_found', message: 'Generation job not found.' } });
      }
      const step = steps[Math.min(job.step, steps.length - 1)];
      job.step += 1;
      return json(route, 200, {
        jobId,
        status: step.status,
        progress: { percent: step.percent, stage: step.stage, processedBatches: 1, totalBatches: 2 },
        error: step.error,
        createdAt: '2026-10-03T08:00:00.000Z',
        updatedAt: '2026-10-03T08:00:01.000Z',
        resultReady: step.status === 'succeeded',
      });
    }

    const resultMatch = /^\/api\/generate-content\/jobs\/([^/]+)\/result$/.exec(path);
    if (resultMatch) {
      const job = jobs.get(decodeURIComponent(resultMatch[1]));
      if (!job) {
        return json(route, 404, { error: { code: 'generation_job_not_found', message: 'Generation job not found.' } });
      }
      result = buildAnalyzerResult(job.request, options);
      return json(route, 200, result);
    }

    return json(route, 404, { error: { code: 'not_found', message: 'fake api: no route' } });
  });

  return {
    planRequests,
    jobRequests,
    statusRequests,
    lastResult: () => result,
  };
}
