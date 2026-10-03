import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Opt-in acceptance run against real Gemini: uses the key in src/.env and spends quota.
// Run: npm run e2e:real (stop anything listening on 127.0.0.1:8787 first).
export default defineConfig({
  ...base,
  timeout: 15 * 60_000,
  testIgnore: undefined,
  testMatch: /real-gemini\.spec\.ts/,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4175' },
  webServer: [
    {
      command: 'npm run proxy:dev',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite build --outDir e2e-dist-real --emptyOutDir && npx vite preview --outDir e2e-dist-real --port 4175 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:8787' },
    },
  ],
});
