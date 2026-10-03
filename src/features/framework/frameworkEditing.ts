// Pure framework editing rules used by the "规划框架" step.
import type { AnalyzerResult } from '@contracts/analyzer';
import type { ChapterPlan, CoverageLevel, FrameworkPlan, SubSlidePlan, TemplatePreset } from '@contracts/framework';
import type { VisualMode } from '@contracts/template';
import { createFrameworkPlanFromPreset, reindexChapters } from '../../template/presets';

export const VISUAL_MODE_LABELS: Record<VisualMode, string> = {
  none: '文字',
  table: '文字 + 表格',
  images: '文字 + 图片',
};

export const COVERAGE_LABELS: Record<CoverageLevel, string> = {
  sufficient: '高覆盖',
  moderate: '中覆盖',
  sparse: '低覆盖',
};

export const MAX_SUBSLIDES_PER_CHAPTER = 20;

export function getVisualModeLabel(mode: VisualMode): string {
  return VISUAL_MODE_LABELS[mode] ?? '文字';
}

export function slideInsightKey(chapterIndex: number, slideIndex: number): string {
  return `${chapterIndex}:${slideIndex}`;
}

/** Cover + ending + one section page per chapter + one page per sub-chapter. */
export function estimateTotalPages(plan: FrameworkPlan): number {
  return 2 + plan.chapters.length + plan.chapters.reduce((sum, chapter) => sum + chapter.slides.length, 0);
}

export function updateChapterSlides(
  plan: FrameworkPlan,
  chapterIndex: number,
  updater: (slides: SubSlidePlan[]) => SubSlidePlan[],
): FrameworkPlan {
  const chapters = [...plan.chapters];
  const target = chapters[chapterIndex];
  if (!target) {
    return plan;
  }

  chapters[chapterIndex] = {
    ...target,
    slides: updater(target.slides),
  };

  return {
    ...plan,
    chapters: reindexChapters(chapters),
  };
}

/** Shrink from the end, or grow by copying the last sub-chapter's layout. Count is clamped to 1..20. */
export function resizeSlides(slides: SubSlidePlan[], nextCountInput: number): SubSlidePlan[] {
  const nextCount = Math.max(1, Math.min(MAX_SUBSLIDES_PER_CHAPTER, Number.isFinite(nextCountInput) ? nextCountInput : 1));
  if (nextCount === slides.length) {
    return slides;
  }

  if (nextCount < slides.length) {
    return slides.slice(0, nextCount);
  }

  const seed = slides.at(-1) ?? {
    subtitle: '子章节',
    visualMode: 'none' as VisualMode,
    contentHint: '待补充',
  };

  const next = [...slides];
  for (let index = slides.length; index < nextCount; index += 1) {
    next.push({
      subtitle: `子章节 ${index + 1}`,
      visualMode: seed.visualMode,
      contentHint: seed.contentHint ?? '待补充',
    });
  }
  return next;
}

export function setChapterTitle(plan: FrameworkPlan, chapterIndex: number, title: string): FrameworkPlan {
  const chapters = [...plan.chapters];
  chapters[chapterIndex] = { ...chapters[chapterIndex], chapterTitle: title };
  return { ...plan, chapters: reindexChapters(chapters) };
}

export function setSubSlideTitle(plan: FrameworkPlan, chapterIndex: number, slideIndex: number, title: string): FrameworkPlan {
  return updateChapterSlides(plan, chapterIndex, (slides) =>
    slides.map((item, index) => (index === slideIndex ? { ...item, subtitle: title } : item)),
  );
}

export function appendChapter(plan: FrameworkPlan): FrameworkPlan {
  const nextIndex = plan.chapters.length + 1;
  return {
    ...plan,
    chapters: reindexChapters([
      ...plan.chapters,
      {
        chapterIndex: nextIndex,
        chapterTitle: `第${nextIndex}章`,
        slides: [{ subtitle: '新子章节', visualMode: 'none', contentHint: '待补充' }],
      },
    ]),
  };
}

export function removeChapter(plan: FrameworkPlan, chapterIndex: number): FrameworkPlan {
  return {
    ...plan,
    chapters: reindexChapters(plan.chapters.filter((_, index) => index !== chapterIndex)),
  };
}

export function appendSubSlide(plan: FrameworkPlan, chapterIndex: number): FrameworkPlan {
  return updateChapterSlides(plan, chapterIndex, (slides) => [
    ...slides,
    {
      subtitle: `子章节 ${slides.length + 1}`,
      visualMode: 'none',
      contentHint: '待补充',
    },
  ]);
}

export function removeSubSlide(plan: FrameworkPlan, chapterIndex: number, slideIndex: number): FrameworkPlan {
  return updateChapterSlides(plan, chapterIndex, (slides) => slides.filter((_, index) => index !== slideIndex));
}

/** Switch preset (or reset to it) while keeping the cover and ending information. */
export function applyPreset(plan: FrameworkPlan, presetId: TemplatePreset['id']): FrameworkPlan {
  const presetPlan = createFrameworkPlanFromPreset(presetId);
  return {
    ...presetPlan,
    coverInfo: {
      ...presetPlan.coverInfo,
      ...plan.coverInfo,
    },
    endingInfo: {
      ...presetPlan.endingInfo,
      ...plan.endingInfo,
    },
  };
}

