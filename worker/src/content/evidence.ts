import type { SlideContent } from '../contracts/analyzer';
import type { ApiSlideInsight, FrameworkPlan } from '../contracts/framework';
import type { VisualMode } from '../contracts/template';
import { CONCRETE_SIGNAL_PATTERN, CONTENT_FALLBACK_SOURCE_REF } from './constants';
import { HIGHLIGHT_DOMAIN_KEYWORDS, countKeywordHits, dedupeKeywords, extractKeywords } from './highlight';
import type { SlideEvidenceCandidate, SlideEvidenceContext, SlidePageMeta } from './types';
import { truncateText } from '../shared/text';

export function splitEvidenceSegments(text: string): string[] {
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

export function buildSlidePageMetaMap(frameworkPlan: FrameworkPlan): Map<number, SlidePageMeta> {
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

export function buildSlideEvidenceContexts(
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

export function buildEvidenceContextMap(contexts: SlideEvidenceContext[]): Map<number, SlideEvidenceContext> {
  const map = new Map<number, SlideEvidenceContext>();
  for (const item of contexts) {
    map.set(item.page, item);
  }
  return map;
}
