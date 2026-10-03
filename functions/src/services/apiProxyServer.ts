import express from 'express';
import type { Request } from 'express';
import { createFrameworkPlanFromPreset } from './presetFactory';
import {
  createGenerationJob,
  enqueueGenerationJob,
  getGenerationJob,
  markGenerationJobFailed,
  readGenerationJobResult,
  type GenerationJobRecord,
} from './generationJobStore';
import type {
  AISupplement,
  AISupplementType,
  AnalyzerResult,
  ImagePrompt,
  SlideContent,
  SlideTableData,
  SourceConfidence,
} from '../types/analyzer';
import type {
  ApiChapterInsight,
  ApiSlideInsight,
  ChapterPlan,
  CoverageLevel,
  FrameworkPlan,
  TemplatePreset,
} from '../types/framework';
import type { VisualMode } from '../types/template';

export interface ApiProxyOptions {
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiPlanModel?: string;
  geminiContentModel?: string;
}

interface ProxyErrorBody {
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

interface PlanRequestBody {
  presetId?: string;
  textContent?: string;
  chapters?: unknown;
}

export interface GenerateContentRequestBody {
  frameworkPlan?: unknown;
  textContent?: string;
  sourceFilename?: string;
}

export interface GenerateContentProgressUpdate {
  stage: 'preparing' | 'generating' | 'finalizing';
  percent: number;
  processedBatches: number;
  totalBatches: number;
}

export interface GenerateContentRuntimeHooks {
  onProgress?: (update: GenerateContentProgressUpdate) => void | Promise<void>;
  jobId?: string;
}

interface ChapterInsight {
  chapterIndex: number;
  reason: string;
  coverageLevel: CoverageLevel;
  sourceHint?: string;
}

interface SlideInsight {
  chapterIndex: number;
  slideIndex: number;
  visualMode: VisualMode;
  reason: string;
  sourceHint?: string;
}

interface GeneratedContentPayload {
  cover?: {
    standardName?: string;
    planNumber?: string;
    reportTitle?: string;
    presenter?: string;
    date?: string;
  };
  ending?: {
    thanks?: string;
    organization?: string;
    contactInfo?: string[];
  };
  slides?: Array<{
    page?: number;
    bodyText?: string;
    highlightRanges?: Array<[number, number]>;
    sourceRef?: string;
    sourceConfidence?: SourceConfidence;
    aiSupplements?: AISupplement[];
    tableData?: SlideTableData;
    imagePrompts?: ImagePrompt[];
  }>;
}

const VALID_PRESET_IDS: TemplatePreset['id'][] = ['standard_review', 'academic_research', 'blank'];
const MAX_TEXT_LENGTH = 120_000;
const MAX_CONTENT_TEXT_LENGTH = 180_000;
const CONTENT_PROMPT_MAX_DOC_CHARS = 36_000;
const CONTENT_PROMPT_COMPACT_DOC_CHARS = 8_000;
const CONTENT_BATCH_SIZE = 4;
const CONTENT_CALL_RETRY_MAX_ATTEMPTS = 2;
const CONTENT_SOFT_DEADLINE_MS = 500_000;
const CONTENT_SOFT_DEADLINE_GUARD_MS = 20_000;
const BLANK_MIN_CHAPTERS = 6;
const BLANK_MIN_SLIDES_PER_CHAPTER = 2;
const RETRIABLE_GEMINI_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const IMAGE_MODE_KEYWORDS = [
  '图',
  '流程',
  '架构',
  '机制',
  '趋势',
  '示意',
  '场景',
  '路线',
  '关系',
  '结构',
  '分布',
  '生态',
  '网络',
  '原理',
];
const TABLE_MODE_KEYWORDS = [
  '数据',
  '指标',
  '参数',
  '统计',
  '对比',
  '比例',
  '成本',
  '收益',
  '风险',
  '清单',
  '矩阵',
  '进度',
  '结果',
  '结论',
  '表',
];

function getBaseUrl(options: ApiProxyOptions): string {
  return (options.geminiBaseUrl ?? process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta')
    .replace(/\/+$/, '');
}

function getApiKey(options: ApiProxyOptions): string | undefined {
  const key = options.geminiApiKey ?? process.env.GEMINI_API_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : undefined;
}

function getPlanModel(options: ApiProxyOptions): string {
  const model = options.geminiPlanModel ?? process.env.GEMINI_PLAN_MODEL ?? 'gemini-2.5-flash';
  return model.trim();
}

function getContentModel(options: ApiProxyOptions): string {
  const model = options.geminiContentModel ?? process.env.GEMINI_CONTENT_MODEL ?? 'gemini-2.5-flash';
  return model.trim();
}

function writeError(res: express.Response, status: number, body: ProxyErrorBody): void {
  res.status(status).json(body);
}

function normalizeForwardPath(req: Request): string {
  const path = req.path.replace(/^\/api\/?/, '').trim();
  return path.replace(/^\/+/, '');
}

function appendQuery(url: URL, query: Request['query']): void {
  for (const [key, rawValue] of Object.entries(query)) {
    if (typeof rawValue === 'undefined') {
      continue;
    }
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        if (typeof value === 'string') {
          url.searchParams.append(key, value);
        }
      }
      continue;
    }
    if (typeof rawValue === 'string') {
      url.searchParams.append(key, rawValue);
    }
  }
}

function buildBody(req: Request): string | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  if (typeof req.body === 'undefined' || req.body === null) {
    return undefined;
  }
  return JSON.stringify(req.body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresetId(value: unknown): value is TemplatePreset['id'] {
  return typeof value === 'string' && VALID_PRESET_IDS.includes(value as TemplatePreset['id']);
}

function normalizeCoverageLevel(value: unknown): CoverageLevel {
  if (value === 'sufficient' || value === 'moderate' || value === 'sparse') {
    return value;
  }
  return 'moderate';
}

function normalizePlanVisualMode(value: unknown, fallback: VisualMode = 'table'): VisualMode {
  if (value === 'images' || value === 'table') {
    return value;
  }
  return fallback;
}

function inferVisualModeFromText(...parts: Array<string | undefined>): VisualMode {
  const text = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');

  if (!text) {
    return 'table';
  }

  const imageScore = IMAGE_MODE_KEYWORDS.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  const tableScore = TABLE_MODE_KEYWORDS.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  return imageScore > tableScore ? 'images' : 'table';
}

function fallbackSlideReason(mode: VisualMode): string {
  if (mode === 'images') {
    return 'This page is better expressed with diagrams and should use text + image prompts.';
  }
  return 'This page is better expressed with structured data and should use text + table.';
}

function normalizeSourceConfidence(value: unknown): SourceConfidence {
  if (value === 'exact' || value === 'paraphrased' || value === 'ai_inferred' || value === 'ai_constructed') {
    return value;
  }
  return 'paraphrased';
}

function normalizeSupplementType(value: unknown): AISupplementType {
  if (
    value === 'common_knowledge' ||
    value === 'ai_summary' ||
    value === 'ai_inference' ||
    value === 'ai_construction' ||
    value === 'chart_design'
  ) {
    return value;
  }
  return 'ai_summary';
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function extractTitleFromText(text: string): string | undefined {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return undefined;
  }
  return truncateText(firstLine, 120);
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

function parseGeminiUpstreamError(message: string): { status: number; details: string } | null {
  const match = /^gemini_upstream_error:(\d+):(.*)$/s.exec(message);
  if (!match) {
    return null;
  }
  const status = Number(match[1]);
  if (!Number.isFinite(status)) {
    return null;
  }
  return {
    status,
    details: match[2],
  };
}

function extractJsonCandidate(raw: string): string | null {
  const starts = [raw.indexOf('{'), raw.indexOf('[')].filter((index) => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        stack.push('}');
        continue;
      }
      if (char === '[') {
        stack.push(']');
        continue;
      }
      if (char !== '}' && char !== ']') {
        continue;
      }
      const expected = stack.pop();
      if (!expected || expected !== char) {
        break;
      }
      if (stack.length === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }
  return null;
}

function parseJsonFromGeminiText(rawText: string): unknown {
  const normalized = stripJsonFence(rawText);
  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    const candidate = extractJsonCandidate(normalized);
    if (candidate) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // ignore candidate parse failure and throw unified error below
      }
    }
    const message = error instanceof Error ? error.message : 'unknown_json_parse_error';
    throw new Error(`gemini_invalid_json:${message}`);
  }
}

function parseGeminiPayloadFromText(rawText: string): unknown {
  const normalized = rawText.trim();
  if (!normalized) {
    return {};
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    const candidate = extractJsonCandidate(normalized);
    if (candidate) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // ignore and throw unified error below
      }
    }
    const message = error instanceof Error ? error.message : 'unknown_upstream_json_parse_error';
    throw new Error(`gemini_upstream_invalid_json:${message}`);
  }
}

function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error('Invalid Gemini response payload.');
  }
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Gemini response does not include candidates.');
  }
  const first = candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    throw new Error('Gemini candidate content is invalid.');
  }
  const part = first.content.parts.find((item: unknown) => isRecord(item) && typeof item.text === 'string');
  if (!part || typeof part.text !== 'string') {
    throw new Error('Gemini candidate text is empty.');
  }
  return part.text;
}

async function callGeminiJson(options: ApiProxyOptions, model: string, prompt: string): Promise<unknown> {
  const apiKey = getApiKey(options);
  if (!apiKey) {
    throw new Error('missing_api_key');
  }

  const url = new URL(`${getBaseUrl(options)}/models/${encodeURIComponent(model)}:generateContent`);
  url.searchParams.set('key', apiKey);

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`gemini_upstream_error:${upstream.status}:${text}`);
  }

  const geminiPayload = parseGeminiPayloadFromText(text);
  const outputText = extractGeminiText(geminiPayload);
  return parseJsonFromGeminiText(outputText);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isGeminiInvalidJsonError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('gemini_invalid_json:') || error.message.startsWith('gemini_upstream_invalid_json:'))
  );
}

function isRetriableGeminiError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const upstream = parseGeminiUpstreamError(error.message);
  if (!upstream) {
    return false;
  }
  return RETRIABLE_GEMINI_STATUS_CODES.has(upstream.status);
}

async function callGeminiJsonWithRetry(options: ApiProxyOptions, model: string, prompt: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CONTENT_CALL_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callGeminiJson(options, model, prompt);
    } catch (error) {
      if (error instanceof Error && error.message === 'missing_api_key') {
        throw error;
      }
      lastError = error;
      const canRetry = isRetriableGeminiError(error) || isGeminiInvalidJsonError(error);
      if (!canRetry || attempt >= CONTENT_CALL_RETRY_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(300 * attempt);
    }
  }
  throw (lastError instanceof Error ? lastError : new Error('gemini_call_failed'));
}

function parseRequestChapters(raw: unknown): ChapterPlan[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const chapters: ChapterPlan[] = [];
  for (let chapterIndex = 0; chapterIndex < raw.length; chapterIndex += 1) {
    const chapter = raw[chapterIndex];
    if (!isRecord(chapter) || !Array.isArray(chapter.slides)) {
      continue;
    }

    const chapterTitle =
      typeof chapter.chapterTitle === 'string' && chapter.chapterTitle.trim().length
        ? chapter.chapterTitle.trim()
        : `第${chapterIndex + 1}章`;

    const slides = chapter.slides
      .map((slide, slideIndex) => {
        if (!isRecord(slide)) {
          return null;
        }
        const subtitle =
          typeof slide.subtitle === 'string' && slide.subtitle.trim().length
            ? slide.subtitle.trim()
            : `子页面 ${slideIndex + 1}`;
        const contentHint =
          typeof slide.contentHint === 'string' && slide.contentHint.trim().length ? slide.contentHint.trim() : undefined;
        return {
          subtitle,
          contentHint,
          visualMode: normalizePlanVisualMode(slide.visualMode, inferVisualModeFromText(chapterTitle, subtitle, contentHint)),
        };
      })
      .filter((item): item is Exclude<typeof item, null> => item !== null);

    if (!slides.length) {
      continue;
    }

    chapters.push({
      chapterIndex: chapters.length + 1,
      chapterTitle,
      slides,
    });
  }

  return chapters.length ? chapters : null;
}

