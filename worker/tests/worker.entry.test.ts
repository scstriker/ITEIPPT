// Cloudflare Worker entry: static assets pass through, the API fails closed without Access configuration.
import { describe, expect, it, vi } from 'vitest';

import worker, { type Env } from '../src/index';

function env(overrides: Partial<Env> = {}): Env {
  return {
    GEMINI_API_KEY: 'secret-key',
    ASSETS: { fetch: vi.fn(async () => new Response('<html></html>', { status: 200 })) },
    ...overrides,
  };
}

describe('worker entry', () => {
  it('serves non-API paths from the static assets', async () => {
    const bindings = env();
    const res = await worker.fetch(new Request('https://slides.example/framework'), bindings);
    expect(res.status).toBe(200);
    expect(bindings.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses API calls when Access is not configured', async () => {
    const res = await worker.fetch(
      new Request('https://slides.example/api/plan', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
      env(),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('access_not_configured');
  });

  it('refuses API calls without an Access token once Access is configured', async () => {
    const res = await worker.fetch(
      new Request('https://slides.example/api/generate-content/batch', { method: 'POST', body: '{}' }),
      env({ ACCESS_TEAM_DOMAIN: 'https://itei-example.cloudflareaccess.com', ACCESS_AUD: 'aud' }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('access_denied');
  });

  it('answers /api/health without touching Gemini or Access', async () => {
    const res = await worker.fetch(new Request('https://slides.example/api/health'), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'iteislides-api' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('never echoes the Gemini key', async () => {
    const res = await worker.fetch(
      new Request('https://slides.example/api/plan', { method: 'POST', body: '{}' }),
      env({ GEMINI_API_KEY: 'secret-key-123' }),
    );
    expect(await res.text()).not.toContain('secret-key-123');
  });
});
