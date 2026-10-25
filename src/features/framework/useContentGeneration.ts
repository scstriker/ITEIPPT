// Drives content generation from the browser: the shared orchestrator splits the content pages into batches of 4
// and sends each batch to POST /api/generate-content/batch (one short Worker request per batch).
import { useEffect, useRef, useState } from 'react';
import type { AnalyzerResult } from '@contracts/analyzer';
import type { FrameworkPlan } from '@contracts/framework';
import { generateContent } from '@worker/content/orchestrate';
import type { GenerateContentProgressUpdate } from '@worker/content/types';
import type { ParsedDocument } from '../../services/document/documentParser';
import { createHttpBatchRunner, mapGenerateContentError } from '../../services/api/contentApi';
import { validatePlanBeforeGenerate } from './frameworkEditing';

/** Stage text and percent shown next to the progress bar for an orchestrator progress update. */
export function describeGenerationProgress(update: GenerateContentProgressUpdate): { stage: string; percent: number } {
  const percent = Math.max(1, Math.min(99, Math.round(update.percent)));
  const total = Math.max(1, update.totalBatches);
  if (update.stage === 'finalizing' || (update.stage === 'generating' && update.processedBatches >= total)) {
    return { stage: '正在整理结果', percent };
  }
  const current = update.stage === 'preparing' ? 1 : Math.min(total, update.processedBatches + 1);
  return { stage: `正在生成内容（批次 ${current}/${total}）`, percent };
}

function friendlyError(error: unknown): string {
  if (error instanceof Error && error.message === 'invalid_framework_plan') {
    return '框架数据无效，请返回 Step 2 重新确认章节结构。';
  }
  if (error instanceof Error && error.message === 'missing_text_content') {
    return '文档正文为空，请先在 Step 1 上传并解析文档。';
  }
  return mapGenerateContentError(error);
}

interface UseContentGenerationOptions {
  parsedDocument: ParsedDocument | null;
  plan: FrameworkPlan;
  onGenerated?: (result: AnalyzerResult) => void;
}

export function useContentGeneration({ parsedDocument, plan, onGenerated }: UseContentGenerationOptions) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genPercent, setGenPercent] = useState(0);
  const [genServerStage, setGenServerStage] = useState<string | null>(null);
  const [showRetryGenerate, setShowRetryGenerate] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    // Reset on (re)mount: React StrictMode runs effects twice in development (PRD Q-9).
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

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

    const controller = new AbortController();
    abortRef.current = controller;
    setGenError(null);
    setShowRetryGenerate(false);
    setGenPercent(2);
    setGenServerStage('正在准备任务');
    setIsGenerating(true);

    try {
      const result = await generateContent(
        { frameworkPlan: plan, textContent: parsedDocument.textContent, sourceFilename: parsedDocument.filename },
        createHttpBatchRunner(controller.signal),
        {
          onProgress: (update) => {
            if (unmountedRef.current) {
              return;
            }
            const { stage, percent } = describeGenerationProgress(update);
            setGenServerStage(stage);
            setGenPercent(percent);
          },
        },
      );
      if (unmountedRef.current) {
        return;
      }
      setGenPercent(100);
      setGenServerStage('已完成，结果已就绪');
      onGenerated(result);
    } catch (error) {
      if (unmountedRef.current) {
        return;
      }
      setGenError(friendlyError(error));
      setShowRetryGenerate(true);
      setGenPercent(0);
      setGenServerStage(null);
    } finally {
      abortRef.current = null;
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
    showRetryGenerate,
    runGenerate,
  };
}
