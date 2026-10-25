// Content generation driver: splits the content pages into batches of 4, runs each batch through the injected
// runner and composes the AnalyzerResult. Pure code with no Gemini access, so the browser can drive the batches
// (each batch is one short Worker request) while tests run them in-process.
import type { AnalyzerResult } from '../contracts/analyzer';
import { isFrameworkPlan } from '../shared/planValues';
import { cleanText, normalizeOptionalText, truncateText } from '../shared/text';
import { autoCompleteMissingPages, chunkArray, collectMissingContentPages, mergeGeneratedSlideUpdates } from './completion';
import { composeAnalyzerResult } from './compose';
import { CONTENT_BATCH_SIZE, CONTENT_SOFT_DEADLINE_GUARD_MS, CONTENT_SOFT_DEADLINE_MS, MAX_CONTENT_TEXT_LENGTH } from './constants';
import { buildEvidenceContextMap, buildSlideEvidenceContexts } from './evidence';
import { buildDocumentExcerpts } from './prompts';
import { buildSlidePlanFromFramework } from './slidePlan';
import type {
  ContentBatchRunner,
  GenerateContentProgressUpdate,
  GenerateContentRequestBody,
  GenerateContentRuntimeHooks,
  GeneratedContentPayload,
} from './types';

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

/**
 * Generates the slide content for a framework. Throws `invalid_framework_plan` / `missing_text_content` for bad input,
 * and rethrows whatever the runner throws (for example `missing_api_key` or a network error); a batch whose Gemini
 * calls all failed comes back with `ok: false` and makes the result degraded instead.
 */
export async function generateContent(
  reqBody: GenerateContentRequestBody,
  runBatch: ContentBatchRunner,
  hooks: GenerateContentRuntimeHooks = {},
): Promise<AnalyzerResult> {
  if (!isFrameworkPlan(reqBody.frameworkPlan)) {
    throw new Error('invalid_framework_plan');
  }
  const textContent = typeof reqBody.textContent === 'string' ? cleanText(reqBody.textContent) : '';
  if (!textContent) {
    throw new Error('missing_text_content');
  }

  const now = hooks.now ?? (() => Date.now());
  const frameworkPlan = reqBody.frameworkPlan;
  const sourceFilename = normalizeOptionalText(reqBody.sourceFilename);
  const baseSlides = buildSlidePlanFromFramework(frameworkPlan, {
    textContent,
    sourceFilename,
  });
  const truncatedText = truncateText(textContent, MAX_CONTENT_TEXT_LENGTH);
  const evidenceContexts = buildSlideEvidenceContexts(frameworkPlan, baseSlides, truncatedText);
  const evidenceContextByPage = buildEvidenceContextMap(evidenceContexts);
  const excerpts = buildDocumentExcerpts(truncatedText);
  const parsed: GeneratedContentPayload = { slides: [] };
  const weakGroundingPages = new Set<number>();
  const batchFallbackPages = new Set<number>();
  const degradeReasons = new Set<string>();
  const startedAt = now();
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
  const reportBatchDone = () =>
    emitGenerateProgress(hooks, {
      stage: 'generating',
      percent: computeGenerateProgressPercent(processedBatches, totalBatches),
      processedBatches,
      totalBatches,
    });

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
      await reportBatchDone();
      continue;
    }

    if (now() + CONTENT_SOFT_DEADLINE_GUARD_MS >= deadlineAt) {
      degradeReasons.add('soft_deadline_reached');
      for (let restIndex = batchIndex; restIndex < batches.length; restIndex += 1) {
        const restPages = batches[restIndex].map((item) => item.page);
        if (!restPages.length) {
          continue;
        }
        const restPageSet = new Set(restPages);
        const restBaseSlides = baseSlides.filter((slide) => slide.type === 'content' && restPageSet.has(slide.page));
        addPages(diagnostics.initialMissingPages, restPages);
        addPages(diagnostics.autoCompletedPages, autoCompleteMissingPages(parsed, restPageSet, evidenceContextByPage));
        addPages(diagnostics.finalMissingPages, collectMissingContentPages(parsed, restBaseSlides));
        addPages(weakGroundingPages, restPages);
        addPages(batchFallbackPages, restPages);
      }
      processedBatches = totalBatches;
      await reportBatchDone();
      break;
    }

    const result = await runBatch({ presetId: frameworkPlan.presetId, contexts: batchContexts, excerpts });
    if (!result.ok) {
      degradeReasons.add('batch_generation_failed');
    }
    mergeGeneratedSlideUpdates(parsed, { slides: result.slides });
    addPages(weakGroundingPages, result.weakPages);
    addPages(batchFallbackPages, result.fallbackPages);
    addPages(diagnostics.initialMissingPages, result.diagnostics.initialMissingPages);
    addPages(diagnostics.rewriteRecoveredPages, result.diagnostics.rewriteRecoveredPages);
    addPages(diagnostics.autoCompletedPages, result.diagnostics.autoCompletedPages);
    addPages(diagnostics.finalMissingPages, result.diagnostics.finalMissingPages);
    processedBatches = Math.min(totalBatches, processedBatches + 1);
    await reportBatchDone();
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
      durationMs: now() - startedAt,
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
