import type { AISupplement, ImagePrompt, SlideTableData, SourceConfidence } from '../contracts/analyzer';
import type { VisualMode } from '../contracts/template';

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

export interface GeneratedContentPayload {
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

export interface SlidePlanFallbackOptions {
  textContent?: string;
  sourceFilename?: string;
}

export interface SlidePageMeta {
  chapterIndex: number;
  slideIndex: number;
  chapterTitle: string;
  subtitle: string;
  contentHint?: string;
  visualMode: VisualMode;
  sourceHint?: string;
  slideReason?: string;
}

export interface SlideEvidenceCandidate {
  text: string;
  score: number;
}

export interface SlideEvidenceContext {
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