function resolveBasePlan(reqBody: PlanRequestBody): FrameworkPlan {
  const fromPreset = createFrameworkPlanFromPreset(reqBody.presetId as TemplatePreset['id']);
  const requestChapters = parseRequestChapters(reqBody.chapters);
  if (!requestChapters) {
    return fromPreset;
  }
  return {
    ...fromPreset,
    chapters: requestChapters,
  };
}

function buildBlankDraftPrompt(textContent: string): string {
  return [
    '你是 PPT 结构规划助手。当前是 blank 自定义模式，需要先生成章节和子页面结构。',
    '请严格输出 JSON，不要输出 markdown。',
    'JSON 缁撴瀯锛歿"chapters":[{"chapterTitle":"...","slides":[{"subtitle":"...","contentHint":"...","visualMode":"table|images"}]}]}',
    '规则：',
    '1) 生成 4-8 个章节，每章 1-3 个子页面。',
    '2) chapterTitle 与 subtitle 使用中文，避免空泛标题。',
    '3) contentHint 使用中文短句，说明该页应覆盖的关键信息。',
    '4) visualMode 只能是 table 或 images。',
    '5) 优先依据文档内容组织结构；若素材不足也要给出可执行框架。',
    '',
    '文档内容如下（可能截断）：',
    textContent,
  ].join('\n');
}

function parseDraftChapters(raw: unknown): ChapterPlan[] {
  if (!isRecord(raw) || !Array.isArray(raw.chapters)) {
    return [];
  }

  const chapters: ChapterPlan[] = [];
  for (let chapterIndex = 0; chapterIndex < raw.chapters.length && chapters.length < 12; chapterIndex += 1) {
    const chapter = raw.chapters[chapterIndex];
    if (!isRecord(chapter) || !Array.isArray(chapter.slides)) {
      continue;
    }

    const chapterTitle =
      typeof chapter.chapterTitle === 'string' && chapter.chapterTitle.trim().length
        ? chapter.chapterTitle.trim()
        : `第${chapterIndex + 1}章`;

    const slides = chapter.slides
      .map((slide, slideIndex) => {
        if (!isRecord(slide)) {
          return null;
        }
        const subtitle =
          typeof slide.subtitle === 'string' && slide.subtitle.trim().length
            ? slide.subtitle.trim()
            : `子页面 ${slideIndex + 1}`;
        const contentHint =
          typeof slide.contentHint === 'string' && slide.contentHint.trim().length ? slide.contentHint.trim() : undefined;
        return {
          subtitle,
          contentHint,
          visualMode: normalizePlanVisualMode(slide.visualMode, inferVisualModeFromText(chapterTitle, subtitle, contentHint)),
        };
      })
      .filter((item): item is Exclude<typeof item, null> => item !== null);

    if (!slides.length) {
      continue;
    }

    chapters.push({
      chapterIndex: chapters.length + 1,
      chapterTitle,
      slides,
    });
  }

  return chapters;
}

function buildFallbackBlankChapters(): ChapterPlan[] {
  return [
    {
      chapterIndex: 1,
      chapterTitle: '一、背景与目标',
      slides: [
        { subtitle: '现状背景与目标定义', contentHint: '说明现状问题、目标与约束。', visualMode: 'table' },
        { subtitle: '建设范围与边界', contentHint: '明确本次建设的范围、边界和交付目标。', visualMode: 'table' },
      ],
    },
    {
      chapterIndex: 2,
      chapterTitle: '二、关键问题分析',
      slides: [
        { subtitle: '核心问题与影响因素', contentHint: '梳理主要问题及其影响。', visualMode: 'images' },
        { subtitle: '问题根因拆解', contentHint: '从组织、流程、技术层面分析根因。', visualMode: 'table' },
      ],
    },
    {
      chapterIndex: 3,
      chapterTitle: '三、方案与实施路径',
      slides: [
        { subtitle: '方案对比与实施步骤', contentHint: '给出候选方案与执行路径。', visualMode: 'table' },
        { subtitle: '里程碑与阶段计划', contentHint: '列出阶段目标、里程碑和关键节点。', visualMode: 'table' },
      ],
    },
    {
      chapterIndex: 4,
      chapterTitle: '四、资源与保障',
      slides: [
        { subtitle: '资源配置建议', contentHint: '说明人力、预算、系统和数据资源配置。', visualMode: 'table' },
        { subtitle: '实施保障机制', contentHint: '给出组织协同与风险保障机制。', visualMode: 'images' },
      ],
    },
    {
      chapterIndex: 5,
      chapterTitle: '五、效益与风险',
      slides: [
        { subtitle: '预期效益', contentHint: '量化效率、质量和成本效益。', visualMode: 'table' },
        { subtitle: '风险识别与应对', contentHint: '识别主要风险并给出应对策略。', visualMode: 'images' },
      ],
    },
    {
      chapterIndex: 6,
      chapterTitle: '六、结论与建议',
      slides: [
        { subtitle: '结论摘要', contentHint: '归纳关键结论。', visualMode: 'table' },
        { subtitle: '下一步行动建议', contentHint: '给出可执行的后续计划。', visualMode: 'images' },
      ],
    },
  ];
}

function ensureBlankChapterFloor(chapters: ChapterPlan[]): ChapterPlan[] {
  const templateChapters = buildFallbackBlankChapters();
  const targetChapterCount = Math.max(BLANK_MIN_CHAPTERS, chapters.length);
  const normalized: ChapterPlan[] = [];

  for (let chapterIndex = 0; chapterIndex < targetChapterCount; chapterIndex += 1) {
    const templateChapter = templateChapters[chapterIndex % templateChapters.length];
    const sourceChapter = chapters[chapterIndex] ?? templateChapter;
    const chapterTitle =
      normalizeOptionalText(sourceChapter.chapterTitle) ??
      normalizeOptionalText(templateChapter.chapterTitle) ??
      `第${chapterIndex + 1}章`;

    const sourceSlides = Array.isArray(sourceChapter.slides) ? sourceChapter.slides : [];
    const targetSlideCount = Math.max(BLANK_MIN_SLIDES_PER_CHAPTER, sourceSlides.length);
    const slides: ChapterPlan['slides'] = [];

    for (let slideIndex = 0; slideIndex < targetSlideCount; slideIndex += 1) {
      const templateSlide = templateChapter.slides[slideIndex % templateChapter.slides.length];
      const sourceSlide = sourceSlides[slideIndex] ?? templateSlide;
      const subtitle =
        normalizeOptionalText(sourceSlide?.subtitle) ??
        normalizeOptionalText(templateSlide.subtitle) ??
        `子页面 ${slideIndex + 1}`;
      const contentHint =
        normalizeOptionalText(sourceSlide?.contentHint) ??
        normalizeOptionalText(templateSlide.contentHint) ??
        `补充第${chapterIndex + 1}章第${slideIndex + 1}页要点。`;
      const visualMode = normalizePlanVisualMode(
        sourceSlide?.visualMode,
        inferVisualModeFromText(chapterTitle, subtitle, contentHint),
      );
      slides.push({
        subtitle,
        contentHint,
        visualMode,
      });
    }

    normalized.push({
      chapterIndex: chapterIndex + 1,
      chapterTitle,
      slides,
      aiReason: sourceChapter.aiReason,
      coverageLevel: sourceChapter.coverageLevel,
      sourceHint: sourceChapter.sourceHint,
    });
  }

  return normalized;
}

function applyBlankPlanMinimum(plan: FrameworkPlan): FrameworkPlan {
  if (plan.presetId !== 'blank') {
    return plan;
  }
  return {
    ...plan,
    chapters: ensureBlankChapterFloor(plan.chapters),
  };
}

function pickSourceHint(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] ? truncateText(lines[0], 48) : undefined;
}

function inferFallbackCoverage(chapter: ChapterPlan, textContent: string): CoverageLevel {
  const text = textContent.trim();
  if (!text) {
    return 'sparse';
  }
  if (text.length < 120) {
    return 'moderate';
  }

  const title = chapter.chapterTitle.replace(/[涓€浜屼笁鍥涗簲鍏竷鍏節鍗併€乗s]/g, '').slice(0, 8);
  if (title && text.includes(title)) {
    return 'sufficient';
  }
  return 'moderate';
}

function buildFallbackChapterReason(chapter: ChapterPlan): string {
  return `已基于章节标题“${chapter.chapterTitle}”生成默认分析，建议再执行 AI 建议调整以提升匹配度。`;
}

function buildFallbackSlideReason(chapter: ChapterPlan, slide: ChapterPlan['slides'][number]): string {
  const modeLabel = slide.visualMode === 'images' ? '文字+图片' : '文字+表格';
  return `该子页面围绕“${slide.subtitle}”生成，建议采用${modeLabel}呈现。`;
}

function buildFallbackInsights(plan: FrameworkPlan, textContent: string): {
  chapterInsights: ChapterInsight[];
  slideInsights: SlideInsight[];
} {
  const chapterInsights: ChapterInsight[] = plan.chapters.map((chapter) => ({
    chapterIndex: chapter.chapterIndex,
    reason: chapter.aiReason?.trim() || buildFallbackChapterReason(chapter),
    coverageLevel: chapter.coverageLevel ?? inferFallbackCoverage(chapter, textContent),
    sourceHint: chapter.sourceHint ?? pickSourceHint(textContent),
  }));

  const slideInsights: SlideInsight[] = plan.chapters.flatMap((chapter) =>
    chapter.slides.map((slide, index) => ({
      chapterIndex: chapter.chapterIndex,
      slideIndex: index + 1,
      visualMode: normalizePlanVisualMode(
        slide.visualMode,
        inferVisualModeFromText(chapter.chapterTitle, slide.subtitle, slide.contentHint),
      ),
      reason: buildFallbackSlideReason(chapter, slide),
      sourceHint: pickSourceHint(textContent),
    })),
  );

  return { chapterInsights, slideInsights };
}

function parseChapterInsights(raw: unknown, chapterCount: number): ChapterInsight[] {
  if (!isRecord(raw) || !Array.isArray(raw.chapterInsights)) {
    throw new Error('AI output missing chapterInsights array.');
  }

  const parsed: ChapterInsight[] = [];
  for (const item of raw.chapterInsights) {
    if (!isRecord(item)) {
      continue;
    }
    const chapterIndex = Number(item.chapterIndex);
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    const sourceHint = typeof item.sourceHint === 'string' ? item.sourceHint.trim() : undefined;
    if (!Number.isFinite(chapterIndex) || chapterIndex < 1 || chapterIndex > chapterCount || !reason) {
      continue;
    }
    parsed.push({
      chapterIndex,
      reason,
      coverageLevel: normalizeCoverageLevel(item.coverageLevel),
      sourceHint,
    });
  }
  return parsed;
}

function parseSlideInsights(raw: unknown, plan: FrameworkPlan): SlideInsight[] {
  if (!isRecord(raw) || !Array.isArray(raw.slideInsights)) {
    throw new Error('AI output missing slideInsights array.');
  }

  const chapterByIndex = new Map<number, ChapterPlan>();
  for (const chapter of plan.chapters) {
    chapterByIndex.set(chapter.chapterIndex, chapter);
  }

  const parsed: SlideInsight[] = [];
  for (const item of raw.slideInsights) {
    if (!isRecord(item)) {
      continue;
    }
    const chapterIndex = Number(item.chapterIndex);
    const slideIndex = Number(item.slideIndex);
    const chapter = chapterByIndex.get(chapterIndex);
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    const sourceHint = typeof item.sourceHint === 'string' ? item.sourceHint.trim() : undefined;
    if (!chapter || !Number.isFinite(slideIndex) || slideIndex < 1 || slideIndex > chapter.slides.length || !reason) {
      continue;
    }
    parsed.push({
      chapterIndex,
      slideIndex,
      visualMode: normalizePlanVisualMode(item.visualMode, inferVisualModeFromText(chapter.chapterTitle, reason)),
      reason,
      sourceHint,
    });
  }
  return parsed;
}

