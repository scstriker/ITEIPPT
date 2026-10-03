import { useMemo } from 'react';
import { ContentAuditor } from '../features/audit/ContentAuditor';
import { FrameworkPlanner } from '../features/framework/FrameworkPlanner';
import { GeneratePanel } from '../features/export/GeneratePanel';
import { ImageImporter } from '../features/images/ImageImporter';
import { UploadPanel } from '../features/upload/UploadPanel';
import { useConfirmCenter } from '../confirm/useConfirmCenter';
import { useWorkflow, type WorkflowStep } from '../workflow/useWorkflow';
import './styles.css';

const STEP_LABELS: Record<WorkflowStep, string> = {
  upload: '上传文档',
  framework: '规划框架',
  images: '配图导入',
  audit: '审计预览',
};

function App() {
  const workflow = useWorkflow();
  const { requestConfirm, confirmModal, confirmBusy } = useConfirmCenter();
  const { state } = workflow;
  const currentStepIndex = workflow.stepOrder.indexOf(state.currentStep);
  const isLastStep = state.currentStep === 'audit';

  const prevStep = [...workflow.stepOrder]
    .slice(0, currentStepIndex)
    .reverse()
    .find((step) => workflow.availableSteps[step]) ?? null;
  const canGoPrev = Boolean(prevStep);

  const nextStep = workflow.stepOrder.slice(currentStepIndex + 1).find((step) => workflow.availableSteps[step]) ?? null;
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
  }, [
    canGoNext,
    isLastStep,
    state.analyzerResult,
    state.currentStep,
    state.parsedDocument,
    workflow.isAnalyzerFresh,
  ]);

  return (
    <main className="app-shell">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <img
              src="/Gemini_Generated_Image_8phlmm8phlmm8phl.jpg"
              alt="ITEISlides Logo"
              className="header-logo"
            />
            <h1>ITEISlides</h1>
          </div>
          <button
            type="button"
            className="task-reset-btn"
            disabled={confirmBusy}
            onClick={() => {
              requestConfirm('task_reset_all', { currentStepLabel }, () => workflow.resetWorkflow());
            }}
          >
            ⚠ 开始新任务
          </button>
        </div>
      </header>

      <nav className="stepper">
        {workflow.stepOrder.map((step, index) => {
          const isDone = index < currentStepIndex;
          const isActive = index === currentStepIndex;
          const isUnavailable = !workflow.availableSteps[step];
          const className = `step-tab${isDone ? ' done' : ''}${isActive ? ' active' : ''}`;

          return (
            <button
              key={step}
              type="button"
              className={className}
              disabled={isUnavailable || isActive || confirmBusy}
              onClick={() => {
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
            >
              <span className="step-num">{index + 1}</span>
              <span>{STEP_LABELS[step]}</span>
            </button>
          );
        })}
      </nav>

      <div className="container">
        {state.currentStep === 'upload' ? (
          <UploadPanel
            key={workflow.taskRevision}
            parsedDocument={state.parsedDocument}
            onParsed={workflow.setParsedDocument}
          />
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

        {nextBlockedReason ? <p className="message-warning">{nextBlockedReason}</p> : null}

        <footer className="actions main-actions">
          <button
            type="button"
            className="btn btn-secondary"
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
          </button>

          {!isLastStep ? (
            <button
              type="button"
              className="btn btn-primary"
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
            </button>
          ) : null}
        </footer>
      </div>

      {confirmModal}
    </main>
  );
}

export default App;
