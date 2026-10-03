// Local backend for development: same HTTP app as production, jobs kept in memory and run in-process.
// Start from src/: `npm run proxy:dev` (reads src/.env; needs GEMINI_API_KEY).
import { createApiApp } from '../http/app';
import { MemoryJobStore } from '../jobs/memoryJobStore';
import { createInlineJobRunner } from '../jobs/runners';

const portRaw = process.env.API_PROXY_PORT ?? '8787';
const port = Number(portRaw);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid API_PROXY_PORT: ${portRaw}`);
}

const gemini = {
  geminiBaseUrl: process.env.GEMINI_BASE_URL,
  geminiPlanModel: process.env.GEMINI_PLAN_MODEL,
  geminiContentModel: process.env.GEMINI_CONTENT_MODEL,
};
const jobStore = new MemoryJobStore();
const app = createApiApp({ gemini, jobStore, jobRunner: createInlineJobRunner(jobStore, gemini) });

app.listen(port, '127.0.0.1', () => {
  console.log(`[API] Listening on http://127.0.0.1:${port}`);
  console.log(`[API] Gemini key ${process.env.GEMINI_API_KEY?.trim() ? 'configured' : 'missing (set GEMINI_API_KEY in src/.env)'}`);
});
