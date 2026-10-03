import type { AnalyzerResult } from '../contracts/analyzer';
import { applyEvidenceSourceDefaults, autoCompleteMissingPages, chunkArray, collectMissingContentPages, mergeGeneratedSlideUpdates } from './completion';
import { composeAnalyzerResult } from './compose';
import { CONTENT_BATCH_SIZE, CONTENT_SOFT_DEADLINE_GUARD_MS, CONTENT_SOFT_DEADLINE_MS, MAX_CONTENT_TEXT_LENGTH } from './constants';
import { buildEvidenceContextMap, buildSlideEvidenceContexts } from './evidence';
import { parseGeneratedContent } from './parse';
import { buildGenerateContentPrompt, buildRewriteContentPrompt } from './prompts';
import { buildSlidePlanFromFramework } from './slidePlan';
import type { GenerateContentProgressUpdate, GenerateContentRequestBody, GenerateContentRuntimeHooks, GeneratedContentPayload } from './types';
import { callGeminiJsonWithRetry, getApiKey, getContentModel } from '../gemini/client';
import type { GeminiOptions } from '../gemini/client';
import { isFrameworkPlan } from '../shared/planValues';
import { cleanText, normalizeOptionalText, truncateText } from '../shared/text';

export async function emitGenerateProgress(
  hooks: GenerateContentRuntimeHooks,
  update: GenerateContentProgressUpdate,
): Promise<void> {
  if (!hooks.onProgress) {
    return;
  }
  try {
    await hooks.onProgress(update);
  } catch {
    // Ignore progress callback failures to avoid interrupting generation.
  }
}

export function computeGenerateProgressPercent(processedBatches: number, totalBatches: number): number {
  if (totalBatches <= 0) {
    return 5;
  }
  const ratio = Math.min(1, Math.max(0, processedBatches / totalBatches));
  return Math.min(95, Math.max(5, Math.round(5 + ratio * 90)));
}

