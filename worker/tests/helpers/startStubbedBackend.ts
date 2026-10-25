// Local backend wired to the scripted Gemini stub (no network, no key). Used by src/e2e/local-backend.spec.ts.
// Run from src/: npx tsx ../worker/tests/helpers/startStubbedBackend.ts
import { serveFetchHandler } from '../../src/dev/nodeServer';
import { createApiHandler } from '../../src/http/app';
import { startGeminiStub } from './geminiStub';

const port = Number(process.env.API_PROXY_PORT ?? '8788');

async function main(): Promise<void> {
  const stub = await startGeminiStub();
  const handler = createApiHandler({ gemini: { geminiApiKey: 'stub-key', geminiBaseUrl: stub.baseUrl }, verifyAccess: null });
  const { baseUrl } = await serveFetchHandler(handler, port);
  console.log(`[stubbed-api] ${baseUrl} -> Gemini stub ${stub.baseUrl}`);
}

void main();
