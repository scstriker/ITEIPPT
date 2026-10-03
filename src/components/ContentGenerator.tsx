import { useEffect, useMemo, useState } from 'react';
import type { ConfirmRequest } from '../confirm/confirmActions';
import type { ParsedDocument } from '../services/documentParser';
import {
  mapGenerateContentError,
  requestGenerateContent,
} from '../services/contentGeneratorApi';
import type { AnalyzerResult, SlideContent } from '../types/analyzer';
import type { FrameworkPlan } from '../types/framework';

type ProgressStatus = 'pending' | 'generating' | 'completed';

interface ProgressItem {
  page: number;
  label: string;
}

interface ContentGeneratorProps {
  frameworkPlan: FrameworkPlan | null;
  parsedDocument: ParsedDocument | null;
  analyzerResult: AnalyzerResult | null;
  requestConfirm?: ConfirmRequest;
  confirmBusy?: boolean;
  onGenerated: (result: AnalyzerResult) => void;
}

function buildExpectedProgress(plan: FrameworkPlan): ProgressItem[] {
  const items: ProgressItem[] = [];
  let page = 1;
  items.push({ page, label: '封面页' });
  page += 1;
  for (const chapter of plan.chapters) {
    items.push({ page, label: `目录页 -> Ch${chapter.chapterIndex}` });
    page += 1;
    for (const slide of chapter.slides) {
      items.push({ page, label: slide.subtitle || `章节 ${chapter.chapterIndex} 子页` });
      page += 1;
    }
  }
  items.push({ page, label: '结束页' });
  return items;
}

function buildProgressFromResult(result: AnalyzerResult): ProgressItem[] {
  return result.slidePlan.map((slide) => ({
    page: slide.page,
    label: slideLabel(slide),
  }));
}

function slideLabel(slide: SlideContent): string {
  if (slide.type === 'cover') {
    return '封面页';
  }
  if (slide.type === 'toc_section') {
    return `目录页 -> Ch${slide.highlightChapter ?? '-'}`;
  }
  if (slide.type === 'ending') {
    return '结束页';
  }
  return slide.subtitle || slide.chapterTitle || '内容页';
}

export function ContentGenerator({
  frameworkPlan,
  parsedDocument,
  analyzerResult,
  requestConfirm,
  confirmBusy = false,
  onGenerated,
}: ContentGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!isGenerating || progressItems.length === 0) {
      return undefined;
    }
    const timer = globalThis.setInterval(() => {
      setActiveIndex((prev) => Math.min(prev + 1, progressItems.length - 1));
    }, 450);
    return () => globalThis.clearInterval(timer);
  }, [isGenerating, progressItems.length]);

  useEffect(() => {
    if (!analyzerResult || isGenerating) {
      return;
    }
    setProgressItems(buildProgressFromResult(analyzerResult));
    setActiveIndex(Math.max(0, analyzerResult.slidePlan.length - 1));
  }, [analyzerResult, isGenerating]);

  const progressPercent = useMemo(() => {
    if (!progressItems.length) {
      return 0;
    }
    if (isGenerating) {
      const ratio = (activeIndex + 0.5) / progressItems.length;
      return Math.min(98, Math.max(4, Math.round(ratio * 100)));
    }
    return analyzerResult ? 100 : 0;
  }, [activeIndex, analyzerResult, isGenerating, progressItems.length]);

  const handleGenerate = async () => {
    if (!frameworkPlan || !parsedDocument) {
      setErrorMessage('请先完成 Step 1 文档解析与 Step 2 框架规划。');
      return;
    }

    setErrorMessage(null);
    const expected = buildExpectedProgress(frameworkPlan);
    setProgressItems(expected);
    setActiveIndex(0);
    setIsGenerating(true);
    try {
      const result = await requestGenerateContent({
        frameworkPlan,
        textContent: parsedDocument.textContent,
        sourceFilename: parsedDocument.filename,
      });
      setProgressItems(buildProgressFromResult(result));
      setActiveIndex(Math.max(0, result.slidePlan.length - 1));
      onGenerated(result);
    } catch (error) {
      setErrorMessage(mapGenerateContentError(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const rowStatus = (index: number): ProgressStatus => {
    if (analyzerResult && !isGenerating) {
      return 'completed';
    }
    if (!isGenerating) {
      return 'pending';
    }
    if (index < activeIndex) {
      return 'completed';
    }
    if (index === activeIndex) {
      return 'generating';
    }
    return 'pending';
  };

  return (
    <section className="panel">
      <article className="card">
        <header className="card-header">🤖 Step 3 · AI 内容生成</header>
        <div className="card-body content-generator-panel">
          <p className="panel-hint">根据 Step 2 的一级/二级标题，从文档中生成正文、表格与 ITEI Draw 图片描述。</p>

          <div className="planner-meta">
            <p>
              <strong>文档：</strong>
              {parsedDocument ? parsedDocument.filename : '未上传'}
            </p>
            <p>
              <strong>框架：</strong>
              {frameworkPlan ? `${frameworkPlan.chapters.length} 章` : '未配置'}
            </p>
            <div className="planner-ai-actions">
              <button
                type="button"
                className="btn btn-ai"
                onClick={() => {
                  if (!requestConfirm) {
                    void handleGenerate();
                    return;
                  }
                  requestConfirm(
                    'content_generate_start',
                    { chapterCount: frameworkPlan?.chapters.length ?? 0 },
                    async () => {
                      await handleGenerate();
                    },
                  );
                }}
                disabled={isGenerating || confirmBusy || !frameworkPlan || !parsedDocument}
              >
                {isGenerating ? 'AI 生成中...' : '开始生成内容'}
              </button>
              {isGenerating ? <span className="loading-note">正在逐页生成，请稍候...</span> : null}
            </div>
          </div>

          <section className="progress-board">
            <header className="progress-header">
              <strong>生成进度</strong>
              <span>{progressPercent}%</span>
            </header>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="progress-list">
              {progressItems.map((item, index) => (
                <div key={`${item.page}-${item.label}`} className={`progress-item ${rowStatus(index)}`}>
                  <span className="progress-page">#{item.page}</span>
                  <span className="progress-label">{item.label}</span>
                  <span className="progress-state">
                    {rowStatus(index) === 'completed'
                      ? '已完成'
                      : rowStatus(index) === 'generating'
                        ? '生成中...'
                        : '等待中'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {errorMessage ? <p className="message-error">{errorMessage}</p> : null}

          {analyzerResult ? (
            <section className="generator-result">
              <h3>生成结果</h3>
              <div className="result-metrics">
                <div className="metric-card">
                  <span>总页数</span>
                  <strong>{analyzerResult.auditSummary.totalSlides}</strong>
                </div>
                <div className="metric-card">
                  <span>原文精确占比</span>
                  <strong>{analyzerResult.auditSummary.exactSourcePercent}%</strong>
                </div>
                <div className="metric-card">
                  <span>AI 补充条目</span>
                  <strong>{analyzerResult.auditSummary.aiSupplementCount}</strong>
                </div>
                <div className="metric-card">
                  <span>图片</span>
                  <strong>{analyzerResult.imagePromptsTotal}</strong>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </article>
    </section>
  );
}