function buildInsightsPrompt(plan: FrameworkPlan, textContent: string): string {
  const chapterLines = plan.chapters
    .map((chapter) => {
      const subtitles = chapter.slides
        .map(
          (slide, slideIndex) =>
            `slideIndex=${slideIndex + 1}; subtitle=${slide.subtitle}; hint=${slide.contentHint ?? 'N/A'}`,
        )
        .join(' | ');
      return `- chapterIndex=${chapter.chapterIndex}; chapterTitle=${chapter.chapterTitle}; ${subtitles}`;
    })
    .join('\n');

  return [
    '你是 PPT 框架规划助手，需要评估文档内容与章节结构匹配度，并为每个子页面自动决定可视化形式。',
    '请严格输出 JSON，不要输出 markdown。',
    'JSON 缁撴瀯锛歿"chapterInsights":[{"chapterIndex":1,"reason":"...","coverageLevel":"sufficient|moderate|sparse","sourceHint":"..."}],"slideInsights":[{"chapterIndex":1,"slideIndex":1,"visualMode":"table|images","reason":"...","sourceHint":"..."}]}',
    '规则：',
    '1) chapterInsights 必须覆盖全部章节，每章 1 条。',
    '2) slideInsights 必须覆盖全部子页面，每页 1 条，visualMode 只能是 table 或 images。',
    '3) 当前页更偏数据对比/参数清单/指标统计时选 table；更偏流程关系/机制原理/场景示意时选 images。',
    '4) chapterInsights.reason 用中文 20-80 字，slideInsights.reason 用中文 12-50 字。',
    '5) sourceHint 用中文短语，尽量给出可追溯线索。',
    '',
    '章节定义如下：',
    chapterLines,
    '',
    '鏂囨。鍐呭濡備笅锛堝彲鑳借鎴柇锛夛細',
    textContent,
  ].join('\n');
}

function slideInsightKey(chapterIndex: number, slideIndex: number): string {
  return `${chapterIndex}:${slideIndex}`;
}
function applyChapterInsights(
  basePlan: FrameworkPlan,
  chapterInsights: ChapterInsight[],
  slideInsights: SlideInsight[],
  provider: string,
): FrameworkPlan {
  const chapterInsightByIndex = new Map<number, ChapterInsight>();
  for (const insight of chapterInsights) {
    chapterInsightByIndex.set(insight.chapterIndex, insight);
  }
  const slideInsightByKey = new Map<string, SlideInsight>();
  for (const insight of slideInsights) {
    slideInsightByKey.set(slideInsightKey(insight.chapterIndex, insight.slideIndex), insight);
  }
  const chapters = basePlan.chapters.map((chapter) => {
    const chapterInsight = chapterInsightByIndex.get(chapter.chapterIndex);
    const slides = chapter.slides.map((slide, slideIndex) => {
      const insight = slideInsightByKey.get(slideInsightKey(chapter.chapterIndex, slideIndex + 1));
      return {
        ...slide,
        visualMode:
          insight?.visualMode ??
          normalizePlanVisualMode(
            slide.visualMode,
            inferVisualModeFromText(chapter.chapterTitle, slide.subtitle, slide.contentHint, chapterInsight?.reason),
          ),
      };
    });
    return {
      ...chapter,
      slides,
      aiReason: chapterInsight?.reason ?? chapter.aiReason,
      coverageLevel: chapterInsight?.coverageLevel ?? chapter.coverageLevel ?? 'moderate',
      sourceHint: chapterInsight?.sourceHint ?? chapter.sourceHint,
    };
  });
  const outputChapterInsights: ApiChapterInsight[] = chapters.map((chapter) => ({
    chapterIndex: chapter.chapterIndex,
    reason: chapter.aiReason ?? 'No valid chapter insight from AI; please review this chapter manually.',
    coverageLevel: chapter.coverageLevel ?? 'moderate',
    sourceHint: chapter.sourceHint,
  }));
  const outputSlideInsights: ApiSlideInsight[] = chapters.flatMap((chapter) =>
    chapter.slides.map((slide, slideIndex) => {
      const insight = slideInsightByKey.get(slideInsightKey(chapter.chapterIndex, slideIndex + 1));
      return {
        chapterIndex: chapter.chapterIndex,
        slideIndex: slideIndex + 1,
        subtitle: slide.subtitle,
        visualMode: normalizePlanVisualMode(
          slide.visualMode,
          inferVisualModeFromText(chapter.chapterTitle, slide.subtitle, slide.contentHint),
        ),
        reason: insight?.reason ?? fallbackSlideReason(slide.visualMode),
        sourceHint: insight?.sourceHint,
      };
    }),
  );
  return {
    ...basePlan,
    chapters,
    apiPlanMeta: {
      provider,
      recommendedAt: new Date().toISOString(),
      chapterInsights: outputChapterInsights,
      slideInsights: outputSlideInsights,
    },
  };
}
async function generatePlanWithGemini(
  options: ApiProxyOptions,
  reqBody: PlanRequestBody,
): Promise<FrameworkPlan> {
  if (!isPresetId(reqBody.presetId)) {
    throw new Error('invalid_preset');
  }
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  if (!textContent) {
    throw new Error('missing_text_content');
  }
  let basePlan = resolveBasePlan(reqBody);
  if (reqBody.presetId === 'blank') {
    basePlan = applyBlankPlanMinimum(basePlan);
  }
  const provider = `gemini:${getPlanModel(options)}`;
  const truncatedText = truncateText(textContent, MAX_TEXT_LENGTH);
  if (!basePlan.chapters.length) {
    if (reqBody.presetId === 'blank') {
      let draftChapters: ChapterPlan[] = [];
      try {
        const draftPrompt = buildBlankDraftPrompt(truncatedText);
        const draftJson = await callGeminiJson(options, getPlanModel(options), draftPrompt);
        draftChapters = parseDraftChapters(draftJson);
      } catch (error) {
        if (error instanceof Error && error.message === 'missing_api_key') {
          throw error;
        }
      }
      basePlan = applyBlankPlanMinimum({
        ...basePlan,
        chapters: draftChapters.length ? draftChapters : buildFallbackBlankChapters(),
      });
    } else {
      return applyChapterInsights(basePlan, [], [], provider);
    }
  }

  try {
    const prompt = buildInsightsPrompt(basePlan, truncatedText);
    const outputJson = await callGeminiJson(options, getPlanModel(options), prompt);
    const chapterInsights = parseChapterInsights(outputJson, basePlan.chapters.length);
    const slideInsights = parseSlideInsights(outputJson, basePlan);
    const planned = applyChapterInsights(basePlan, chapterInsights, slideInsights, provider);
    return reqBody.presetId === 'blank' ? applyBlankPlanMinimum(planned) : planned;
  } catch (error) {
    if (error instanceof Error && error.message === 'missing_api_key') {
      throw error;
    }
    const fallback = buildFallbackInsights(basePlan, truncatedText);
    const planned = applyChapterInsights(basePlan, fallback.chapterInsights, fallback.slideInsights, `${provider}:fallback`);
    return reqBody.presetId === 'blank' ? applyBlankPlanMinimum(planned) : planned;
  }
}
function isFrameworkPlan(value: unknown): value is FrameworkPlan {
  return isRecord(value) && isPresetId(value.presetId) && Array.isArray(value.chapters);
}

function toSourceFiles(filename: string | undefined): AnalyzerResult['sourceFiles'] {
  const safeName = filename?.trim() || 'uploaded-document';
  const shortName = safeName.length > 28 ? `${safeName.slice(0, 25)}...` : safeName;
  return [{ id: 1, filename: safeName, shortName }];
}

interface SlidePlanFallbackOptions {
  textContent?: string;
  sourceFilename?: string;
}

function resolveCoverTitle(frameworkPlan: FrameworkPlan, options: SlidePlanFallbackOptions): string | undefined {
  const fromPlan = normalizeOptionalText(frameworkPlan.coverInfo.standardName);
  if (fromPlan) {
    return fromPlan;
  }
  const fromText = options.textContent ? extractTitleFromText(options.textContent) : undefined;
  if (fromText) {
    return fromText;
  }
  if (!options.sourceFilename) {
    return undefined;
  }
  return normalizeOptionalText(stripFileExtension(options.sourceFilename));
}

function buildSlidePlanFromFramework(
  frameworkPlan: FrameworkPlan,
  options: SlidePlanFallbackOptions = {},
): SlideContent[] {
  const slides: SlideContent[] = [];
  const tocSectionItems = frameworkPlan.chapters.map((item, idx) => ({
    number: String(idx + 1).padStart(2, '0'),
    title: normalizeOptionalText(item.chapterTitle) ?? `第${idx + 1}章`,
  }));
  let page = 1;
  const coverTitle = resolveCoverTitle(frameworkPlan, options);
  const presenter = normalizeOptionalText(frameworkPlan.coverInfo.presenter);
  const planNumber = normalizeOptionalText(frameworkPlan.coverInfo.planNumber);
  const coverDate = normalizeOptionalText(frameworkPlan.coverInfo.date) ?? new Date().toISOString().slice(0, 10);
  const organization = normalizeOptionalText(frameworkPlan.endingInfo.organization);

  slides.push({
    page,
    type: 'cover',
    standardName: coverTitle,
    planNumber,
    presenter,
    date: coverDate,
    organization,
  });
  page += 1;

  for (const chapter of frameworkPlan.chapters) {
    slides.push({
      page,
      type: 'toc_section',
      pageTitle: '汇报内容',
      highlightChapter: chapter.chapterIndex,
      sectionItems: tocSectionItems.map((item) => ({ ...item })),
    });
    page += 1;

    for (const sub of chapter.slides) {
      slides.push({
        page,
        type: 'content',
        chapterTitle: chapter.chapterTitle,
        subtitle: sub.subtitle,
        visualMode: sub.visualMode as VisualMode,
        bodyText: '',
        sourceConfidence: 'paraphrased',
      });
      page += 1;
    }
  }

  slides.push({
    page,
    type: 'ending',
    thanks: '敬请指正',
    organization,
    contactInfo: frameworkPlan.endingInfo.contactInfo ?? [],
  });

  return slides;
}

interface SlidePageMeta {
  chapterIndex: number;
  slideIndex: number;
  chapterTitle: string;
  subtitle: string;
  contentHint?: string;
  visualMode: VisualMode;
  sourceHint?: string;
  slideReason?: string;
}

interface SlideEvidenceCandidate {
  text: string;
  score: number;
}

interface SlideEvidenceContext {
  page: number;
  chapterIndex: number;
  slideIndex: number;
  chapterTitle: string;
  subtitle: string;
  contentHint?: string;
  visualMode: VisualMode;
  sourceHint?: string;
  evidenceSnippets: string[];
  primarySourceRef: string;
  evidenceKeywords: string[];
}

interface SlideQualityResult {
  passed: boolean;
  reasons: string[];
  length: number;
  sentenceCount: number;
  titleOverlap: number;
  evidenceHits: number;
  concreteSignal: boolean;
}

const CONTENT_FALLBACK_BODY = '根据当前文档可提取信息不足，需补充原文依据后完善本页正文。';
const CONTENT_FALLBACK_SOURCE_REF = '待补充原文依据';
const BANNED_BODY_PREFIXES = ['本表总结了', '本页展示了', '如下表所示', '本页主要介绍', '下表显示'];
const CONCRETE_SIGNAL_PATTERN = /\d|%|万|亿|元|年|月|日|台|个|项|条|SQL|API|CPU|GPU|数据库|系统|平台/i;

