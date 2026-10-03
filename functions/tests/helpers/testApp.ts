import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiProxyApp, type ApiProxyOptions } from '../../src/services/apiProxyServer';

export interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

// Builds the HTTP app the way production does and serves it on a random port.
export async function startTestApp(options: ApiProxyOptions = {}): Promise<RunningApp> {
  const app = createApiProxyApp(options);
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
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
