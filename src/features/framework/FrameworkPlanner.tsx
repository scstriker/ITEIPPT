import { Fragment, useEffect, useMemo, useState } from 'react';
import { IconChevronRight, IconSparkles, IconX } from '@tabler/icons-react';
import { Card, Field, Notice } from '@/components/itei/Blocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { AnalyzerResult } from '@contracts/analyzer';
import type { CoverageLevel, FrameworkPlan, TemplatePreset } from '@contracts/framework';
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
import { useContentGeneration } from './useContentGeneration';

const COVERAGE_TONE: Record<CoverageLevel, 'success' | 'warning' | 'danger'> = {
  sufficient: 'success',
  moderate: 'warning',
  sparse: 'danger',
};

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
    showRetryGenerate,
    runGenerate,
  } = useContentGeneration({ parsedDocument, plan, onGenerated });

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
    <>
      <Card title="演讲框架规划" bodyClassName="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-6">
          <Field label="预设模板" htmlFor="presetSelect">
            <NativeSelect
              id="presetSelect"
              className="w-48"
              value={plan.presetId}
              onChange={(event) => handlePresetChange(event.target.value as TemplatePreset['id'])}
              disabled={isAnalyzing}
            >
              {presets.map((preset) => (
                <NativeSelectOption key={preset.id} value={preset.id}>
                  {preset.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <div className="flex flex-col gap-1 text-[13px] leading-5 text-ink-muted">
            <span>文档：{parsedDocument ? parsedDocument.filename : '未上传'}</span>
            <span>预计演示页数：{totalPages}（按当前框架）</span>
            <span>{coverageSummaryText}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 border border-border bg-surface-sunken p-3">
          <Badge variant="info">AI 调整建议</Badge>
          {aiSuggestionItems.length === 0 ? (
            <p className="text-[13px] leading-5 text-ink-muted">点击 AI 建议调整，生成章节与子章节内容。</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-5 text-ink">
              {aiSuggestionItems.map((item) => (
                <li key={`ai-suggestion-${item.chapterIndex}`}>
                  第{item.chapterIndex}章《{item.chapterTitle}》：{item.reason}
                </li>
              ))}
            </ol>
          )}
        </div>

        {hasStaleAnalyzerResult ? (
          <Notice tone="warning">框架已改动，之前生成的内容已失效。请重新点击“开始生成内容”。</Notice>
        ) : null}

        {isAnalyzing || isGenerating ? <Notice tone="warning">AI 处理中，请勿刷新或关闭页面，避免任务中断。</Notice> : null}

        {analyzeError ? <Notice tone="error">{analyzeError}</Notice> : null}

        <Table className="table-fixed">
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '40%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '36%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>章节名称</TableHead>
              <TableHead>子章节数</TableHead>
              <TableHead>内容</TableHead>
              <TableHead>
                <span className="sr-only">删除</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.chapters.map((chapter, chapterIndex) => {
              const isExpanded = expandedChapterIndex === chapterIndex;

              return (
                <Fragment key={`chapter-${chapter.chapterIndex}`}>
                  <TableRow data-state={isExpanded ? 'selected' : undefined} className="even:bg-surface-sunken">
                    <TableCell className="font-semibold text-brand-navy tabular-nums">{chapter.chapterIndex}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-brand-navy"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedChapterIndex((prev) => (prev === chapterIndex ? null : chapterIndex));
                          }}
                          aria-label={isExpanded ? '收起子章节' : '展开子章节'}
                          aria-expanded={isExpanded}
                        >
                          <IconChevronRight
                            aria-hidden="true"
                            className={cn('transition-transform duration-150 ease-out', isExpanded && 'rotate-90')}
                            stroke={2}
                          />
                        </Button>
                        <Input
                          type="text"
                          value={chapter.chapterTitle}
                          title={chapter.chapterTitle}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onChange(setChapterTitle(plan, chapterIndex, event.target.value))}
                          disabled={isAnalyzing}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        className="w-20 tabular-nums"
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
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={chapter.coverageLevel ? COVERAGE_TONE[chapter.coverageLevel] : 'neutral'}>
                          {chapter.coverageLevel ? COVERAGE_LABELS[chapter.coverageLevel] : '待分析'}
                        </Badge>
                        <span className="text-[13px] leading-5 text-ink-muted">
                          {chapter.aiReason?.trim() || '点击 AI 建议调整生成内容'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-ink-muted hover:text-brand-red"
                        onClick={(event) => {
                          event.stopPropagation();
                          requestConfirm('framework_delete_chapter', { chapterTitle: chapter.chapterTitle }, () =>
                            removeChapter(chapterIndex),
                          );
                        }}
                        disabled={isAnalyzing || confirmBusy || plan.chapters.length <= 1}
                        title="删除章节"
                        aria-label={`删除第${chapter.chapterIndex}章`}
                      >
                        <IconX aria-hidden="true" stroke={2} />
                      </Button>
                    </TableCell>
                  </TableRow>

                  {isExpanded ? (
                    <TableRow className="bg-surface">
                      <TableCell colSpan={5} className="p-0">
                        <div className="flex flex-col gap-3 border-l-4 border-brand-sky bg-surface px-6 py-4">
                          <Table className="table-fixed">
                            <colgroup>
                              <col style={{ width: '8%' }} />
                              <col style={{ width: '38%' }} />
                              <col style={{ width: '16%' }} />
                              <col style={{ width: '32%' }} />
                              <col style={{ width: '6%' }} />
                            </colgroup>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>子章节</TableHead>
                                <TableHead>布局提示</TableHead>
                                <TableHead>内容</TableHead>
                                <TableHead>
                                  <span className="sr-only">删除</span>
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {chapter.slides.map((slide, slideIndex) => (
                                <TableRow key={`slide-${chapter.chapterIndex}-${slideIndex}`} className="even:bg-surface-sunken">
                                  <TableCell className="text-brand-navy tabular-nums">
                                    {chapter.chapterIndex}-{slideIndex + 1}
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      type="text"
                                      value={slide.subtitle}
                                      onChange={(event) =>
                                        onChange(setSubSlideTitle(plan, chapterIndex, slideIndex, event.target.value))
                                      }
                                      disabled={isAnalyzing}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={slide.visualMode === 'none' ? 'neutral' : 'info'}>
                                      {getVisualModeLabel(slide.visualMode)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-[13px] leading-5 text-ink-muted">
                                    {slideInsightReasonMap.get(slideInsightKey(chapter.chapterIndex, slideIndex + 1)) ??
                                      '点击 AI 建议调整生成内容'}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-ink-muted hover:text-brand-red"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        requestConfirm(
                                          'framework_delete_subslide',
                                          { chapterTitle: chapter.chapterTitle, subtitle: slide.subtitle },
                                          () => removeSubSlide(chapterIndex, slideIndex),
                                        );
                                      }}
                                      disabled={isAnalyzing || confirmBusy || chapter.slides.length <= 1}
                                      title="删除子章节"
                                      aria-label={`删除第${chapter.chapterIndex}-${slideIndex + 1}子章节`}
                                    >
                                      <IconX aria-hidden="true" stroke={2} />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="self-start"
                            onClick={() => {
                              requestConfirm(
                                'framework_add_subslide',
                                { chapterTitle: chapter.chapterTitle, nextSubslideIndex: chapter.slides.length + 1 },
                                () => onChange(appendSubSlide(plan, chapterIndex)),
                              );
                            }}
                            disabled={isAnalyzing || confirmBusy}
                          >
                            + 添加子章节
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border border-border bg-surface-sunken px-4 py-3">
          <span className="text-[13px] leading-5 text-ink">
            当前 {plan.chapters.length} 个章节，预计生成 {totalPages} 页（含封面/目录/结束页）
          </span>
          <span className="text-[28px] leading-8 font-bold text-brand-navy tabular-nums">{totalPages}</span>
        </div>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              requestConfirm('framework_add_chapter', { nextChapterIndex: plan.chapters.length + 1 }, () => addChapter());
            }}
            disabled={isAnalyzing || isGenerating || confirmBusy}
          >
            + 添加章节
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const presetName = presets.find((item) => item.id === plan.presetId)?.name ?? plan.presetId;
              requestConfirm('framework_reset_preset', { presetName }, () => handlePresetChange(plan.presetId));
            }}
            disabled={isAnalyzing || isGenerating || confirmBusy}
          >
            重置默认
          </Button>
        </div>
      </Card>

      <Card title="AI 内容生成" bodyClassName="flex flex-col gap-4">
        <p className="text-[13px] leading-5 text-ink-muted">确认框架后，点击下方按钮生成正文、表格与图片。</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleGenerateClick}
            disabled={isGenerating || isAnalyzing || confirmBusy || !parsedDocument || !onGenerated || plan.chapters.length === 0}
          >
            <IconSparkles aria-hidden="true" stroke={2} />
            {isGenerating ? '任务执行中...' : showRetryGenerate ? '重新生成内容' : '开始生成内容'}
          </Button>
          {showRetryGenerate && !isGenerating ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerateClick}
              disabled={isAnalyzing || confirmBusy || !parsedDocument || !onGenerated || plan.chapters.length === 0}
            >
              重新生成
            </Button>
          ) : null}
          {isGenerating ? <span className="text-[13px] leading-5 text-ink-muted">正在逐批生成内容，请稍候...</span> : null}
        </div>

        {isGenerating ? (
          <div className="flex flex-col gap-2 border border-border bg-surface-sunken p-3">
            <div className="flex items-center justify-between text-[13px] leading-5">
              <div className="flex items-center gap-2">
                <strong className="text-brand-navy">生成进度</strong>
                <span className="text-ink">{progressStageText}</span>
              </div>
              <span className="font-semibold text-brand-navy tabular-nums">{genPercent}%</span>
            </div>
            <Progress value={genPercent} aria-label="生成进度" />
          </div>
        ) : null}

        {genError ? <Notice tone="error">{genError}</Notice> : null}
        {generationWarningMessage ? <Notice tone="warning">{generationWarningMessage}</Notice> : null}

        {analyzerResult ? (
          <div className="flex gap-8 text-[13px] leading-5 text-ink">
            <p>
              <strong className="text-brand-navy">已生成页数：</strong>
              {analyzerResult.slidePlan.length}
            </p>
            <p>
              <strong className="text-brand-navy">原文覆盖率：</strong>
              {analyzerResult.auditSummary.exactSourcePercent}%
            </p>
          </div>
        ) : null}
      </Card>

      <Button
        type="button"
        className="fixed top-[calc(50%-20px)] right-6 z-40 shadow-raised"
        onClick={handleAiSuggestClick}
        disabled={isAnalyzing || confirmBusy || !parsedDocument}
      >
        <IconSparkles aria-hidden="true" stroke={2} />
        {isAnalyzing ? 'AI 分析中...' : 'AI 建议调整'}
      </Button>
    </>
  );
}
