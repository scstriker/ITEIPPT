import type { VisualMode } from './template';

export type CoverageLevel = 'sufficient' | 'moderate' | 'sparse';

export interface PresetSubtitle {
  subtitle: string;
  visualMode: VisualMode;
  contentHint: string;
}

export interface PresetChapter {
  title: string;
  defaultSubtitles: PresetSubtitle[];
}

export interface TemplatePreset {
  id: 'standard_review' | 'academic_research' | 'blank';
  name: string;
  description: string;
  chapters: PresetChapter[];
}

export interface SubSlidePlan {
  subtitle: string;
  visualMode: VisualMode;
  contentHint?: string;
}

export interface ChapterPlan {
  chapterIndex: number;
  chapterTitle: string;
  slides: SubSlidePlan[];
  aiReason?: string;
  coverageLevel?: CoverageLevel;
  sourceHint?: string;
}

export interface ApiChapterInsight {
  chapterIndex: number;
  reason: string;
  coverageLevel: CoverageLevel;
  sourceHint?: string;
}

export interface ApiSlideInsight {
  chapterIndex: number;
  slideIndex: number;
  subtitle?: string;
  visualMode: VisualMode;
  reason: string;
  sourceHint?: string;
}

export interface FrameworkPlan {
  presetId: TemplatePreset['id'];
  coverInfo: {
    standardName?: string;
    planNumber?: string;
    presenter?: string;
    date?: string;
  };
  chapters: ChapterPlan[];
  endingInfo: {
    organization?: string;
    contactInfo?: string[];
  };
  apiPlanMeta?: {
    provider?: string;
    recommendedAt?: string;
    chapterInsights?: ApiChapterInsight[];
    slideInsights?: ApiSlideInsight[];
  };
}