function splitEvidenceSegments(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const raw = normalized
    .split('\n')
    .flatMap((line) => line.split(/[。！？；;]/))
    .map((item) => item.trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const segment of raw) {
    const length = Array.from(segment).length;
    if (length < 12 || length > 180) {
      continue;
    }
    if (!segments.includes(segment)) {
      segments.push(segment);
    }
  }
  return segments;
}

function buildSlidePageMetaMap(frameworkPlan: FrameworkPlan): Map<number, SlidePageMeta> {
  const map = new Map<number, SlidePageMeta>();
  const slideInsightByKey = new Map<string, ApiSlideInsight>();
  for (const insight of frameworkPlan.apiPlanMeta?.slideInsights ?? []) {
    slideInsightByKey.set(`${insight.chapterIndex}:${insight.slideIndex}`, insight);
  }

  let page = 1;
  page += 1;
  for (const chapter of frameworkPlan.chapters) {
    page += 1;
    for (let slideIndex = 0; slideIndex < chapter.slides.length; slideIndex += 1) {
      const slide = chapter.slides[slideIndex];
      const insight = slideInsightByKey.get(`${chapter.chapterIndex}:${slideIndex + 1}`);
      map.set(page, {
        chapterIndex: chapter.chapterIndex,
        slideIndex: slideIndex + 1,
        chapterTitle: chapter.chapterTitle,
        subtitle: slide.subtitle,
        contentHint: slide.contentHint,
        visualMode: slide.visualMode,
        sourceHint: insight?.sourceHint ?? chapter.sourceHint,
        slideReason: insight?.reason,
      });
      page += 1;
    }
  }
  return map;
}

function buildSlideEvidenceContexts(
  frameworkPlan: FrameworkPlan,
  baseSlides: SlideContent[],
  textContent: string,
): SlideEvidenceContext[] {
  const pageMetaMap = buildSlidePageMetaMap(frameworkPlan);
  const segments = splitEvidenceSegments(textContent);
  const contexts: SlideEvidenceContext[] = [];

  for (const slide of baseSlides) {
    if (slide.type !== 'content') {
      continue;
    }
    const meta = pageMetaMap.get(slide.page);
    const chapterIndex = meta?.chapterIndex ?? 0;
    const slideIndex = meta?.slideIndex ?? 0;
    const chapterTitle = meta?.chapterTitle ?? slide.chapterTitle ?? '';
    const subtitle = meta?.subtitle ?? slide.subtitle ?? '';
    const visualMode = (meta?.visualMode ?? slide.visualMode ?? 'table') as VisualMode;
    const sourceHint = meta?.sourceHint;
    const contentHint = meta?.contentHint;

    const priorityKeywords = extractKeywords([chapterTitle, subtitle].filter(Boolean).join(' '), 10);
    const mappingKeywords = dedupeKeywords([
      ...priorityKeywords,
      ...extractKeywords([contentHint ?? '', sourceHint ?? '', meta?.slideReason ?? ''].join(' '), 12),
      ...HIGHLIGHT_DOMAIN_KEYWORDS,
    ]);

    const candidates: SlideEvidenceCandidate[] = [];
    for (const segment of segments) {
      const priorityHits = countKeywordHits(segment, priorityKeywords);
      const mappingHits = countKeywordHits(segment, mappingKeywords);
      if (priorityHits === 0 && mappingHits === 0) {
        continue;
      }
      const signalBonus = CONCRETE_SIGNAL_PATTERN.test(segment) ? 2 : 0;
      const length = Array.from(segment).length;
      const lengthBonus = length >= 24 && length <= 90 ? 1 : 0;
      const score = priorityHits * 5 + mappingHits * 2 + signalBonus + lengthBonus;
      candidates.push({ text: segment, score });
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.text.length - a.text.length;
    });

    const evidenceSnippets = candidates.slice(0, 3).map((item) => item.text);
    const primarySourceRef = evidenceSnippets[0]
      ? truncateText(evidenceSnippets[0], 80)
      : sourceHint ?? CONTENT_FALLBACK_SOURCE_REF;

    const evidenceKeywords = dedupeKeywords([
      ...mappingKeywords,
      ...extractKeywords(evidenceSnippets.join(' '), 14),
    ]);

    contexts.push({
      page: slide.page,
      chapterIndex,
      slideIndex,
      chapterTitle,
      subtitle,
      contentHint,
      visualMode,
      sourceHint,
      evidenceSnippets,
      primarySourceRef,
      evidenceKeywords,
    });
  }

  return contexts;
}

function buildGenerateContentPrompt(
  frameworkPlan: FrameworkPlan,
  evidenceContexts: SlideEvidenceContext[],
  textContent: string,
  compactMode = false,
): string {
  const normalizedText = textContent.trim();
  const maxDocChars = compactMode ? CONTENT_PROMPT_COMPACT_DOC_CHARS : CONTENT_PROMPT_MAX_DOC_CHARS;
  let documentExcerpt = normalizedText;
  let isExcerptTruncated = false;
  if (documentExcerpt.length > maxDocChars) {
    isExcerptTruncated = true;
    const headLength = Math.floor(maxDocChars * 0.75);
    const tailLength = Math.max(0, maxDocChars - headLength);
    documentExcerpt = `${documentExcerpt.slice(0, headLength)}\n...\n${documentExcerpt.slice(-tailLength)}`;
  }
  if (!documentExcerpt) {
    documentExcerpt = 'N/A';
  }

  const taskLines = evidenceContexts
    .map((item) => {
      const snippets = item.evidenceSnippets.length
        ? item.evidenceSnippets.map((snippet, index) => `evidence${index + 1}=${snippet}`).join(' | ')
        : 'evidence=N/A';
      return [
        `- page=${item.page}; chapterIndex=${item.chapterIndex}; slideIndex=${item.slideIndex}; visualMode=${item.visualMode}`,
        `  chapterTitle=${item.chapterTitle}; subtitle=${item.subtitle}`,
        `  contentHint=${item.contentHint ?? 'N/A'}; sourceHint=${item.sourceHint ?? 'N/A'}`,
        `  preferredSourceRef=${item.primarySourceRef}`,
        `  ${snippets}`,
      ].join('\n');
    })
    .join('\n');

  return [
    'You are the ITEISlides content generator.',
    'Return strict JSON only. Do not return markdown.',
    'Return schema only:',
    '{"slides":[{"page":3,"bodyText":"","sourceRef":"","sourceConfidence":"exact|paraphrased|ai_inferred|ai_constructed","aiSupplements":[{"description":"","type":"common_knowledge|ai_summary|ai_inference|ai_construction|chart_design"}],"tableData":{"headers":[""],"rows":[[""]]},"imagePrompts":[{"description":"","iteiDrawPrompt":""}]}]}',
    'Rules:',
    '1) Only generate slides for content pages listed in page tasks. Do not output cover/ending.',
    '2) bodyText should be one concise Chinese paragraph with 1-3 sentences and 80-220 Chinese chars.',
    '3) Prioritize chapter/subtitle alignment: include conclusion + key evidence details when available.',
    '4) Do not start bodyText with: 本表总结了 / 本页展示了 / 如下表所示 / 本页主要介绍 / 下表显示.',
    '5) Keep traceability fields: sourceRef should be filled when possible; sourceConfidence prefer exact/paraphrased, but ai_inferred/ai_constructed is allowed if evidence is weak.',
    '6) Do not leave bodyText empty. If evidence is weak, provide a usable, topic-focused draft for later human review.',
    '7) For visualMode=table, provide tableData when possible (3 columns, 2-4 rows).',
    '8) For visualMode=images, provide 1-2 imagePrompts.',
    '9) Do not output highlightRanges.',
    compactMode
      ? '10) Compact mode: rely on page evidence as primary grounding; document text is only a short fallback excerpt.'
      : '10) Full mode: use evidence snippets first, and document excerpt only as supplementary context.',
    '',
    `framework presetId=${frameworkPlan.presetId}`,
    'Page tasks with evidence:',
    taskLines,
    '',
    `Document text (${compactMode ? 'compact' : 'full'} excerpt${isExcerptTruncated ? ', truncated' : ''}):`,
    documentExcerpt,
  ].join('\n');
}

function buildRewriteContentPrompt(
  failedContexts: SlideEvidenceContext[],
  currentSlides: NonNullable<GeneratedContentPayload['slides']>,
): string {
  const currentByPage = new Map<number, NonNullable<GeneratedContentPayload['slides']>[number]>();
  for (const item of currentSlides) {
    currentByPage.set(item.page ?? -1, item);
  }

  const failedLines = failedContexts
    .map((item) => {
      const current = currentByPage.get(item.page);
      const snippets = item.evidenceSnippets.length
        ? item.evidenceSnippets.map((snippet, index) => `evidence${index + 1}=${snippet}`).join(' | ')
        : 'evidence=N/A';
      return [
        `- page=${item.page}; visualMode=${item.visualMode}`,
        `  chapterTitle=${item.chapterTitle}; subtitle=${item.subtitle}`,
        `  currentBody=${current?.bodyText ?? ''}`,
        `  currentSourceRef=${current?.sourceRef ?? ''}; currentConfidence=${current?.sourceConfidence ?? ''}`,
        `  preferredSourceRef=${item.primarySourceRef}`,
        `  ${snippets}`,
      ].join('\n');
    })
    .join('\n');

  return [
    'Rewrite missing/empty pages only.',
    'Return strict JSON only:',
    '{"slides":[{"page":3,"bodyText":"","sourceRef":"","sourceConfidence":"exact|paraphrased|ai_inferred|ai_constructed"}]}',
    'Rules:',
    '1) bodyText should be one concise Chinese paragraph with 1-3 sentences and 80-220 Chinese chars.',
    '2) Keep content tightly aligned to chapterTitle/subtitle and use evidence snippets when available.',
    '3) Do not start with: 本表总结了 / 本页展示了 / 如下表所示 / 本页主要介绍 / 下表显示.',
    '4) Do not output empty bodyText. If evidence remains weak, output a usable draft and mark sourceConfidence as ai_inferred/ai_constructed.',
    '5) Keep sourceRef/sourceConfidence whenever possible for audit visibility.',
    '',
    'Failed pages:',
    failedLines,
  ].join('\n');
}

interface TextRangeCandidate {
  text: string;
  start: number;
  end: number;
  score: number;
  mappingHits: number;
  priorityHits: number;
  source: 'phrase' | 'sentence';
}

const HIGHLIGHT_DOMAIN_KEYWORDS = [
  '战略',
  '目标',
  '定位',
  '问题',
  '资源',
  '平台',
  '能力',
  '路径',
  '方案',
  '实施',
  '服务',
  '网站',
  '云服务',
  '数据',
  '指标',
  '成本',
  '收益',
  '风险',
  '结论',
  '建议',
  '算力',
  '存储',
];

const STRONG_DELIMITERS = new Set(['。', '！', '？', '；', ';', '\n']);
const WEAK_DELIMITERS = new Set(['，', ',', '、', '：', ':']);
const SIGNAL_KEYWORD_PATTERN = /\d|%|KPI|AI|GPU|CPU|指标|比例|增长|上升|下降|提升/i;

function isTrimBoundaryChar(char: string): boolean {
  return /\s/.test(char) || '，。！？；;、：:（）()【】《》「」“”\'`'.includes(char);
}

function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let left = start;
  let right = end;
  while (left < right && isTrimBoundaryChar(text[left])) {
    left += 1;
  }
  while (right > left && isTrimBoundaryChar(text[right - 1])) {
    right -= 1;
  }
  if (right <= left) {
    return null;
  }
  return { start: left, end: right };
}

function splitRangesByDelimiters(
  text: string,
  start: number,
  end: number,
  delimiters: Set<string>,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (let index = start; index < end; index += 1) {
    const char = text[index];
    if (!delimiters.has(char)) {
      continue;
    }
    if (cursor < index) {
      ranges.push({ start: cursor, end: index });
    }
    cursor = index + 1;
  }
  if (cursor < end) {
    ranges.push({ start: cursor, end });
  }
  return ranges;
}

