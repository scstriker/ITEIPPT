import { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconChevronRight } from '@tabler/icons-react';
import type { AnalyzerResult, SlideContent } from '@contracts/analyzer';
import { Card, KpiTile, SubTitle } from '@/components/itei/Blocks';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { getImageSlotKey } from '../images/imageSlots';
import {
  FILTER_LABELS,
  SLIDE_TYPE_LABEL,
  SUPPLEMENT_LABEL,
  TAB_LABELS,
  VISUAL_MODE_LABEL,
  buildAuditMetrics,
  countIssuesByPage,
  filterSlides,
  getAuditCoverageLabel,
  getConfidenceMeta,
  getGroupMeta,
  getSlideMainTitle,
  groupSlides,
  toAuditCoverage,
  withTableCell,
  withTableHeader,
  type AuditCoverage,
  type AuditFilter,
  type AuditViewSection,
} from './auditModel';

interface ContentAuditorProps {
  analyzerResult: AnalyzerResult | null;
  importedImages: Map<string, File>;
  onUpdateSlide: (page: number, updater: (slide: SlideContent) => SlideContent) => void;
}

const BODY_SOFT_LIMIT = 150;

const COVERAGE_TONE: Record<AuditCoverage, 'success' | 'warning' | 'danger'> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
};

const CONFIDENCE_TONE = { sufficient: 'success', moderate: 'warning', sparse: 'danger' } as const;

const COVERAGE_DOT: Record<AuditCoverage, string> = {
  high: 'bg-success',
  medium: 'bg-warning',
  low: 'bg-brand-red',
};

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  return url;
}

function ImportedImagePreview({ file, alt }: { file: File | null; alt: string }) {
  const previewUrl = useObjectUrl(file);

  if (!file || !previewUrl) {
    return <span className="text-xs leading-4 text-ink-muted">未导入图片</span>;
  }

  return <img src={previewUrl} alt={alt} className="h-full w-full object-contain" />;
}

