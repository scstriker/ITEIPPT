// AC-021: audit metrics, issue counting, filtering and grouping.
import { describe, expect, it } from 'vitest';
import type { AnalyzerResult, SlideContent } from '@contracts/analyzer';
import {
  buildAuditMetrics,
  countIssuesByPage,
  filterSlides,
  getAuditCoverageLabel,
  getSlideMainTitle,
  groupSlides,
  toAuditCoverage,
} from '../features/audit/auditModel';

const slides: SlideContent[] = [
  { page: 1, type: 'cover', reportTitle: '汇报' },
  { page: 2, type: 'toc_section', pageTitle: '汇报内容' },
  { page: 3, type: 'content', chapterTitle: '一、背景', subtitle: '项目背景', sourceConfidence: 'exact' },
  { page: 4, type: 'content', chapterTitle: '一、背景', subtitle: '必要性', sourceConfidence: 'ai_constructed' },
  { page: 5, type: 'toc_section', pageTitle: '汇报内容' },
  { page: 6, type: 'content', chapterTitle: '二、内容', subtitle: '范围', aiSupplements: [{ description: 'x', type: 'ai_summary' }] },
  { page: 7, type: 'ending', thanks: '敬请指正' },
];

const result = {
  slidePlan: slides,
  missingInfo: [{ page: 3, description: 'd', solution: 's' }],
  auditSummary: { totalSlides: 7, exactSourcePercent: 33.33, aiSupplementCount: 1, missingCount: 1 },
} as AnalyzerResult;

describe('audit model', () => {
  it('maps confidence to coverage', () => {
    expect(toAuditCoverage('exact')).toBe('high');
    expect(toAuditCoverage('ai_constructed')).toBe('low');
    expect(toAuditCoverage(undefined)).toBe('medium');
    expect(getAuditCoverageLabel('low')).toBe('低覆盖');
  });

  it('titles each slide type', () => {
    expect(slides.map(getSlideMainTitle)).toEqual(['汇报', '汇报内容', '项目背景', '必要性', '汇报内容', '范围', '敬请指正']);
  });

  it('counts issues from missing info, supplements and low coverage', () => {
    const issues = countIssuesByPage(result);
    expect([...issues.entries()].filter(([, count]) => count > 0)).toEqual([
      [3, 1],
      [4, 1],
      [6, 1],
    ]);
  });

  it('filters and groups', () => {
    const issues = countIssuesByPage(result);
    expect(filterSlides(slides, 'content', issues).map((s) => s.page)).toEqual([3, 4, 6]);
    expect(filterSlides(slides, 'issues', issues).map((s) => s.page)).toEqual([3, 4, 6]);
    expect(groupSlides(slides).map((g) => [g.title, g.slides.length])).toEqual([
      ['封面与开场', 1],
      ['目录页', 2],
      ['一、背景', 2],
      ['二、内容', 1],
      ['结束与收尾', 1],
    ]);
  });

  it('builds the metric cards', () => {
    expect(buildAuditMetrics(result)).toEqual([
      { label: '总页数', value: 7 },
      { label: '原文覆盖率', value: '33.33%' },
      { label: 'AI 补充项', value: 1 },
      { label: '缺失项', value: 1 },
    ]);
  });
});
