export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: BASE_HEADERS });
}

export function errorResponse(status: number, code: string, message: string, details?: string): Response {
  const body: ApiErrorBody = { error: details ? { code, message, details } : { code, message } };
  return jsonResponse(body, status);
}

/** Input errors shared by /api/plan and /api/generate-content/batch; null when the error is something else. */
export function inputErrorResponse(error: unknown): Response | null {
  if (!(error instanceof Error)) {
    return null;
  }
  switch (error.message) {
    case 'invalid_preset':
      return errorResponse(400, 'invalid_preset', 'presetId is invalid. Allowed: standard_review | academic_research | blank.');
    case 'missing_text_content':
      return errorResponse(400, 'missing_text_content', 'textContent is required and must not be empty.');
    case 'missing_api_key':
      return errorResponse(503, 'missing_api_key', 'GEMINI_API_KEY is not configured on the server side.');
    default:
      return null;
  }
}
