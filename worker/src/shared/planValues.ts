import type { AISupplementType, SourceConfidence } from '../contracts/analyzer';
import type { CoverageLevel, FrameworkPlan, TemplatePreset } from '../contracts/framework';
import type { VisualMode } from '../contracts/template';
import { isRecord } from './text';

export const VALID_PRESET_IDS: TemplatePreset['id'][] = ['standard_review', 'academic_research', 'blank'];

export const IMAGE_MODE_KEYWORDS = [
  '图',
  '流程',
  '架构',
  '机制',
  '趋势',
  '示意',
  '场景',
  '路线',
  '关系',
  '结构',
  '分布',
  '生态',
  '网络',
  '原理',
];

export const TABLE_MODE_KEYWORDS = [
  '数据',
  '指标',
  '参数',
  '统计',
  '对比',
  '比例',
  '成本',
  '收益',
  '风险',
  '清单',
  '矩阵',
  '进度',
  '结果',
  '结论',
  '表',
];

export function isPresetId(value: unknown): value is TemplatePreset['id'] {
  return typeof value === 'string' && VALID_PRESET_IDS.includes(value as TemplatePreset['id']);
}

export function normalizeCoverageLevel(value: unknown): CoverageLevel {
  if (value === 'sufficient' || value === 'moderate' || value === 'sparse') {
    return value;
  }
  return 'moderate';
}

export function normalizePlanVisualMode(value: unknown, fallback: VisualMode = 'table'): VisualMode {
  if (value === 'images' || value === 'table') {
    return value;
  }
  return fallback;
}

export function inferVisualModeFromText(...parts: Array<string | undefined>): VisualMode {
  const text = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');

  if (!text) {
    return 'table';
  }

  const imageScore = IMAGE_MODE_KEYWORDS.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  const tableScore = TABLE_MODE_KEYWORDS.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  return imageScore > tableScore ? 'images' : 'table';
}

export function fallbackSlideReason(mode: VisualMode): string {
  if (mode === 'images') {
    return 'This page is better expressed with diagrams and should use text + image prompts.';
  }
  return 'This page is better expressed with structured data and should use text + table.';
}

export function normalizeSourceConfidence(value: unknown): SourceConfidence {
  if (value === 'exact' || value === 'paraphrased' || value === 'ai_inferred' || value === 'ai_constructed') {
    return value;
  }
  return 'paraphrased';
}

export function normalizeSupplementType(value: unknown): AISupplementType {
  if (
    value === 'common_knowledge' ||
    value === 'ai_summary' ||
    value === 'ai_inference' ||
    value === 'ai_construction' ||
    value === 'chart_design'
  ) {
    return value;
  }
  return 'ai_summary';
}

export function isFrameworkPlan(value: unknown): value is FrameworkPlan {
  return isRecord(value) && isPresetId(value.presetId) && Array.isArray(value.chapters);
}
