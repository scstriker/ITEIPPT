import type { AnalyzerResult, SlideContent } from '../contracts/analyzer';
import type { FrameworkPlan } from '../contracts/framework';
import { fallbackImagePrompt, fallbackTableData } from './completion';
import { deriveSemanticHighlightRanges } from './highlight';
import { buildSlidePlanFromFramework, toSourceFiles } from './slidePlan';
import type { GeneratedContentPayload } from './types';
import { normalizeSourceConfidence } from '../shared/planValues';
import { truncateText } from '../shared/text';

export function composeAnalyzerResult(
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
    const slide = typeof update.page === 'number' ? byPage.get(update.page) : undefined;
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
