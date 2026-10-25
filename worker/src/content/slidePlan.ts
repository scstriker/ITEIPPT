import type { AnalyzerResult, SlideContent } from '../contracts/analyzer';
import type { FrameworkPlan } from '../contracts/framework';
import type { VisualMode } from '../contracts/template';
import type { SlidePlanFallbackOptions } from './types';
import { extractTitleFromText, normalizeOptionalText, stripFileExtension } from '../shared/text';

export function toSourceFiles(filename: string | undefined): AnalyzerResult['sourceFiles'] {
  const safeName = filename?.trim() || 'uploaded-document';
  const shortName = safeName.length > 28 ? `${safeName.slice(0, 25)}...` : safeName;
  return [{ id: 1, filename: safeName, shortName }];
}

export function resolveCoverTitle(frameworkPlan: FrameworkPlan, options: SlidePlanFallbackOptions): string | undefined {
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

export function buildSlidePlanFromFramework(
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
