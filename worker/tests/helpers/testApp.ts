import { serveFetchHandler } from '../../src/dev/nodeServer';
import type { AccessVerifier } from '../../src/http/access';
import { createApiHandler } from '../../src/http/app';
import type { GeminiOptions } from '../../src/gemini/client';

export interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

// Serves the API handler on a random local port, the way the dev server does.
export async function startTestApp(gemini: GeminiOptions = {}, verifyAccess: AccessVerifier | null = null): Promise<RunningApp> {
  return serveFetchHandler(createApiHandler({ gemini, verifyAccess }), 0);
}

export async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

export async function getJson(url: string): Promise<{ status: number; json: any }> {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