function AuditSlideCanvas({
  slide,
  importedImages,
  issueCount,
}: {
  slide: SlideContent;
  importedImages: Map<string, File>;
  issueCount: number;
}) {
  const confidence = getConfidenceMeta(slide.sourceConfidence);
  const coverage = toAuditCoverage(slide.sourceConfidence);
  const visualMode = slide.visualMode ?? 'none';
  const summaryText = (slide.bodyText ?? '').trim();

  return (
    <article className="flex flex-col gap-3 border border-border bg-surface-raised p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="text-base leading-6 font-bold text-brand-navy">
            第 {slide.page} 页 · {SLIDE_TYPE_LABEL[slide.type]}
          </h4>
          <p className="text-[13px] leading-5 text-ink-muted">{getSlideMainTitle(slide)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={COVERAGE_TONE[coverage]}>{getAuditCoverageLabel(coverage)}</Badge>
          <Badge variant={CONFIDENCE_TONE[confidence.chip]}>{confidence.label}</Badge>
          <Badge variant={issueCount ? 'warning' : 'neutral'}>问题 {issueCount}</Badge>
        </div>
      </header>

      <div className="relative aspect-video w-full overflow-hidden border border-border bg-surface">
        <div className="h-3 bg-itei-header" />
        <div className="flex h-[calc(100%-12px)] flex-col gap-2 p-4 text-[13px] leading-5 text-ink">
          {slide.type === 'cover' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <h5 className="text-lg leading-[26px] font-bold text-brand-navy">{slide.reportTitle ?? '封面标题'}</h5>
              <p>{slide.standardName ?? '标准名称'}</p>
              <p className="text-ink-muted">{slide.date ?? '日期信息'}</p>
            </div>
          ) : null}

          {slide.type === 'toc_section' ? (
            <div className="flex flex-col gap-2">
              <h5 className="text-center text-lg leading-[26px] font-bold text-brand-navy">{slide.pageTitle ?? '目录内容'}</h5>
              <ul className="mx-auto flex w-full max-w-sm flex-col gap-1.5">
                {(slide.sectionItems ?? []).slice(0, 6).map((item, index) => (
                  <li
                    key={`${slide.page}-toc-${index}`}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1',
                      index + 1 === slide.highlightChapter ? 'bg-brand-red text-on-brand' : 'bg-brand-navy text-on-brand',
                    )}
                  >
                    <span className="font-bold tabular-nums">{item.number ?? String(index + 1).padStart(2, '0')}</span>
                    <span>{item.title ?? '章节标题'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {slide.type === 'ending' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <h5 className="text-lg leading-[26px] font-bold text-brand-navy">{slide.thanks ?? '感谢聆听'}</h5>
              <p>{slide.organization ?? '组织名称'}</p>
              <p className="text-ink-muted">{slide.contactInfo?.join(' · ') || '联系方式待补充'}</p>
            </div>
          ) : null}

          {slide.type === 'content' ? (
            <>
              <div className="clip-slash w-fit bg-brand-navy py-1 pr-8 pl-3 font-bold text-on-brand">
                {slide.subtitle ?? '子章节标题'}
              </div>
              <div className="line-clamp-4">{summaryText || '该页正文待完善。'}</div>

              {visualMode === 'table' ? (
                <table className="w-full text-xs leading-4">
                  <thead className="bg-surface-sunken text-brand-navy">
                    <tr>
                      {(slide.tableData?.headers?.length ? slide.tableData.headers : ['列1', '列2', '列3']).map((header, idx) => (
                        <th key={`${slide.page}-th-${idx}`} className="border-b-2 border-brand-sky px-2 py-1 text-left font-bold">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(slide.tableData?.rows?.length ? slide.tableData.rows : [['数据', '数据', '数据'], ['数据', '数据', '数据']])
                      .slice(0, 3)
                      .map((row, rowIdx) => (
                        <tr key={`${slide.page}-tr-${rowIdx}`} className="border-b border-border">
                          {row.map((cell, cellIdx) => (
                            <td key={`${slide.page}-td-${rowIdx}-${cellIdx}`} className="px-2 py-1">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : null}

              {visualMode === 'images' ? (
                <div className="grid flex-1 grid-cols-2 gap-2">
                  {(slide.imagePrompts?.length ? slide.imagePrompts : [{ description: '图片 1', iteiDrawPrompt: '' }]).map(
                    (prompt, index) => {
                      const file = importedImages.get(getImageSlotKey(slide.page, index)) ?? null;
                      return (
                        <div key={`${slide.page}-img-${index}`} className="flex min-h-0 flex-col gap-1">
                          <div className="flex min-h-16 flex-1 items-center justify-center border border-border bg-surface-sunken">
                            <ImportedImagePreview file={file} alt={`第${slide.page}页图片${index + 1}`} />
                          </div>
                          <span className="truncate text-xs leading-4 text-ink-muted">
                            图片 {index + 1} · {prompt.description || '暂无描述'}
                          </span>
                        </div>
                      );
                    },
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ContentAuditor({ analyzerResult, importedImages, onUpdateSlide }: ContentAuditorProps) {
  if (!analyzerResult) {
    return (
      <Card title="审计预览">
        <p className="text-[13px] leading-5 text-ink-muted">请先在规划框架中生成内容，再进入审计预览。</p>
      </Card>
    );
  }
  return <AuditWorkbench analyzerResult={analyzerResult} importedImages={importedImages} onUpdateSlide={onUpdateSlide} />;
}

function AuditWorkbench({
  analyzerResult,
  importedImages,
  onUpdateSlide,
}: ContentAuditorProps & { analyzerResult: AnalyzerResult }) {
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [filter, setFilter] = useState<AuditFilter>('content');
  const [activeTab, setActiveTab] = useState<AuditViewSection>('source');
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const cardRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  const pageIssueCount = useMemo(() => countIssuesByPage(analyzerResult), [analyzerResult]);
  const visibleSlides = useMemo(
    () => filterSlides(analyzerResult.slidePlan, filter, pageIssueCount),
    [analyzerResult.slidePlan, filter, pageIssueCount],
  );

  useEffect(() => {
    if (!visibleSlides.length) {
      setSelectedPage(null);
      return;
    }
    if (selectedPage === null || !visibleSlides.some((slide) => slide.page === selectedPage)) {
      setSelectedPage(visibleSlides[0].page);
    }
  }, [selectedPage, visibleSlides]);

  const selectedSlide = useMemo(() => {
    if (!visibleSlides.length) {
      return null;
    }
    if (selectedPage === null) {
      return visibleSlides[0];
    }
    return visibleSlides.find((slide) => slide.page === selectedPage) ?? visibleSlides[0];
  }, [selectedPage, visibleSlides]);

  const slideGroups = useMemo(() => groupSlides(visibleSlides), [visibleSlides]);

  useEffect(() => {
    if (!slideGroups.length) {
      setExpandedGroupKey(null);
      return;
    }
    const selectedGroupKey = selectedSlide ? getGroupMeta(selectedSlide).key : slideGroups[0].key;
    setExpandedGroupKey((prev) => {
      if (!prev || !slideGroups.some((group) => group.key === prev)) {
        return selectedGroupKey;
      }
      return prev;
    });
  }, [selectedSlide, slideGroups]);

  useEffect(() => {
    if (!selectedSlide) {
      return;
    }
    const node = cardRefs.current.get(selectedSlide.page);
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedSlide]);

  const auditMetrics = useMemo(() => buildAuditMetrics(analyzerResult), [analyzerResult]);

  const selectedMissingInfo = selectedSlide ? analyzerResult.missingInfo.filter((item) => item.page === selectedSlide.page) : [];
  const selectedConfidence = getConfidenceMeta(selectedSlide?.sourceConfidence);
  const selectedCoverage = toAuditCoverage(selectedSlide?.sourceConfidence);
  const bodyText = selectedSlide?.bodyText ?? '';
  const bodyLength = bodyText.length;

  return (
    <Card title="内容审计预览" bodyClassName="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {auditMetrics.map((metric) => (
          <KpiTile key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <SubTitle>源文件清单</SubTitle>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>编号</TableHead>
              <TableHead>文件名</TableHead>
              <TableHead>简称</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analyzerResult.sourceFiles.map((file) => (
              <TableRow key={file.id}>
                <TableCell className="tabular-nums">{file.id}</TableCell>
                <TableCell>{file.filename}</TableCell>
                <TableCell>{file.shortName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <SubTitle>逐页审阅</SubTitle>
          <div className="flex gap-1" role="group" aria-label="审阅筛选">
            {(Object.keys(FILTER_LABELS) as AuditFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                className={cn(
                  'h-8 rounded-sm border px-3 text-[13px] leading-5 font-semibold transition-colors duration-150 ease-out',
                  filter === option
                    ? 'border-brand-navy bg-brand-navy text-on-brand'
                    : 'border-border bg-surface text-brand-navy hover:bg-info-bg',
                )}
                onClick={() => setFilter(option)}
              >
                {FILTER_LABELS[option]}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="flex max-h-[720px] flex-col gap-2 overflow-y-auto">
            {slideGroups.map((group) => {
              const isExpanded = expandedGroupKey === group.key;
              return (
                <section key={group.key} className="border border-border bg-surface-raised">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-info-bg"
                    onClick={() => setExpandedGroupKey((prev) => (prev === group.key ? null : group.key))}
                    aria-expanded={isExpanded}
                  >
                    <IconChevronRight
                      aria-hidden="true"
                      className={cn('size-4 text-brand-navy transition-transform duration-150 ease-out', isExpanded && 'rotate-90')}
                      stroke={2}
                    />
                    <span className="flex-1 text-[13px] leading-5 font-bold text-brand-navy">{group.title}</span>
                    <Badge variant="neutral">{group.slides.length}</Badge>
                  </button>

                  {isExpanded ? (
                    <div className="flex flex-col gap-1 border-t border-border p-2">
                      {group.slides.map((slide) => {
                        const coverage = toAuditCoverage(slide.sourceConfidence);
                        const issueCount = pageIssueCount.get(slide.page) ?? 0;
                        const isActive = selectedSlide?.page === slide.page;
                        const slideTag =
                          slide.type === 'content' ? VISUAL_MODE_LABEL[slide.visualMode ?? 'none'] : SLIDE_TYPE_LABEL[slide.type];

                        return (
                          <button
                            key={slide.page}
                            type="button"
                            aria-current={isActive ? 'true' : undefined}
                            className={cn(
                              'flex items-start gap-2 border px-2 py-2 text-left transition-colors duration-150 ease-out',
                              isActive ? 'border-brand-navy bg-info-bg' : 'border-transparent hover:bg-surface-sunken',
                            )}
                            onClick={() => {
                              setSelectedPage(slide.page);
                              setExpandedGroupKey(group.key);
                            }}
                            title={`来源：${slide.sourceRef ?? '未提供'} | 布局：${slideTag}`}
                            ref={(node) => {
                              cardRefs.current.set(slide.page, node);
                            }}
                          >
                            <span className="text-[13px] leading-5 font-bold text-brand-navy tabular-nums">P{slide.page}</span>
                            {' '}
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className="truncate text-[13px] leading-5 text-ink">{getSlideMainTitle(slide)}</span>
                              <span className="flex items-center gap-2 text-xs leading-4 text-ink-muted">
                                <span aria-hidden="true" className={cn('size-1.5 rounded-full', COVERAGE_DOT[coverage])} />
                                {slideTag}
                                <span className={cn('ml-auto tabular-nums', issueCount ? 'text-warning' : 'text-ink-disabled')}>
                                  {issueCount}
                                </span>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </aside>

          <div className="flex min-w-0 flex-col gap-4">
            {selectedSlide ? (
              <>
                <AuditSlideCanvas
                  slide={selectedSlide}
                  importedImages={importedImages}
                  issueCount={pageIssueCount.get(selectedSlide.page) ?? 0}
                />

                <article className="border border-border bg-surface-raised">
                  <nav className="flex border-b border-border" aria-label="审计视图切换">
                    {(Object.keys(TAB_LABELS) as AuditViewSection[]).map((section) => (
                      <button
                        key={section}
                        type="button"
                        aria-pressed={activeTab === section}
                        className={cn(
                          '-mb-px border-b-2 px-4 py-2 text-[13px] leading-5 font-semibold transition-colors duration-150 ease-out',
                          activeTab === section
                            ? 'border-brand-navy text-brand-navy'
                            : 'border-transparent text-ink-muted hover:text-brand-navy',
                        )}
                        onClick={() => setActiveTab(section)}
                      >
                        {TAB_LABELS[section]}
                      </button>
                    ))}
                  </nav>

                  <div className="flex flex-col gap-3 p-4 text-[13px] leading-5">
                    {activeTab === 'source' ? (
                      <section className="flex flex-col gap-2">
                        <h5 className="text-base leading-6 font-bold text-brand-navy">溯源信息</h5>
                        <dl className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <dt className="inline font-semibold">来源引用：</dt>
                            <dd className="inline">{selectedSlide.sourceRef ?? '未提供'}</dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">覆盖程度：</dt>
                            <dd className="inline">
                              <Badge variant={COVERAGE_TONE[selectedCoverage]}>{getAuditCoverageLabel(selectedCoverage)}</Badge>
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">来源置信度：</dt>
                            <dd className="inline">
                              <Badge variant={CONFIDENCE_TONE[selectedConfidence.chip]}>{selectedConfidence.label}</Badge>
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">布局：</dt>
                            <dd className="inline">
                              {selectedSlide.type === 'content'
                                ? VISUAL_MODE_LABEL[selectedSlide.visualMode ?? 'none']
                                : SLIDE_TYPE_LABEL[selectedSlide.type]}
                            </dd>
                          </div>
                        </dl>
                      </section>
                    ) : null}

                    {activeTab === 'body' ? (
                      <section className="flex flex-col gap-3">
                        <h5 className="text-base leading-6 font-bold text-brand-navy">正文编辑</h5>
                        {selectedSlide.type === 'content' ? (
                          <>
                            <label className="flex flex-col gap-1.5">
                              <span className="font-semibold">正文（建议 ≤ 150 字）</span>
                              <Textarea
                                className="min-h-32"
                                value={bodyText}
                                onChange={(event) =>
                                  onUpdateSlide(selectedSlide.page, (current) => ({
                                    ...current,
                                    bodyText: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <p
                              className={cn(
                                'flex items-center gap-1 tabular-nums',
                                bodyLength > BODY_SOFT_LIMIT ? 'font-semibold text-warning' : 'text-ink-muted',
                              )}
                            >
                              {bodyLength > BODY_SOFT_LIMIT ? (
                                <IconAlertTriangle aria-hidden="true" className="size-4" stroke={2} />
                              ) : null}
                              字数：{bodyLength}/150
                            </p>

                            {selectedSlide.visualMode === 'table' && selectedSlide.tableData ? (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    {selectedSlide.tableData.headers.map((header, headerIndex) => (
                                      <TableHead key={`${selectedSlide.page}-header-${headerIndex}`} className="px-1">
                                        <Input
                                          value={header}
                                          onChange={(event) =>
                                            onUpdateSlide(selectedSlide.page, (current) =>
                                              withTableHeader(current, headerIndex, event.target.value),
                                            )
                                          }
                                        />
                                      </TableHead>
                                    ))}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {selectedSlide.tableData.rows.map((row, rowIndex) => (
                                    <TableRow key={`${selectedSlide.page}-row-${rowIndex}`}>
                                      {row.map((cell, cellIndex) => (
                                        <TableCell key={`${selectedSlide.page}-cell-${rowIndex}-${cellIndex}`} className="px-1">
                                          <Input
                                            value={cell}
                                            onChange={(event) =>
                                              onUpdateSlide(selectedSlide.page, (current) =>
                                                withTableCell(current, rowIndex, cellIndex, event.target.value),
                                              )
                                            }
                                          />
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            ) : null}

                            {selectedSlide.visualMode === 'images' ? (
                              <div className="flex flex-col gap-1">
                                {(selectedSlide.imagePrompts ?? []).map((prompt, index) => {
                                  const file = importedImages.get(getImageSlotKey(selectedSlide.page, index));
                                  return (
                                    <p key={`${selectedSlide.page}-status-${index}`}>
                                      <strong>图片 {index + 1}：</strong>
                                      {file ? '已导入' : '未导入'} · {prompt.description || '暂无描述'}
                                    </p>
                                  );
                                })}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-ink-muted">该页不可编辑正文，请切换到溯源或缺失项继续审阅。</p>
                        )}
                      </section>
                    ) : null}

                    {activeTab === 'supplements' ? (
                      <section className="flex flex-col gap-2">
                        <h5 className="text-base leading-6 font-bold text-brand-navy">AI 补充清单</h5>
                        {(selectedSlide.aiSupplements ?? []).length ? (
                          <ul className="list-disc space-y-1 pl-5">
                            {(selectedSlide.aiSupplements ?? []).map((item, idx) => (
                              <li key={`${selectedSlide.page}-supplement-${idx}`}>
                                [{SUPPLEMENT_LABEL[item.type]}] {item.description}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-ink-muted">当前页无 AI 补充。</p>
                        )}
                      </section>
                    ) : null}

                    {activeTab === 'missing' ? (
                      <section className="flex flex-col gap-2">
                        <h5 className="text-base leading-6 font-bold text-brand-navy">缺失项</h5>
                        {selectedMissingInfo.length ? (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>缺失情况</TableHead>
                                <TableHead>补充方式</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedMissingInfo.map((item, idx) => (
                                <TableRow key={`${selectedSlide.page}-missing-${idx}`}>
                                  <TableCell>{item.description}</TableCell>
                                  <TableCell>{item.solution}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <p className="text-ink-muted">当前页无缺失项。</p>
                        )}
                      </section>
                    ) : null}
                  </div>
                </article>
              </>
            ) : (
              <p className="border border-border p-4 text-[13px] leading-5 text-ink-muted">当前筛选条件下暂无可审阅页面。</p>
            )}
          </div>
        </div>
      </section>
    </Card>
  );
}
