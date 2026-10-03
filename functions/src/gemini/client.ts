import { isRecord } from '../shared/text';

export interface GeminiOptions {
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiPlanModel?: string;
  geminiContentModel?: string;
}

export const RETRIABLE_GEMINI_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export const CONTENT_CALL_RETRY_MAX_ATTEMPTS = 2;

export function getBaseUrl(options: GeminiOptions): string {
  return (options.geminiBaseUrl ?? process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta')
    .replace(/\/+$/, '');
}

export function getApiKey(options: GeminiOptions): string | undefined {
  const key = options.geminiApiKey ?? process.env.GEMINI_API_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : undefined;
}

export function getPlanModel(options: GeminiOptions): string {
  const model = options.geminiPlanModel ?? process.env.GEMINI_PLAN_MODEL ?? 'gemini-2.5-flash';
  return model.trim();
}

export function getContentModel(options: GeminiOptions): string {
  const model = options.geminiContentModel ?? process.env.GEMINI_CONTENT_MODEL ?? 'gemini-2.5-flash';
  return model.trim();
}

export function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

export function parseGeminiUpstreamError(message: string): { status: number; details: string } | null {
  const match = /^gemini_upstream_error:(\d+):(.*)$/s.exec(message);
  if (!match) {
    return null;
  }
  const status = Number(match[1]);
  if (!Number.isFinite(status)) {
    return null;
  }
  return {
    status,
    details: match[2],
  };
}

export function extractJsonCandidate(raw: string): string | null {
  const starts = [raw.indexOf('{'), raw.indexOf('[')].filter((index) => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        stack.push('}');
        continue;
      }
      if (char === '[') {
        stack.push(']');
        continue;
      }
      if (char !== '}' && char !== ']') {
        continue;
      }
      const expected = stack.pop();
      if (!expected || expected !== char) {
        break;
      }
      if (stack.length === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function parseJsonFromGeminiText(rawText: string): unknown {
  const normalized = stripJsonFence(rawText);
  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    const candidate = extractJsonCandidate(normalized);
    if (candidate) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // ignore candidate parse failure and throw unified error below
      }
    }
    const message = error instanceof Error ? error.message : 'unknown_json_parse_error';
    throw new Error(`gemini_invalid_json:${message}`);
  }
}

export function parseGeminiPayloadFromText(rawText: string): unknown {
  const normalized = rawText.trim();
  if (!normalized) {
    return {};
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    const candidate = extractJsonCandidate(normalized);
    if (candidate) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // ignore and throw unified error below
      }
    }
    const message = error instanceof Error ? error.message : 'unknown_upstream_json_parse_error';
    throw new Error(`gemini_upstream_invalid_json:${message}`);
  }
}

export function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error('Invalid Gemini response payload.');
  }
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Gemini response does not include candidates.');
  }
  const first = candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    throw new Error('Gemini candidate content is invalid.');
  }
  const part = first.content.parts.find((item: unknown) => isRecord(item) && typeof item.text === 'string');
  if (!part || typeof part.text !== 'string') {
    throw new Error('Gemini candidate text is empty.');
  }
  return part.text;
}

export async function callGeminiJson(options: GeminiOptions, model: string, prompt: string): Promise<unknown> {
  const apiKey = getApiKey(options);
  if (!apiKey) {
    throw new Error('missing_api_key');
  }

  const url = new URL(`${getBaseUrl(options)}/models/${encodeURIComponent(model)}:generateContent`);
  url.searchParams.set('key', apiKey);

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`gemini_upstream_error:${upstream.status}:${text}`);
  }

  const geminiPayload = parseGeminiPayloadFromText(text);
  const outputText = extractGeminiText(geminiPayload);
  return parseJsonFromGeminiText(outputText);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isGeminiInvalidJsonError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('gemini_invalid_json:') || error.message.startsWith('gemini_upstream_invalid_json:'))
  );
}

export function isRetriableGeminiError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const upstream = parseGeminiUpstreamError(error.message);
  if (!upstream) {
    return false;
  }
  return RETRIABLE_GEMINI_STATUS_CODES.has(upstream.status);
}

export async function callGeminiJsonWithRetry(options: GeminiOptions, model: string, prompt: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CONTENT_CALL_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callGeminiJson(options, model, prompt);
    } catch (error) {
      if (error instanceof Error && error.message === 'missing_api_key') {
        throw error;
      }
      lastError = error;
      const canRetry = isRetriableGeminiError(error) || isGeminiInvalidJsonError(error);
      if (!canRetry || attempt >= CONTENT_CALL_RETRY_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(300 * attempt);
    }
  }
  throw (lastError instanceof Error ? lastError : new Error('gemini_call_failed'));
}