function extractKeywords(text: string, maxCount = 8): string[] {
  const stopwords = new Set([
    '鏈珷',
    '鏈〉',
    '鏈',
    '閫氳繃',
    '杩涜',
    '鎻愬嚭',
    '璇存槑',
    '瀹炵幇',
    '鐩稿叧',
    '浠ュ強',
    '鍏朵腑',
  ]);
  const matches = text.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,8}/g) ?? [];
  const unique: string[] = [];
  for (const token of matches) {
    if (stopwords.has(token)) {
      continue;
    }
    if (!unique.includes(token)) {
      unique.push(token);
    }
    if (unique.length >= maxCount) {
      break;
    }
  }
  return unique;
}

function countKeywordHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const keyword of keywords) {
    if (keyword && text.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function dedupeKeywords(words: string[]): string[] {
  const output: string[] = [];
  for (const word of words) {
    if (!word || output.includes(word)) {
      continue;
    }
    output.push(word);
  }
  return output;
}

function buildHighlightKeywordContext(subtitle?: string, chapterTitle?: string): {
  priorityKeywords: string[];
  mappingKeywords: string[];
} {
  const titleWords = extractKeywords([subtitle ?? '', chapterTitle ?? ''].filter(Boolean).join(' '), 12);
  const priorityKeywords = dedupeKeywords(titleWords);
  const mappingKeywords = dedupeKeywords([...priorityKeywords, ...HIGHLIGHT_DOMAIN_KEYWORDS]);
  return {
    priorityKeywords,
    mappingKeywords,
  };
}

function sortHighlightCandidates(candidates: TextRangeCandidate[]): TextRangeCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.priorityHits !== a.priorityHits) {
      return b.priorityHits - a.priorityHits;
    }
    if (b.mappingHits !== a.mappingHits) {
      return b.mappingHits - a.mappingHits;
    }
    const lenA = Math.abs(16 - Array.from(a.text).length);
    const lenB = Math.abs(16 - Array.from(b.text).length);
    if (lenA !== lenB) {
      return lenA - lenB;
    }
    return a.start - b.start;
  });
}

function selectCandidates(
  candidates: TextRangeCandidate[],
  maxCount: number,
  maxCoverage: number,
): TextRangeCandidate[] {
  const sorted = sortHighlightCandidates(candidates);
  const selected: TextRangeCandidate[] = [];
  let coveredChars = 0;
  for (const candidate of sorted) {
    if (selected.length >= maxCount) {
      break;
    }
    if (selected.some((picked) => rangesOverlap(picked, candidate))) {
      continue;
    }
    const nextLength = candidate.end - candidate.start;
    if (coveredChars + nextLength > maxCoverage) {
      continue;
    }
    selected.push(candidate);
    coveredChars += nextLength;
  }
  return selected;
}

function createHighlightCandidate(
  text: string,
  range: { start: number; end: number },
  context: { priorityKeywords: string[]; mappingKeywords: string[] },
  source: 'phrase' | 'sentence',
): TextRangeCandidate | null {
  const trimmed = trimRange(text, range.start, range.end);
  if (!trimmed) {
    return null;
  }
  const candidateText = text.slice(trimmed.start, trimmed.end);
  const length = Array.from(candidateText).length;
  if (length < 8) {
    return null;
  }
  if (source === 'phrase' && length > 28) {
    return null;
  }
  if (source === 'sentence' && length > 88) {
    return null;
  }

  const priorityHits = countKeywordHits(candidateText, context.priorityKeywords);
  const domainHits = countKeywordHits(candidateText, HIGHLIGHT_DOMAIN_KEYWORDS);
  const mappingHits = countKeywordHits(candidateText, context.mappingKeywords);
  const signalScore = SIGNAL_KEYWORD_PATTERN.test(candidateText) ? 2 : 0;
  const lengthTarget = source === 'phrase' ? 16 : 24;
  const lengthScore = Math.max(0, 3 - Math.floor(Math.abs(lengthTarget - length) / 5));
  const sourceBonus = source === 'phrase' ? 2 : 1;
  const score = sourceBonus + priorityHits * 6 + mappingHits * 4 + domainHits * 2 + signalScore + lengthScore;

  return {
    text: candidateText,
    start: trimmed.start,
    end: trimmed.end,
    score,
    mappingHits,
    priorityHits,
    source,
  };
}

function deriveSemanticHighlightRanges(bodyText: string, subtitle?: string, chapterTitle?: string): Array<[number, number]> {
  if (!bodyText.trim()) {
    return [];
  }
  const text = bodyText;
  const maxCoverage = Math.max(12, Math.floor(text.length * 0.35));
  const context = buildHighlightKeywordContext(subtitle, chapterTitle);
  const sentenceRanges = splitRangesByDelimiters(text, 0, text.length, STRONG_DELIMITERS);

  const phraseMap = new Map<string, TextRangeCandidate>();
  for (const sentence of sentenceRanges) {
    const phraseRanges = splitRangesByDelimiters(text, sentence.start, sentence.end, WEAK_DELIMITERS);
    for (const phraseRange of phraseRanges) {
      const candidate = createHighlightCandidate(text, phraseRange, context, 'phrase');
      if (!candidate || candidate.mappingHits < 1) {
        continue;
      }
      const key = `${candidate.start}:${candidate.end}`;
      const prev = phraseMap.get(key);
      if (!prev || candidate.score > prev.score) {
        phraseMap.set(key, candidate);
      }
    }
  }

  const selectedPhrases = selectCandidates([...phraseMap.values()], 2, maxCoverage);
  if (selectedPhrases.length > 0) {
    return selectedPhrases
      .sort((a, b) => a.start - b.start)
      .map((item) => [item.start, item.end] as [number, number]);
  }

  const sentenceCandidates: TextRangeCandidate[] = [];
  for (const sentenceRange of sentenceRanges) {
    const candidate = createHighlightCandidate(text, sentenceRange, context, 'sentence');
    if (!candidate) {
      continue;
    }
    if (candidate.priorityHits < 1 && candidate.mappingHits < 1) {
      continue;
    }
    sentenceCandidates.push(candidate);
  }

  const selectedSentence = selectCandidates(sentenceCandidates, 1, maxCoverage);
  if (!selectedSentence.length) {
    return [];
  }

  const bestSentence = selectedSentence[0];
  return [[bestSentence.start, bestSentence.end]];
}

function normalizeRanges(ranges: unknown): Array<[number, number]> {
  if (!Array.isArray(ranges)) {
    return [];
  }
  const result: Array<[number, number]> = [];
  for (const item of ranges) {
    if (!Array.isArray(item) || item.length !== 2) {
      continue;
    }
    const start = Number(item[0]);
    const end = Number(item[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    result.push([Math.max(0, Math.floor(start)), Math.max(0, Math.floor(end))]);
  }
  return result;
}

function normalizeTableData(raw: unknown): SlideTableData | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.headers) || !Array.isArray(raw.rows)) {
    return undefined;
  }
  const headers = raw.headers.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  const rows = raw.rows
    .map((row) => (Array.isArray(row) ? row.map((cell) => (typeof cell === 'string' ? cell.trim() : '')) : []))
    .filter((row) => row.length > 0);
  if (!headers.length || !rows.length) {
    return undefined;
  }
  return { headers, rows };
}

function normalizeImagePrompts(raw: unknown): ImagePrompt[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const prompts: ImagePrompt[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const iteiDrawPrompt = typeof item.iteiDrawPrompt === 'string' ? item.iteiDrawPrompt.trim() : '';
    if (!description || !iteiDrawPrompt) {
      continue;
    }
    prompts.push({ description, iteiDrawPrompt });
  }
  return prompts;
}

function normalizeSupplements(raw: unknown): AISupplement[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const supplements: AISupplement[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!description) {
      continue;
    }
    supplements.push({
      description,
      type: normalizeSupplementType(item.type),
    });
  }
  return supplements;
}

function parseGeneratedContent(raw: unknown): GeneratedContentPayload {
  if (!isRecord(raw)) {
    return {};
  }

  const payload: GeneratedContentPayload = {};
  if (isRecord(raw.cover)) {
    payload.cover = {
      standardName: normalizeOptionalText(raw.cover.standardName),
      planNumber: normalizeOptionalText(raw.cover.planNumber),
      reportTitle: normalizeOptionalText(raw.cover.reportTitle),
      presenter: normalizeOptionalText(raw.cover.presenter),
      date: normalizeOptionalText(raw.cover.date),
    };
  }
  if (isRecord(raw.ending)) {
    payload.ending = {
      thanks: normalizeOptionalText(raw.ending.thanks),
      organization: normalizeOptionalText(raw.ending.organization),
      contactInfo: Array.isArray(raw.ending.contactInfo)
        ? raw.ending.contactInfo.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : undefined,
    };
  }
  if (Array.isArray(raw.slides)) {
    const parsedSlides: NonNullable<GeneratedContentPayload['slides']> = [];
    for (const item of raw.slides) {
      if (!isRecord(item)) {
        continue;
      }
      const page = Number(item.page);
      if (!Number.isFinite(page)) {
        continue;
      }
      parsedSlides.push({
        page,
        bodyText: typeof item.bodyText === 'string' ? cleanText(item.bodyText) : undefined,
        highlightRanges: normalizeRanges(item.highlightRanges),
        sourceRef: typeof item.sourceRef === 'string' ? item.sourceRef.trim() : undefined,
        sourceConfidence: normalizeSourceConfidence(item.sourceConfidence),
        aiSupplements: normalizeSupplements(item.aiSupplements),
        tableData: normalizeTableData(item.tableData),
        imagePrompts: normalizeImagePrompts(item.imagePrompts),
      });
    }
    payload.slides = parsedSlides;
  }

  return payload;
}

function buildEvidenceContextMap(contexts: SlideEvidenceContext[]): Map<number, SlideEvidenceContext> {
  const map = new Map<number, SlideEvidenceContext>();
  for (const item of contexts) {
    map.set(item.page, item);
  }
  return map;
}

function countSentenceEndings(text: string): number {
  return (text.match(/[。！？]/g) ?? []).length;
}

function computeTitleOverlap(bodyText: string, titleText: string): number {
  const titleKeywords = extractKeywords(titleText, 12);
  if (!titleKeywords.length) {
    return 0;
  }
  const hits = countKeywordHits(bodyText, titleKeywords);
  return Number((hits / titleKeywords.length).toFixed(4));
}

function evaluateSingleSlideQuality(
  bodyText: string,
  sourceRef: string | undefined,
  sourceConfidence: SourceConfidence,
  context: SlideEvidenceContext,
): SlideQualityResult {
  const normalizedBody = bodyText.trim();
  const length = Array.from(normalizedBody).length;
  const sentenceCount = countSentenceEndings(normalizedBody);
  const titleOverlap = computeTitleOverlap(normalizedBody, `${context.chapterTitle} ${context.subtitle}`);
  const evidenceHits = countKeywordHits(normalizedBody, context.evidenceKeywords.slice(0, 20));
  const concreteSignal = CONCRETE_SIGNAL_PATTERN.test(normalizedBody);
  const reasons: string[] = [];

  if (!normalizedBody) {
    reasons.push('body_empty');
  }

  if (normalizedBody === CONTENT_FALLBACK_BODY) {
    if (sourceRef !== CONTENT_FALLBACK_SOURCE_REF) {
      reasons.push('fallback_source_ref_invalid');
    }
    if (sourceConfidence !== 'ai_constructed') {
      reasons.push('fallback_confidence_invalid');
    }
    return {
      passed: reasons.length === 0,
      reasons,
      length,
      sentenceCount,
      titleOverlap,
      evidenceHits,
      concreteSignal,
    };
  }

  if (length < 45 || length > 140) {
    reasons.push('body_length_out_of_range');
  }
  if (sentenceCount < 2) {
    reasons.push('body_sentence_count_too_low');
  }
  if (BANNED_BODY_PREFIXES.some((prefix) => normalizedBody.startsWith(prefix))) {
    reasons.push('body_starts_with_banned_prefix');
  }
  if (context.evidenceSnippets.length === 0) {
    reasons.push('evidence_snippet_missing');
  }
  if (titleOverlap > 0.6) {
    reasons.push('title_overlap_too_high');
  }
  if (evidenceHits < 2) {
    reasons.push('evidence_hits_too_low');
  }
  if (!sourceRef?.trim()) {
    reasons.push('source_ref_missing');
  }
  if (sourceConfidence !== 'exact' && sourceConfidence !== 'paraphrased') {
    reasons.push('source_confidence_not_strong');
  }
  if (context.visualMode === 'table' && !concreteSignal) {
    reasons.push('table_page_missing_concrete_signal');
  }

  return {
    passed: reasons.length === 0,
    reasons,
    length,
    sentenceCount,
    titleOverlap,
    evidenceHits,
    concreteSignal,
  };
}

