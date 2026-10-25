// One batch of content pages: build the prompt, call Gemini (full, then compact), rewrite empty pages,
// and complete what is still missing from the evidence. Runs in the Worker behind POST /api/generate-content/batch.
import type { SlideContent } from '../contracts/analyzer';
import { callGeminiJsonWithRetry, getContentModel, type GeminiOptions } from '../gemini/client';
import { truncateText } from '../shared/text';
import { applyEvidenceSourceDefaults, autoCompleteMissingPages, collectMissingContentPages, mergeGeneratedSlideUpdates } from './completion';
import { buildEvidenceContextMap } from './evidence';
import { parseGeneratedContent } from './parse';
import { buildGenerateContentPrompt, buildRewriteContentPrompt } from './prompts';
import type { ContentBatchRequest, ContentBatchResult, GeneratedContentPayload } from './types';

function contentPageStubs(pages: number[]): SlideContent[] {
  return pages.map((page) => ({ page, type: 'content' }) as SlideContent);
}

function sortedPages(pages: Iterable<number>): number[] {
  return Array.from(new Set(pages)).sort((a, b) => a - b);
}

function isMissingKey(error: unknown): boolean {
  return error instanceof Error && error.message === 'missing_api_key';
}

function keepBatchPages(payload: GeneratedContentPayload, pages: Set<number>): void {
  if (payload.slides?.length) {
    payload.slides = payload.slides.filter((item) => typeof item.page === 'number' && pages.has(item.page));
  }
}

export async function runContentBatch(options: GeminiOptions, request: ContentBatchRequest): Promise<ContentBatchResult> {
  const { presetId, contexts, excerpts } = request;
  const contentModel = getContentModel(options);
  const batchPages = contexts.map((item) => item.page);
  const batchPageSet = new Set<number>(batchPages);
  const batchBaseSlides = contentPageStubs(batchPages);
  const contextByPage = buildEvidenceContextMap(contexts);
  const prompt = buildGenerateContentPrompt(presetId, contexts, excerpts.full, false);
  const compactPrompt = buildGenerateContentPrompt(presetId, contexts, excerpts.compact, true);

  let batchParsed: GeneratedContentPayload;
  try {
    let raw: unknown;
    try {
      raw = await callGeminiJsonWithRetry(options, contentModel, prompt);
    } catch (error) {
      if (isMissingKey(error)) {
        throw error;
      }
      try {
        raw = await callGeminiJsonWithRetry(options, contentModel, compactPrompt);
      } catch (compactError) {
        if (isMissingKey(compactError)) {
          throw compactError;
        }
        const primaryMessage = error instanceof Error ? error.message : 'unknown_primary_error';
        const compactMessage = compactError instanceof Error ? compactError.message : 'unknown_compact_error';
        throw new Error(`content_generation_chain_failed:primary=${primaryMessage};compact=${compactMessage}`);
      }
    }
    batchParsed = parseGeneratedContent(raw);
    keepBatchPages(batchParsed, batchPageSet);
  } catch (error) {
    if (isMissingKey(error)) {
      throw error;
    }
    // Every call failed: fill the pages from the evidence so the flow can continue (degraded).
    const failed: GeneratedContentPayload = { slides: [] };
    const autoCompleted = autoCompleteMissingPages(failed, batchPageSet, contextByPage);
    const unresolved = collectMissingContentPages(failed, batchBaseSlides);
    return {
      ok: false,
      slides: failed.slides ?? [],
      weakPages: sortedPages(batchPages),
      fallbackPages: sortedPages(batchPages),
      diagnostics: {
        initialMissingPages: sortedPages(batchPages),
        rewriteRecoveredPages: [],
        autoCompletedPages: sortedPages(autoCompleted),
        finalMissingPages: sortedPages(unresolved),
      },
      error: truncateText(error instanceof Error ? error.message : 'unknown_batch_error', 320),
    };
  }

  applyEvidenceSourceDefaults(batchParsed, contextByPage);
  const initialMissingPages = collectMissingContentPages(batchParsed, batchBaseSlides);

  if (initialMissingPages.size > 0) {
    const missingContexts = contexts.filter((item) => initialMissingPages.has(item.page));
    if (missingContexts.length > 0) {
      try {
        const rewritePrompt = buildRewriteContentPrompt(missingContexts, batchParsed.slides ?? []);
        const rewriteParsed = parseGeneratedContent(await callGeminiJsonWithRetry(options, contentModel, rewritePrompt));
        keepBatchPages(rewriteParsed, batchPageSet);
        mergeGeneratedSlideUpdates(batchParsed, rewriteParsed);
        applyEvidenceSourceDefaults(batchParsed, contextByPage);
      } catch (error) {
        if (isMissingKey(error)) {
          throw error;
        }
      }
    }
  }

  const missingAfterRewrite = collectMissingContentPages(batchParsed, batchBaseSlides);
  const rewriteRecovered = [...initialMissingPages].filter((page) => !missingAfterRewrite.has(page));
  const weakPages = new Set<number>();
  let autoCompleted = new Set<number>();
  if (missingAfterRewrite.size > 0) {
    autoCompleted = autoCompleteMissingPages(batchParsed, missingAfterRewrite, contextByPage);
    for (const page of autoCompleted) {
      weakPages.add(page);
    }
  }
  const finalMissingPages = collectMissingContentPages(batchParsed, batchBaseSlides);
  for (const page of finalMissingPages) {
    weakPages.add(page);
  }

  return {
    ok: true,
    slides: batchParsed.slides ?? [],
    weakPages: sortedPages(weakPages),
    fallbackPages: [],
    diagnostics: {
      initialMissingPages: sortedPages(initialMissingPages),
      rewriteRecoveredPages: sortedPages(rewriteRecovered),
      autoCompletedPages: sortedPages(autoCompleted),
      finalMissingPages: sortedPages(finalMissingPages),
    },
  };
}
