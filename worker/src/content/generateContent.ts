// In-process content generation (batches call Gemini directly). The browser drives the same orchestrator over HTTP.
import type { AnalyzerResult } from '../contracts/analyzer';
import type { GeminiOptions } from '../gemini/client';
import { runContentBatch } from './batch';
import { generateContent } from './orchestrate';
import type { GenerateContentRequestBody, GenerateContentRuntimeHooks } from './types';

export async function generateContentWithGemini(
  options: GeminiOptions,
  reqBody: GenerateContentRequestBody,
  hooks: GenerateContentRuntimeHooks = {},
): Promise<AnalyzerResult> {
  return generateContent(reqBody, (request) => runContentBatch(options, request), hooks);
}
