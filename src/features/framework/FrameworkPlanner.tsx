import { Fragment, useEffect, useMemo, useState } from 'react';
import type { AnalyzerResult } from '@contracts/analyzer';
import type { FrameworkPlan, TemplatePreset } from '@contracts/framework';
import type { ConfirmRequest } from '../../confirm/confirmActions';
import type { ParsedDocument } from '../../services/document/documentParser';
import { mapPlanErrorToMessage, requestFrameworkPlan } from '../../services/api/planApi';
import { getTemplatePresets } from '../../template/presets';
import {
  COVERAGE_LABELS,
  aiSuggestionItems as listAiSuggestions,
  appendChapter,
  appendSubSlide,
  applyPreset,
  coverageSummaryText as buildCoverageSummary,
  degradedWarning,
  estimateTotalPages,
  getProgressStageText,
  getVisualModeLabel,
  mergeInsights,
  removeChapter as removeChapterFromPlan,
  removeSubSlide as removeSubSlideFromPlan,
  resizeSlides,
  setChapterTitle,
  setSubSlideTitle,
  slideInsightKey,
  slideInsightReasons,
  updateChapterSlides,
  validatePlanBeforeGenerate,
} from './frameworkEditing';
import { useGenerationJob } from './useGenerationJob';

interface FrameworkPlannerProps {
  parsedDocument: ParsedDocument | null;
  plan: FrameworkPlan;
  analyzerResult: AnalyzerResult | null;
  isAnalyzerFresh: boolean;
  requestConfirm: ConfirmRequest;
  confirmBusy: boolean;
  onChange: (plan: FrameworkPlan) => void;
  onGenerated?: (result: AnalyzerResult) => void;
}

