import type { FrameworkPlan } from './framework';
import type { VisualMode } from './template';

export type SlideType = 'cover' | 'toc_section' | 'content' | 'ending';

export type SourceConfidence = 'exact' | 'paraphrased' | 'ai_inferred' | 'ai_constructed';

export type AISupplementType =
  | 'common_knowledge'
  | 'ai_summary'
  | 'ai_inference'
  | 'ai_construction'
  | 'chart_design';

export interface SlideTableData {
  headers: string[];
  rows: string[][];
  headerFillColor?: string;
}

export interface SlideImageData {
  key?: string;
  data?: string;
  mimeType?: string;
}

export interface SlideBodyRun {
  text: string;
  color?: string;
  bold?: boolean;
}

export interface ImagePrompt {
  description: string;
  iteiDrawPrompt: string;
}

export interface AISupplement {
  description: string;
  type: AISupplementType;
}

export interface SlideContent {
  page: number;
  type: SlideType;

  // cover
  standardName?: string;
  planNumber?: string;
  reportTitle?: string;
  presenter?: string;
  date?: string;

  // toc_section
  pageTitle?: string;
  highlightChapter?: number;
  sectionItems?: Array<{ number?: string; title?: string }>;

  // content
  chapterTitle?: string;
  subtitle?: string;
  bodyText?: string;
  bodyRuns?: SlideBodyRun[];
  highlightRanges?: Array<[number, number]>;
  visualMode?: VisualMode;
  tableData?: SlideTableData;
  images?: SlideImageData[];
  imagePrompts?: ImagePrompt[];
  imageFiles?: string[];

  // ending
  thanks?: string;
  organization?: string;
  contactInfo?: string[];

  // traceability
  sourceRef?: string;
  sourceConfidence?: SourceConfidence;
  aiSupplements?: AISupplement[];
}

export interface AnalyzerResult {
  frameworkPlan: FrameworkPlan;
  slidePlan: SlideContent[];
  sourceFiles: Array<{ id: number; filename: string; shortName: string }>;
  missingInfo: Array<{ page: number; description: string; solution: string }>;
  imagePromptsTotal: number;
  auditSummary: {
    totalSlides: number;
    exactSourcePercent: number;
    aiSupplementCount: number;
    missingCount: number;
  };
  generationMeta?: {
    mode: 'normal' | 'degraded';
    reason?: string;
  };
  generatedAt: string;
}
