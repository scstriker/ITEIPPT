import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createFrameworkPlanFromPreset, getTemplatePresets, reindexChapters } from '../config/templatePresets';
import type { ParsedDocument } from '../services/documentParser';
import { mapPlanErrorToMessage, requestFrameworkPlan } from '../services/frameworkPlanApi';
import {
  ContentApiError,
  mapGenerateContentError,
  requestCreateGenerateContentJob,
  requestGenerateContentJobResult,
  requestGenerateContentJobStatus,
} from '../services/contentGeneratorApi';
import type { AnalyzerResult } from '@contracts/analyzer';
import type { ChapterPlan, CoverageLevel, FrameworkPlan, SubSlidePlan, TemplatePreset } from '@contracts/framework';
import type { VisualMode } from '@contracts/template';
import type { ConfirmRequest } from '../confirm/confirmActions';

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

const VISUAL_MODE_LABELS: Record<VisualMode, string> = {
  none: '文字',
  table: '文字 + 表格',
  images: '文字 + 图片',
};

const COVERAGE_LABELS: Record<CoverageLevel, string> = {
  sufficient: '高覆盖',
  moderate: '中覆盖',
  sparse: '低覆盖',
};

function updateChapterSlides(
  plan: FrameworkPlan,
  chapterIndex: number,
  updater: (slides: SubSlidePlan[]) => SubSlidePlan[],
): FrameworkPlan {
  const chapters = [...plan.chapters];
  const target = chapters[chapterIndex];
  if (!target) {
    return plan;
  }

  chapters[chapterIndex] = {
    ...target,
    slides: updater(target.slides),
  };

  return {
    ...plan,
    chapters: reindexChapters(chapters),
  };
}

function resizeSlides(slides: SubSlidePlan[], nextCountInput: number): SubSlidePlan[] {
  const nextCount = Math.max(1, Math.min(20, Number.isFinite(nextCountInput) ? nextCountInput : 1));
  if (nextCount === slides.length) {
    return slides;
  }

  if (nextCount < slides.length) {
    return slides.slice(0, nextCount);
  }

  const seed = slides.at(-1) ?? {
    subtitle: '子章节',
    visualMode: 'none' as VisualMode,
    contentHint: '待补充',
  };

  const next = [...slides];
  for (let index = slides.length; index < nextCount; index += 1) {
    next.push({
      subtitle: `子章节 ${index + 1}`,
      visualMode: seed.visualMode,
      contentHint: seed.contentHint ?? '待补充',
    });
  }
  return next;
}

function mergeInsights(currentPlan: FrameworkPlan, aiPlan: FrameworkPlan): FrameworkPlan {
  if (currentPlan.chapters.length === 0 && aiPlan.chapters.length > 0) {
    return {
      ...currentPlan,
      chapters: aiPlan.chapters,
      apiPlanMeta: aiPlan.apiPlanMeta,
    };
  }

  const byIndex = new Map<number, ChapterPlan>();
  for (const chapter of aiPlan.chapters) {
    byIndex.set(chapter.chapterIndex, chapter);
  }

  const slideModeByKey = new Map<string, VisualMode>();
  for (const insight of aiPlan.apiPlanMeta?.slideInsights ?? []) {
    slideModeByKey.set(`${insight.chapterIndex}:${insight.slideIndex}`, insight.visualMode);
  }

  const chapters = currentPlan.chapters.map((chapter) => {
    const aiChapter = byIndex.get(chapter.chapterIndex);
    return {
      ...chapter,
      aiReason: aiChapter?.aiReason ?? chapter.aiReason,
      coverageLevel: aiChapter?.coverageLevel ?? chapter.coverageLevel,
      sourceHint: aiChapter?.sourceHint ?? chapter.sourceHint,
      slides: chapter.slides.map((slide, slideIndex) => {
        const key = `${chapter.chapterIndex}:${slideIndex + 1}`;
        const nextMode = slideModeByKey.get(key) ?? aiChapter?.slides?.[slideIndex]?.visualMode;
        if (!nextMode) {
          return slide;
        }
        return {
          ...slide,
          visualMode: nextMode,
        };
      }),
    };
  });

  return {
    ...currentPlan,
    chapters,
    apiPlanMeta: aiPlan.apiPlanMeta,
  };
}

