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
  /** Clock used for the soft deadline; tests replace it. */
  now?: () => number;
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

export interface DocumentExcerpt {
  text: string;
  truncated: boolean;
}

/** Document excerpts for the full prompt and the compact retry prompt. */
export interface DocumentExcerpts {
  full: DocumentExcerpt;
  compact: DocumentExcerpt;
}

/** One batch of content pages, sent from the browser to POST /api/generate-content/batch. */
export interface ContentBatchRequest {
  presetId: string;
  contexts: SlideEvidenceContext[];
  excerpts: DocumentExcerpts;
}

export interface ContentBatchResult {
  /** false when every Gemini call for the batch failed and the pages were filled by rules. */
  ok: boolean;
  slides: NonNullable<GeneratedContentPayload['slides']>;
  /** Pages whose body was completed from evidence (weak grounding). */
  weakPages: number[];
  /** Pages filled by rules because the batch failed. */
  fallbackPages: number[];
  diagnostics: {
    initialMissingPages: number[];
    rewriteRecoveredPages: number[];
    autoCompletedPages: number[];
    finalMissingPages: number[];
  };
  error?: string;
}

/** Runs one batch: on the server it calls Gemini, in the browser it posts to the Worker. */
export type ContentBatchRunner = (request: ContentBatchRequest) => Promise<ContentBatchResult>;