export async function generateContentWithGemini(
  options: GeminiOptions,
  reqBody: GenerateContentRequestBody,
  hooks: GenerateContentRuntimeHooks = {},
): Promise<AnalyzerResult> {
  if (!isFrameworkPlan(reqBody.frameworkPlan)) {
    throw new Error('invalid_framework_plan');
  }
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  if (!textContent) {
    throw new Error('missing_text_content');
  }

  const frameworkPlan = reqBody.frameworkPlan;
  const sourceFilename = normalizeOptionalText(reqBody.sourceFilename);
  const baseSlides = buildSlidePlanFromFramework(frameworkPlan, {
    textContent,
    sourceFilename,
  });
  const truncatedText = truncateText(textContent, MAX_CONTENT_TEXT_LENGTH);
  const evidenceContexts = buildSlideEvidenceContexts(frameworkPlan, baseSlides, truncatedText);
  const evidenceContextByPage = buildEvidenceContextMap(evidenceContexts);
  const contentModel = getContentModel(options);
  const parsed: GeneratedContentPayload = { slides: [] };
  const weakGroundingPages = new Set<number>();
  const batchFallbackPages = new Set<number>();
  const degradeReasons = new Set<string>();
  const startedAt = Date.now();
  const deadlineAt = startedAt + CONTENT_SOFT_DEADLINE_MS;
  const batches = chunkArray(evidenceContexts, CONTENT_BATCH_SIZE);
  const totalBatches = Math.max(1, batches.length);
  let processedBatches = 0;
  const diagnostics = {
    totalContentPages: evidenceContexts.length,
    initialMissingPages: new Set<number>(),
    rewriteRecoveredPages: new Set<number>(),
    autoCompletedPages: new Set<number>(),
    finalMissingPages: new Set<number>(),
  };
  const addPages = (target: Set<number>, pages: Iterable<number>): void => {
    for (const page of pages) {
      target.add(page);
    }
  };

  await emitGenerateProgress(hooks, {
    stage: 'preparing',
    percent: 2,
    processedBatches: 0,
    totalBatches,
  });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batchContexts = batches[batchIndex];
    if (!batchContexts.length) {
      processedBatches = Math.min(totalBatches, processedBatches + 1);
      await emitGenerateProgress(hooks, {
        stage: 'generating',
        percent: computeGenerateProgressPercent(processedBatches, totalBatches),
        processedBatches,
        totalBatches,
      });
      continue;
    }

    if (Date.now() + CONTENT_SOFT_DEADLINE_GUARD_MS >= deadlineAt) {
      degradeReasons.add('soft_deadline_reached');
      for (let restIndex = batchIndex; restIndex < batches.length; restIndex += 1) {
        const restPages = batches[restIndex].map((item) => item.page);
        if (!restPages.length) {
          continue;
        }
        const restPageSet = new Set(restPages);
        const restBaseSlides = baseSlides.filter((slide) => slide.type === 'content' && restPageSet.has(slide.page));
        addPages(diagnostics.initialMissingPages, restPages);
        const autoCompleted = autoCompleteMissingPages(parsed, restPageSet, evidenceContextByPage);
        addPages(diagnostics.autoCompletedPages, autoCompleted);
        const unresolved = collectMissingContentPages(parsed, restBaseSlides);
        addPages(diagnostics.finalMissingPages, unresolved);
        for (const page of restPages) {
          weakGroundingPages.add(page);
          batchFallbackPages.add(page);
        }
      }
      processedBatches = totalBatches;
      await emitGenerateProgress(hooks, {
        stage: 'generating',
        percent: computeGenerateProgressPercent(processedBatches, totalBatches),
        processedBatches,
        totalBatches,
      });
      break;
    }

    const batchPages = batchContexts.map((item) => item.page);
    const batchPageSet = new Set<number>(batchPages);
    const batchBaseSlides = baseSlides.filter((slide) => slide.type === 'content' && batchPageSet.has(slide.page));
    const batchContextByPage = buildEvidenceContextMap(batchContexts);
    const prompt = buildGenerateContentPrompt(frameworkPlan, batchContexts, truncatedText, false);
    const compactPrompt = buildGenerateContentPrompt(frameworkPlan, batchContexts, truncatedText, true);
    let batchParsed: GeneratedContentPayload;

    try {
      let raw: unknown;
      try {
        raw = await callGeminiJsonWithRetry(options, contentModel, prompt);
      } catch (error) {
        if (error instanceof Error && error.message === 'missing_api_key') {
          throw error;
        }
        try {
          raw = await callGeminiJsonWithRetry(options, contentModel, compactPrompt);
        } catch (compactError) {
          if (compactError instanceof Error && compactError.message === 'missing_api_key') {
            throw compactError;
          }
          const primaryMessage = error instanceof Error ? error.message : 'unknown_primary_error';
          const compactMessage = compactError instanceof Error ? compactError.message : 'unknown_compact_error';
          throw new Error(`content_generation_chain_failed:primary=${primaryMessage};compact=${compactMessage}`);
        }
      }
      batchParsed = parseGeneratedContent(raw);
      if (batchParsed.slides?.length) {
        batchParsed.slides = batchParsed.slides.filter(
          (item) => typeof item.page === 'number' && batchPageSet.has(item.page),
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'missing_api_key') {
        throw error;
      }
      degradeReasons.add('batch_generation_failed');
      addPages(diagnostics.initialMissingPages, batchPages);
      const autoCompleted = autoCompleteMissingPages(parsed, batchPageSet, batchContextByPage);
      addPages(diagnostics.autoCompletedPages, autoCompleted);
      const unresolved = collectMissingContentPages(parsed, batchBaseSlides);
      addPages(diagnostics.finalMissingPages, unresolved);
      for (const page of batchPages) {
        weakGroundingPages.add(page);
        batchFallbackPages.add(page);
      }
      processedBatches = Math.min(totalBatches, processedBatches + 1);
      await emitGenerateProgress(hooks, {
        stage: 'generating',
        percent: computeGenerateProgressPercent(processedBatches, totalBatches),
        processedBatches,
        totalBatches,
      });
      continue;
    }

    applyEvidenceSourceDefaults(batchParsed, batchContextByPage);
    const initialMissingPages = collectMissingContentPages(batchParsed, batchBaseSlides);
    addPages(diagnostics.initialMissingPages, initialMissingPages);

    if (initialMissingPages.size > 0) {
      const missingContexts = batchContexts.filter((item) => initialMissingPages.has(item.page));
      if (missingContexts.length > 0) {
        try {
          const rewritePrompt = buildRewriteContentPrompt(missingContexts, batchParsed.slides ?? []);
          const rewriteRaw = await callGeminiJsonWithRetry(options, contentModel, rewritePrompt);
          const rewriteParsed = parseGeneratedContent(rewriteRaw);
          if (rewriteParsed.slides?.length) {
            rewriteParsed.slides = rewriteParsed.slides.filter(
              (item) => typeof item.page === 'number' && batchPageSet.has(item.page),
            );
          }
          mergeGeneratedSlideUpdates(batchParsed, rewriteParsed);
          applyEvidenceSourceDefaults(batchParsed, batchContextByPage);
        } catch (error) {
          if (error instanceof Error && error.message === 'missing_api_key') {
            throw error;
          }
        }
      }
    }

    const missingAfterRewrite = collectMissingContentPages(batchParsed, batchBaseSlides);
    for (const page of initialMissingPages) {
      if (!missingAfterRewrite.has(page)) {
        diagnostics.rewriteRecoveredPages.add(page);
      }
    }

    if (missingAfterRewrite.size > 0) {
      const autoCompleted = autoCompleteMissingPages(batchParsed, missingAfterRewrite, batchContextByPage);
      addPages(diagnostics.autoCompletedPages, autoCompleted);
      for (const page of autoCompleted) {
        weakGroundingPages.add(page);
      }
    }

    const finalMissingPages = collectMissingContentPages(batchParsed, batchBaseSlides);
    addPages(diagnostics.finalMissingPages, finalMissingPages);
    for (const page of finalMissingPages) {
      weakGroundingPages.add(page);
    }

    mergeGeneratedSlideUpdates(parsed, batchParsed);
    processedBatches = Math.min(totalBatches, processedBatches + 1);
    await emitGenerateProgress(hooks, {
      stage: 'generating',
      percent: computeGenerateProgressPercent(processedBatches, totalBatches),
      processedBatches,
      totalBatches,
    });
  }

  if (batches.length === 0) {
    processedBatches = totalBatches;
  }

  await emitGenerateProgress(hooks, {
    stage: 'finalizing',
    percent: 98,
    processedBatches: Math.min(totalBatches, Math.max(0, processedBatches)),
    totalBatches,
  });

  const generationMeta: AnalyzerResult['generationMeta'] = degradeReasons.size
    ? {
        mode: 'degraded',
        reason: Array.from(degradeReasons).join(';'),
      }
    : {
        mode: 'normal',
      };

  const sortedPages = (pages: Set<number>): number[] => Array.from(pages).sort((a, b) => a - b);
  console.info(
    '[generate-content][completeness]',
    JSON.stringify({
      jobId: hooks.jobId ?? 'sync',
      totalContentPages: diagnostics.totalContentPages,
      initialMissingPages: diagnostics.initialMissingPages.size,
      rewriteRecoveredPages: diagnostics.rewriteRecoveredPages.size,
      autoCompletedPages: diagnostics.autoCompletedPages.size,
      finalMissingPages: diagnostics.finalMissingPages.size,
      initialMissingPageList: sortedPages(diagnostics.initialMissingPages),
      rewriteRecoveredPageList: sortedPages(diagnostics.rewriteRecoveredPages),
      autoCompletedPageList: sortedPages(diagnostics.autoCompletedPages),
      finalMissingPageList: sortedPages(diagnostics.finalMissingPages),
      degradeReasons: Array.from(degradeReasons),
      durationMs: Date.now() - startedAt,
    }),
  );

  return composeAnalyzerResult(
    frameworkPlan,
    parsed,
    sourceFilename,
    weakGroundingPages,
    batchFallbackPages,
    baseSlides,
    generationMeta,
  );
}

