import { chunkArray } from '../../src/content/completion';
import { CONTENT_BATCH_SIZE } from '../../src/content/constants';
import { buildSlideEvidenceContexts } from '../../src/content/evidence';
import { buildDocumentExcerpts } from '../../src/content/prompts';
import { buildSlidePlanFromFramework } from '../../src/content/slidePlan';
import type { ContentBatchRequest } from '../../src/content/types';
import type { FrameworkPlan } from '../../src/contracts/framework';

/** The request the browser sends for batch `batchIndex` of a framework (same steps as content/orchestrate.ts). */
export function batchRequestFor(plan: FrameworkPlan, text: string, batchIndex: number): ContentBatchRequest {
  const baseSlides = buildSlidePlanFromFramework(plan, { textContent: text });
  const contexts = buildSlideEvidenceContexts(plan, baseSlides, text);
  return {
    presetId: plan.presetId,
    contexts: chunkArray(contexts, CONTENT_BATCH_SIZE)[batchIndex],
    excerpts: buildDocumentExcerpts(text),
  };
}
