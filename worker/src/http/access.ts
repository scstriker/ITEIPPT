// Verifies the Cloudflare Access JWT (Cf-Access-Jwt-Assertion) on every API request.
// Access already blocks unauthenticated visitors at the edge; this check makes the Worker refuse requests that
// reach it any other way (a misconfigured Access policy, a route added later, a direct service binding).
// See https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export interface AccessConfig {
  /** Team domain, e.g. https://itei.cloudflareaccess.com */
  teamDomain: string;
  /** Application Audience (AUD) tag of the Access application. */
  audience: string;
  fetchImpl?: (url: string) => Promise<Response>;
  now?: () => number;
}

type VerifyKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

export type AccessCheck =
  | { ok: true; email?: string }
  | AccessDenied;

export interface AccessDenied {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type AccessVerifier = (request: Request) => Promise<AccessCheck>;

const KEY_CACHE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function normalizeTeamDomain(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const denied = (message: string): AccessCheck => ({ ok: false, status: 401, code: 'access_denied', message });

export function createAccessVerifier(config: AccessConfig): AccessVerifier {
  const teamDomain = normalizeTeamDomain(config.teamDomain);
  const audience = config.audience.trim();
  const fetchImpl = config.fetchImpl ?? ((url: string) => fetch(url));
  const now = config.now ?? (() => Date.now());
  let keys = new Map<string, VerifyKey>();
  let keysFetchedAt = 0;

  async function loadKeys(): Promise<void> {
    const response = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) {
      throw new Error(`access_certs_unavailable:${response.status}`);
    }
    const body = (await response.json()) as { keys?: Jwk[] };
    const next = new Map<string, VerifyKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.kty !== 'RSA') {
        continue;
      }
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      next.set(jwk.kid, key);
    }
    keys = next;
    keysFetchedAt = now();
  }

  async function keyFor(kid: string): Promise<VerifyKey | undefined> {
    if (!keys.has(kid) || now() - keysFetchedAt > KEY_CACHE_MS) {
      await loadKeys();
    }
    return keys.get(kid);
  }

  return async (request) => {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) {
      return denied('Cloudflare Access token is missing.');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      return denied('Cloudflare Access token is malformed.');
    }
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (!header || !payload || header.alg !== 'RS256' || typeof header.kid !== 'string') {
      return denied('Cloudflare Access token is malformed.');
    }

    let key: VerifyKey | undefined;
    try {
      key = await keyFor(header.kid);
    } catch {
      return { ok: false, status: 503, code: 'access_unavailable', message: 'Cloudflare Access keys could not be loaded.' };
    }
    if (!key) {
      return denied('Cloudflare Access token was signed by an unknown key.');
    }
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) {
      return denied('Cloudflare Access token signature is invalid.');
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) {
      return denied('Cloudflare Access token is for another application.');
    }
    if (payload.iss !== teamDomain) {
      return denied('Cloudflare Access token was issued by another team.');
    }
    const nowSeconds = now() / 1000;
    if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowSeconds) {
      return denied('Cloudflare Access token has expired.');
    }
    if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_S > nowSeconds) {
      return denied('Cloudflare Access token is not valid yet.');
    }
    return { ok: true, email: typeof payload.email === 'string' ? payload.email : undefined };
  };
}
