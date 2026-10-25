// Local backend for development: the Worker's API handler on 127.0.0.1, without Cloudflare Access.
// Start from src/: `npm run proxy:dev` (reads src/.env; needs GEMINI_API_KEY).
import { createApiHandler } from '../http/app';
import { serveFetchHandler } from './nodeServer';

const portRaw = process.env.API_PROXY_PORT ?? '8787';
const port = Number(portRaw);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid API_PROXY_PORT: ${portRaw}`);
}

const handler = createApiHandler({
  gemini: {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiBaseUrl: process.env.GEMINI_BASE_URL,
    geminiPlanModel: process.env.GEMINI_PLAN_MODEL,
    geminiContentModel: process.env.GEMINI_CONTENT_MODEL,
  },
  // Access only exists in front of the deployed Worker; this server listens on 127.0.0.1 only.
  verifyAccess: null,
});

serveFetchHandler(handler, port).then(({ baseUrl }) => {
  console.log(`[API] Listening on ${baseUrl}`);
  console.log(`[API] Gemini key ${process.env.GEMINI_API_KEY?.trim() ? 'configured' : 'missing (set GEMINI_API_KEY in src/.env)'}`);
});
