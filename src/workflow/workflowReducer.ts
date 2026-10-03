// Pure workflow state machine: upload -> framework -> images -> audit.
import type { AnalyzerResult, SlideContent } from '@contracts/analyzer';
import type { FrameworkPlan } from '@contracts/framework';
import type { ParsedDocument } from '../services/document/documentParser';
import { createFrameworkPlanFromPreset } from '../template/presets';

export type WorkflowStep = 'upload' | 'framework' | 'images' | 'audit';

export const STEP_ORDER: WorkflowStep[] = ['upload', 'framework', 'images', 'audit'];

export const STEP_LABELS: Record<WorkflowStep, string> = {
  upload: '上传文档',
  framework: '规划框架',
  images: '配图导入',
  audit: '审计预览',
};

export interface AuditSlideState {
  page: number;
  auditStatus: 'pending' | 'reviewed' | 'modified';
  userNotes?: string;
}

export interface WorkflowState {
  currentStep: WorkflowStep;
  parsedDocument: ParsedDocument | null;
  frameworkPlan: FrameworkPlan;
  analyzerResult: AnalyzerResult | null;
  analyzerPlanDigest: string | null;
  importedImages: Map<string, File>;
  auditState: AuditSlideState[];
  generatedBlob: Blob | null;
}

export interface UploadMeta {
  presenter?: string;
  organization?: string;
}

export type WorkflowAction =
  | { type: 'goToStep'; step: WorkflowStep }
  | { type: 'goNext' }
  | { type: 'goPrev' }
  | { type: 'setParsedDocument'; document: ParsedDocument; meta?: UploadMeta }
  | { type: 'setFrameworkPlan'; plan: FrameworkPlan }
  | { type: 'setAnalyzerResult'; result: AnalyzerResult }
  | { type: 'setImportedImage'; key: string; file: File }
  | { type: 'removeImportedImage'; key: string }
  | { type: 'updateSlide'; page: number; updater: (slide: SlideContent) => SlideContent }
  | { type: 'setGeneratedBlob'; blob: Blob | null }
  | { type: 'reset' };

export function createInitialWorkflowState(): WorkflowState {
  return {
    currentStep: 'upload',
    parsedDocument: null,
    frameworkPlan: createFrameworkPlanFromPreset('blank'),
    analyzerResult: null,
    analyzerPlanDigest: null,
    importedImages: new Map<string, File>(),
    auditState: [],
    generatedBlob: null,
  };
}

function normalizeDigestText(value?: string): string {
  return (value ?? '').trim();
}

/** Identity of the framework content; generated results are only valid for the digest they were built from. */
export function buildFrameworkDigest(plan: FrameworkPlan): string {
  return JSON.stringify({
    presetId: plan.presetId,
    chapters: plan.chapters.map((chapter) => ({
      chapterIndex: chapter.chapterIndex,
      chapterTitle: normalizeDigestText(chapter.chapterTitle),
      slides: chapter.slides.map((slide) => ({
        subtitle: normalizeDigestText(slide.subtitle),
        visualMode: slide.visualMode,
        contentHint: normalizeDigestText(slide.contentHint),
      })),
    })),
  });
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

/** Cover title: first non-empty line of the text, else the file name without extension. */
export function extractDocumentTitle(document: ParsedDocument): string {
  const firstLine = document.textContent
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) {
    return firstLine;
  }
  const fallback = stripFileExtension(document.filename).trim();
  return fallback || '未命名文档';
}

export function selectIsAnalyzerFresh(state: WorkflowState): boolean {
  return Boolean(state.analyzerResult) && state.analyzerPlanDigest === buildFrameworkDigest(state.frameworkPlan);
}

export function selectAvailableSteps(state: WorkflowState): Record<WorkflowStep, boolean> {
  const fresh = selectIsAnalyzerFresh(state);
  return {
    upload: true,
    framework: !!state.parsedDocument,
    images: fresh,
    audit: fresh,
  };
}

function stepFrom(state: WorkflowState, direction: 1 | -1): WorkflowStep | null {
  const available = selectAvailableSteps(state);
  const currentIdx = STEP_ORDER.indexOf(state.currentStep);
  for (let index = currentIdx + direction; index >= 0 && index < STEP_ORDER.length; index += direction) {
    if (available[STEP_ORDER[index]]) {
      return STEP_ORDER[index];
    }
  }
  return null;
}

export function selectNextStep(state: WorkflowState): WorkflowStep | null {
  return stepFrom(state, 1);
}

export function selectPrevStep(state: WorkflowState): WorkflowStep | null {
  return stepFrom(state, -1);
}

function withImages(map: Map<string, File>, change: (next: Map<string, File>) => void): Map<string, File> {
  const next = new Map(map);
  change(next);
  return next;
}

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case 'goToStep':
      return selectAvailableSteps(state)[action.step] ? { ...state, currentStep: action.step } : state;
    case 'goNext': {
      const next = selectNextStep(state);
      return next ? { ...state, currentStep: next } : state;
    }
    case 'goPrev': {
      const prev = selectPrevStep(state);
      return prev ? { ...state, currentStep: prev } : state;
    }
    case 'setParsedDocument': {
      const { document, meta } = action;
      const presenter = meta?.presenter?.trim() || undefined;
      const organization = meta?.organization?.trim() || undefined;
      return {
        ...state,
        parsedDocument: document,
        frameworkPlan: {
          ...state.frameworkPlan,
          coverInfo: {
            ...state.frameworkPlan.coverInfo,
            standardName: extractDocumentTitle(document),
            ...(meta ? { presenter } : {}),
          },
          endingInfo: {
            ...state.frameworkPlan.endingInfo,
            ...(meta ? { organization } : {}),
          },
        },
        analyzerResult: null,
        analyzerPlanDigest: null,
        importedImages: new Map<string, File>(),
        auditState: [],
        generatedBlob: null,
      };
    }
    case 'setFrameworkPlan':
      return { ...state, frameworkPlan: action.plan, generatedBlob: null };
    case 'setAnalyzerResult':
      return {
        ...state,
        analyzerResult: action.result,
        analyzerPlanDigest: buildFrameworkDigest(state.frameworkPlan),
        auditState: action.result.slidePlan.map((slide) => ({
          page: slide.page,
          auditStatus: slide.type === 'content' ? 'pending' : 'reviewed',
        })),
      };
    case 'setImportedImage':
      return { ...state, importedImages: withImages(state.importedImages, (next) => next.set(action.key, action.file)) };
    case 'removeImportedImage':
      if (!state.importedImages.has(action.key)) {
        return state;
      }
      return { ...state, importedImages: withImages(state.importedImages, (next) => next.delete(action.key)) };
    case 'updateSlide': {
      if (!state.analyzerResult) {
        return state;
      }
      return {
        ...state,
        analyzerResult: {
          ...state.analyzerResult,
          slidePlan: state.analyzerResult.slidePlan.map((slide) => (slide.page === action.page ? action.updater(slide) : slide)),
        },
        auditState: state.auditState.map((item) => (item.page === action.page ? { ...item, auditStatus: 'modified' } : item)),
      };
    }
    case 'setGeneratedBlob':
      return { ...state, generatedBlob: action.blob };
    case 'reset':
      return createInitialWorkflowState();
    default:
      return state;
  }
}
