// HTTP API as a plain fetch handler: the Cloudflare Worker and the local Node server both call it.
import { runContentBatch } from '../content/batch';
import type { GeminiOptions } from '../gemini/client';
import type { PlanRequestBody } from '../plan/basePlan';
import { generatePlanWithGemini } from '../plan/generatePlan';
import { isRecord } from '../shared/text';
import type { AccessDenied, AccessVerifier } from './access';
import { parseContentBatchRequest } from './batchRequest';
import { errorResponse, inputErrorResponse, jsonResponse } from './errors';

export interface ApiHandlerDeps {
  gemini: GeminiOptions;
  /** Checks the caller before any route other than /api/health. null only for the local development server. */
  verifyAccess: AccessVerifier | null;
}

export type ApiHandler = (request: Request) => Promise<Response>;

/** Body size caps. The browser sends at most ~150,000 characters to /api/plan and one batch to the batch route. */
export const BODY_LIMITS = {
  plan: 2 * 1024 * 1024,
  batch: 256 * 1024,
} as const;

class BodyError extends Error {
  constructor(readonly response: Response) {
    super('body_error');
  }
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new BodyError(errorResponse(413, 'payload_too_large', `Request body must not exceed ${maxBytes} bytes.`));
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes) {
    throw new BodyError(errorResponse(413, 'payload_too_large', `Request body must not exceed ${maxBytes} bytes.`));
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new BodyError(errorResponse(400, 'invalid_json', 'Request body must be JSON.'));
  }
}

export function createApiHandler({ gemini, verifyAccess }: ApiHandlerDeps): ApiHandler {
  async function plan(request: Request): Promise<Response> {
    const raw = await readJson(request, BODY_LIMITS.plan);
    const body = isRecord(raw) ? (raw as PlanRequestBody) : {};
    try {
      return jsonResponse(await generatePlanWithGemini(gemini, body));
    } catch (error) {
      return (
        inputErrorResponse(error) ??
        errorResponse(502, 'plan_generation_failed', 'Failed to generate framework plan with Gemini.', error instanceof Error ? error.message : undefined)
      );
    }
  }

  async function batch(request: Request): Promise<Response> {
    const raw = await readJson(request, BODY_LIMITS.batch);
    try {
      const batchRequest = parseContentBatchRequest(raw);
      return jsonResponse(await runContentBatch(gemini, batchRequest));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('invalid_batch_request:')) {
        return errorResponse(400, 'invalid_batch_request', 'Batch request does not match the contract.', error.message.slice('invalid_batch_request:'.length));
      }
      return (
        inputErrorResponse(error) ??
        errorResponse(502, 'content_generation_failed', 'Failed to generate slide content with Gemini.', error instanceof Error ? error.message : undefined)
      );
    }
  }

  return async (request) => {
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();

    if (pathname === '/api/health' && method === 'GET') {
      return jsonResponse({ ok: true, service: 'iteislides-api' });
    }

    const routes: Record<string, (request: Request) => Promise<Response>> = {
      'POST /api/plan': plan,
      'POST /api/generate-content/batch': batch,
    };
    const route = routes[`${method} ${pathname}`];
    if (!route) {
      // Anything else under /api is not part of the contract (the old Gemini passthrough is gone; see docs/SECURITY.md).
      return errorResponse(404, 'not_found', 'API route not found.');
    }

    if (verifyAccess) {
      const access = await verifyAccess(request);
      if (access.ok === false) {
        const denied = access as AccessDenied;
        return errorResponse(denied.status, denied.code, denied.message);
      }
    }

    try {
      return await route(request);
    } catch (error) {
      if (error instanceof BodyError) {
        return error.response;
      }
      return errorResponse(500, 'internal_error', 'Unexpected server error.');
    }
  };
}