function evaluateGeneratedContentQuality(
  payload: GeneratedContentPayload,
  baseSlides: SlideContent[],
  evidenceContextByPage: Map<number, SlideEvidenceContext>,
): {
  failedPages: Set<number>;
  resultByPage: Map<number, SlideQualityResult>;
} {
  const failedPages = new Set<number>();
  const resultByPage = new Map<number, SlideQualityResult>();
  const slideByPage = new Map<number, NonNullable<GeneratedContentPayload['slides']>[number]>();
  for (const item of payload.slides ?? []) {
    if (typeof item.page === 'number') {
      slideByPage.set(item.page, item);
    }
  }

  for (const slide of baseSlides) {
    if (slide.type !== 'content') {
      continue;
    }
    const context = evidenceContextByPage.get(slide.page);
    if (!context) {
      failedPages.add(slide.page);
      resultByPage.set(slide.page, {
        passed: false,
        reasons: ['evidence_context_missing'],
        length: 0,
        sentenceCount: 0,
        titleOverlap: 0,
        evidenceHits: 0,
        concreteSignal: false,
      });
      continue;
    }
    const generated = slideByPage.get(slide.page);
    const bodyText = generated?.bodyText ?? '';
    const sourceRef = generated?.sourceRef ?? context.primarySourceRef;
    const sourceConfidence = normalizeSourceConfidence(generated?.sourceConfidence);
    const quality = evaluateSingleSlideQuality(bodyText, sourceRef, sourceConfidence, context);
    resultByPage.set(slide.page, quality);
    if (!quality.passed) {
      failedPages.add(slide.page);
    }
  }

  return { failedPages, resultByPage };
}

function upsertGeneratedSlide(
  payload: GeneratedContentPayload,
  page: number,
): NonNullable<GeneratedContentPayload['slides']>[number] {
  const slides = payload.slides ?? [];
  payload.slides = slides;
  const existing = slides.find((item) => item.page === page);
  if (existing) {
    return existing;
  }
  const created: NonNullable<GeneratedContentPayload['slides']>[number] = { page };
  slides.push(created);
  return created;
}

function mergeGeneratedSlideUpdates(target: GeneratedContentPayload, patch: GeneratedContentPayload): void {
  if (!patch.slides?.length) {
    return;
  }
  for (const item of patch.slides) {
    if (typeof item.page !== 'number') {
      continue;
    }
    const current = upsertGeneratedSlide(target, item.page);
    if (typeof item.bodyText === 'string') {
      current.bodyText = item.bodyText;
    }
    if (Array.isArray(item.highlightRanges)) {
      current.highlightRanges = item.highlightRanges;
    }
    if (typeof item.sourceRef === 'string') {
      current.sourceRef = item.sourceRef;
    }
    if (item.sourceConfidence) {
      current.sourceConfidence = item.sourceConfidence;
    }
    if (Array.isArray(item.aiSupplements)) {
      current.aiSupplements = item.aiSupplements;
    }
    if (item.tableData) {
      current.tableData = item.tableData;
    }
    if (Array.isArray(item.imagePrompts)) {
      current.imagePrompts = item.imagePrompts;
    }
  }
}

function applyEvidenceSourceDefaults(
  payload: GeneratedContentPayload,
  evidenceContextByPage: Map<number, SlideEvidenceContext>,
): void {
  for (const item of payload.slides ?? []) {
    if (typeof item.page !== 'number') {
      continue;
    }
    const context = evidenceContextByPage.get(item.page);
    if (!context) {
      continue;
    }
    if (!item.sourceRef?.trim()) {
      item.sourceRef = context.primarySourceRef;
    }
    if (!item.sourceConfidence) {
      item.sourceConfidence = 'paraphrased';
    }
  }
}

function hasUsableBodyText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectMissingContentPages(payload: GeneratedContentPayload, baseSlides: SlideContent[]): Set<number> {
  const missingPages = new Set<number>();
  const generatedByPage = new Map<number, NonNullable<GeneratedContentPayload['slides']>[number]>();
  for (const item of payload.slides ?? []) {
    if (typeof item.page === 'number') {
      generatedByPage.set(item.page, item);
    }
  }
  for (const slide of baseSlides) {
    if (slide.type !== 'content') {
      continue;
    }
    const generated = generatedByPage.get(slide.page);
    if (!hasUsableBodyText(generated?.bodyText)) {
      missingPages.add(slide.page);
    }
  }
  return missingPages;
}

function buildAutoCompletedBody(context: SlideEvidenceContext): string {
  const chapterTitle = context.chapterTitle || '当前章节';
  const subtitle = context.subtitle || '核心内容';
  const firstEvidence = context.evidenceSnippets[0] ? truncateText(context.evidenceSnippets[0], 72) : '';
  const sourceLine = firstEvidence
    ? `结合原文可提取信息“${firstEvidence}”，已形成本页可继续编辑的基础草稿，建议在审校阶段补充更细的数据与论据。`
    : '当前页依据章节语义完成自动归纳草稿，建议在审校阶段补充更具体的数据、案例与原文定位。';
  return `本页围绕“${chapterTitle}”下的“${subtitle}”整理关键结论与执行要点，确保内容结构可直接进入后续编辑。${sourceLine}`;
}

function buildAutoCompletedTableData(context: SlideEvidenceContext): SlideTableData {
  const evidence = context.evidenceSnippets[0] ? truncateText(context.evidenceSnippets[0], 32) : '待补充原文细节';
  return {
    headers: ['维度', '内容', '来源提示'],
    rows: [
      ['主题', truncateText(context.subtitle || context.chapterTitle || '核心要点', 28), '章节语义'],
      ['关键信息', evidence, truncateText(context.primarySourceRef || CONTENT_FALLBACK_SOURCE_REF, 28)],
    ],
  };
}

function buildAutoCompletedImagePrompts(context: SlideEvidenceContext): ImagePrompt[] {
  const chapterTitle = context.chapterTitle || '当前章节';
  const subtitle = context.subtitle || '核心内容';
  return [
    {
      description: `${subtitle}配图`,
      iteiDrawPrompt: `请生成一张适用于“${chapterTitle} - ${subtitle}”的专业汇报配图，16:9，蓝白科技风，突出关键信息表达。`,
    },
  ];
}

function autoCompleteMissingPages(
  payload: GeneratedContentPayload,
  missingPages: Set<number>,
  evidenceContextByPage: Map<number, SlideEvidenceContext>,
): Set<number> {
  const completedPages = new Set<number>();
  for (const page of missingPages) {
    const context = evidenceContextByPage.get(page);
    if (!context) {
      continue;
    }
    const item = upsertGeneratedSlide(payload, page);
    if (!hasUsableBodyText(item.bodyText)) {
      item.bodyText = buildAutoCompletedBody(context);
      completedPages.add(page);
    }
    if (!item.sourceRef?.trim()) {
      item.sourceRef = context.primarySourceRef || CONTENT_FALLBACK_SOURCE_REF;
    }
    if (!item.sourceConfidence) {
      item.sourceConfidence = context.evidenceSnippets.length ? 'paraphrased' : 'ai_constructed';
    }
    if (context.visualMode === 'table' && !item.tableData) {
      item.tableData = buildAutoCompletedTableData(context);
    }
    if (context.visualMode === 'images' && !item.imagePrompts?.length) {
      item.imagePrompts = buildAutoCompletedImagePrompts(context);
    }
  }
  return completedPages;
}

