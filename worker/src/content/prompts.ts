import { CONTENT_PROMPT_COMPACT_DOC_CHARS, CONTENT_PROMPT_MAX_DOC_CHARS } from './constants';
import type { DocumentExcerpt, DocumentExcerpts, GeneratedContentPayload, SlideEvidenceContext } from './types';

/** Head (3/4) + tail (1/4) of the document, at most `maxDocChars` characters plus the separator. */
export function buildDocumentExcerpt(textContent: string, compactMode: boolean): DocumentExcerpt {
  const normalizedText = textContent.trim();
  const maxDocChars = compactMode ? CONTENT_PROMPT_COMPACT_DOC_CHARS : CONTENT_PROMPT_MAX_DOC_CHARS;
  if (normalizedText.length <= maxDocChars) {
    return { text: normalizedText || 'N/A', truncated: false };
  }
  const headLength = Math.floor(maxDocChars * 0.75);
  const tailLength = Math.max(0, maxDocChars - headLength);
  return { text: `${normalizedText.slice(0, headLength)}\n...\n${normalizedText.slice(-tailLength)}`, truncated: true };
}

export function buildDocumentExcerpts(textContent: string): DocumentExcerpts {
  return { full: buildDocumentExcerpt(textContent, false), compact: buildDocumentExcerpt(textContent, true) };
}

export function buildGenerateContentPrompt(
  presetId: string,
  evidenceContexts: SlideEvidenceContext[],
  excerpt: DocumentExcerpt,
  compactMode = false,
): string {
  const documentExcerpt = excerpt.text;
  const isExcerptTruncated = excerpt.truncated;

  const taskLines = evidenceContexts
    .map((item) => {
      const snippets = item.evidenceSnippets.length
        ? item.evidenceSnippets.map((snippet, index) => `evidence${index + 1}=${snippet}`).join(' | ')
        : 'evidence=N/A';
      return [
        `- page=${item.page}; chapterIndex=${item.chapterIndex}; slideIndex=${item.slideIndex}; visualMode=${item.visualMode}`,
        `  chapterTitle=${item.chapterTitle}; subtitle=${item.subtitle}`,
        `  contentHint=${item.contentHint ?? 'N/A'}; sourceHint=${item.sourceHint ?? 'N/A'}`,
        `  preferredSourceRef=${item.primarySourceRef}`,
        `  ${snippets}`,
      ].join('\n');
    })
    .join('\n');

  return [
    'You are the ITEISlides content generator.',
    'Return strict JSON only. Do not return markdown.',
    'Return schema only:',
    '{"slides":[{"page":3,"bodyText":"","sourceRef":"","sourceConfidence":"exact|paraphrased|ai_inferred|ai_constructed","aiSupplements":[{"description":"","type":"common_knowledge|ai_summary|ai_inference|ai_construction|chart_design"}],"tableData":{"headers":[""],"rows":[[""]]},"imagePrompts":[{"description":"","iteiDrawPrompt":""}]}]}',
    'Rules:',
    '1) Only generate slides for content pages listed in page tasks. Do not output cover/ending.',
    '2) bodyText should be one concise Chinese paragraph with 1-3 sentences and 80-220 Chinese chars.',
    '3) Prioritize chapter/subtitle alignment: include conclusion + key evidence details when available.',
    '4) Do not start bodyText with: 本表总结了 / 本页展示了 / 如下表所示 / 本页主要介绍 / 下表显示.',
    '5) Keep traceability fields: sourceRef should be filled when possible; sourceConfidence prefer exact/paraphrased, but ai_inferred/ai_constructed is allowed if evidence is weak.',
    '6) Do not leave bodyText empty. If evidence is weak, provide a usable, topic-focused draft for later human review.',
    '7) For visualMode=table, provide tableData when possible (3 columns, 2-4 rows).',
    '8) For visualMode=images, provide 1-2 imagePrompts.',
    '9) Do not output highlightRanges.',
    compactMode
      ? '10) Compact mode: rely on page evidence as primary grounding; document text is only a short fallback excerpt.'
      : '10) Full mode: use evidence snippets first, and document excerpt only as supplementary context.',
    '',
    `framework presetId=${presetId}`,
    'Page tasks with evidence:',
    taskLines,
    '',
    `Document text (${compactMode ? 'compact' : 'full'} excerpt${isExcerptTruncated ? ', truncated' : ''}):`,
    documentExcerpt,
  ].join('\n');
}

export function buildRewriteContentPrompt(
  failedContexts: SlideEvidenceContext[],
  currentSlides: NonNullable<GeneratedContentPayload['slides']>,
): string {
  const currentByPage = new Map<number, NonNullable<GeneratedContentPayload['slides']>[number]>();
  for (const item of currentSlides) {
    currentByPage.set(item.page ?? -1, item);
  }

  const failedLines = failedContexts
    .map((item) => {
      const current = currentByPage.get(item.page);
      const snippets = item.evidenceSnippets.length
        ? item.evidenceSnippets.map((snippet, index) => `evidence${index + 1}=${snippet}`).join(' | ')
        : 'evidence=N/A';
      return [
        `- page=${item.page}; visualMode=${item.visualMode}`,
        `  chapterTitle=${item.chapterTitle}; subtitle=${item.subtitle}`,
        `  currentBody=${current?.bodyText ?? ''}`,
        `  currentSourceRef=${current?.sourceRef ?? ''}; currentConfidence=${current?.sourceConfidence ?? ''}`,
        `  preferredSourceRef=${item.primarySourceRef}`,
        `  ${snippets}`,
      ].join('\n');
    })
    .join('\n');

  return [
    'Rewrite missing/empty pages only.',
    'Return strict JSON only:',
    '{"slides":[{"page":3,"bodyText":"","sourceRef":"","sourceConfidence":"exact|paraphrased|ai_inferred|ai_constructed"}]}',
    'Rules:',
    '1) bodyText should be one concise Chinese paragraph with 1-3 sentences and 80-220 Chinese chars.',
    '2) Keep content tightly aligned to chapterTitle/subtitle and use evidence snippets when available.',
    '3) Do not start with: 本表总结了 / 本页展示了 / 如下表所示 / 本页主要介绍 / 下表显示.',
    '4) Do not output empty bodyText. If evidence remains weak, output a usable draft and mark sourceConfidence as ai_inferred/ai_constructed.',
    '5) Keep sourceRef/sourceConfidence whenever possible for audit visibility.',
    '',
    'Failed pages:',
    failedLines,
  ].join('\n');
}