/** Merge an /api/plan response: take its chapters only when the current plan is empty. */
export function mergeInsights(currentPlan: FrameworkPlan, aiPlan: FrameworkPlan): FrameworkPlan {
  if (currentPlan.chapters.length === 0 && aiPlan.chapters.length > 0) {
    return {
      ...currentPlan,
      chapters: aiPlan.chapters,
      apiPlanMeta: aiPlan.apiPlanMeta,
    };
  }

  const byIndex = new Map<number, ChapterPlan>();
  for (const chapter of aiPlan.chapters) {
    byIndex.set(chapter.chapterIndex, chapter);
  }

  const slideModeByKey = new Map<string, VisualMode>();
  for (const insight of aiPlan.apiPlanMeta?.slideInsights ?? []) {
    slideModeByKey.set(`${insight.chapterIndex}:${insight.slideIndex}`, insight.visualMode);
  }

  const chapters = currentPlan.chapters.map((chapter) => {
    const aiChapter = byIndex.get(chapter.chapterIndex);
    return {
      ...chapter,
      aiReason: aiChapter?.aiReason ?? chapter.aiReason,
      coverageLevel: aiChapter?.coverageLevel ?? chapter.coverageLevel,
      sourceHint: aiChapter?.sourceHint ?? chapter.sourceHint,
      slides: chapter.slides.map((slide, slideIndex) => {
        const key = `${chapter.chapterIndex}:${slideIndex + 1}`;
        const nextMode = slideModeByKey.get(key) ?? aiChapter?.slides?.[slideIndex]?.visualMode;
        if (!nextMode) {
          return slide;
        }
        return {
          ...slide,
          visualMode: nextMode,
        };
      }),
    };
  });

  return {
    ...currentPlan,
    chapters,
    apiPlanMeta: aiPlan.apiPlanMeta,
  };
}

export function validatePlanBeforeGenerate(plan: FrameworkPlan): string | null {
  if (plan.chapters.length === 0) {
    return '请至少保留 1 个章节。';
  }

  for (const chapter of plan.chapters) {
    if (!chapter.chapterTitle.trim()) {
      return `第 ${chapter.chapterIndex} 章标题不能为空。`;
    }
    if (chapter.slides.length === 0) {
      return `第 ${chapter.chapterIndex} 章至少需要 1 个子章节。`;
    }
    for (let slideIndex = 0; slideIndex < chapter.slides.length; slideIndex += 1) {
      if (!chapter.slides[slideIndex].subtitle.trim()) {
        return `第 ${chapter.chapterIndex}-${slideIndex + 1} 子章节标题不能为空。`;
      }
    }
  }

  return null;
}

export function getProgressStageText(percent: number): string {
  if (percent >= 100) {
    return '已完成，结果已就绪';
  }
  if (percent <= 15) {
    return '正在建立章节语义索引';
  }
  if (percent <= 35) {
    return '正在提炼子章节内容';
  }
  if (percent <= 60) {
    return '正在匹配布局提示';
  }
  if (percent <= 85) {
    return '正在生成逐页内容草稿';
  }
  return '正在校验一致性与完整性';
}

export function coverageSummaryText(plan: FrameworkPlan): string {
  const counts = plan.chapters.reduce<Record<CoverageLevel, number>>(
    (acc, chapter) => {
      if (chapter.coverageLevel) {
        acc[chapter.coverageLevel] += 1;
      }
      return acc;
    },
    { sufficient: 0, moderate: 0, sparse: 0 },
  );
  const total = counts.sufficient + counts.moderate + counts.sparse;
  return total > 0
    ? `章节覆盖评估：高覆盖 ${counts.sufficient} / 中覆盖 ${counts.moderate} / 低覆盖 ${counts.sparse}`
    : '章节覆盖评估：待 AI 建议调整后生成';
}

export function aiSuggestionItems(plan: FrameworkPlan): Array<{ chapterIndex: number; chapterTitle: string; reason: string }> {
  return plan.chapters
    .filter((chapter) => chapter.aiReason?.trim())
    .map((chapter) => ({
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      reason: chapter.aiReason?.trim() ?? '',
    }));
}

export function slideInsightReasons(plan: FrameworkPlan): Map<string, string> {
  const map = new Map<string, string>();
  for (const insight of plan.apiPlanMeta?.slideInsights ?? []) {
    if (!insight.reason) {
      continue;
    }
    map.set(slideInsightKey(insight.chapterIndex, insight.slideIndex), insight.reason);
  }
  return map;
}

const TECHNICAL_DEGRADE_PREFIXES = ['batch_generation_failed', 'soft_deadline_reached', 'request_level_fallback'];

/** Warning for a degraded result; only technical reasons are shown. */
export function degradedWarning(result: AnalyzerResult | null, isFresh: boolean): string | null {
  if (!result || !isFresh) {
    return null;
  }
  if (result.generationMeta?.mode !== 'degraded') {
    return null;
  }
  const reason = result.generationMeta.reason?.trim();
  if (!reason) {
    return '已降级生成，可继续编辑。';
  }
  const technicalReasons = reason
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => TECHNICAL_DEGRADE_PREFIXES.some((prefix) => item === prefix || item.startsWith(`${prefix}:`)));
  if (technicalReasons.length === 0) {
    return null;
  }
  return `已降级生成，可继续编辑（原因：${technicalReasons.join(';')}）。`;
}
