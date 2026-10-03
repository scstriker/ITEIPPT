import { useEffect, useMemo, useRef, useState } from 'react';
import { getImageSlotKey } from '../hooks/useWorkflow';
import type { AISupplementType, AnalyzerResult, SlideContent, SourceConfidence } from '@contracts/analyzer';

type AuditCoverage = 'high' | 'medium' | 'low';
type AuditFilter = 'content' | 'all' | 'issues';
type AuditViewSection = 'source' | 'body' | 'supplements' | 'missing';

interface ContentAuditorProps {
  analyzerResult: AnalyzerResult | null;
  importedImages: Map<string, File>;
  onUpdateSlide: (page: number, updater: (slide: SlideContent) => SlideContent) => void;
}

interface SlideGroup {
  key: string;
  title: string;
  slides: SlideContent[];
}

const SOURCE_CONFIDENCE_META: Record<SourceConfidence, { label: string; chip: 'sufficient' | 'moderate' | 'sparse' }> = {
  exact: { label: '原文精确引用', chip: 'sufficient' },
  paraphrased: { label: '原文转述', chip: 'moderate' },
  ai_inferred: { label: 'AI 推断', chip: 'moderate' },
  ai_constructed: { label: 'AI 补充构建', chip: 'sparse' },
};

const SUPPLEMENT_LABEL: Record<AISupplementType, string> = {
  common_knowledge: '常识补充',
  ai_summary: 'AI 概括',
  ai_inference: 'AI 推理',
  ai_construction: 'AI 构建',
  chart_design: '图表设计',
};

const SLIDE_TYPE_LABEL: Record<SlideContent['type'], string> = {
  cover: '封面页',
  toc_section: '目录页',
  content: '正文页',
  ending: '结束页',
};

const VISUAL_MODE_LABEL: Record<NonNullable<SlideContent['visualMode']>, string> = {
  none: '文字',
  table: '文字+表格',
  images: '文字+图片',
};

const FILTER_LABELS: Record<AuditFilter, string> = {
  content: '仅正文',
  all: '全部页面',
  issues: '仅问题页',
};

const TAB_LABELS: Record<AuditViewSection, string> = {
  source: '溯源',
  body: '正文编辑',
  supplements: 'AI补充',
  missing: '缺失项',
};

function getConfidenceMeta(sourceConfidence?: SourceConfidence): { label: string; chip: 'sufficient' | 'moderate' | 'sparse' } {
  return SOURCE_CONFIDENCE_META[sourceConfidence ?? 'paraphrased'];
}

function toAuditCoverage(sourceConfidence?: SourceConfidence): AuditCoverage {
  if (sourceConfidence === 'exact') {
    return 'high';
  }
  if (sourceConfidence === 'ai_constructed') {
    return 'low';
  }
  return 'medium';
}

function getAuditCoverageLabel(coverage: AuditCoverage): string {
  if (coverage === 'high') {
    return '高覆盖';
  }
  if (coverage === 'low') {
    return '低覆盖';
  }
  return '中覆盖';
}

function getSlideMainTitle(slide: SlideContent): string {
  switch (slide.type) {
    case 'cover':
      return slide.reportTitle ?? slide.standardName ?? '封面信息';
    case 'toc_section':
      return slide.pageTitle ?? '目录章节';
    case 'content':
      return slide.subtitle ?? slide.chapterTitle ?? '正文内容';
    case 'ending':
      return slide.thanks ?? '结束页';
    default:
      return '未命名页面';
  }
}

function getGroupMeta(slide: SlideContent): { key: string; title: string } {
  if (slide.type === 'content') {
    const chapter = slide.chapterTitle?.trim() || '未分组章节';
    return { key: `chapter:${chapter}`, title: chapter };
  }
  if (slide.type === 'cover') {
    return { key: 'fixed:cover', title: '封面与开场' };
  }
  if (slide.type === 'toc_section') {
    return { key: 'fixed:toc', title: '目录页' };
  }
  return { key: 'fixed:ending', title: '结束与收尾' };
}

function getIssueCount(slide: SlideContent, missingCount: number): number {
  const supplementCount = slide.aiSupplements?.length ?? 0;
  const lowCoverage = toAuditCoverage(slide.sourceConfidence) === 'low' ? 1 : 0;
  return supplementCount + missingCount + lowCoverage;
}

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