function applyFallbackForFailedPages(payload: GeneratedContentPayload, failedPages: Set<number>): void {
  for (const page of failedPages) {
    const item = upsertGeneratedSlide(payload, page);
    item.bodyText = CONTENT_FALLBACK_BODY;
    item.sourceRef = CONTENT_FALLBACK_SOURCE_REF;
    item.sourceConfidence = 'ai_constructed';
    item.highlightRanges = [];
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildFallbackPayloadForPages(pages: number[]): GeneratedContentPayload {
  return {
    slides: pages.map((page) => ({
      page,
      bodyText: CONTENT_FALLBACK_BODY,
      sourceRef: CONTENT_FALLBACK_SOURCE_REF,
      sourceConfidence: 'ai_constructed' as SourceConfidence,
      highlightRanges: [],
    })),
  };
}

function fallbackImagePrompt(slide: SlideContent): ImagePrompt {
  return {
    description: `${slide.subtitle ?? slide.chapterTitle ?? '该页面'}配图`,
    iteiDrawPrompt: `请生成一张适用于“${slide.chapterTitle ?? ''} - ${slide.subtitle ?? ''}”的专业汇报配图，16:9，蓝白科技风，信息清晰。`,
  };
}

function fallbackTableData(slide: SlideContent): SlideTableData {
  const bodySnippet = truncateText(slide.bodyText ?? '待补充本页要点', 36);
  const source = truncateText(slide.sourceRef ?? '待补充来源', 24);
  return {
    headers: ['维度', '说明', '来源'],
    rows: [
      ['主题', truncateText(slide.subtitle ?? slide.chapterTitle ?? '核心要点', 24), '章节信息'],
      ['内容', bodySnippet, source],
    ],
  };
}

function composeAnalyzerResult(
  frameworkPlan: FrameworkPlan,
  parsed: GeneratedContentPayload,
  sourceFilename: string | undefined,
  weakGroundingPages?: Set<number>,
  batchFallbackPages?: Set<number>,
  baseSlidesInput?: SlideContent[],
  generationMeta?: AnalyzerResult['generationMeta'],
): AnalyzerResult {
  const slides = (baseSlidesInput ?? buildSlidePlanFromFramework(frameworkPlan, { sourceFilename })).map((slide) => ({
    ...slide,
  }));
  const byPage = new Map<number, SlideContent>();
  for (const slide of slides) {
    byPage.set(slide.page, slide);
  }

  if (parsed.cover) {
    const coverSlide = slides.find((item) => item.type === 'cover');
    if (coverSlide) {
      if (!coverSlide.standardName && parsed.cover.standardName) {
        coverSlide.standardName = parsed.cover.standardName;
      }
      if (!coverSlide.planNumber && parsed.cover.planNumber) {
        coverSlide.planNumber = parsed.cover.planNumber;
      }
      if (!coverSlide.reportTitle && parsed.cover.reportTitle) {
        coverSlide.reportTitle = parsed.cover.reportTitle;
      }
      if (!coverSlide.presenter && parsed.cover.presenter) {
        coverSlide.presenter = parsed.cover.presenter;
      }
      if (!coverSlide.date && parsed.cover.date) {
        coverSlide.date = parsed.cover.date;
      }
    }
  }

  if (parsed.ending) {
    const coverSlide = slides.find((item) => item.type === 'cover');
    const endingSlide = slides.find((item) => item.type === 'ending');
    if (endingSlide) {
      endingSlide.thanks = parsed.ending.thanks ?? endingSlide.thanks;
      if (!endingSlide.organization && parsed.ending.organization) {
        endingSlide.organization = parsed.ending.organization;
      }
      if (coverSlide && !coverSlide.organization && endingSlide.organization) {
        coverSlide.organization = endingSlide.organization;
      }
      if (parsed.ending.contactInfo?.length) {
        endingSlide.contactInfo = parsed.ending.contactInfo;
      }
    }
  }

  for (const update of parsed.slides ?? []) {
    const slide = byPage.get(update.page);
    if (!slide || slide.type !== 'content') {
      continue;
    }
    if (update.bodyText) {
      slide.bodyText = truncateText(update.bodyText, 220);
    }
    if (update.sourceRef) {
      slide.sourceRef = update.sourceRef;
    }
    slide.sourceConfidence = normalizeSourceConfidence(update.sourceConfidence);
    slide.aiSupplements = update.aiSupplements ?? [];
    if (slide.visualMode === 'table' && update.tableData) {
      slide.tableData = update.tableData;
    }
    if (slide.visualMode === 'images') {
      slide.imagePrompts = update.imagePrompts?.length ? update.imagePrompts : [fallbackImagePrompt(slide)];
    }
  }

  const missingInfo: AnalyzerResult['missingInfo'] = [];
  for (const slide of slides) {
    if (slide.type !== 'content') {
      continue;
    }
    if (slide.bodyText?.trim()) {
      slide.highlightRanges = deriveSemanticHighlightRanges(slide.bodyText, slide.subtitle, slide.chapterTitle);
    } else {
      slide.highlightRanges = [];
    }
    if (!slide.bodyText || slide.bodyText.length < 30) {
      missingInfo.push({
        page: slide.page,
        description: '正文素材不足，当前内容长度较短。',
        solution: '建议补充文档原文或在审校阶段人工完善该页内容。',
      });
    }
    if (batchFallbackPages?.has(slide.page)) {
      missingInfo.push({
        page: slide.page,
        description: '本页生成阶段遇到上游异常，系统已自动补写正文以保证流程可继续。',
        solution: '建议在审校阶段优先复核本页内容，必要时可重新生成以提升细节质量。',
      });
    } else if (weakGroundingPages?.has(slide.page)) {
      missingInfo.push({
        page: slide.page,
        description: '本页正文由低证据或自动归纳补全生成，建议人工复核关键结论与数据。',
        solution: '可在审校页补充更精确原文依据与数据细节，再导出最终版本。',
      });
    }
    if (slide.visualMode === 'images' && !slide.imagePrompts?.length) {
      slide.imagePrompts = [fallbackImagePrompt(slide)];
    }
    if (slide.visualMode === 'table' && !slide.tableData) {
      slide.tableData = fallbackTableData(slide);
    }
  }

  const contentSlides = slides.filter((slide) => slide.type === 'content');
  const exactCount = contentSlides.filter((slide) => slide.sourceConfidence === 'exact').length;
  const aiSupplementCount = contentSlides.reduce((sum, slide) => sum + (slide.aiSupplements?.length ?? 0), 0);
  const imagePromptsTotal = contentSlides.reduce((sum, slide) => sum + (slide.imagePrompts?.length ?? 0), 0);

  return {
    frameworkPlan,
    slidePlan: slides,
    sourceFiles: toSourceFiles(sourceFilename),
    missingInfo,
    imagePromptsTotal,
    auditSummary: {
      totalSlides: slides.length,
      exactSourcePercent: contentSlides.length ? Number(((exactCount / contentSlides.length) * 100).toFixed(2)) : 0,
      aiSupplementCount,
      missingCount: missingInfo.length,
    },
    generationMeta,
    generatedAt: new Date().toISOString(),
  };
}

async function emitGenerateProgress(
  hooks: GenerateContentRuntimeHooks,
  update: GenerateContentProgressUpdate,
): Promise<void> {
  if (!hooks.onProgress) {
    return;
  }
  try {
    await hooks.onProgress(update);
  } catch {
    // Ignore progress callback failures to avoid interrupting generation.
  }
}

function computeGenerateProgressPercent(processedBatches: number, totalBatches: number): number {
  if (totalBatches <= 0) {
    return 5;
  }
  const ratio = Math.min(1, Math.max(0, processedBatches / totalBatches));
  return Math.min(95, Math.max(5, Math.round(5 + ratio * 90)));
}

export async function generateContentWithGemini(
  options: ApiProxyOptions,
  reqBody: GenerateContentRequestBody,
  hooks: GenerateContentRuntimeHooks = {},
): Promise<AnalyzerResult> {
  if (!isFrameworkPlan(reqBody.frameworkPlan)) {
    throw new Error('invalid_framework_plan');
  }
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  if (!textContent) {
    throw new Error('missing_text_content');
  }

  const frameworkPlan = reqBody.frameworkPlan;
  const sourceFilename = normalizeOptionalText(reqBody.sourceFilename);
  const baseSlides = buildSlidePlanFromFramework(frameworkPlan, {
    textContent,
    sourceFilename,
  });
  const truncatedText = truncateText(textContent, MAX_CONTENT_TEXT_LENGTH);
  const evidenceContexts = buildSlideEvidenceContexts(frameworkPlan, baseSlides, truncatedText);
  const evidenceContextByPage = buildEvidenceContextMap(evidenceContexts);
  const contentModel = getContentModel(options);
  const parsed: GeneratedContentPayload = { slides: [] };
  const weakGroundingPages = new Set<number>();
  const batchFallbackPages = new Set<number>();
  const degradeReasons = new Set<string>();
  const startedAt = Date.now();
  const deadlineAt = startedAt + CONTENT_SOFT_DEADLINE_MS;
  const batches = chunkArray(evidenceContexts, CONTENT_BATCH_SIZE);
  const totalBatches = Math.max(1, batches.length);
  let processedBatches = 0;
  const diagnostics = {
    totalContentPages: evidenceContexts.length,
    initialMissingPages: new Set<number>(),
    rewriteRecoveredPages: new Set<number>(),
    autoCompletedPages: new Set<number>(),
    finalMissingPages: new Set<number>(),
  };
  const addPages = (target: Set<number>, pages: Iterable<number>): void => {
    for (const page of pages) {
      target.add(page);
    }
  };

  await emitGenerateProgress(hooks, {
    stage: 'preparing',
    percent: 2,
    processedBatches: 0,
    totalBatches,
  });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batchContexts = batches[batchIndex];
    if (!batchContexts.length) {
      processedBatches = Math.min(totalBatches, processedBatches + 1);
      await emitGenerateProgress(hooks, {
        stage: 'generating',
        percent: computeGenerateProgressPercent(processedBatches, totalBatches),
        processedBatches,
        totalBatches,
      });
      continue;
    }

    if (Date.now() + CONTENT_SOFT_DEADLINE_GUARD_MS >= deadlineAt) {
      degradeReasons.add('soft_deadline_reached');
      for (let restIndex = batchIndex; restIndex < batches.length; restIndex += 1) {
        const restPages = batches[restIndex].map((item) => item.page);
        if (!restPages.length) {
          continue;
        }
        const restPageSet = new Set(restPages);
        const restBaseSlides = baseSlides.filter((slide) => slide.type === 'content' && restPageSet.has(slide.page));
        addPages(diagnostics.initialMissingPages, restPages);
        const autoCompleted = autoCompleteMissingPages(parsed, restPageSet, evidenceContextByPage);
        addPages(diagnostics.autoCompletedPages, autoCompleted);
        const unresolved = collectMissingContentPages(parsed, restBaseSlides);
        addPages(diagnostics.finalMissingPages, unresolved);
        for (const page of restPages) {
          weakGroundingPages.add(page);
          batchFallbackPages.add(page);
        }
      }
      processedBatches = totalBatches;
      await emitGenerateProgress(hooks, {
        stage: 'generating',
        percent: computeGenerateProgressPercent(processedBatches, totalBatches),
        processedBatches,
        totalBatches,
      });
      break;
    }

    const batchPages = batchContexts.map((item) => item.page);
    const batchPageSet = new Set<number>(batchPages);
    const batchBaseSlides = baseSlides.filter((slide) => slide.type === 'content' && batchPageSet.has(slide.page));
    const batchContextByPage = buildEvidenceContextMap(batchContexts);
    const prompt = buildGenerateContentPrompt(frameworkPlan, batchContexts, truncatedText, false);
    const compactPrompt = buildGenerateContentPrompt(frameworkPlan, batchContexts, truncatedText, true);
    let batchParsed: GeneratedContentPayload;

    try {
      let raw: unknown;
      try {
        raw = await callGeminiJsonWithRetry(options, contentModel, prompt);
      } catch (error) {
        if (error instanceof Error && error.message === 'missing_api_key') {
          throw error;
        }
        try {
          raw = await callGeminiJsonWithRetry(options, contentModel, compactPrompt);
        } catch (compactError) {
          if (compactError instanceof Error && compactError.message === 'missing_api_key') {
            throw compactError;
          }
          const primaryMessage = error instanceof Error ? error.message : 'unknown_primary_error';
          const compactMessage = compactError instanceof Error ? compactError.message : 'unknown_compact_error';
          throw new Error(`content_generation_chain_failed:primary=${primaryMessage};compact=${compactMessage}`);
        }
      }
      batchParsed = parseGeneratedContent(raw);
      if (batchParsed.slides?.length) {
        batchParsed.slides = batchParsed.slides.filter(
          (item) => typeof item.page === 'number' && batchPageSet.has(item.page),
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'missing_api_key') {
        throw error;
      }
      degradeReasons.add('batch_generation_failed');
      addPages(diagnostics.initialMissingPages, batchPages);
      const autoCompleted = autoCompleteMissingPages(parsed, batchPageSet, batchContextByPage);
      addPages(diagnostics.autoCompletedPages, autoCompleted);
      const unresolved = collectMissingContentPages(parsed, batchBaseSlides);
      addPages(diagnostics.finalMissingPages, unresolved);
      for (const page of batchPages) {
        weakGroundingPages.add(page);
        batchFallbackPages.add(page);
      }
      processedBatches = Math.min(totalBatches, processedBatches + 1);
      await emitGenerateProgress(hooks, {
        stage: 'generating',
        percent: computeGenerateProgressPercent(processedBatches, totalBatches),
        processedBatches,
        totalBatches,
      });
      continue;
    }

    applyEvidenceSourceDefaults(batchParsed, batchContextByPage);
    const initialMissingPages = collectMissingContentPages(batchParsed, batchBaseSlides);
    addPages(diagnostics.initialMissingPages, initialMissingPages);

    if (initialMissingPages.size > 0) {
      const missingContexts = batchContexts.filter((item) => initialMissingPages.has(item.page));
      if (missingContexts.length > 0) {
        try {
          const rewritePrompt = buildRewriteContentPrompt(missingContexts, batchParsed.slides ?? []);
          const rewriteRaw = await callGeminiJsonWithRetry(options, contentModel, rewritePrompt);
          const rewriteParsed = parseGeneratedContent(rewriteRaw);
          if (rewriteParsed.slides?.length) {
            rewriteParsed.slides = rewriteParsed.slides.filter(
              (item) => typeof item.page === 'number' && batchPageSet.has(item.page),
            );
          }
          mergeGeneratedSlideUpdates(batchParsed, rewriteParsed);
          applyEvidenceSourceDefaults(batchParsed, batchContextByPage);
        } catch (error) {
          if (error instanceof Error && error.message === 'missing_api_key') {
            throw error;
          }
        }
      }
    }

    const missingAfterRewrite = collectMissingContentPages(batchParsed, batchBaseSlides);
    for (const page of initialMissingPages) {
      if (!missingAfterRewrite.has(page)) {
        diagnostics.rewriteRecoveredPages.add(page);
      }
    }

    if (missingAfterRewrite.size > 0) {
      const autoCompleted = autoCompleteMissingPages(batchParsed, missingAfterRewrite, batchContextByPage);
      addPages(diagnostics.autoCompletedPages, autoCompleted);
      for (const page of autoCompleted) {
        weakGroundingPages.add(page);
      }
    }

    const finalMissingPages = collectMissingContentPages(batchParsed, batchBaseSlides);
    addPages(diagnostics.finalMissingPages, finalMissingPages);
    for (const page of finalMissingPages) {
      weakGroundingPages.add(page);
    }

    mergeGeneratedSlideUpdates(parsed, batchParsed);
    processedBatches = Math.min(totalBatches, processedBatches + 1);
    await emitGenerateProgress(hooks, {
      stage: 'generating',
      percent: computeGenerateProgressPercent(processedBatches, totalBatches),
      processedBatches,
      totalBatches,
    });
  }

  if (batches.length === 0) {
    processedBatches = totalBatches;
  }

  await emitGenerateProgress(hooks, {
    stage: 'finalizing',
    percent: 98,
    processedBatches: Math.min(totalBatches, Math.max(0, processedBatches)),
    totalBatches,
  });

  const generationMeta: AnalyzerResult['generationMeta'] = degradeReasons.size
    ? {
        mode: 'degraded',
        reason: Array.from(degradeReasons).join(';'),
      }
    : {
        mode: 'normal',
      };

  const sortedPages = (pages: Set<number>): number[] => Array.from(pages).sort((a, b) => a - b);
  console.info(
    '[generate-content][completeness]',
    JSON.stringify({
      jobId: hooks.jobId ?? 'sync',
      totalContentPages: diagnostics.totalContentPages,
      initialMissingPages: diagnostics.initialMissingPages.size,
      rewriteRecoveredPages: diagnostics.rewriteRecoveredPages.size,
      autoCompletedPages: diagnostics.autoCompletedPages.size,
      finalMissingPages: diagnostics.finalMissingPages.size,
      initialMissingPageList: sortedPages(diagnostics.initialMissingPages),
      rewriteRecoveredPageList: sortedPages(diagnostics.rewriteRecoveredPages),
      autoCompletedPageList: sortedPages(diagnostics.autoCompletedPages),
      finalMissingPageList: sortedPages(diagnostics.finalMissingPages),
      degradeReasons: Array.from(degradeReasons),
      durationMs: Date.now() - startedAt,
    }),
  );

  return composeAnalyzerResult(
    frameworkPlan,
    parsed,
    sourceFilename,
    weakGroundingPages,
    batchFallbackPages,
    baseSlides,
    generationMeta,
  );
}

function buildDegradedAnalyzerFromRequest(
  reqBody: GenerateContentRequestBody,
  reason: string,
): AnalyzerResult | null {
  if (!isFrameworkPlan(reqBody.frameworkPlan)) {
    return null;
  }

  const sourceFilename = normalizeOptionalText(reqBody.sourceFilename);
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  const baseSlides = buildSlidePlanFromFramework(reqBody.frameworkPlan, {
    textContent,
    sourceFilename,
  });
  const contentPages = baseSlides.filter((slide) => slide.type === 'content').map((slide) => slide.page);
  const truncatedText = truncateText(textContent, MAX_CONTENT_TEXT_LENGTH);
  const evidenceContexts = buildSlideEvidenceContexts(reqBody.frameworkPlan, baseSlides, truncatedText);
  const evidenceContextByPage = buildEvidenceContextMap(evidenceContexts);
  const degradedPayload: GeneratedContentPayload = { slides: [] };
  const fallbackPages = new Set<number>(contentPages);
  const weakGroundingPages = autoCompleteMissingPages(degradedPayload, fallbackPages, evidenceContextByPage);
  for (const page of fallbackPages) {
    weakGroundingPages.add(page);
  }

  return composeAnalyzerResult(
    reqBody.frameworkPlan,
    degradedPayload,
    sourceFilename,
    weakGroundingPages,
    fallbackPages,
    baseSlides,
    {
      mode: 'degraded',
      reason: `request_level_fallback:${truncateText(reason, 220)}`,
    },
  );
}

function validateGenerateContentRequestInput(options: ApiProxyOptions, reqBody: GenerateContentRequestBody): void {
  if (!isFrameworkPlan(reqBody.frameworkPlan)) {
    throw new Error('invalid_framework_plan');
  }
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  if (!textContent) {
    throw new Error('missing_text_content');
  }
  if (!getApiKey(options)) {
    throw new Error('missing_api_key');
  }
}

function normalizeJobId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function toJobStatusResponse(job: GenerationJobRecord): {
  jobId: string;
  status: GenerationJobRecord['status'];
  progress: GenerationJobRecord['progress'];
  error?: GenerationJobRecord['error'];
  createdAt: string;
  updatedAt: string;
  resultReady: boolean;
} {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    resultReady: Boolean(job.resultStoragePath && job.status === 'succeeded'),
  };
}

function writePlanInputError(res: express.Response, error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.message === 'invalid_preset') {
    writeError(res, 400, {
      error: {
        code: 'invalid_preset',
        message: 'presetId is invalid. Allowed: standard_review | academic_research | blank.',
      },
    });
    return true;
  }
  if (error.message === 'missing_text_content') {
    writeError(res, 400, {
      error: {
        code: 'missing_text_content',
        message: 'textContent is required and must not be empty.',
      },
    });
    return true;
  }
  if (error.message === 'missing_api_key') {
    writeError(res, 503, {
      error: {
        code: 'missing_api_key',
        message: 'GEMINI_API_KEY is not configured on the server side.',
      },
    });
    return true;
  }
  return false;
}

