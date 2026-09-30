import {
  errorCodes,
  gradebookEnvelopeSchema,
  type ErrorCode,
  type GradebookEnvelope,
} from './domain/contract';

export class LoadError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  api_unavailable: 'Unable to load the academic data. The Academic API did not respond.',
  unauthorized: 'The Gradebook is not authorized to access the Academic API (invalid API key).',
  forbidden: 'The Gradebook credentials do not have permission to read this course.',
  course_not_found: 'The configured course was not found in the Academic API.',
  malformed_response: 'The academic data has an unexpected format and was not displayed.',
  config_error: 'The Gradebook server is misconfigured. Contact the administrator.',
};

export async function fetchGradebook(): Promise<GradebookEnvelope> {
  let response: Response;
  try {
    response = await fetch('/api/gradebook');
  } catch {
    throw new LoadError('api_unavailable');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LoadError('api_unavailable');
  }
  if (!response.ok) {
    const code = (body as { error?: string } | null)?.error;
    throw new LoadError(errorCodes.find((c) => c === code) ?? 'api_unavailable');
  }
  // Validate again in the browser: never render data that fails the contract.
  const parsed = gradebookEnvelopeSchema.safeParse(body);
  if (!parsed.success) throw new LoadError('malformed_response');
  return parsed.data;
}
