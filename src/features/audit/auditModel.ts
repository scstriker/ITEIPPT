import type { AISupplementType, AnalyzerResult, SlideContent, SourceConfidence } from '@contracts/analyzer';

export type AuditCoverage = 'high' | 'medium' | 'low';
export type AuditFilter = 'content' | 'all' | 'issues';
export type AuditViewSection = 'source' | 'body' | 'supplements' | 'missing';


export interface SlideGroup {
  key: string;
  title: string;
  slides: SlideContent[];
}

export const SOURCE_CONFIDENCE_META: Record<SourceConfidence, { label: string; chip: 'sufficient' | 'moderate' | 'sparse' }> = {
  exact: { label: '原文精确引用', chip: 'sufficient' },
  paraphrased: { label: '原文转述', chip: 'moderate' },
  ai_inferred: { label: 'AI 推断', chip: 'moderate' },
  ai_constructed: { label: 'AI 补充构建', chip: 'sparse' },
};

export const SUPPLEMENT_LABEL: Record<AISupplementType, string> = {
  common_knowledge: '常识补充',
  ai_summary: 'AI 概括',
  ai_inference: 'AI 推理',
  ai_construction: 'AI 构建',
  chart_design: '图表设计',
};

export const SLIDE_TYPE_LABEL: Record<SlideContent['type'], string> = {
  cover: '封面页',
  toc_section: '目录页',
  content: '正文页',
  ending: '结束页',
};

export const VISUAL_MODE_LABEL: Record<NonNullable<SlideContent['visualMode']>, string> = {
  none: '文字',
  table: '文字+表格',
  images: '文字+图片',
};

export const FILTER_LABELS: Record<AuditFilter, string> = {
  content: '仅正文',
  all: '全部页面',
  issues: '仅问题页',
};

export const TAB_LABELS: Record<AuditViewSection, string> = {
  source: '溯源',
  body: '正文编辑',
  supplements: 'AI补充',
  missing: '缺失项',
};

export function getConfidenceMeta(sourceConfidence?: SourceConfidence): { label: string; chip: 'sufficient' | 'moderate' | 'sparse' } {
  return SOURCE_CONFIDENCE_META[sourceConfidence ?? 'paraphrased'];
}

export function toAuditCoverage(sourceConfidence?: SourceConfidence): AuditCoverage {
  if (sourceConfidence === 'exact') {
    return 'high';
  }
  if (sourceConfidence === 'ai_constructed') {
    return 'low';
  }
  return 'medium';
}

export function getAuditCoverageLabel(coverage: AuditCoverage): string {
  if (coverage === 'high') {
    return '高覆盖';
  }
  if (coverage === 'low') {
    return '低覆盖';
  }
  return '中覆盖';
}

export function getSlideMainTitle(slide: SlideContent): string {
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

export function getGroupMeta(slide: SlideContent): { key: string; title: string } {
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

export function getIssueCount(slide: SlideContent, missingCount: number): number {
  const supplementCount = slide.aiSupplements?.length ?? 0;
  const lowCoverage = toAuditCoverage(slide.sourceConfidence) === 'low' ? 1 : 0;
  return supplementCount + missingCount + lowCoverage;
}

export function countIssuesByPage(result: AnalyzerResult): Map<number, number> {
  const missingByPage = new Map<number, number>();
  for (const item of result.missingInfo) {
    missingByPage.set(item.page, (missingByPage.get(item.page) ?? 0) + 1);
  }
  const issues = new Map<number, number>();
  for (const slide of result.slidePlan) {
    issues.set(slide.page, getIssueCount(slide, missingByPage.get(slide.page) ?? 0));
  }
  return issues;
}

export function filterSlides(slides: SlideContent[], filter: AuditFilter, issuesByPage: Map<number, number>): SlideContent[] {
  if (filter === 'all') {
    return slides;
  }
  if (filter === 'issues') {
    return slides.filter((slide) => (issuesByPage.get(slide.page) ?? 0) > 0);
  }
  return slides.filter((slide) => slide.type === 'content');
}

/** Group slides in order of first appearance: content by chapter, the rest into fixed groups. */
export function groupSlides(slides: SlideContent[]): SlideGroup[] {
  const order: string[] = [];
  const map = new Map<string, SlideGroup>();
  for (const slide of slides) {
    const meta = getGroupMeta(slide);
    if (!map.has(meta.key)) {
      map.set(meta.key, { key: meta.key, title: meta.title, slides: [] });
      order.push(meta.key);
    }
    map.get(meta.key)?.slides.push(slide);
  }
  return order.map((key) => map.get(key)).filter((item): item is SlideGroup => Boolean(item));
}

export function buildAuditMetrics(result: AnalyzerResult): Array<{ label: string; value: string | number }> {
  return [
    { label: '总页数', value: result.auditSummary.totalSlides },
    { label: '原文覆盖率', value: `${result.auditSummary.exactSourcePercent}%` },
    { label: 'AI 补充项', value: result.auditSummary.aiSupplementCount },
    { label: '缺失项', value: result.auditSummary.missingCount },
  ];
}