function writeGenerateInputError(res: express.Response, error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.message === 'invalid_framework_plan') {
    writeError(res, 400, {
      error: {
        code: 'invalid_framework_plan',
        message: 'frameworkPlan is required and must match FrameworkPlan schema.',
      },
    });
    return true;
  }
  if (error.message === 'missing_text_content') {
    writeError(res, 400, {
      error: {
        code: 'missing_text_content',
        message: 'textContent is required and must not be empty.',
      },
    });
    return true;
  }
  if (error.message === 'missing_api_key') {
    writeError(res, 503, {
      error: {
        code: 'missing_api_key',
        message: 'GEMINI_API_KEY is not configured on the server side.',
      },
    });
    return true;
  }
  return false;
}

export function createApiProxyApp(options: ApiProxyOptions = {}): express.Express {
  const app = express();

  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'local-gemini-proxy' });
  });

  app.post('/api/plan', async (req, res) => {
    const body = isRecord(req.body) ? (req.body as PlanRequestBody) : {};

    try {
      const plan = await generatePlanWithGemini(options, body);
      res.json(plan);
      return;
    } catch (error) {
      if (writePlanInputError(res, error)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown plan generation error';
      writeError(res, 502, {
        error: {
          code: 'plan_generation_failed',
          message: 'Failed to generate framework plan with Gemini.',
          details: message,
        },
      });
    }
  });

  app.post('/api/generate-content/jobs', async (req, res) => {
    const body = isRecord(req.body) ? (req.body as GenerateContentRequestBody) : {};

    try {
      validateGenerateContentRequestInput(options, body);

      const frameworkPlan = body.frameworkPlan as FrameworkPlan;
      const textContent = cleanText(body.textContent as string);
      const sourceFilename = normalizeOptionalText(body.sourceFilename);

      const job = await createGenerationJob({
        frameworkPlan,
        textContent,
        sourceFilename,
      });

      try {
        await enqueueGenerationJob(job.id);
      } catch (enqueueError) {
        const details = enqueueError instanceof Error ? enqueueError.message : 'Unknown enqueue error';
        await markGenerationJobFailed(job.id, {
          code: 'job_enqueue_failed',
          message: '任务入队失败。',
          details: truncateText(details, 320),
        });
        throw new Error(`job_enqueue_failed:${details}`);
      }

      res.status(202).json({
        jobId: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        pollUrl: `/api/generate-content/jobs/${job.id}`,
        resultUrl: `/api/generate-content/jobs/${job.id}/result`,
      });
    } catch (error) {
      if (writeGenerateInputError(res, error)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown job creation error';
      writeError(res, 502, {
        error: {
          code: 'generation_job_create_failed',
          message: 'Failed to create generation job.',
          details: message,
        },
      });
    }
  });

  app.get('/api/generate-content/jobs/:jobId', async (req, res) => {
    const jobId = normalizeJobId(req.params.jobId);
    if (!jobId) {
      writeError(res, 400, {
        error: {
          code: 'invalid_job_id',
          message: 'jobId is required.',
        },
      });
      return;
    }

    try {
      const job = await getGenerationJob(jobId);
      if (!job) {
        writeError(res, 404, {
          error: {
            code: 'generation_job_not_found',
            message: 'Generation job not found.',
          },
        });
        return;
      }
      res.json(toJobStatusResponse(job));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown job lookup error';
      writeError(res, 500, {
        error: {
          code: 'generation_job_status_failed',
          message: 'Failed to query generation job status.',
          details: message,
        },
      });
    }
  });

  app.get('/api/generate-content/jobs/:jobId/result', async (req, res) => {
    const jobId = normalizeJobId(req.params.jobId);
    if (!jobId) {
      writeError(res, 400, {
        error: {
          code: 'invalid_job_id',
          message: 'jobId is required.',
        },
      });
      return;
    }

    try {
      const job = await getGenerationJob(jobId);
      if (!job) {
        writeError(res, 404, {
          error: {
            code: 'generation_job_not_found',
            message: 'Generation job not found.',
          },
        });
        return;
      }

      if (job.status !== 'succeeded' || !job.resultStoragePath) {
        writeError(res, 409, {
          error: {
            code: 'job_not_completed',
            message: 'Generation job is not completed.',
          },
        });
        return;
      }

      const result = await readGenerationJobResult(job.resultStoragePath);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown result lookup error';
      writeError(res, 500, {
        error: {
          code: 'generation_job_result_failed',
          message: 'Failed to load generation result.',
          details: message,
        },
      });
    }
  });

  app.post('/api/generate-content', async (req, res) => {
    const body = isRecord(req.body) ? (req.body as GenerateContentRequestBody) : {};

    try {
      const result = await generateContentWithGemini(options, body);
      res.json(result);
      return;
    } catch (error) {
      if (writeGenerateInputError(res, error)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown content generation error';
      const degraded = buildDegradedAnalyzerFromRequest(body, message);
      if (degraded) {
        res.json(degraded);
        return;
      }
      writeError(res, 502, {
        error: {
          code: 'content_generation_failed',
          message: 'Failed to generate slide content with Gemini.',
          details: message,
        },
      });
    }
  });

  app.all(['/api', '/api/'], (_req, res) => {
    writeError(res, 400, {
      error: {
        code: 'invalid_api_path',
        message: 'Missing Gemini API path. Use /api/{gemini-path}.',
      },
    });
  });

  app.all('/api/*', async (req, res) => {
    const apiKey = getApiKey(options);
    if (!apiKey) {
      writeError(res, 503, {
        error: {
          code: 'missing_api_key',
          message: 'GEMINI_API_KEY is not configured on the server side.',
        },
      });
      return;
    }

    const forwardPath = normalizeForwardPath(req);
    if (!forwardPath) {
      writeError(res, 400, {
        error: {
          code: 'invalid_api_path',
          message: 'Missing Gemini API path. Use /api/{gemini-path}.',
        },
      });
      return;
    }

    try {
      const url = new URL(`${getBaseUrl(options)}/${forwardPath}`);
      appendQuery(url, req.query);
      url.searchParams.set('key', apiKey);

      const upstream = await fetch(url, {
        method: req.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: buildBody(req),
      });

      const text = await upstream.text();
      const contentType = upstream.headers.get('content-type');

      res.status(upstream.status);
      if (contentType) {
        res.setHeader('content-type', contentType);
      }

      if (!text) {
        res.end();
        return;
      }

      if (contentType?.includes('application/json')) {
        try {
          res.json(JSON.parse(text) as unknown);
          return;
        } catch {
          // fallback to raw payload
        }
      }

      res.send(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown upstream error';
      writeError(res, 502, {
        error: {
          code: 'upstream_error',
          message: 'Failed to reach Gemini upstream endpoint.',
          details: message,
        },
      });
    }
  });

  return app;
}




