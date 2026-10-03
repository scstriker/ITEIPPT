import { PubSub } from '@google-cloud/pubsub';
import type { GeminiOptions } from '../gemini/client';
import type { JobRunner, JobStore } from './types';
import { processGenerationJob } from './worker';

export const GENERATION_JOB_TOPIC =
  (process.env.GENERATION_JOB_TOPIC ?? 'iteippt-generation-content-jobs').trim() || 'iteippt-generation-content-jobs';

/** Production: publish the job id; the Pub/Sub-triggered function `generationJobWorker` runs it. */
export function createPubSubJobRunner(pubsub: PubSub = new PubSub()): JobRunner {
  return {
    async enqueue(jobId) {
      await pubsub.topic(GENERATION_JOB_TOPIC).publishMessage({ json: { jobId } });
    },
  };
}

export interface InlineJobRunner extends JobRunner {
  /** Resolves when every job started so far has finished. */
  drain(): Promise<void>;
}

/** Local development: run the worker in this process right after the request returns. */
export function createInlineJobRunner(store: JobStore, gemini: GeminiOptions = {}): InlineJobRunner {
  const running = new Set<Promise<void>>();
  return {
    async enqueue(jobId) {
      const run = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => processGenerationJob(jobId, { store, gemini }))
        .catch((error: unknown) => {
          // processGenerationJob records failures on the job; this only guards unexpected store errors.
          console.error('[local-jobs] worker crashed', error);
        })
        .finally(() => running.delete(run));
      running.add(run);
    },
    async drain() {
      while (running.size) {
        await Promise.all([...running]);
      }
    },
  };
}
