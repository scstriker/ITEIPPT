import type { ApiChapterInsight, ApiSlideInsight, ChapterPlan, CoverageLevel, FrameworkPlan } from '../contracts/framework';
import type { VisualMode } from '../contracts/template';
import { fallbackSlideReason, inferVisualModeFromText, normalizeCoverageLevel, normalizePlanVisualMode } from '../shared/planValues';
import { isRecord, truncateText } from '../shared/text';

export interface ChapterInsight {
  chapterIndex: number;
  reason: string;
  coverageLevel: CoverageLevel;
  sourceHint?: string;
}

export interface SlideInsight {
  chapterIndex: number;
  slideIndex: number;
  visualMode: VisualMode;
  reason: string;
  sourceHint?: string;
}

export function pickSourceHint(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] ? truncateText(lines[0], 48) : undefined;
}

export function inferFallbackCoverage(chapter: ChapterPlan, textContent: string): CoverageLevel {
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

export function buildFallbackChapterReason(chapter: ChapterPlan): string {
  return `已基于章节标题“${chapter.chapterTitle}”生成默认分析，建议再执行 AI 建议调整以提升匹配度。`;
}

export function buildFallbackSlideReason(chapter: ChapterPlan, slide: ChapterPlan['slides'][number]): string {
  const modeLabel = slide.visualMode === 'images' ? '文字+图片' : '文字+表格';
  return `该子页面围绕“${slide.subtitle}”生成，建议采用${modeLabel}呈现。`;
}

export function buildFallbackInsights(plan: FrameworkPlan, textContent: string): {
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

export function parseChapterInsights(raw: unknown, chapterCount: number): ChapterInsight[] {
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

export function parseSlideInsights(raw: unknown, plan: FrameworkPlan): SlideInsight[] {
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

export function buildInsightsPrompt(plan: FrameworkPlan, textContent: string): string {
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

export function slideInsightKey(chapterIndex: number, slideIndex: number): string {
  return `${chapterIndex}:${slideIndex}`;
}

export function applyChapterInsights(
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
