import type { ChapterPlan, FrameworkPlan, TemplatePreset } from '../contracts/framework';
import { createFrameworkPlanFromPreset } from './presets';
import { inferVisualModeFromText, normalizePlanVisualMode } from '../shared/planValues';
import { isRecord, normalizeOptionalText } from '../shared/text';

export interface PlanRequestBody {
  presetId?: string;
  textContent?: string;
  chapters?: unknown;
}

export const MAX_TEXT_LENGTH = 120_000;

export const BLANK_MIN_CHAPTERS = 6;

export const BLANK_MIN_SLIDES_PER_CHAPTER = 2;

export function parseRequestChapters(raw: unknown): ChapterPlan[] | null {
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

export function resolveBasePlan(reqBody: PlanRequestBody): FrameworkPlan {
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

export function buildBlankDraftPrompt(textContent: string): string {
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

export function parseDraftChapters(raw: unknown): ChapterPlan[] {
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

export function buildFallbackBlankChapters(): ChapterPlan[] {
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

export function ensureBlankChapterFloor(chapters: ChapterPlan[]): ChapterPlan[] {
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

export function applyBlankPlanMinimum(plan: FrameworkPlan): FrameworkPlan {
  if (plan.presetId !== 'blank') {
    return plan;
  }
  return {
    ...plan,
    chapters: ensureBlankChapterFloor(plan.chapters),
  };
}
