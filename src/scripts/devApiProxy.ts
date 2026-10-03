import dotenv from 'dotenv';
import { createApiProxyApp } from '../services/apiProxyServer';

dotenv.config();

const portRaw = process.env.API_PROXY_PORT ?? '8787';
const port = Number(portRaw);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid API_PROXY_PORT: ${portRaw}`);
}

const app = createApiProxyApp();
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[API Proxy] Listening on http://127.0.0.1:${port}`);
  // eslint-disable-next-line no-console
  console.log('[API Proxy] /api/plan -> Gemini framework analysis; /api/* -> Gemini REST API');
});
