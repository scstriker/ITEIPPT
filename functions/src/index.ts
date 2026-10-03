import express from 'express';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { GeminiOptions } from './gemini/client';
import { createApiApp } from './http/app';
import { firestoreJobStore } from './jobs/firestoreJobStore';
import { GENERATION_JOB_TOPIC, createPubSubJobRunner } from './jobs/runners';
import { parseJobIdFromPubSubMessage, processGenerationJob } from './jobs/worker';

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const sharedGeminiOptions: GeminiOptions = {
  geminiBaseUrl: process.env.GEMINI_BASE_URL,
  geminiPlanModel: process.env.GEMINI_PLAN_MODEL,
  geminiContentModel: process.env.GEMINI_CONTENT_MODEL,
};

function hydrateGeminiSecret(): void {
  try {
    const key = GEMINI_API_KEY.value()?.trim();
    if (key) {
      process.env.GEMINI_API_KEY = key;
    }
  } catch {
    // Secret may be unavailable in non-runtime contexts.
  }
}

const upstreamApp = createApiApp({
  gemini: sharedGeminiOptions,
  jobStore: firestoreJobStore,
  jobRunner: createPubSubJobRunner(),
});
const app = express();

app.use((_req, _res, next) => {
  hydrateGeminiSecret();
  next();
});

app.use(upstreamApp);

export const api = onRequest(
  {
    region: 'asia-east1',
    timeoutSeconds: 600,
    memory: '512MiB',
    secrets: [GEMINI_API_KEY],
  },
  app,
);

export const generationJobWorker = onMessagePublished(
  {
    region: 'asia-east1',
    topic: GENERATION_JOB_TOPIC,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [GEMINI_API_KEY],
  },
  async (event) => {
    hydrateGeminiSecret();
    const jobId = parseJobIdFromPubSubMessage(event.data);
    if (!jobId) {
      logger.warn('Skip generation job message without valid jobId.');
      return;
    }
    await processGenerationJob(jobId, { store: firestoreJobStore, gemini: sharedGeminiOptions });
  },
);

export const generationJobCleanup = onSchedule(
  {
    region: 'asia-east1',
    schedule: 'every 24 hours',
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async () => {
    const result = await firestoreJobStore.cleanupExpired();
    logger.info('Generation job cleanup finished.', result);
  },
);
