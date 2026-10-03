import { useCallback, useMemo, useReducer, useState } from 'react';
import type { AnalyzerResult, SlideContent } from '@contracts/analyzer';
import type { FrameworkPlan } from '@contracts/framework';
import type { ParsedDocument } from '../services/document/documentParser';
import {
  STEP_ORDER,
  createInitialWorkflowState,
  selectAvailableSteps,
  selectIsAnalyzerFresh,
  selectNextStep,
  selectPrevStep,
  workflowReducer,
  type UploadMeta,
  type WorkflowStep,
} from './workflowReducer';

export type { WorkflowState, WorkflowStep } from './workflowReducer';

export function useWorkflow() {
  const [state, dispatch] = useReducer(workflowReducer, undefined, createInitialWorkflowState);
  // Bumped on reset so the upload step remounts with empty local state.
  const [taskRevision, setTaskRevision] = useState(0);

  const isAnalyzerFresh = useMemo(() => selectIsAnalyzerFresh(state), [state]);
  const availableSteps = useMemo(() => selectAvailableSteps(state), [state]);
  const nextStep = useMemo(() => selectNextStep(state), [state]);
  const prevStep = useMemo(() => selectPrevStep(state), [state]);

  return {
    state,
    stepOrder: STEP_ORDER,
    availableSteps,
    isAnalyzerFresh,
    nextStep,
    prevStep,
    taskRevision,
    goToStep: useCallback((step: WorkflowStep) => dispatch({ type: 'goToStep', step }), []),
    goNext: useCallback(() => dispatch({ type: 'goNext' }), []),
    goPrev: useCallback(() => dispatch({ type: 'goPrev' }), []),
    setParsedDocument: useCallback(
      (document: ParsedDocument, meta?: UploadMeta) => dispatch({ type: 'setParsedDocument', document, meta }),
      [],
    ),
    setFrameworkPlan: useCallback((plan: FrameworkPlan) => dispatch({ type: 'setFrameworkPlan', plan }), []),
    setAnalyzerResult: useCallback((result: AnalyzerResult) => dispatch({ type: 'setAnalyzerResult', result }), []),
    setImportedImage: useCallback((key: string, file: File) => dispatch({ type: 'setImportedImage', key, file }), []),
    removeImportedImage: useCallback((key: string) => dispatch({ type: 'removeImportedImage', key }), []),
    updateSlideContent: useCallback(
      (page: number, updater: (slide: SlideContent) => SlideContent) => dispatch({ type: 'updateSlide', page, updater }),
      [],
    ),
    setGeneratedBlob: useCallback((blob: Blob | null) => dispatch({ type: 'setGeneratedBlob', blob }), []),
    resetWorkflow: useCallback(() => {
      dispatch({ type: 'reset' });
      setTaskRevision((prev) => prev + 1);
    }, []),
  };
}