function getVisualModeLabel(mode: VisualMode): string {
  return VISUAL_MODE_LABELS[mode] ?? '文字';
}

function getProgressStageText(percent: number): string {
  if (percent >= 100) {
    return '已完成，结果已就绪';
  }
  if (percent <= 15) {
    return '正在建立章节语义索引';
  }
  if (percent <= 35) {
    return '正在提炼子章节内容';
  }
  if (percent <= 60) {
    return '正在匹配布局提示';
  }
  if (percent <= 85) {
    return '正在生成逐页内容草稿';
  }
  return '正在校验一致性与完整性';
}

function estimateTotalPages(plan: FrameworkPlan): number {
  return 2 + plan.chapters.length + plan.chapters.reduce((sum, chapter) => sum + chapter.slides.length, 0);
}

function slideInsightKey(chapterIndex: number, slideIndex: number): string {
  return `${chapterIndex}:${slideIndex}`;
}

const ACTIVE_GENERATION_JOB_KEY = 'itei_step2_active_generation_job';
const GENERATION_JOB_POLL_INTERVAL_MS = 2000;
const GENERATION_JOB_POLL_TIMEOUT_MS = 20 * 60 * 1000;

interface StoredGenerationJobState {
  jobId: string;
  planDigest: string;
  savedAt: string;
}

function buildPlanDigest(plan: FrameworkPlan): string {
  return JSON.stringify({
    presetId: plan.presetId,
    chapters: plan.chapters.map((chapter) => ({
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle.trim(),
      slides: chapter.slides.map((slide) => ({
        subtitle: slide.subtitle.trim(),
        visualMode: slide.visualMode,
        contentHint: (slide.contentHint ?? '').trim(),
      })),
    })),
  });
}

