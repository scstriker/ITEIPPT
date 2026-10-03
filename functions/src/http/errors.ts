import type express from 'express';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

export function writeError(res: express.Response, status: number, body: ApiErrorBody): void {
  res.status(status).json(body);
}

export function writePlanInputError(res: express.Response, error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.message === 'invalid_preset') {
    writeError(res, 400, {
      error: {
        code: 'invalid_preset',
        message: 'presetId is invalid. Allowed: standard_review | academic_research | blank.',
      },
    });
    return true;
  }
  if (error.message === 'missing_text_content') {
    writeError(res, 400, {
      error: {
        code: 'missing_text_content',
        message: 'textContent is required and must not be empty.',
      },
    });
    return true;
  }
  if (error.message === 'missing_api_key') {
    writeError(res, 503, {
      error: {
        code: 'missing_api_key',
        message: 'GEMINI_API_KEY is not configured on the server side.',
      },
    });
    return true;
  }
  return false;
}

export function writeGenerateInputError(res: express.Response, error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.message === 'invalid_framework_plan') {
    writeError(res, 400, {
      error: {
        code: 'invalid_framework_plan',
        message: 'frameworkPlan is required and must match FrameworkPlan schema.',
      },
    });
    return true;
  }
  if (error.message === 'missing_text_content') {
    writeError(res, 400, {
      error: {
        code: 'missing_text_content',
        message: 'textContent is required and must not be empty.',
      },
    });
    return true;
  }
  if (error.message === 'missing_api_key') {
    writeError(res, 503, {
      error: {
        code: 'missing_api_key',
        message: 'GEMINI_API_KEY is not configured on the server side.',
      },
    });
    return true;
  }
  return false;
}
