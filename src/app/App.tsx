import { useMemo } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Notice } from '@/components/itei/Blocks';
import { AppFooter, AppHeader, StepNav } from '@/components/itei/Shell';
import { Button } from '@/components/ui/button';
import { useConfirmCenter } from '../confirm/useConfirmCenter';
import { ContentAuditor } from '../features/audit/ContentAuditor';
import { GeneratePanel } from '../features/export/GeneratePanel';
import { FrameworkPlanner } from '../features/framework/FrameworkPlanner';
import { ImageImporter } from '../features/images/ImageImporter';
import { UploadPanel } from '../features/upload/UploadPanel';
import { useWorkflow } from '../workflow/useWorkflow';
import { STEP_LABELS, type WorkflowStep } from '../workflow/workflowReducer';

function App() {
  const workflow = useWorkflow();
  const { requestConfirm, confirmModal, confirmBusy } = useConfirmCenter();
  const { state, nextStep, prevStep } = workflow;
  const currentStepIndex = workflow.stepOrder.indexOf(state.currentStep);
  const isLastStep = state.currentStep === 'audit';
  const canGoPrev = Boolean(prevStep);
  const canGoNext = Boolean(nextStep);
  const currentStepLabel = STEP_LABELS[state.currentStep];

  const nextBlockedReason = useMemo(() => {
    if (isLastStep) {
      return null;
    }

    if (state.currentStep === 'upload' && !state.parsedDocument) {
      return '请先上传并解析文档，再进入下一步。';
    }

    if (state.currentStep === 'framework') {
      if (!state.analyzerResult) {
        return '请先在当前框架下生成内容，再进入下一步。';
      }
      if (!workflow.isAnalyzerFresh) {
        return '框架已修改，之前生成的内容已失效。请重新生成后再进入下一步。';
      }
    }

    if (state.currentStep === 'images' && !workflow.isAnalyzerFresh) {
      return '当前内容已过期，请返回“规划框架”重新生成内容。';
    }

    if (!canGoNext) {
      return '当前步骤尚未满足进入下一步的条件。';
    }

    return null;
  }, [canGoNext, isLastStep, state.analyzerResult, state.currentStep, state.parsedDocument, workflow.isAnalyzerFresh]);

  const stepItems = workflow.stepOrder.map((step, index) => ({
    key: step,
    label: STEP_LABELS[step],
    current: index === currentStepIndex,
    done: index < currentStepIndex,
    disabled: !workflow.availableSteps[step] || index === currentStepIndex || confirmBusy,
  }));

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppHeader
        title="ITEISlides"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-on-gradient bg-transparent text-on-gradient hover:bg-white/10"
            disabled={confirmBusy}
            onClick={() => {
              requestConfirm('task_reset_all', { currentStepLabel }, () => workflow.resetWorkflow());
            }}
          >
            <IconAlertTriangle aria-hidden="true" stroke={2} />
            开始新任务
          </Button>
        }
      />

      <StepNav
        items={stepItems}
        onSelect={(key) => {
          const step = key as WorkflowStep;
          if (step === state.currentStep) {
            return;
          }
          requestConfirm(
            'nav_step_switch',
            {
              fromStepLabel: currentStepLabel,
              toStepLabel: STEP_LABELS[step],
            },
            () => workflow.goToStep(step),
          );
        }}
      />

      <main className="mx-auto flex w-full max-w-[var(--content-max)] flex-1 flex-col gap-6 px-8 py-6">
        {state.currentStep === 'upload' ? (
          <UploadPanel key={workflow.taskRevision} parsedDocument={state.parsedDocument} onParsed={workflow.setParsedDocument} />
        ) : null}

        {state.currentStep === 'framework' ? (
          <FrameworkPlanner
            parsedDocument={state.parsedDocument}
            plan={state.frameworkPlan}
            analyzerResult={state.analyzerResult}
            isAnalyzerFresh={workflow.isAnalyzerFresh}
            requestConfirm={requestConfirm}
            confirmBusy={confirmBusy}
            onChange={workflow.setFrameworkPlan}
            onGenerated={workflow.setAnalyzerResult}
          />
        ) : null}

        {state.currentStep === 'images' ? (
          <ImageImporter
            analyzerResult={state.analyzerResult}
            importedImages={state.importedImages}
            requestConfirm={requestConfirm}
            confirmBusy={confirmBusy}
            onImportImage={workflow.setImportedImage}
            onRemoveImage={workflow.removeImportedImage}
          />
        ) : null}

        {state.currentStep === 'audit' ? (
          <>
            <ContentAuditor
              analyzerResult={state.analyzerResult}
              importedImages={state.importedImages}
              onUpdateSlide={workflow.updateSlideContent}
            />
            <GeneratePanel
              analyzerResult={state.analyzerResult}
              importedImages={state.importedImages}
              requestConfirm={requestConfirm}
              confirmBusy={confirmBusy}
              onGenerated={workflow.setGeneratedBlob}
            />
          </>
        ) : null}

        {nextBlockedReason ? <Notice tone="warning">{nextBlockedReason}</Notice> : null}

        <div className="flex items-center justify-between border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={!canGoPrev || confirmBusy}
            onClick={() => {
              if (!prevStep) {
                return;
              }
              requestConfirm(
                'nav_prev_step',
                {
                  fromStepLabel: currentStepLabel,
                  toStepLabel: STEP_LABELS[prevStep],
                },
                () => workflow.goPrev(),
              );
            }}
          >
            ← 上一步
          </Button>

          {!isLastStep ? (
            <Button
              type="button"
              disabled={!canGoNext || confirmBusy}
              onClick={() => {
                if (!nextStep) {
                  return;
                }
                requestConfirm(
                  'nav_next_step',
                  {
                    fromStepLabel: currentStepLabel,
                    toStepLabel: STEP_LABELS[nextStep],
                  },
                  () => workflow.goNext(),
                );
              }}
            >
              下一步 →
            </Button>
          ) : null}
        </div>
      </main>

      <AppFooter />
      {confirmModal}
    </div>
  );
}

export default App;
