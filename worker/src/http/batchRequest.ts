// Validates POST /api/generate-content/batch bodies. The limits keep each prompt to one batch of the
// documented size, so the endpoint cannot be used to send arbitrary large prompts to Gemini.
import type { VisualMode } from '../contracts/template';
import { CONTENT_BATCH_SIZE, CONTENT_PROMPT_COMPACT_DOC_CHARS, CONTENT_PROMPT_MAX_DOC_CHARS } from '../content/constants';
import type { ContentBatchRequest, DocumentExcerpt, SlideEvidenceContext } from '../content/types';
import { isPresetId } from '../shared/planValues';
import { isRecord } from '../shared/text';

export const BATCH_LIMITS = {
  maxTitleChars: 1_000,
  maxHintChars: 2_000,
  maxSnippets: 5,
  maxSnippetChars: 400,
  maxKeywords: 40,
  maxKeywordChars: 1_000,
  /** Excerpt separator "\n...\n" plus a little slack. */
  excerptSlack: 16,
} as const;

const VISUAL_MODES: VisualMode[] = ['none', 'table', 'images'];

class BatchRequestError extends Error {
  constructor(detail: string) {
    super(`invalid_batch_request:${detail}`);
  }
}

function text(value: unknown, field: string, max: number, optional = false): string | undefined {
  if (value === undefined || value === null) {
    if (optional) {
      return undefined;
    }
    throw new BatchRequestError(`${field} is required`);
  }
  if (typeof value !== 'string' || value.length > max) {
    throw new BatchRequestError(`${field} must be a string of at most ${max} characters`);
  }
  return value;
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new BatchRequestError(`${field} must be a positive integer`);
  }
  return value;
}

function stringList(value: unknown, field: string, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new BatchRequestError(`${field} must be an array of at most ${maxItems} items`);
  }
  return value.map((item, index) => text(item, `${field}[${index}]`, maxChars) as string);
}

function parseContext(raw: unknown, index: number): SlideEvidenceContext {
  if (!isRecord(raw)) {
    throw new BatchRequestError(`contexts[${index}] must be an object`);
  }
  const field = (name: string) => `contexts[${index}].${name}`;
  const visualMode = raw.visualMode;
  if (typeof visualMode !== 'string' || !VISUAL_MODES.includes(visualMode as VisualMode)) {
    throw new BatchRequestError(`${field('visualMode')} must be none | table | images`);
  }
  return {
    page: positiveInt(raw.page, field('page')),
    chapterIndex: positiveInt(raw.chapterIndex, field('chapterIndex')),
    slideIndex: positiveInt(raw.slideIndex, field('slideIndex')),
    chapterTitle: text(raw.chapterTitle, field('chapterTitle'), BATCH_LIMITS.maxTitleChars) as string,
    subtitle: text(raw.subtitle, field('subtitle'), BATCH_LIMITS.maxTitleChars) as string,
    contentHint: text(raw.contentHint, field('contentHint'), BATCH_LIMITS.maxHintChars, true),
    visualMode: visualMode as VisualMode,
    sourceHint: text(raw.sourceHint, field('sourceHint'), BATCH_LIMITS.maxHintChars, true),
    evidenceSnippets: stringList(raw.evidenceSnippets, field('evidenceSnippets'), BATCH_LIMITS.maxSnippets, BATCH_LIMITS.maxSnippetChars),
    primarySourceRef: text(raw.primarySourceRef, field('primarySourceRef'), BATCH_LIMITS.maxHintChars) as string,
    evidenceKeywords: stringList(raw.evidenceKeywords, field('evidenceKeywords'), BATCH_LIMITS.maxKeywords, BATCH_LIMITS.maxKeywordChars),
  };
}

function parseExcerpt(raw: unknown, field: string, maxChars: number): DocumentExcerpt {
  if (!isRecord(raw) || typeof raw.truncated !== 'boolean') {
    throw new BatchRequestError(`${field} must be { text, truncated }`);
  }
  return { text: text(raw.text, `${field}.text`, maxChars + BATCH_LIMITS.excerptSlack) as string, truncated: raw.truncated };
}

/** Throws Error('invalid_batch_request:<detail>') or Error('invalid_preset'). */
export function parseContentBatchRequest(body: unknown): ContentBatchRequest {
  if (!isRecord(body)) {
    throw new BatchRequestError('body must be a JSON object');
  }
  if (!isPresetId(body.presetId)) {
    throw new Error('invalid_preset');
  }
  if (!Array.isArray(body.contexts) || body.contexts.length < 1 || body.contexts.length > CONTENT_BATCH_SIZE) {
    throw new BatchRequestError(`contexts must hold 1-${CONTENT_BATCH_SIZE} pages`);
  }
  const contexts = body.contexts.map(parseContext);
  if (new Set(contexts.map((item) => item.page)).size !== contexts.length) {
    throw new BatchRequestError('contexts must not repeat a page');
  }
  if (!isRecord(body.excerpts)) {
    throw new BatchRequestError('excerpts is required');
  }
  return {
    presetId: body.presetId,
    contexts,
    excerpts: {
      full: parseExcerpt(body.excerpts.full, 'excerpts.full', CONTENT_PROMPT_MAX_DOC_CHARS),
      compact: parseExcerpt(body.excerpts.compact, 'excerpts.compact', CONTENT_PROMPT_COMPACT_DOC_CHARS),
    },
  };
}
