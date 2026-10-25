import type { ImagePrompt, SlideContent, SlideTableData } from '../contracts/analyzer';
import { CONTENT_FALLBACK_SOURCE_REF } from './constants';
import type { GeneratedContentPayload, SlideEvidenceContext } from './types';
import { truncateText } from '../shared/text';

export function upsertGeneratedSlide(
  payload: GeneratedContentPayload,
  page: number,
): NonNullable<GeneratedContentPayload['slides']>[number] {
  const slides = payload.slides ?? [];
  payload.slides = slides;
  const existing = slides.find((item) => item.page === page);
  if (existing) {
    return existing;
  }
  const created: NonNullable<GeneratedContentPayload['slides']>[number] = { page };
  slides.push(created);
  return created;
}

export function mergeGeneratedSlideUpdates(target: GeneratedContentPayload, patch: GeneratedContentPayload): void {
  if (!patch.slides?.length) {
    return;
  }
  for (const item of patch.slides) {
    if (typeof item.page !== 'number') {
      continue;
    }
    const current = upsertGeneratedSlide(target, item.page);
    if (typeof item.bodyText === 'string') {
      current.bodyText = item.bodyText;
    }
    if (Array.isArray(item.highlightRanges)) {
      current.highlightRanges = item.highlightRanges;
    }
    if (typeof item.sourceRef === 'string') {
      current.sourceRef = item.sourceRef;
    }
    if (item.sourceConfidence) {
      current.sourceConfidence = item.sourceConfidence;
    }
    if (Array.isArray(item.aiSupplements)) {
      current.aiSupplements = item.aiSupplements;
    }
    if (item.tableData) {
      current.tableData = item.tableData;
    }
    if (Array.isArray(item.imagePrompts)) {
      current.imagePrompts = item.imagePrompts;
    }
  }
}

export function applyEvidenceSourceDefaults(
  payload: GeneratedContentPayload,
  evidenceContextByPage: Map<number, SlideEvidenceContext>,
): void {
  for (const item of payload.slides ?? []) {
    if (typeof item.page !== 'number') {
      continue;
    }
    const context = evidenceContextByPage.get(item.page);
    if (!context) {
      continue;
    }
    if (!item.sourceRef?.trim()) {
      item.sourceRef = context.primarySourceRef;
    }
    if (!item.sourceConfidence) {
      item.sourceConfidence = 'paraphrased';
    }
  }
}

export function hasUsableBodyText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function collectMissingContentPages(payload: GeneratedContentPayload, baseSlides: SlideContent[]): Set<number> {
  const missingPages = new Set<number>();
  const generatedByPage = new Map<number, NonNullable<GeneratedContentPayload['slides']>[number]>();
  for (const item of payload.slides ?? []) {
    if (typeof item.page === 'number') {
      generatedByPage.set(item.page, item);
    }
  }
  for (const slide of baseSlides) {
    if (slide.type !== 'content') {
      continue;
    }
    const generated = generatedByPage.get(slide.page);
    if (!hasUsableBodyText(generated?.bodyText)) {
      missingPages.add(slide.page);
    }
  }
  return missingPages;
}

export function buildAutoCompletedBody(context: SlideEvidenceContext): string {
  const chapterTitle = context.chapterTitle || '当前章节';
  const subtitle = context.subtitle || '核心内容';
  const firstEvidence = context.evidenceSnippets[0] ? truncateText(context.evidenceSnippets[0], 72) : '';
  const sourceLine = firstEvidence
    ? `结合原文可提取信息“${firstEvidence}”，已形成本页可继续编辑的基础草稿，建议在审校阶段补充更细的数据与论据。`
    : '当前页依据章节语义完成自动归纳草稿，建议在审校阶段补充更具体的数据、案例与原文定位。';
  return `本页围绕“${chapterTitle}”下的“${subtitle}”整理关键结论与执行要点，确保内容结构可直接进入后续编辑。${sourceLine}`;
}

export function buildAutoCompletedTableData(context: SlideEvidenceContext): SlideTableData {
  const evidence = context.evidenceSnippets[0] ? truncateText(context.evidenceSnippets[0], 32) : '待补充原文细节';
  return {
    headers: ['维度', '内容', '来源提示'],
    rows: [
      ['主题', truncateText(context.subtitle || context.chapterTitle || '核心要点', 28), '章节语义'],
      ['关键信息', evidence, truncateText(context.primarySourceRef || CONTENT_FALLBACK_SOURCE_REF, 28)],
    ],
  };
}

export function buildAutoCompletedImagePrompts(context: SlideEvidenceContext): ImagePrompt[] {
  const chapterTitle = context.chapterTitle || '当前章节';
  const subtitle = context.subtitle || '核心内容';
  return [
    {
      description: `${subtitle}配图`,
      iteiDrawPrompt: `请生成一张适用于“${chapterTitle} - ${subtitle}”的专业汇报配图，16:9，蓝白科技风，突出关键信息表达。`,
    },
  ];
}

export function autoCompleteMissingPages(
  payload: GeneratedContentPayload,
  missingPages: Set<number>,
  evidenceContextByPage: Map<number, SlideEvidenceContext>,
): Set<number> {
  const completedPages = new Set<number>();
  for (const page of missingPages) {
    const context = evidenceContextByPage.get(page);
    if (!context) {
      continue;
    }
    const item = upsertGeneratedSlide(payload, page);
    if (!hasUsableBodyText(item.bodyText)) {
      item.bodyText = buildAutoCompletedBody(context);
      completedPages.add(page);
    }
    if (!item.sourceRef?.trim()) {
      item.sourceRef = context.primarySourceRef || CONTENT_FALLBACK_SOURCE_REF;
    }
    if (!item.sourceConfidence) {
      item.sourceConfidence = context.evidenceSnippets.length ? 'paraphrased' : 'ai_constructed';
    }
    if (context.visualMode === 'table' && !item.tableData) {
      item.tableData = buildAutoCompletedTableData(context);
    }
    if (context.visualMode === 'images' && !item.imagePrompts?.length) {
      item.imagePrompts = buildAutoCompletedImagePrompts(context);
    }
  }
  return completedPages;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function fallbackImagePrompt(slide: SlideContent): ImagePrompt {
  return {
    description: `${slide.subtitle ?? slide.chapterTitle ?? '该页面'}配图`,
    iteiDrawPrompt: `请生成一张适用于“${slide.chapterTitle ?? ''} - ${slide.subtitle ?? ''}”的专业汇报配图，16:9，蓝白科技风，信息清晰。`,
  };
}

export function fallbackTableData(slide: SlideContent): SlideTableData {
  const bodySnippet = truncateText(slide.bodyText ?? '待补充本页要点', 36);
  const source = truncateText(slide.sourceRef ?? '待补充来源', 24);
  return {
    headers: ['维度', '说明', '来源'],
    rows: [
      ['主题', truncateText(slide.subtitle ?? slide.chapterTitle ?? '核心要点', 24), '章节信息'],
      ['内容', bodySnippet, source],
    ],
  };
}
