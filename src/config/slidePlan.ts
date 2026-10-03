import { getSlideType, getTemplate } from './templateLoader';
import type { SlideType, VisualMode } from '@contracts/template';

export interface SlidePlanItem {
  slideNumber: number;
  slideType: SlideType;
  visualMode?: VisualMode;
  chapterTitle?: string;
  subtitle?: string;
  highlightChapter?: number;
}

function normalizeIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) {
    return max;
  }
  if (index < 0) {
    return 0;
  }
  if (index > max) {
    return max;
  }
  return Math.floor(index);
}

function reindex(plan: SlidePlanItem[]): SlidePlanItem[] {
  return plan.map((item, idx) => ({
    ...item,
    slideNumber: idx + 1,
  }));
}

function ensureSlideType(type: string): SlideType {
  getSlideType(type);
  return type as SlideType;
}

function defaultVisualModeForType(type: SlideType): VisualMode | undefined {
  return type === 'content' ? 'none' : undefined;
}

export function loadDefaultSlidePlan(): SlidePlanItem[] {
  const template = getTemplate();
  return template.slides.map((slide) => ({
    slideNumber: slide.slide_number,
    slideType: slide.slide_type,
    visualMode: slide.visual_mode,
  }));
}

export function addSlide(plan: SlidePlanItem[], afterIndex: number, type: string): SlidePlanItem[] {
  const slideType = ensureSlideType(type);
  const insertionPoint = normalizeIndex(afterIndex + 1, plan.length);
  const next = [...plan];
  next.splice(insertionPoint, 0, {
    slideNumber: 0,
    slideType,
    visualMode: defaultVisualModeForType(slideType),
  });
  return reindex(next);
}

export function removeSlide(plan: SlidePlanItem[], index: number): SlidePlanItem[] {
  if (!plan.length) {
    return [];
  }
  const target = normalizeIndex(index, plan.length - 1);
  const next = [...plan];
  next.splice(target, 1);
  return reindex(next);
}

export function changeSlideType(plan: SlidePlanItem[], index: number, newType: string): SlidePlanItem[] {
  if (!plan.length) {
    return [];
  }
  const slideType = ensureSlideType(newType);
  const target = normalizeIndex(index, plan.length - 1);
  const next = [...plan];
  const current = next[target];
  next[target] = {
    ...current,
    slideType,
    visualMode: slideType === 'content' ? current.visualMode ?? 'none' : undefined,
  };
  return reindex(next);
}
