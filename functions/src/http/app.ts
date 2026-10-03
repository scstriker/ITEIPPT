import express from 'express';
import type { FrameworkPlan } from '../contracts/framework';
import { buildDegradedAnalyzerFromRequest, generateContentWithGemini, validateGenerateContentRequestInput } from '../content/generateContent';
import type { GenerateContentRequestBody } from '../content/types';
import type { GeminiOptions } from '../gemini/client';
import type { GenerationJobRecord, JobRunner, JobStore } from '../jobs/types';
import type { PlanRequestBody } from '../plan/basePlan';
import { generatePlanWithGemini } from '../plan/generatePlan';
import { cleanText, isRecord, normalizeOptionalText, truncateText } from '../shared/text';
import { writeError, writeGenerateInputError, writePlanInputError } from './errors';

export interface ApiAppDeps {
  gemini?: GeminiOptions;
  jobStore: JobStore;
  jobRunner: JobRunner;
}

function normalizeJobId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function toJobStatusResponse(job: GenerationJobRecord): {
  jobId: string;
  status: GenerationJobRecord['status'];
  progress: GenerationJobRecord['progress'];
  error?: GenerationJobRecord['error'];
  createdAt: string;
  updatedAt: string;
  resultReady: boolean;
} {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    resultReady: Boolean(job.resultStoragePath && job.status === 'succeeded'),
  };
}

export function createApiApp({ gemini = {}, jobStore, jobRunner }: ApiAppDeps): express.Express {
  const app = express();

  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'local-gemini-proxy' });
  });

  app.post('/api/plan', async (req, res) => {
    const body = isRecord(req.body) ? (req.body as PlanRequestBody) : {};

    try {
      const plan = await generatePlanWithGemini(gemini, body);
      res.json(plan);
      return;
    } catch (error) {
      if (writePlanInputError(res, error)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown plan generation error';
      writeError(res, 502, {
        error: {
          code: 'plan_generation_failed',
          message: 'Failed to generate framework plan with Gemini.',
          details: message,
        },
      });
    }
  });

  app.post('/api/generate-content/jobs', async (req, res) => {
    const body = isRecord(req.body) ? (req.body as GenerateContentRequestBody) : {};

    try {
      validateGenerateContentRequestInput(gemini, body);

      const frameworkPlan = body.frameworkPlan as FrameworkPlan;
      const textContent = cleanText(body.textContent as string);
      const sourceFilename = normalizeOptionalText(body.sourceFilename);

      const job = await jobStore.create({
        frameworkPlan,
        textContent,
        sourceFilename,
      });

      try {
        await jobRunner.enqueue(job.id);
      } catch (enqueueError) {
        const details = enqueueError instanceof Error ? enqueueError.message : 'Unknown enqueue error';
        await jobStore.markFailed(job.id, {
          code: 'job_enqueue_failed',
          message: '任务入队失败。',
          details: truncateText(details, 320),
        });
        throw new Error(`job_enqueue_failed:${details}`);
      }

      res.status(202).json({
        jobId: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        pollUrl: `/api/generate-content/jobs/${job.id}`,
        resultUrl: `/api/generate-content/jobs/${job.id}/result`,
      });
    } catch (error) {
      if (writeGenerateInputError(res, error)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown job creation error';
      writeError(res, 502, {
        error: {
          code: 'generation_job_create_failed',
          message: 'Failed to create generation job.',
          details: message,
        },
      });
    }
  });

  app.get('/api/generate-content/jobs/:jobId', async (req, res) => {
    const jobId = normalizeJobId(req.params.jobId);
    if (!jobId) {
      writeError(res, 400, {
        error: {
          code: 'invalid_job_id',
          message: 'jobId is required.',
        },
      });
      return;
    }

    try {
      const job = await jobStore.get(jobId);
      if (!job) {
        writeError(res, 404, {
          error: {
            code: 'generation_job_not_found',
            message: 'Generation job not found.',
          },
        });
        return;
      }
      res.json(toJobStatusResponse(job));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown job lookup error';
      writeError(res, 500, {
        error: {
          code: 'generation_job_status_failed',
          message: 'Failed to query generation job status.',
          details: message,
        },
      });
    }
  });

  app.get('/api/generate-content/jobs/:jobId/result', async (req, res) => {
    const jobId = normalizeJobId(req.params.jobId);
    if (!jobId) {
      writeError(res, 400, {
        error: {
          code: 'invalid_job_id',
          message: 'jobId is required.',
        },
      });
      return;
    }

    try {
      const job = await jobStore.get(jobId);
      if (!job) {
        writeError(res, 404, {
          error: {
            code: 'generation_job_not_found',
            message: 'Generation job not found.',
          },
        });
        return;
      }

      if (job.status !== 'succeeded' || !job.resultStoragePath) {
        writeError(res, 409, {
          error: {
            code: 'job_not_completed',
            message: 'Generation job is not completed.',
          },
        });
        return;
      }

      const result = await jobStore.readResult(job.resultStoragePath);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown result lookup error';
      writeError(res, 500, {
        error: {
          code: 'generation_job_result_failed',
          message: 'Failed to load generation result.',
          details: message,
        },
      });
    }
  });

  app.post('/api/generate-content', async (req, res) => {
    const body = isRecord(req.body) ? (req.body as GenerateContentRequestBody) : {};

    try {
      const result = await generateContentWithGemini(gemini, body);
      res.json(result);
      return;
    } catch (error) {
      if (writeGenerateInputError(res, error)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown content generation error';
      const degraded = buildDegradedAnalyzerFromRequest(body, message);
      if (degraded) {
        res.json(degraded);
        return;
      }
      writeError(res, 502, {
        error: {
          code: 'content_generation_failed',
          message: 'Failed to generate slide content with Gemini.',
          details: message,
        },
      });
    }
  });

  // Anything else under /api is not part of the contract. (The old Gemini passthrough is gone; see docs/SECURITY.md.)
  app.all(['/api', '/api/*'], (_req, res) => {
    writeError(res, 404, {
      error: {
        code: 'not_found',
        message: 'API route not found.',
      },
    });
  });

  return app;
}