function readStoredGenerationJob(): StoredGenerationJobState | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.sessionStorage.getItem(ACTIVE_GENERATION_JOB_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGenerationJobState>;
    if (typeof parsed.jobId !== 'string' || !parsed.jobId.trim()) {
      return null;
    }
    if (typeof parsed.planDigest !== 'string' || !parsed.planDigest.trim()) {
      return null;
    }
    return {
      jobId: parsed.jobId.trim(),
      planDigest: parsed.planDigest,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeStoredGenerationJob(job: StoredGenerationJobState): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(ACTIVE_GENERATION_JOB_KEY, JSON.stringify(job));
}

function clearStoredGenerationJob(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(ACTIVE_GENERATION_JOB_KEY);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function validatePlanBeforeGenerate(plan: FrameworkPlan): string | null {
  if (plan.chapters.length === 0) {
    return '请至少保留 1 个章节。';
  }

  for (const chapter of plan.chapters) {
    if (!chapter.chapterTitle.trim()) {
      return `第 ${chapter.chapterIndex} 章标题不能为空。`;
    }
    if (chapter.slides.length === 0) {
      return `第 ${chapter.chapterIndex} 章至少需要 1 个子章节。`;
    }
    for (let slideIndex = 0; slideIndex < chapter.slides.length; slideIndex += 1) {
      if (!chapter.slides[slideIndex].subtitle.trim()) {
        return `第 ${chapter.chapterIndex}-${slideIndex + 1} 子章节标题不能为空。`;
      }
    }
  }

  return null;
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

  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genPercent, setGenPercent] = useState(0);
  const [genServerStage, setGenServerStage] = useState<string | null>(null);
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const [showRetryGenerate, setShowRetryGenerate] = useState(false);

  const resumeCheckedRef = useRef(false);
  const unmountedRef = useRef(false);
  const planDigest = useMemo(() => buildPlanDigest(plan), [plan]);

  const hasStaleAnalyzerResult = Boolean(analyzerResult) && !isAnalyzerFresh;

  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    [],
  );

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
  const generationWarningMessage = useMemo(() => {
    if (!analyzerResult || !isAnalyzerFresh) {
      return null;
    }
    if (analyzerResult.generationMeta?.mode !== 'degraded') {
      return null;
    }
    const reason = analyzerResult.generationMeta.reason?.trim();
    if (!reason) {
      return '已降级生成，可继续编辑。';
    }
    const reasons = reason
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean);
    const technicalReasonPrefixes = ['batch_generation_failed', 'soft_deadline_reached', 'request_level_fallback'];
    const technicalReasons = reasons.filter((item) =>
      technicalReasonPrefixes.some((prefix) => item === prefix || item.startsWith(`${prefix}:`)),
    );
    if (technicalReasons.length === 0) {
      return null;
    }
    return `已降级生成，可继续编辑（原因：${technicalReasons.join(';')}）。`;
  }, [analyzerResult, isAnalyzerFresh]);

  const aiSuggestionItems = useMemo(() => {
    return plan.chapters
      .filter((chapter) => chapter.aiReason?.trim())
      .map((chapter) => ({
        chapterIndex: chapter.chapterIndex,
        chapterTitle: chapter.chapterTitle,
        reason: chapter.aiReason?.trim() ?? '',
      }));
  }, [plan.chapters]);

  const coverageCounts = plan.chapters.reduce<Record<CoverageLevel, number>>(
    (acc, chapter) => {
      if (chapter.coverageLevel) {
        acc[chapter.coverageLevel] += 1;
      }
      return acc;
    },
    { sufficient: 0, moderate: 0, sparse: 0 },
  );

  const totalCoverageCount = coverageCounts.sufficient + coverageCounts.moderate + coverageCounts.sparse;
  const coverageSummaryText =
    totalCoverageCount > 0
      ? `章节覆盖评估：高覆盖 ${coverageCounts.sufficient} / 中覆盖 ${coverageCounts.moderate} / 低覆盖 ${coverageCounts.sparse}`
      : '章节覆盖评估：待 AI 建议调整后生成';

  const slideInsightReasonMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const insight of plan.apiPlanMeta?.slideInsights ?? []) {
      if (!insight.reason) {
        continue;
      }
      map.set(slideInsightKey(insight.chapterIndex, insight.slideIndex), insight.reason);
    }
    return map;
  }, [plan.apiPlanMeta?.slideInsights]);

  const handlePresetChange = (presetId: TemplatePreset['id']) => {
    setAnalyzeError(null);
    setExpandedChapterIndex(null);
    const presetPlan = createFrameworkPlanFromPreset(presetId);
    onChange({
      ...presetPlan,
      coverInfo: {
        ...presetPlan.coverInfo,
        ...plan.coverInfo,
      },
      endingInfo: {
        ...presetPlan.endingInfo,
        ...plan.endingInfo,
      },
    });
  };

  const addChapter = () => {
    const nextIndex = plan.chapters.length + 1;
    onChange({
      ...plan,
      chapters: reindexChapters([
        ...plan.chapters,
        {
          chapterIndex: nextIndex,
          chapterTitle: `第${nextIndex}章`,
          slides: [{ subtitle: '新子章节', visualMode: 'none', contentHint: '待补充' }],
        },
      ]),
    });
    setExpandedChapterIndex(plan.chapters.length);
  };

  const removeChapter = (chapterIndex: number) => {
    if (plan.chapters.length <= 1) {
      setAnalyzeError('至少保留 1 个章节，不能继续删除。');
      return;
    }
    const next = plan.chapters.filter((_, index) => index !== chapterIndex);
    onChange({
      ...plan,
      chapters: reindexChapters(next),
    });

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
    onChange(
      updateChapterSlides(plan, chapterIndex, (slides) => slides.filter((_, index) => index !== slideIndex)),
    );
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

  const pollGenerationJob = async (jobId: string): Promise<void> => {
    const startedAt = Date.now();

    while (true) {
      const status = await requestGenerateContentJobStatus(jobId);
      if (unmountedRef.current) {
        return;
      }

      setGenJobId(status.jobId);
      setGenServerStage(status.progress.stage || '正在处理任务');
      const progressPercent = Math.max(1, Math.min(99, Math.round(status.progress.percent)));
      setGenPercent(progressPercent);

      if (status.status === 'succeeded') {
        const result = await requestGenerateContentJobResult(jobId);
        if (unmountedRef.current) {
          return;
        }
        setGenPercent(100);
        setGenServerStage('已完成，结果已就绪');
        setGenJobId(null);
        clearStoredGenerationJob();
        onGenerated?.(result);
        return;
      }

      if (status.status === 'failed') {
        clearStoredGenerationJob();
        const details = status.error?.details?.trim();
        const message = status.error?.message?.trim() || '任务执行失败，请点击“重新生成”。';
        throw new ContentApiError(409, status.error?.code ?? 'generation_job_failed', message, details);
      }

      if (Date.now() - startedAt > GENERATION_JOB_POLL_TIMEOUT_MS) {
        clearStoredGenerationJob();
        throw new ContentApiError(408, 'generation_job_timeout', '异步任务等待超时，请点击“重新生成”。');
      }

      await sleep(GENERATION_JOB_POLL_INTERVAL_MS);
    }
  };

  useEffect(() => {
    if (resumeCheckedRef.current) {
      return;
    }
    resumeCheckedRef.current = true;

    if (!parsedDocument || !onGenerated) {
      return;
    }

    const storedJob = readStoredGenerationJob();
    if (!storedJob) {
      return;
    }

    if (storedJob.planDigest !== planDigest) {
      clearStoredGenerationJob();
      return;
    }

    setIsGenerating(true);
    setShowRetryGenerate(false);
    setGenError(null);
    setGenPercent(2);
    setGenServerStage('正在恢复任务状态');
    setGenJobId(storedJob.jobId);

    void (async () => {
      try {
        await pollGenerationJob(storedJob.jobId);
      } catch (error) {
        if (!unmountedRef.current) {
          setGenError(mapGenerateContentError(error));
          setShowRetryGenerate(true);
          setGenPercent(0);
          setGenServerStage(null);
        }
      } finally {
        if (!unmountedRef.current) {
          setIsGenerating(false);
        }
      }
    })();
  }, [onGenerated, parsedDocument, planDigest]);

  const runGenerate = async () => {
    if (!parsedDocument) {
      setGenError('请先在 Step 1 上传并解析文档。');
      return;
    }
    if (!onGenerated) {
      setGenError('当前页面未接入内容生成回调。');
      return;
    }
    const validationError = validatePlanBeforeGenerate(plan);
    if (validationError) {
      setGenError(validationError);
      return;
    }

    setGenError(null);
    setShowRetryGenerate(false);
    setGenPercent(2);
    setGenServerStage('正在创建任务');
    setIsGenerating(true);

    try {
      const created = await requestCreateGenerateContentJob({
        frameworkPlan: plan,
        textContent: parsedDocument.textContent,
        sourceFilename: parsedDocument.filename,
      });

      setGenJobId(created.jobId);
      writeStoredGenerationJob({
        jobId: created.jobId,
        planDigest,
        savedAt: new Date().toISOString(),
      });

      await pollGenerationJob(created.jobId);
    } catch (error) {
      setGenError(mapGenerateContentError(error));
      setShowRetryGenerate(true);
      setGenPercent(0);
      setGenServerStage(null);
    } finally {
      if (!unmountedRef.current) {
        setIsGenerating(false);
      }
    }
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
                              onChange={(event) => {
                                const chapters = [...plan.chapters];
                                chapters[chapterIndex] = {
                                  ...chapter,
                                  chapterTitle: event.target.value,
                                };
                                onChange({
                                  ...plan,
                                  chapters: reindexChapters(chapters),
                                });
                              }}
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
                                          onChange={(event) => {
                                            onChange(
                                              updateChapterSlides(plan, chapterIndex, (slides) =>
                                                slides.map((item, index) =>
                                                  index === slideIndex ? { ...item, subtitle: event.target.value } : item,
                                                ),
                                              ),
                                            );
                                          }}
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
                                  () =>
                                    onChange(
                                      updateChapterSlides(plan, chapterIndex, (slides) => [
                                        ...slides,
                                        {
                                          subtitle: `子章节 ${slides.length + 1}`,
                                          visualMode: 'none',
                                          contentHint: '待补充',
                                        },
                                      ]),
                                    ),
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


