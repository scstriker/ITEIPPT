// Local backend wired to the scripted Gemini stub (no network, no key). Used by src/e2e/local-backend.spec.ts.
// Run from src/: npx tsx ../functions/tests/helpers/startStubbedBackend.ts
import { createApiApp } from '../../src/http/app';
import { MemoryJobStore } from '../../src/jobs/memoryJobStore';
import { createInlineJobRunner } from '../../src/jobs/runners';
import { startGeminiStub } from './geminiStub';

const port = Number(process.env.API_PROXY_PORT ?? '8788');

async function main(): Promise<void> {
  const stub = await startGeminiStub();
  const gemini = { geminiApiKey: 'stub-key', geminiBaseUrl: stub.baseUrl };
  const jobStore = new MemoryJobStore();
  const app = createApiApp({ gemini, jobStore, jobRunner: createInlineJobRunner(jobStore, gemini) });
  app.listen(port, '127.0.0.1', () => {
    console.log(`[stubbed-api] http://127.0.0.1:${port} -> Gemini stub ${stub.baseUrl}`);
  });
}

void main();