interface ImportedImagePreviewProps {
  file: File | null;
  alt: string;
}

function ImportedImagePreview({ file, alt }: ImportedImagePreviewProps) {
  const previewUrl = useObjectUrl(file);

  if (!file || !previewUrl) {
    return <span className="auditwb-image-empty">未导入图片</span>;
  }

  return <img src={previewUrl} alt={alt} className="auditwb-image" />;
}

interface AuditSlideCanvasProps {
  slide: SlideContent;
  importedImages: Map<string, File>;
  issueCount: number;
}

function AuditSlideCanvas({ slide, importedImages, issueCount }: AuditSlideCanvasProps) {
  const confidence = getConfidenceMeta(slide.sourceConfidence);
  const coverage = toAuditCoverage(slide.sourceConfidence);
  const visualMode = slide.visualMode ?? 'none';
  const summaryText = (slide.bodyText ?? '').trim();

  return (
    <article className="auditwb-canvas-card">
      <header className="auditwb-canvas-header">
        <div>
          <h4>
            第 {slide.page} 页 · {SLIDE_TYPE_LABEL[slide.type]}
          </h4>
          <p className="panel-hint">{getSlideMainTitle(slide)}</p>
        </div>
        <div className="auditwb-canvas-meta">
          <span className={`audit-coverage ${coverage}`}>{getAuditCoverageLabel(coverage)}</span>
          <span className={`coverage-chip ${confidence.chip}`}>{confidence.label}</span>
          <span className="auditwb-issue-chip">问题 {issueCount}</span>
        </div>
      </header>

      <div className="auditwb-canvas-ratio">
        <div className={`auditwb-canvas auditwb-canvas-${slide.type}`}>
          <div className="auditwb-canvas-topbar" />

          {slide.type === 'cover' ? (
            <div className="auditwb-canvas-block">
              <h5>{slide.reportTitle ?? '封面标题'}</h5>
              <p>{slide.standardName ?? '标准名称'}</p>
              <p>{slide.date ?? '日期信息'}</p>
            </div>
          ) : null}

          {slide.type === 'toc_section' ? (
            <div className="auditwb-canvas-block">
              <h5>{slide.pageTitle ?? '目录内容'}</h5>
              <ul className="auditwb-mini-list">
                {(slide.sectionItems ?? []).slice(0, 6).map((item, index) => (
                  <li key={`${slide.page}-toc-${index}`}>
                    <span>{item.number ?? String(index + 1).padStart(2, '0')}</span>
                    <span>{item.title ?? '章节标题'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {slide.type === 'ending' ? (
            <div className="auditwb-canvas-block">
              <h5>{slide.thanks ?? '感谢聆听'}</h5>
              <p>{slide.organization ?? '组织名称'}</p>
              <p>{slide.contactInfo?.join(' · ') || '联系方式待补充'}</p>
            </div>
          ) : null}

          {slide.type === 'content' ? (
            <div className="auditwb-content-layout">
              <div className="auditwb-subtitle-strip">{slide.subtitle ?? '子章节标题'}</div>

              <div className="auditwb-body-preview">{summaryText || '该页正文待完善。'}</div>

              {visualMode === 'table' ? (
                <div className="auditwb-table-preview">
                  <table>
                    <thead>
                      <tr>
                        {(slide.tableData?.headers?.length ? slide.tableData.headers : ['列1', '列2', '列3']).map((header, idx) => (
                          <th key={`${slide.page}-th-${idx}`}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(slide.tableData?.rows?.length ? slide.tableData.rows : [['数据', '数据', '数据'], ['数据', '数据', '数据']])
                        .slice(0, 3)
                        .map((row, rowIdx) => (
                          <tr key={`${slide.page}-tr-${rowIdx}`}>
                            {row.map((cell, cellIdx) => (
                              <td key={`${slide.page}-td-${rowIdx}-${cellIdx}`}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {visualMode === 'images' ? (
                <div className="auditwb-image-grid">
                  {(slide.imagePrompts?.length ? slide.imagePrompts : [{ description: '图片 1', iteiDrawPrompt: '' }]).map(
                    (prompt, index) => {
                      const file = importedImages.get(getImageSlotKey(slide.page, index)) ?? null;
                      return (
                        <div key={`${slide.page}-img-${index}`} className="auditwb-image-tile">
                          <ImportedImagePreview file={file} alt={`第${slide.page}页图片${index + 1}`} />
                          <span className="auditwb-image-caption">图片 {index + 1} · {prompt.description || '暂无描述'}</span>
                        </div>
                      );
                    },
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ContentAuditor({ analyzerResult, importedImages, onUpdateSlide }: ContentAuditorProps) {
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [filter, setFilter] = useState<AuditFilter>('content');
  const [activeTab, setActiveTab] = useState<AuditViewSection>('source');
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const cardRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  if (!analyzerResult) {
    return (
      <section className="panel">
        <h2>审计预览</h2>
        <p className="panel-hint">请先在规划框架中生成内容，再进入审计预览。</p>
      </section>
    );
  }

  const allSlides = analyzerResult.slidePlan;
  const missingByPage = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of analyzerResult.missingInfo) {
      map.set(item.page, (map.get(item.page) ?? 0) + 1);
    }
    return map;
  }, [analyzerResult.missingInfo]);

  const pageIssueCount = useMemo(() => {
    const map = new Map<number, number>();
    for (const slide of allSlides) {
      map.set(slide.page, getIssueCount(slide, missingByPage.get(slide.page) ?? 0));
    }
    return map;
  }, [allSlides, missingByPage]);

  const visibleSlides = useMemo(() => {
    if (filter === 'all') {
      return allSlides;
    }
    if (filter === 'issues') {
      return allSlides.filter((slide) => (pageIssueCount.get(slide.page) ?? 0) > 0);
    }
    return allSlides.filter((slide) => slide.type === 'content');
  }, [allSlides, filter, pageIssueCount]);

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

  const slideGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SlideGroup>();

    for (const slide of visibleSlides) {
      const meta = getGroupMeta(slide);
      if (!map.has(meta.key)) {
        map.set(meta.key, { key: meta.key, title: meta.title, slides: [] });
        order.push(meta.key);
      }
      map.get(meta.key)?.slides.push(slide);
    }

    return order.map((key) => map.get(key)).filter((item): item is SlideGroup => Boolean(item));
  }, [visibleSlides]);

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

  const auditMetrics = useMemo(
    () => [
      {
        label: '总页数',
        value: analyzerResult.auditSummary.totalSlides,
      },
      {
        label: '原文覆盖率',
        value: `${analyzerResult.auditSummary.exactSourcePercent}%`,
      },
      {
        label: 'AI 补充项',
        value: analyzerResult.auditSummary.aiSupplementCount,
      },
      {
        label: '缺失项',
        value: analyzerResult.auditSummary.missingCount,
      },
    ],
    [
      analyzerResult.auditSummary.aiSupplementCount,
      analyzerResult.auditSummary.exactSourcePercent,
      analyzerResult.auditSummary.missingCount,
      analyzerResult.auditSummary.totalSlides,
    ],
  );

  const selectedMissingInfo = selectedSlide ? analyzerResult.missingInfo.filter((item) => item.page === selectedSlide.page) : [];
  const selectedConfidence = getConfidenceMeta(selectedSlide?.sourceConfidence);
  const selectedCoverage = toAuditCoverage(selectedSlide?.sourceConfidence);
  const bodyText = selectedSlide?.bodyText ?? '';
  const bodyLength = bodyText.length;

  return (
    <section className="panel">
      <article className="card">
        <header className="card-header">内容审计预览</header>
        <div className="card-body auditor-panel">
          <div className="result-metrics audit-metrics">
            {auditMetrics.map((metric) => (
              <article key={metric.label} className="metric-card">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </article>
            ))}
          </div>

          <section className="auditor-source-files">
            <h3>源文件清单</h3>
            <div className="auditor-table-wrap">
              <table className="auditor-table">
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>文件名</th>
                    <th>简称</th>
                  </tr>
                </thead>
                <tbody>
                  {analyzerResult.sourceFiles.map((file) => (
                    <tr key={file.id}>
                      <td>{file.id}</td>
                      <td>{file.filename}</td>
                      <td>{file.shortName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="auditwb-workbench">
            <header className="auditwb-header">
              <h3>逐页审阅</h3>
              <div className="auditwb-filterbar" role="tablist" aria-label="审阅筛选">
                {(Object.keys(FILTER_LABELS) as AuditFilter[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`auditwb-filter-btn${filter === option ? ' active' : ''}`}
                    onClick={() => setFilter(option)}
                  >
                    {FILTER_LABELS[option]}
                  </button>
                ))}
              </div>
            </header>

            <div className="auditwb-layout">
              <aside className="auditwb-sidebar">
                {slideGroups.map((group) => {
                  const isExpanded = expandedGroupKey === group.key;
                  return (
                    <section key={group.key} className={`auditwb-group${isExpanded ? ' expanded' : ''}`}>
                      <button
                        type="button"
                        className="auditwb-group-toggle"
                        onClick={() => setExpandedGroupKey((prev) => (prev === group.key ? null : group.key))}
                        aria-expanded={isExpanded}
                      >
                        <span className="auditwb-group-arrow">▶</span>
                        <span className="auditwb-group-title">{group.title}</span>
                        <span className="auditwb-group-count">{group.slides.length}</span>
                      </button>

                      <div className="auditwb-group-list">
                        {group.slides.map((slide) => {
                          const coverage = toAuditCoverage(slide.sourceConfidence);
                          const issueCount = pageIssueCount.get(slide.page) ?? 0;
                          const isActive = selectedSlide?.page === slide.page;
                          const slideTag = slide.type === 'content' ? VISUAL_MODE_LABEL[slide.visualMode ?? 'none'] : SLIDE_TYPE_LABEL[slide.type];

                          return (
                            <button
                              key={slide.page}
                              type="button"
                              className={`auditwb-slide-card${isActive ? ' active' : ''}`}
                              onClick={() => {
                                setSelectedPage(slide.page);
                                setExpandedGroupKey(group.key);
                              }}
                              title={`来源：${slide.sourceRef ?? '未提供'} | 布局：${slideTag}`}
                              ref={(node) => {
                                cardRefs.current.set(slide.page, node);
                              }}
                            >
                              <span className={`auditwb-coverage-dot ${coverage}`} />
                              <span className="auditwb-slide-page">P{slide.page}</span>
                              <div className="auditwb-slide-main">
                                <span className="auditwb-slide-title">{getSlideMainTitle(slide)}</span>
                                <span className="auditwb-slide-meta">
                                  <span className="auditwb-type-tag">{slideTag}</span>
                                  <span className={`auditwb-issue-badge${issueCount ? '' : ' zero'}`}>{issueCount}</span>
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </aside>

              <div className="auditwb-main">
                {selectedSlide ? (
                  <>
                    <AuditSlideCanvas
                      slide={selectedSlide}
                      importedImages={importedImages}
                      issueCount={pageIssueCount.get(selectedSlide.page) ?? 0}
                    />

                    <article className="auditwb-task-panel">
                      <nav className="auditwb-tabs" role="tablist" aria-label="审计视图切换">
                        {(Object.keys(TAB_LABELS) as AuditViewSection[]).map((section) => (
                          <button
                            key={section}
                            type="button"
                            className={`auditwb-tab-btn${activeTab === section ? ' active' : ''}`}
                            onClick={() => setActiveTab(section)}
                          >
                            {TAB_LABELS[section]}
                          </button>
                        ))}
                      </nav>

                      <div className="auditwb-tab-body">
                        {activeTab === 'source' ? (
                          <section className="auditor-detail-block compact">
                            <h5>溯源信息</h5>
                            <div className="auditwb-kv-grid">
                              <p>
                                <strong>来源引用：</strong>
                                {selectedSlide.sourceRef ?? '未提供'}
                              </p>
                              <p>
                                <strong>覆盖程度：</strong>
                                <span className={`audit-coverage ${selectedCoverage}`}>{getAuditCoverageLabel(selectedCoverage)}</span>
                              </p>
                              <p>
                                <strong>来源置信度：</strong>
                                <span className={`coverage-chip ${selectedConfidence.chip}`}>{selectedConfidence.label}</span>
                              </p>
                              <p>
                                <strong>布局：</strong>
                                {selectedSlide.type === 'content'
                                  ? VISUAL_MODE_LABEL[selectedSlide.visualMode ?? 'none']
                                  : SLIDE_TYPE_LABEL[selectedSlide.type]}
                              </p>
                            </div>
                          </section>
                        ) : null}

                        {activeTab === 'body' ? (
                          <section className="auditor-detail-block compact">
                            <h5>正文编辑</h5>
                            {selectedSlide.type === 'content' ? (
                              <>
                                <label className="field">
                                  <span>正文（建议 ≤ 150 字）</span>
                                  <textarea
                                    className="body-editor"
                                    value={bodyText}
                                    onChange={(event) =>
                                      onUpdateSlide(selectedSlide.page, (current) => ({
                                        ...current,
                                        bodyText: event.target.value,
                                      }))
                                    }
                                  />
                                </label>
                                <p className={`audit-word-count${bodyLength > 150 ? ' over-limit' : ''}`}>字数：{bodyLength}/150</p>

                                {selectedSlide.visualMode === 'table' && selectedSlide.tableData ? (
                                  <div className="auditor-table-wrap">
                                    <table className="auditor-table auditwb-inline-table">
                                      <thead>
                                        <tr>
                                          {selectedSlide.tableData.headers.map((header, headerIndex) => (
                                            <th key={`${selectedSlide.page}-header-${headerIndex}`}>
                                              <input
                                                value={header}
                                                onChange={(event) =>
                                                  onUpdateSlide(selectedSlide.page, (current) => {
                                                    if (!current.tableData) {
                                                      return current;
                                                    }
                                                    const nextHeaders = [...current.tableData.headers];
                                                    nextHeaders[headerIndex] = event.target.value;
                                                    return {
                                                      ...current,
                                                      tableData: {
                                                        ...current.tableData,
                                                        headers: nextHeaders,
                                                      },
                                                    };
                                                  })
                                                }
                                              />
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {selectedSlide.tableData.rows.map((row, rowIndex) => (
                                          <tr key={`${selectedSlide.page}-row-${rowIndex}`}>
                                            {row.map((cell, cellIndex) => (
                                              <td key={`${selectedSlide.page}-cell-${rowIndex}-${cellIndex}`}>
                                                <input
                                                  value={cell}
                                                  onChange={(event) =>
                                                    onUpdateSlide(selectedSlide.page, (current) => {
                                                      if (!current.tableData) {
                                                        return current;
                                                      }
                                                      const nextRows = current.tableData.rows.map((item) => [...item]);
                                                      nextRows[rowIndex][cellIndex] = event.target.value;
                                                      return {
                                                        ...current,
                                                        tableData: {
                                                          ...current.tableData,
                                                          rows: nextRows,
                                                        },
                                                      };
                                                    })
                                                  }
                                                />
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : null}

                                {selectedSlide.visualMode === 'images' ? (
                                  <div className="auditwb-image-status">
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
                              <p className="panel-hint compact-empty">该页不可编辑正文，请切换到溯源或缺失项继续审阅。</p>
                            )}
                          </section>
                        ) : null}

                        {activeTab === 'supplements' ? (
                          <section className="auditor-detail-block compact">
                            <h5>AI 补充清单</h5>
                            {(selectedSlide.aiSupplements ?? []).length ? (
                              <ul className="supplement-list">
                                {(selectedSlide.aiSupplements ?? []).map((item, idx) => (
                                  <li key={`${selectedSlide.page}-supplement-${idx}`}>
                                    [{SUPPLEMENT_LABEL[item.type]}] {item.description}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="panel-hint compact-empty">当前页无 AI 补充。</p>
                            )}
                          </section>
                        ) : null}

                        {activeTab === 'missing' ? (
                          <section className="auditor-detail-block compact">
                            <h5>缺失项</h5>
                            {selectedMissingInfo.length ? (
                              <div className="auditor-table-wrap">
                                <table className="auditor-table">
                                  <thead>
                                    <tr>
                                      <th>缺失情况</th>
                                      <th>补充方式</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedMissingInfo.map((item, idx) => (
                                      <tr key={`${selectedSlide.page}-missing-${idx}`}>
                                        <td>{item.description}</td>
                                        <td>{item.solution}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="panel-hint compact-empty">当前页无缺失项。</p>
                            )}
                          </section>
                        ) : null}
                      </div>
                    </article>
                  </>
                ) : (
                  <article className="auditor-detail">
                    <p className="panel-hint">当前筛选条件下暂无可审阅页面。</p>
                  </article>
                )}
              </div>
            </div>
          </section>
        </div>
      </article>
    </section>
  );
}
