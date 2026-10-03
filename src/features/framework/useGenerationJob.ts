// Submit, poll and resume the async content-generation job of the "规划框架" step.
import { useEffect, useRef, useState } from 'react';
import type { AnalyzerResult } from '@contracts/analyzer';
import type { FrameworkPlan } from '@contracts/framework';
import type { ParsedDocument } from '../../services/document/documentParser';
import {
  ContentApiError,
  mapGenerateContentError,
  requestCreateGenerateContentJob,
  requestGenerateContentJobResult,
  requestGenerateContentJobStatus,
} from '../../services/api/contentApi';
import { buildFrameworkDigest } from '../../workflow/workflowReducer';
import { validatePlanBeforeGenerate } from './frameworkEditing';

export const ACTIVE_GENERATION_JOB_KEY = 'itei_step2_active_generation_job';
export const GENERATION_JOB_POLL_INTERVAL_MS = 2000;
export const GENERATION_JOB_POLL_TIMEOUT_MS = 20 * 60 * 1000;

export interface StoredGenerationJobState {
  jobId: string;
  planDigest: string;
  savedAt: string;
}

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

export function readStoredGenerationJob(store: Storage | null = storage()): StoredGenerationJobState | null {
  const raw = store?.getItem(ACTIVE_GENERATION_JOB_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGenerationJobState>;
    if (typeof parsed.jobId !== 'string' || !parsed.jobId.trim()) {
      return null;
    }
    if (typeof parsed.planDigest !== 'string' || !parsed.planDigest.trim()) {
      return null;
    }
    return {
      jobId: parsed.jobId.trim(),
      planDigest: parsed.planDigest,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeStoredGenerationJob(job: StoredGenerationJobState, store: Storage | null = storage()): void {
  store?.setItem(ACTIVE_GENERATION_JOB_KEY, JSON.stringify(job));
}

export function clearStoredGenerationJob(store: Storage | null = storage()): void {
  store?.removeItem(ACTIVE_GENERATION_JOB_KEY);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface UseGenerationJobOptions {
  parsedDocument: ParsedDocument | null;
  plan: FrameworkPlan;
  onGenerated?: (result: AnalyzerResult) => void;
}

export function useGenerationJob({ parsedDocument, plan, onGenerated }: UseGenerationJobOptions) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genPercent, setGenPercent] = useState(0);
  const [genServerStage, setGenServerStage] = useState<string | null>(null);
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const [showRetryGenerate, setShowRetryGenerate] = useState(false);

  const resumeCheckedRef = useRef(false);
  const unmountedRef = useRef(false);
  const planDigest = buildFrameworkDigest(plan);

  useEffect(() => {
    // Reset on (re)mount: React StrictMode runs effects twice in development (PRD Q-9).
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const pollGenerationJob = async (jobId: string): Promise<void> => {
    const startedAt = Date.now();

    while (true) {
      const status = await requestGenerateContentJobStatus(jobId);
      if (unmountedRef.current) {
        return;
      }

      setGenJobId(status.jobId);
      setGenServerStage(status.progress.stage || '正在处理任务');
      setGenPercent(Math.max(1, Math.min(99, Math.round(status.progress.percent))));

      if (status.status === 'succeeded') {
        const result = await requestGenerateContentJobResult(jobId);
        if (unmountedRef.current) {
          return;
        }
        setGenPercent(100);
        setGenServerStage('已完成，结果已就绪');
        setGenJobId(null);
        clearStoredGenerationJob();
        onGenerated?.(result);
        return;
      }

      if (status.status === 'failed') {
        clearStoredGenerationJob();
        const details = status.error?.details?.trim();
        const message = status.error?.message?.trim() || '任务执行失败，请点击“重新生成”。';
        throw new ContentApiError(409, status.error?.code ?? 'generation_job_failed', message, details);
      }

      if (Date.now() - startedAt > GENERATION_JOB_POLL_TIMEOUT_MS) {
        clearStoredGenerationJob();
        throw new ContentApiError(408, 'generation_job_timeout', '异步任务等待超时，请点击“重新生成”。');
      }

      await sleep(GENERATION_JOB_POLL_INTERVAL_MS);
    }
  };

  const failWith = (error: unknown) => {
    setGenError(mapGenerateContentError(error));
    setShowRetryGenerate(true);
    setGenPercent(0);
    setGenServerStage(null);
  };

  useEffect(() => {
    if (resumeCheckedRef.current) {
      return;
    }
    resumeCheckedRef.current = true;

    if (!parsedDocument || !onGenerated) {
      return;
    }

    const storedJob = readStoredGenerationJob();
    if (!storedJob) {
      return;
    }

    if (storedJob.planDigest !== planDigest) {
      clearStoredGenerationJob();
      return;
    }

    setIsGenerating(true);
    setShowRetryGenerate(false);
    setGenError(null);
    setGenPercent(2);
    setGenServerStage('正在恢复任务状态');
    setGenJobId(storedJob.jobId);

    void (async () => {
      try {
        await pollGenerationJob(storedJob.jobId);
      } catch (error) {
        if (!unmountedRef.current) {
          failWith(error);
        }
      } finally {
        if (!unmountedRef.current) {
          setIsGenerating(false);
        }
      }
    })();
    // Runs once per mount: resume only what was stored before this step opened.
  }, [onGenerated, parsedDocument, planDigest]);

  const runGenerate = async () => {
    if (!parsedDocument) {
      setGenError('请先在 Step 1 上传并解析文档。');
      return;
    }
    if (!onGenerated) {
      setGenError('当前页面未接入内容生成回调。');
      return;
    }
    const validationError = validatePlanBeforeGenerate(plan);
    if (validationError) {
      setGenError(validationError);
      return;
    }

    setGenError(null);
    setShowRetryGenerate(false);
    setGenPercent(2);
    setGenServerStage('正在创建任务');
    setIsGenerating(true);

    try {
      const created = await requestCreateGenerateContentJob({
        frameworkPlan: plan,
        textContent: parsedDocument.textContent,
        sourceFilename: parsedDocument.filename,
      });

      setGenJobId(created.jobId);
      writeStoredGenerationJob({
        jobId: created.jobId,
        planDigest,
        savedAt: new Date().toISOString(),
      });

      await pollGenerationJob(created.jobId);
    } catch (error) {
      failWith(error);
    } finally {
      if (!unmountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  return {
    isGenerating,
    genError,
    setGenError,
    genPercent,
    genServerStage,
    genJobId,
    showRetryGenerate,
    runGenerate,
  };
}
