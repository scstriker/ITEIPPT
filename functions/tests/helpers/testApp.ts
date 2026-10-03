import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { GeminiOptions } from '../../src/gemini/client';
import { createApiApp } from '../../src/http/app';
import { MemoryJobStore } from '../../src/jobs/memoryJobStore';
import { createInlineJobRunner, type InlineJobRunner } from '../../src/jobs/runners';
import type { JobRunner } from '../../src/jobs/types';

export interface RunningApp {
  baseUrl: string;
  store: MemoryJobStore;
  runner: InlineJobRunner;
  /** When false, created jobs stay queued until runQueued() is called. */
  setAutoRun: (value: boolean) => void;
  close: () => Promise<void>;
}

// Builds the HTTP app with the local (in-memory, in-process) job wiring and serves it on a random port.
export async function startTestApp(gemini: GeminiOptions = {}): Promise<RunningApp> {
  let nextId = 1;
  const store = new MemoryJobStore(() => `job-${String(nextId++).padStart(4, '0')}`);
  const runner = createInlineJobRunner(store, gemini);
  let autoRun = true;
  const gatedRunner: JobRunner = {
    enqueue: (jobId) => (autoRun ? runner.enqueue(jobId) : Promise.resolve()),
  };
  const app = createApiApp({ gemini, jobStore: store, jobRunner: gatedRunner });
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    store,
    runner,
    setAutoRun: (value) => {
      autoRun = value;
    },
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export async function postJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

export async function getJson(url: string): Promise<{ status: number; json: any }> {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
