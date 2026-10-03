import { defineConfig } from '@playwright/test';

const PORT = 4173;

// Uses the installed Chrome (set PW_CHANNEL=msedge or PW_CHANNEL= to use Playwright's Chromium).
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: channel || undefined,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  webServer: {
    // Production build: matches what users get (React StrictMode double effects only exist in dev).
    command: `npx vite build --outDir e2e-dist --emptyOutDir && npx vite preview --outDir e2e-dist --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // /api is answered by page.route in the browser; point the dev proxy at a closed port.
    env: { API_PROXY_TARGET: 'http://127.0.0.1:9' },
  },
});
