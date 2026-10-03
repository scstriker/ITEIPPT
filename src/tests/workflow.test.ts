// AC-003, AC-005, AC-007, AC-016: workflow state machine.
import { describe, expect, it } from 'vitest';
import type { AnalyzerResult } from '@contracts/analyzer';
import {
  buildFrameworkDigest,
  createInitialWorkflowState,
  extractDocumentTitle,
  selectAvailableSteps,
  selectIsAnalyzerFresh,
  workflowReducer,
  type WorkflowAction,
  type WorkflowState,
} from '../workflow/workflowReducer';
import { createFrameworkPlanFromPreset } from '../template/presets';

const doc = { filename: '送审稿（示例）.docx', fileType: 'docx' as const, textContent: '\n  压力传感器（示例）\n正文' };
const result = {
  slidePlan: [
    { page: 1, type: 'cover' },
    { page: 2, type: 'content', bodyText: 'a' },
  ],
} as AnalyzerResult;

function run(...actions: WorkflowAction[]): WorkflowState {
  return actions.reduce(workflowReducer, createInitialWorkflowState());
}

describe('document title', () => {
  it('uses the first non-empty line, else the file name', () => {
    expect(extractDocumentTitle(doc)).toBe('压力传感器（示例）');
    expect(extractDocumentTitle({ ...doc, textContent: ' \n ' })).toBe('送审稿（示例）');
  });
});

describe('workflowReducer', () => {
  it('starts on upload with only upload available', () => {
    const state = createInitialWorkflowState();
    expect(state.currentStep).toBe('upload');
    expect(state.frameworkPlan.presetId).toBe('blank');
    expect(selectAvailableSteps(state)).toEqual({ upload: true, framework: false, images: false, audit: false });
    expect(workflowReducer(state, { type: 'goNext' }).currentStep).toBe('upload');
  });

  it('back-fills cover and ending info from the upload', () => {
    const state = run({ type: 'setParsedDocument', document: doc, meta: { presenter: ' 张三 ', organization: '' } });
    expect(state.frameworkPlan.coverInfo).toEqual({ standardName: '压力传感器（示例）', presenter: '张三' });
    expect(state.frameworkPlan.endingInfo).toEqual({ organization: undefined });
    expect(selectAvailableSteps(state).framework).toBe(true);
    expect(workflowReducer(state, { type: 'goNext' }).currentStep).toBe('framework');
  });

  it('unlocks images and audit only while the result matches the framework', () => {
    const plan = createFrameworkPlanFromPreset('academic_research');
    let state = run(
      { type: 'setParsedDocument', document: doc },
      { type: 'setFrameworkPlan', plan },
      { type: 'setAnalyzerResult', result },
    );
    expect(selectIsAnalyzerFresh(state)).toBe(true);
    expect(state.analyzerPlanDigest).toBe(buildFrameworkDigest(plan));
    expect(state.auditState).toEqual([
      { page: 1, auditStatus: 'reviewed' },
      { page: 2, auditStatus: 'pending' },
    ]);

    const edited = { ...plan, chapters: plan.chapters.map((c, i) => (i === 0 ? { ...c, chapterTitle: '改' } : c)) };
    state = workflowReducer(state, { type: 'setFrameworkPlan', plan: edited });
    expect(selectAvailableSteps(state)).toMatchObject({ images: false, audit: false });
    expect(workflowReducer(state, { type: 'goToStep', step: 'audit' }).currentStep).toBe('upload');

    state = workflowReducer(state, { type: 'setFrameworkPlan', plan: { ...plan, chapters: plan.chapters.map((c) => ({ ...c, chapterTitle: ` ${c.chapterTitle} ` })) } });
    expect(selectIsAnalyzerFresh(state)).toBe(true);
  });

  it('marks edited slides as modified and keeps image map immutable', () => {
    const before = run(
      { type: 'setParsedDocument', document: doc },
      { type: 'setAnalyzerResult', result },
    );
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const withImage = workflowReducer(before, { type: 'setImportedImage', key: 'page-2-slot-0', file });
    expect(before.importedImages.size).toBe(0);
    expect(withImage.importedImages.get('page-2-slot-0')).toBe(file);
    expect(workflowReducer(withImage, { type: 'removeImportedImage', key: 'nope' })).toBe(withImage);

    const edited = workflowReducer(withImage, { type: 'updateSlide', page: 2, updater: (s) => ({ ...s, bodyText: 'b' }) });
    expect(edited.analyzerResult?.slidePlan[1].bodyText).toBe('b');
    expect(edited.auditState[1].auditStatus).toBe('modified');
  });

  it('a new upload clears results and images; reset clears everything', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const state = run(
      { type: 'setParsedDocument', document: doc },
      { type: 'setAnalyzerResult', result },
      { type: 'setImportedImage', key: 'k', file },
      { type: 'setParsedDocument', document: doc },
    );
    expect(state.analyzerResult).toBeNull();
    expect(state.importedImages.size).toBe(0);
    const reset = workflowReducer(state, { type: 'reset' });
    expect(reset).toEqual(createInitialWorkflowState());
  });
});
