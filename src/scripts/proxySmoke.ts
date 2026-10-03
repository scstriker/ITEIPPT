import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiProxyApp } from '../services/apiProxyServer';
import { createFrameworkPlanFromPreset } from '../config/templatePresets';

async function main(): Promise<void> {
  const app = createApiProxyApp({ geminiApiKey: '' });
  const server = app.listen(0);
  await once(server, 'listening');

  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const healthRes = await fetch(`${base}/api/health`);
  assert.equal(healthRes.status, 200, 'health endpoint should return 200');
  const healthBody = await healthRes.json() as { ok?: boolean };
  assert.equal(healthBody.ok, true, 'health payload should include ok=true');

  const missingKeyRes = await fetch(`${base}/api/models`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missingKeyRes.status, 503, 'missing key should return 503');
  const missingKeyBody = await missingKeyRes.json() as { error?: { code?: string } };
  assert.equal(missingKeyBody.error?.code, 'missing_api_key', 'missing key code mismatch');

  const missingPathRes = await fetch(`${base}/api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missingPathRes.status, 400, 'missing path should return 400');
  const missingPathBody = await missingPathRes.json() as { error?: { code?: string } };
  assert.equal(missingPathBody.error?.code, 'invalid_api_path', 'missing path code mismatch');

  const invalidPlanPayloadRes = await fetch(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ presetId: 'invalid', textContent: '' }),
  });
  assert.equal(invalidPlanPayloadRes.status, 400, 'invalid preset should return 400');
  const invalidPlanBody = await invalidPlanPayloadRes.json() as { error?: { code?: string } };
  assert.equal(invalidPlanBody.error?.code, 'invalid_preset', 'invalid preset code mismatch');

  const missingKeyPlanRes = await fetch(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ presetId: 'standard_review', textContent: '样例文本' }),
  });
  assert.equal(missingKeyPlanRes.status, 503, 'missing key for /api/plan should return 503');
  const missingKeyPlanBody = await missingKeyPlanRes.json() as { error?: { code?: string } };
  assert.equal(missingKeyPlanBody.error?.code, 'missing_api_key', 'missing key plan code mismatch');

  const invalidGenerateRes = await fetch(`${base}/api/generate-content`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ frameworkPlan: {}, textContent: 'x' }),
  });
  assert.equal(invalidGenerateRes.status, 400, 'invalid framework plan should return 400');
  const invalidGenerateBody = await invalidGenerateRes.json() as { error?: { code?: string } };
  assert.equal(
    invalidGenerateBody.error?.code,
    'invalid_framework_plan',
    'invalid framework plan code mismatch',
  );

  const missingKeyGenerateRes = await fetch(`${base}/api/generate-content`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      frameworkPlan: createFrameworkPlanFromPreset('standard_review'),
      textContent: '样例文本',
    }),
  });
  assert.equal(missingKeyGenerateRes.status, 503, 'missing key for /api/generate-content should return 503');
  const missingKeyGenerateBody = await missingKeyGenerateRes.json() as { error?: { code?: string } };
  assert.equal(
    missingKeyGenerateBody.error?.code,
    'missing_api_key',
    'missing key generate-content code mismatch',
  );

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  // eslint-disable-next-line no-console
  console.log('[API Proxy] Smoke tests passed.');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[API Proxy] Smoke tests failed:', error);
  process.exit(1);
});
