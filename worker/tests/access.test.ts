// Cloudflare Access JWT verification (docs/SECURITY.md).
import { beforeAll, describe, expect, it } from 'vitest';

import { createAccessVerifier, normalizeTeamDomain } from '../src/http/access';

const TEAM = 'https://itei-example.cloudflareaccess.com';
const AUD = 'aud-tag-example';
const NOW = Date.UTC(2026, 9, 25, 8, 0, 0);

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let jwks: { keys: unknown[] };
let certFetches = 0;

function b64url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function sign(payload: Record<string, unknown>, options: { kid?: string; key?: CryptoKey; alg?: string } = {}): Promise<string> {
  const header = encodeJson({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'kid-1', typ: 'JWT' });
  const body = encodeJson(payload);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', options.key ?? privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(signature))}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { aud: [AUD], iss: TEAM, exp: NOW / 1000 + 600, iat: NOW / 1000, email: 'staff@example.com', ...overrides };
}

function verifier(fetchImpl?: (url: string) => Promise<Response>) {
  return createAccessVerifier({
    teamDomain: 'itei-example.cloudflareaccess.com/',
    audience: AUD,
    now: () => NOW,
    fetchImpl:
      fetchImpl ??
      (async (input) => {
        certFetches += 1;
        expect(String(input)).toBe(`${TEAM}/cdn-cgi/access/certs`);
        return new Response(JSON.stringify(jwks), { status: 200 });
      }),
  });
}

const request = (token?: string) =>
  new Request('https://slides.example/api/plan', { method: 'POST', headers: token ? { 'cf-access-jwt-assertion': token } : {} });

beforeAll(async () => {
  const params = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } as const;
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  const other = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  jwks = { keys: [{ kid: 'kid-1', kty: 'RSA', alg: 'RS256', n: publicJwk.n, e: publicJwk.e }] };
});

describe('createAccessVerifier', () => {
  it('accepts a token signed by the team for this application', async () => {
    const check = await verifier()(request(await sign(claims())));
    expect(check).toEqual({ ok: true, email: 'staff@example.com' });
  });

  it('caches the team keys between requests', async () => {
    certFetches = 0;
    const verify = verifier();
    await verify(request(await sign(claims())));
    await verify(request(await sign(claims())));
    expect(certFetches).toBe(1);
  });

  it.each([
    ['no token', async () => undefined],
    ['a malformed token', async () => 'not-a-jwt'],
    ['another audience', async () => sign(claims({ aud: ['someone-else'] }))],
    ['another issuer', async () => sign(claims({ iss: 'https://other.cloudflareaccess.com' }))],
    ['an expired token', async () => sign(claims({ exp: NOW / 1000 - 3600 }))],
    ['a token not valid yet', async () => sign(claims({ nbf: NOW / 1000 + 3600 }))],
    ['a forged signature', async () => sign(claims(), { key: otherPrivateKey })],
    ['an unknown key id', async () => sign(claims(), { kid: 'kid-2' })],
    ['alg none', async () => {
      const token = await sign(claims());
      return `${encodeJson({ alg: 'none', kid: 'kid-1' })}.${token.split('.')[1]}.`;
    }],
  ])('rejects %s with 401', async (_name, makeToken) => {
    const check = await verifier()(request(await makeToken()));
    expect(check).toMatchObject({ ok: false, status: 401, code: 'access_denied' });
  });

  it('answers 503 when the team keys cannot be loaded', async () => {
    const check = await verifier(async () => new Response('down', { status: 500 }))(request(await sign(claims())));
    expect(check).toMatchObject({ ok: false, status: 503, code: 'access_unavailable' });
  });
});

describe('normalizeTeamDomain', () => {
  it('adds https and drops trailing slashes', () => {
    expect(normalizeTeamDomain('itei.cloudflareaccess.com/')).toBe('https://itei.cloudflareaccess.com');
    expect(normalizeTeamDomain('https://itei.cloudflareaccess.com')).toBe('https://itei.cloudflareaccess.com');
  });
});
