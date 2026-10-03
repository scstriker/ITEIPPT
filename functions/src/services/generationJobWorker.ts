import type { ApiProxyOptions, GenerateContentProgressUpdate, GenerateContentRequestBody } from './apiProxyServer';
import { generateContentWithGemini } from './apiProxyServer';
import {
  getGenerationJob,
  markGenerationJobFailed,
  markGenerationJobRunning,
  markGenerationJobSucceeded,
  readGenerationJobRequest,
  updateGenerationJobProgress,
  writeGenerationJobResult,
} from './generationJobStore';
import type { GenerationJobError, GenerationJobProgress } from '../types/analyzer';

const STALE_RUNNING_WINDOW_MS = 10 * 60 * 1000;

function mapProgressStage(update: GenerateContentProgressUpdate): string {
  if (update.stage === 'preparing') {
    return '正在准备任务';
  }
  if (update.stage === 'finalizing') {
    return '正在整理结果';
  }
  return `正在生成内容（批次 ${Math.max(1, update.processedBatches)}/${Math.max(1, update.totalBatches)}）`;
}

function toJobProgress(update: GenerateContentProgressUpdate): GenerationJobProgress {
  return {
    percent: update.percent,
    stage: mapProgressStage(update),
    processedBatches: update.processedBatches,
    totalBatches: update.totalBatches,
  };
}

function classifyJobError(error: unknown): GenerationJobError {
  if (!(error instanceof Error)) {
    return {
      code: 'unknown_error',
      message: '任务执行失败。',
      details: 'Unknown error object',
    };
  }

  const message = error.message || 'unknown_error';
  if (message === 'missing_api_key') {
    return {
      code: 'missing_api_key',
      message: '服务端未配置 GEMINI_API_KEY。',
    };
  }
  if (message === 'invalid_framework_plan') {
    return {
      code: 'invalid_framework_plan',
      message: '框架数据无效。',
    };
  }
  if (message === 'missing_text_content') {
    return {
      code: 'missing_text_content',
      message: '文档正文为空，无法生成内容。',
    };
  }
  if (message.startsWith('gemini_upstream_error:')) {
    return {
      code: 'gemini_upstream_error',
      message: 'Gemini 上游服务调用失败。',
      details: message.slice(0, 320),
    };
  }
  if (message.startsWith('gemini_invalid_json:') || message.startsWith('gemini_upstream_invalid_json:')) {
    return {
      code: 'gemini_invalid_json',
      message: 'Gemini 返回数据格式异常。',
      details: message.slice(0, 320),
    };
  }
  return {
    code: 'generation_job_failed',
    message: '内容生成任务执行失败。',
    details: message.slice(0, 320),
  };
}

function isJobId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function processGenerationJob(jobId: string, options: ApiProxyOptions = {}): Promise<void> {
  const normalizedJobId = jobId.trim();
  if (!normalizedJobId) {
    return;
  }

  const job = await getGenerationJob(normalizedJobId);
  if (!job) {
    return;
  }

  if (job.status === 'succeeded' || job.status === 'failed') {
    return;
  }

  if (job.status === 'running' && Date.now() - job.updatedAt.getTime() < STALE_RUNNING_WINDOW_MS) {
    return;
  }

  await markGenerationJobRunning(normalizedJobId, job.progress.totalBatches);

  let requestPayload: GenerateContentRequestBody;
  try {
    requestPayload = (await readGenerationJobRequest(job.requestStoragePath)) as GenerateContentRequestBody;
  } catch (error) {
    await markGenerationJobFailed(normalizedJobId, classifyJobError(error));
    return;
  }

  try {
    const result = await generateContentWithGemini(options, requestPayload, {
      jobId: normalizedJobId,
      onProgress: async (update) => {
        await updateGenerationJobProgress(normalizedJobId, toJobProgress(update));
      },
    });
    const resultStoragePath = await writeGenerationJobResult(normalizedJobId, result);
    await markGenerationJobSucceeded(normalizedJobId, resultStoragePath, result.generationMeta);
  } catch (error) {
    await markGenerationJobFailed(normalizedJobId, classifyJobError(error));
  }
}

export function parseJobIdFromPubSubMessage(eventData: unknown): string | null {
  if (!eventData || typeof eventData !== 'object') {
    return null;
  }

  const candidate = eventData as {
    message?: {
      json?: unknown;
      data?: string;
    };
  };

  if (candidate.message?.json && typeof candidate.message.json === 'object') {
    const maybeJson = candidate.message.json as { jobId?: unknown };
    if (isJobId(maybeJson.jobId)) {
      return maybeJson.jobId.trim();
    }
  }

  const data = candidate.message?.data;
  if (typeof data === 'string' && data.length > 0) {
    try {
      const decoded = Buffer.from(data, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded) as { jobId?: unknown };
      if (isJobId(parsed.jobId)) {
        return parsed.jobId.trim();
      }
    } catch {
      return null;
    }
  }

  return null;
}
