import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// AC-029: the browser talks to the real local backend (memory jobs, in-process worker),
// which talks to the scripted Gemini stub. No fake API in the browser.
const PORT = 4174;
const API_PORT = 8788;

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: /local-backend\.spec\.ts/,
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORT}` },
  webServer: [
    {
      command: 'npx tsx ../functions/tests/helpers/startStubbedBackend.ts',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PROXY_PORT: String(API_PORT) },
    },
    {
      // E2E_DEV=1 runs against the dev server (React StrictMode), as developers use it.
      command: process.env.E2E_DEV
        ? `npx vite --port ${PORT} --strictPort --host 127.0.0.1`
        : `npx vite build --outDir e2e-dist-local --emptyOutDir && npx vite preview --outDir e2e-dist-local --port ${PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
