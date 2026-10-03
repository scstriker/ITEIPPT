import { useMemo, useState } from 'react';
import { createFrameworkPlanFromPreset } from '../config/templatePresets';
import type { ParsedDocument } from '../services/documentParser';
import type { AnalyzerResult, SlideContent } from '../types/analyzer';
import type { FrameworkPlan } from '../types/framework';

export type WorkflowStep = 'upload' | 'framework' | 'images' | 'audit';

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

const STEP_ORDER: WorkflowStep[] = ['upload', 'framework', 'images', 'audit'];

function createInitialWorkflowState(): WorkflowState {
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

function cloneImageMap(map: Map<string, File>): Map<string, File> {
  const next = new Map<string, File>();
  for (const [key, value] of map.entries()) {
    next.set(key, value);
  }
  return next;
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function normalizeDigestText(value?: string): string {
  return (value ?? '').trim();
}

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

function extractDocumentTitle(document: ParsedDocument): string {
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

export function getImageSlotKey(page: number, slotIndex: number): string {
  return `page-${page}-slot-${slotIndex}`;
}

export function useWorkflow() {
  const [state, setState] = useState<WorkflowState>(() => createInitialWorkflowState());
  const [taskRevision, setTaskRevision] = useState(0);

  const frameworkDigest = useMemo(() => buildFrameworkDigest(state.frameworkPlan), [state.frameworkPlan]);
  const isAnalyzerFresh = useMemo(
    () => Boolean(state.analyzerResult) && state.analyzerPlanDigest === frameworkDigest,
    [frameworkDigest, state.analyzerPlanDigest, state.analyzerResult],
  );

  const availableSteps = useMemo(() => {
    const unlocked: Record<WorkflowStep, boolean> = {
      upload: true,
      framework: !!state.parsedDocument,
      images: isAnalyzerFresh,
      audit: isAnalyzerFresh,
    };
    return unlocked;
  }, [isAnalyzerFresh, state.parsedDocument]);

  const goToStep = (step: WorkflowStep) => {
    if (!availableSteps[step]) {
      return;
    }
    setState((prev) => ({ ...prev, currentStep: step }));
  };

  const goNext = () => {
    setState((prev) => {
      const currentIdx = STEP_ORDER.indexOf(prev.currentStep);
      for (let index = currentIdx + 1; index < STEP_ORDER.length; index += 1) {
        const candidate = STEP_ORDER[index];
        if (availableSteps[candidate]) {
          return { ...prev, currentStep: candidate };
        }
      }
      return prev;
    });
  };

  const goPrev = () => {
    setState((prev) => {
      const currentIdx = STEP_ORDER.indexOf(prev.currentStep);
      for (let index = currentIdx - 1; index >= 0; index -= 1) {
        const candidate = STEP_ORDER[index];
        if (availableSteps[candidate]) {
          return { ...prev, currentStep: candidate };
        }
      }
      return prev;
    });
  };

  const setParsedDocument = (document: ParsedDocument, meta?: UploadMeta) => {
    const title = extractDocumentTitle(document);
    const presenter = meta?.presenter?.trim() || undefined;
    const organization = meta?.organization?.trim() || undefined;

    setState((prev) => ({
      ...prev,
      parsedDocument: document,
      frameworkPlan: {
        ...prev.frameworkPlan,
        coverInfo: {
          ...prev.frameworkPlan.coverInfo,
          standardName: title,
          ...(meta ? { presenter } : {}),
        },
        endingInfo: {
          ...prev.frameworkPlan.endingInfo,
          ...(meta ? { organization } : {}),
        },
      },
      analyzerResult: null,
      analyzerPlanDigest: null,
      importedImages: new Map<string, File>(),
      auditState: [],
      generatedBlob: null,
    }));
  };

  const setFrameworkPlan = (plan: FrameworkPlan) => {
    setState((prev) => ({
      ...prev,
      frameworkPlan: plan,
      generatedBlob: null,
    }));
  };

  const setAnalyzerResult = (result: AnalyzerResult) => {
    setState((prev) => ({
      ...prev,
      analyzerResult: result,
      analyzerPlanDigest: buildFrameworkDigest(prev.frameworkPlan),
      auditState: result.slidePlan.map((slide) => ({
        page: slide.page,
        auditStatus: slide.type === 'content' ? 'pending' : 'reviewed',
      })),
    }));
  };

  const setImportedImage = (key: string, file: File) => {
    setState((prev) => {
      const nextMap = cloneImageMap(prev.importedImages);
      nextMap.set(key, file);
      return {
        ...prev,
        importedImages: nextMap,
      };
    });
  };

  const removeImportedImage = (key: string) => {
    setState((prev) => {
      if (!prev.importedImages.has(key)) {
        return prev;
      }
      const nextMap = cloneImageMap(prev.importedImages);
      nextMap.delete(key);
      return {
        ...prev,
        importedImages: nextMap,
      };
    });
  };

  const updateSlideContent = (page: number, updater: (slide: SlideContent) => SlideContent) => {
    setState((prev) => {
      if (!prev.analyzerResult) {
        return prev;
      }
      const nextSlidePlan = prev.analyzerResult.slidePlan.map((slide) => (slide.page === page ? updater(slide) : slide));
      const nextAudit: AuditSlideState[] = prev.auditState.map((item) =>
        item.page === page ? { ...item, auditStatus: 'modified' } : item,
      );
      return {
        ...prev,
        analyzerResult: {
          ...prev.analyzerResult,
          slidePlan: nextSlidePlan,
        },
        auditState: nextAudit,
      };
    });
  };

  const setGeneratedBlob = (blob: Blob | null) => {
    setState((prev) => ({
      ...prev,
      generatedBlob: blob,
    }));
  };

  const resetWorkflow = () => {
    setState(createInitialWorkflowState());
    setTaskRevision((prev) => prev + 1);
  };

  return {
    state,
    stepOrder: STEP_ORDER,
    availableSteps,
    isAnalyzerFresh,
    goToStep,
    goNext,
    goPrev,
    setParsedDocument,
    setFrameworkPlan,
    setAnalyzerResult,
    setImportedImage,
    removeImportedImage,
    updateSlideContent,
    setGeneratedBlob,
    resetWorkflow,
    taskRevision,
  };
}
