// Runs the Worker in the local Cloudflare runtime (wrangler dev / workerd) against a Gemini stub and a fake
// Access key server, then checks static assets, the Access check, /api/plan and one content batch.
// Needs src/dist (npm --prefix ../src run build). Run from worker/: npx tsx scripts/workerdSmoke.ts
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startGeminiStub } from '../tests/helpers/geminiStub';
import { batchRequestFor } from '../tests/helpers/batch';
import { SAMPLE_TEXT, twoChapterPlan } from '../tests/helpers/fixtures';

const PORT = 8799;
const AUD = 'smoke-aud';

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function main(): Promise<void> {
  const gemini = await startGeminiStub();
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const certs = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [{ kid: 'smoke', kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e }] }));
  });
  await new Promise<void>((resolve) => certs.listen(0, '127.0.0.1', resolve));
  const team = `http://127.0.0.1:${(certs.address() as AddressInfo).port}`;

  const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
  const head = encode({ alg: 'RS256', kid: 'smoke' });
  const body = encode({ aud: [AUD], iss: team, exp: Math.floor(Date.now() / 1000) + 600, email: 'smoke@example.com' });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  const token = `${head}.${body}.${b64url(new Uint8Array(signature))}`;

  const vars = {
    GEMINI_API_KEY: 'stub-key',
    GEMINI_BASE_URL: gemini.baseUrl,
    ACCESS_TEAM_DOMAIN: team,
    ACCESS_AUD: AUD,
  };
  const args = ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])];
  const child = spawn('npx', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));

  const base = `http://127.0.0.1:${PORT}`;
  const results: string[] = [];
  const check = (name: string, ok: boolean, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const health = await fetch(`${base}/api/health`);
    check('GET /api/health', health.status === 200, String(health.status));
    const index = await fetch(`${base}/framework`);
    check('SPA fallback serves index.html', index.status === 200 && (await index.text()).includes('<div id="root">'));
    const headers = { 'content-type': 'application/json' };
    const noToken = await fetch(`${base}/api/plan`, { method: 'POST', headers, body: JSON.stringify({ presetId: 'standard_review', textContent: SAMPLE_TEXT }) });
    check('plan without Access token is refused', noToken.status === 401, String(noToken.status));
    const plan = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { ...headers, 'cf-access-jwt-assertion': token },
      body: JSON.stringify({ presetId: 'standard_review', textContent: SAMPLE_TEXT, chapters: twoChapterPlan().chapters }),
    });
    check('plan with Access token', plan.status === 200, String(plan.status));
    const batch = await fetch(`${base}/api/generate-content/batch`, {
      method: 'POST',
      headers: { ...headers, 'cf-access-jwt-assertion': token },
      body: JSON.stringify(batchRequestFor(twoChapterPlan(), SAMPLE_TEXT, 0)),
    });
    const batchJson = (await batch.json()) as { ok?: boolean; slides?: unknown[] };
    check('content batch with Access token', batch.status === 200 && batchJson.ok === true && (batchJson.slides?.length ?? 0) > 0, String(batch.status));
    check('Gemini key only in the header', gemini.requests.length > 0 && gemini.requests.every((r) => r.apiKey === 'stub-key' && !r.keyInUrl));
  } finally {
    // npx starts wrangler, which starts workerd: stop the whole tree before exiting.
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill();
    }
    certs.close();
    await gemini.close();
  }
  console.log(results.join('\n'));
  if (results.some((line) => line.startsWith('FAIL'))) {
    console.log(log.slice(-3000));
    process.exitCode = 1;
  }
}

void main();