export function FrameworkPlanner({
  parsedDocument,
  plan,
  analyzerResult,
  isAnalyzerFresh,
  requestConfirm,
  confirmBusy,
  onChange,
  onGenerated,
}: FrameworkPlannerProps) {
  const presets = getTemplatePresets();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [expandedChapterIndex, setExpandedChapterIndex] = useState<number | null>(null);

  const {
    isGenerating,
    genError,
    setGenError,
    genPercent,
    genServerStage,
    genJobId,
    showRetryGenerate,
    runGenerate,
  } = useGenerationJob({ parsedDocument, plan, onGenerated });

  const hasStaleAnalyzerResult = Boolean(analyzerResult) && !isAnalyzerFresh;

  useEffect(() => {
    if (!isGenerating && !isAnalyzing) {
      return undefined;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isAnalyzing, isGenerating]);

  const totalPages = estimateTotalPages(plan);
  const progressStageText = useMemo(
    () => genServerStage?.trim() || getProgressStageText(genPercent),
    [genPercent, genServerStage],
  );
  const generationWarningMessage = useMemo(
    () => degradedWarning(analyzerResult, isAnalyzerFresh),
    [analyzerResult, isAnalyzerFresh],
  );
  const aiSuggestionItems = useMemo(() => listAiSuggestions(plan), [plan]);
  const coverageSummaryText = buildCoverageSummary(plan);
  const slideInsightReasonMap = useMemo(() => slideInsightReasons(plan), [plan]);

  const handlePresetChange = (presetId: TemplatePreset['id']) => {
    setAnalyzeError(null);
    setExpandedChapterIndex(null);
    onChange(applyPreset(plan, presetId));
  };

  const addChapter = () => {
    onChange(appendChapter(plan));
    setExpandedChapterIndex(plan.chapters.length);
  };

  const removeChapter = (chapterIndex: number) => {
    if (plan.chapters.length <= 1) {
      setAnalyzeError('至少保留 1 个章节，不能继续删除。');
      return;
    }
    onChange(removeChapterFromPlan(plan, chapterIndex));

    setExpandedChapterIndex((prev) => {
      if (prev === null) {
        return null;
      }
      if (prev === chapterIndex) {
        return null;
      }
      return prev > chapterIndex ? prev - 1 : prev;
    });
  };

  const removeSubSlide = (chapterIndex: number, slideIndex: number) => {
    onChange(removeSubSlideFromPlan(plan, chapterIndex, slideIndex));
  };

  const runAiPlan = async () => {
    if (!parsedDocument) {
      setAnalyzeError('请先在 Step 1 上传并解析文档。');
      return;
    }

    setAnalyzeError(null);
    setIsAnalyzing(true);
    try {
      const aiPlan = await requestFrameworkPlan({
        presetId: plan.presetId,
        textContent: parsedDocument.textContent,
        chapters: plan.chapters.map((chapter) => ({
          chapterIndex: chapter.chapterIndex,
          chapterTitle: chapter.chapterTitle,
          slides: chapter.slides.map((slide) => ({
            subtitle: slide.subtitle,
            visualMode: slide.visualMode,
            contentHint: slide.contentHint,
          })),
        })),
      });
      onChange(mergeInsights(plan, aiPlan));
    } catch (error) {
      setAnalyzeError(mapPlanErrorToMessage(error));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAiSuggestClick = () => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    requestConfirm(
      'framework_ai_suggest',
      { chapterCount: plan.chapters.length },
      async () => {
        await runAiPlan();
      },
    );
  };

  const handleGenerateClick = () => {
    const validationError = validatePlanBeforeGenerate(plan);
    if (validationError) {
      setGenError(validationError);
      return;
    }
    requestConfirm(
      'framework_generate_content',
      { totalPages },
      async () => {
        await runGenerate();
      },
    );
  };

  return (
    <section className="panel">
      <article className="card">
        <header className="card-header planner-main-header">
          <span>演讲框架规划</span>
        </header>

        <div className="card-body planner-body">
          <div className="planner-toolbar">
            <div className="form-group">
              <label htmlFor="presetSelect">预设模板</label>
              <select
                id="presetSelect"
                value={plan.presetId}
                onChange={(event) => handlePresetChange(event.target.value as TemplatePreset['id'])}
                disabled={isAnalyzing}
              >
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="planner-inline-meta">
              <span>文档：{parsedDocument ? parsedDocument.filename : '未上传'}</span>
              <span>预计演示页数：{totalPages}（按当前框架）</span>
              <span>{coverageSummaryText}</span>
            </div>
          </div>

          <div className="ai-suggestion-box">
            <span className="ai-badge">AI 调整建议</span>
            {aiSuggestionItems.length === 0 ? (
              <p>点击 AI 建议调整，生成章节与子章节内容。</p>
            ) : (
              <ol className="ai-suggestion-list">
                {aiSuggestionItems.map((item) => (
                  <li key={`ai-suggestion-${item.chapterIndex}`}>
                    第{item.chapterIndex}章《{item.chapterTitle}》：{item.reason}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {hasStaleAnalyzerResult ? (
            <p className="message-warning">框架已改动，之前生成的内容已失效。请重新点击“开始生成内容”。</p>
          ) : null}

          {(isAnalyzing || isGenerating) ? (
            <p className="message-warning">AI 处理中，请勿刷新或关闭页面，避免任务中断。</p>
          ) : null}

          {analyzeError ? <p className="message-error">{analyzeError}</p> : null}

          <div className="fw-table-wrap">
            <table className="fw-table framework-main-table">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '40%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '38%' }} />
                <col style={{ width: '5%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="col-index">#</th>
                  <th>章节名称</th>
                  <th className="col-count">子章节数</th>
                  <th>内容</th>
                  <th className="col-action">×</th>
                </tr>
              </thead>
              <tbody>
                {plan.chapters.map((chapter, chapterIndex) => {
                  const coverageClass = chapter.coverageLevel ?? 'moderate';
                  const isExpanded = expandedChapterIndex === chapterIndex;

                  return (
                    <Fragment key={`chapter-${chapter.chapterIndex}`}>
                      <tr className={isExpanded ? 'selected' : ''}>
                        <td className="cell-index">{chapter.chapterIndex}</td>
                        <td className="cell-chapter">
                          <div className="chapter-title-row">
                            <button
                              type="button"
                              className={`chapter-drawer-toggle ${isExpanded ? 'expanded' : ''}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedChapterIndex((prev) => (prev === chapterIndex ? null : chapterIndex));
                              }}
                              aria-label={isExpanded ? '收起子章节' : '展开子章节'}
                            >
                              ▶
                            </button>
                            <input
                              type="text"
                              className="chapter-title-input"
                              value={chapter.chapterTitle}
                              title={chapter.chapterTitle}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => onChange(setChapterTitle(plan, chapterIndex, event.target.value))}
                              disabled={isAnalyzing}
                            />
                          </div>
                        </td>
                        <td className="cell-count">
                          <input
                            className="chapter-count-input"
                            type="number"
                            min={1}
                            value={chapter.slides.length}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const nextCount = Number(event.target.value);
                              onChange(
                                updateChapterSlides(plan, chapterIndex, (slides) =>
                                  resizeSlides(slides, Number.isFinite(nextCount) ? nextCount : slides.length),
                                ),
                              );
                            }}
                            disabled={isAnalyzing}
                          />
                        </td>
                        <td className="cell-insight chapter-content-cell">
                          <span className={`coverage-chip ${coverageClass}`}>
                            {chapter.coverageLevel ? COVERAGE_LABELS[chapter.coverageLevel] : '待分析'}
                          </span>
                          <span className="panel-hint">{chapter.aiReason?.trim() || '点击 AI 建议调整生成内容'}</span>
                        </td>
                        <td className="cell-action">
                          <button
                            type="button"
                            className="btn-del-icon"
                            onClick={(event) => {
                              event.stopPropagation();
                              requestConfirm(
                                'framework_delete_chapter',
                                {
                                  chapterTitle: chapter.chapterTitle,
                                },
                                () => removeChapter(chapterIndex),
                              );
                            }}
                            disabled={isAnalyzing || confirmBusy || plan.chapters.length <= 1}
                            title="删除章节"
                            aria-label={`删除第${chapter.chapterIndex}章`}
                          >
                            ×
                          </button>
                        </td>
                      </tr>

                      <tr className={`chapter-drawer-row ${isExpanded ? 'expanded' : ''}`} aria-hidden={!isExpanded}>
                        <td colSpan={5}>
                          <div className={`chapter-drawer ${isExpanded ? 'expanded' : ''}`}>
                            <div className="fw-table-wrap">
                              <table className="fw-table subslide-table">
                                <colgroup>
                                  <col style={{ width: '6%' }} />
                                  <col style={{ width: '38%' }} />
                                  <col style={{ width: '16%' }} />
                                  <col style={{ width: '34%' }} />
                                  <col style={{ width: '6%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th className="col-index">#</th>
                                    <th>子章节</th>
                                    <th className="col-layout">布局提示</th>
                                    <th>内容</th>
                                    <th className="col-action">×</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {chapter.slides.map((slide, slideIndex) => (
                                    <tr key={`slide-${chapter.chapterIndex}-${slideIndex}`}>
                                      <td className="cell-index">
                                        {chapter.chapterIndex}-{slideIndex + 1}
                                      </td>
                                      <td className="cell-subtitle">
                                        <input
                                          type="text"
                                          className="subslide-title-input"
                                          value={slide.subtitle}
                                          onChange={(event) =>
                                            onChange(setSubSlideTitle(plan, chapterIndex, slideIndex, event.target.value))
                                          }
                                          disabled={isAnalyzing}
                                        />
                                      </td>
                                      <td className="cell-layout">
                                        <span className={`visual-mode-chip ${slide.visualMode}`}>
                                          {getVisualModeLabel(slide.visualMode)}
                                        </span>
                                      </td>
                                      <td className="cell-insight subslide-content-cell">
                                        <span className="panel-hint">
                                          {slideInsightReasonMap.get(slideInsightKey(chapter.chapterIndex, slideIndex + 1)) ??
                                            '点击 AI 建议调整生成内容'}
                                        </span>
                                      </td>
                                      <td className="cell-action">
                                        <button
                                          type="button"
                                          className="btn-del-icon"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            requestConfirm(
                                              'framework_delete_subslide',
                                              {
                                                chapterTitle: chapter.chapterTitle,
                                                subtitle: slide.subtitle,
                                              },
                                              () => removeSubSlide(chapterIndex, slideIndex),
                                            );
                                          }}
                                          disabled={isAnalyzing || confirmBusy || chapter.slides.length <= 1}
                                          title="删除子章节"
                                          aria-label={`删除第${chapter.chapterIndex}-${slideIndex + 1}子章节`}
                                        >
                                          ×
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <button
                              type="button"
                              className="btn-add-row"
                              onClick={() => {
                                requestConfirm(
                                  'framework_add_subslide',
                                  {
                                    chapterTitle: chapter.chapterTitle,
                                    nextSubslideIndex: chapter.slides.length + 1,
                                  },
                                  () => onChange(appendSubSlide(plan, chapterIndex)),
                                );
                              }}
                              disabled={isAnalyzing || confirmBusy}
                            >
                              + 添加子章节
                            </button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="fw-total">
            <span>当前 {plan.chapters.length} 个章节，预计生成 {totalPages} 页（含封面/目录/结束页）</span>
            <span className="count">{totalPages}</span>
          </div>

          <div className="planner-table-actions">
            <button
              type="button"
              className="btn-add-row"
              onClick={() => {
                requestConfirm(
                  'framework_add_chapter',
                  { nextChapterIndex: plan.chapters.length + 1 },
                  () => addChapter(),
                );
              }}
              disabled={isAnalyzing || isGenerating || confirmBusy}
            >
              + 添加章节
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const presetName = presets.find((item) => item.id === plan.presetId)?.name ?? plan.presetId;
                requestConfirm(
                  'framework_reset_preset',
                  { presetName },
                  () => handlePresetChange(plan.presetId),
                );
              }}
              disabled={isAnalyzing || isGenerating || confirmBusy}
            >
              重置默认
            </button>
          </div>

          <article className="card content-generator-card">
            <header className="card-header">AI 内容生成</header>
            <div className="card-body">
              <p className="panel-hint">确认框架后，点击下方按钮生成正文、表格与图片。</p>
              <div className="planner-ai-actions">
                <button
                  type="button"
                  className="btn btn-ai"
                  onClick={handleGenerateClick}
                  disabled={
                    isGenerating ||
                    isAnalyzing ||
                    confirmBusy ||
                    !parsedDocument ||
                    !onGenerated ||
                    plan.chapters.length === 0
                  }
                >
                  {isGenerating ? '任务执行中...' : showRetryGenerate ? '重新生成内容' : '开始生成内容'}
                </button>
                {showRetryGenerate && !isGenerating ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleGenerateClick}
                    disabled={isAnalyzing || confirmBusy || !parsedDocument || !onGenerated || plan.chapters.length === 0}
                  >
                    重新生成
                  </button>
                ) : null}
                {isGenerating ? <span className="loading-note">任务已提交，正在后台生成，请稍候...</span> : null}
                {isGenerating && genJobId ? <span className="loading-note">任务 ID：{genJobId}</span> : null}
              </div>

              {isGenerating ? (
                <div className={`progress-board compact ${genPercent >= 100 ? 'is-complete' : ''}`}>
                  <header className="progress-header">
                    <div className="progress-title-group">
                      <strong>生成进度</strong>
                      <span className="progress-status-text">{progressStageText}</span>
                      <span className={`progress-status-dots ${genPercent >= 100 ? 'is-finished' : ''}`} aria-hidden="true">
                        <span>.</span>
                        <span>.</span>
                        <span>.</span>
                      </span>
                    </div>
                    <span>{genPercent}%</span>
                  </header>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${genPercent}%` }} />
                  </div>
                </div>
              ) : null}

              {genError ? <p className="message-error">{genError}</p> : null}
              {generationWarningMessage ? <p className="message-warning">{generationWarningMessage}</p> : null}

              {analyzerResult ? (
                <div className="planner-meta" style={{ marginTop: 10 }}>
                  <p>
                    <strong>已生成页数：</strong>
                    {analyzerResult.slidePlan.length}
                  </p>
                  <p>
                    <strong>原文覆盖率：</strong>
                    {analyzerResult.auditSummary.exactSourcePercent}%
                  </p>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      </article>
      <button
        type="button"
        className="btn btn-ai planner-float-ai-btn"
        onClick={handleAiSuggestClick}
        disabled={isAnalyzing || confirmBusy || !parsedDocument}
      >
        {isAnalyzing ? 'AI 分析中...' : 'AI 建议调整'}
      </button>
    </section>
  );
}