export function buildDegradedAnalyzerFromRequest(
  reqBody: GenerateContentRequestBody,
  reason: string,
): AnalyzerResult | null {
  if (!isFrameworkPlan(reqBody.frameworkPlan)) {
    return null;
  }

  const sourceFilename = normalizeOptionalText(reqBody.sourceFilename);
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  const baseSlides = buildSlidePlanFromFramework(reqBody.frameworkPlan, {
    textContent,
    sourceFilename,
  });
  const contentPages = baseSlides.filter((slide) => slide.type === 'content').map((slide) => slide.page);
  const truncatedText = truncateText(textContent, MAX_CONTENT_TEXT_LENGTH);
  const evidenceContexts = buildSlideEvidenceContexts(reqBody.frameworkPlan, baseSlides, truncatedText);
  const evidenceContextByPage = buildEvidenceContextMap(evidenceContexts);
  const degradedPayload: GeneratedContentPayload = { slides: [] };
  const fallbackPages = new Set<number>(contentPages);
  const weakGroundingPages = autoCompleteMissingPages(degradedPayload, fallbackPages, evidenceContextByPage);
  for (const page of fallbackPages) {
    weakGroundingPages.add(page);
  }

  return composeAnalyzerResult(
    reqBody.frameworkPlan,
    degradedPayload,
    sourceFilename,
    weakGroundingPages,
    fallbackPages,
    baseSlides,
    {
      mode: 'degraded',
      reason: `request_level_fallback:${truncateText(reason, 220)}`,
    },
  );
}

export function validateGenerateContentRequestInput(options: GeminiOptions, reqBody: GenerateContentRequestBody): void {
  if (!isFrameworkPlan(reqBody.frameworkPlan)) {
    throw new Error('invalid_framework_plan');
  }
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  if (!textContent) {
    throw new Error('missing_text_content');
  }
  if (!getApiKey(options)) {
    throw new Error('missing_api_key');
  }
}
