// Cloudflare Worker entry. Static files come from the Vite build (wrangler `assets`); only /api/* runs this code.
// The Gemini key is a Worker secret (`wrangler secret put GEMINI_API_KEY`) and never leaves the Worker.
import { createAccessVerifier, type AccessVerifier } from './http/access';
import { createApiHandler, type ApiHandler } from './http/app';
import { errorResponse } from './http/errors';

export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_BASE_URL?: string;
  GEMINI_PLAN_MODEL?: string;
  GEMINI_CONTENT_MODEL?: string;
  /** Cloudflare Access team domain, e.g. https://itei.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience (AUD) tag of the Access application that protects this Worker. */
  ACCESS_AUD?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// Fail closed: without an Access configuration every API call except /api/health is refused.
const accessNotConfigured: AccessVerifier = async () => ({
  ok: false,
  status: 503,
  code: 'access_not_configured',
  message: 'Cloudflare Access is not configured for this deployment.',
});

// The Access verifier caches the team's signing keys, so it is kept across requests of this isolate.
let cachedVerifier: { signature: string; verify: AccessVerifier } | null = null;

function verifierFor(env: Env): AccessVerifier {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  if (!teamDomain || !audience) {
    return accessNotConfigured;
  }
  const signature = `${teamDomain}|${audience}`;
  if (cachedVerifier?.signature !== signature) {
    cachedVerifier = { signature, verify: createAccessVerifier({ teamDomain, audience }) };
  }
  return cachedVerifier.verify;
}

function handlerFor(env: Env): ApiHandler {
  return createApiHandler({
    gemini: {
      geminiApiKey: env.GEMINI_API_KEY,
      geminiBaseUrl: env.GEMINI_BASE_URL,
      geminiPlanModel: env.GEMINI_PLAN_MODEL,
      geminiContentModel: env.GEMINI_CONTENT_MODEL,
    },
    verifyAccess: verifierFor(env),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api' && !pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await handlerFor(env)(request);
    } catch {
      return errorResponse(500, 'internal_error', 'Unexpected server error.');
    }
  },
};
