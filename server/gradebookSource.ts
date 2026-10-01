import { readFile } from 'node:fs/promises';
import { gradebookSchema, type ErrorCode, type GradebookContract } from '../src/domain/contract';
import type { Config } from './config';

export class GradebookError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

function validate(payload: unknown): GradebookContract {
  const result = gradebookSchema.safeParse(payload);
  if (!result.success) {
    // Log the first few schema issues (paths/messages only, no payload values).
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    console.error('Gradebook payload failed validation:', issues.join(' | '));
    throw new GradebookError(
      'malformed_response',
      502,
      'The academic data has an unexpected format.',
    );
  }
  return result.data;
}

export async function loadFixture(path: string): Promise<GradebookContract> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new GradebookError('config_error', 500, 'The gradebook fixture could not be read.');
  }
  return validate(payload);
}

export async function fetchFromAcademicApi(
  api: NonNullable<Config['academicApi']>,
  fetchImpl: typeof fetch,
): Promise<GradebookContract> {
  // Fixed, configured endpoint only: nothing from the browser reaches this URL.
  const url = api.baseUrl + api.gradebookPath.replace('{course_id}', api.courseId);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'X-API-Key': api.apiKey, Accept: 'application/json' },
      // never follow redirects: they could carry the X-API-Key header elsewhere
      redirect: 'error',
      signal: AbortSignal.timeout(api.timeoutMs),
    });
  } catch {
    throw new GradebookError('api_unavailable', 502, 'The Academic API did not respond.');
  }
  // The Academic API reports failures as {"detail": "..."}; only the status is used,
  // so upstream text is never forwarded to the browser.
  if (response.status === 401) {
    throw new GradebookError('unauthorized', 502, 'The Academic API rejected the API key.');
  }
  if (response.status === 403) {
    throw new GradebookError(
      'forbidden',
      502,
      'The API key is not allowed to read this gradebook.',
    );
  }
  if (response.status === 404) {
    throw new GradebookError('course_not_found', 404, 'The course was not found.');
  }
  if (!response.ok) {
    console.error(`Academic API returned HTTP ${response.status}`);
    throw new GradebookError('api_unavailable', 502, 'The Academic API returned an error.');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GradebookError(
      'malformed_response',
      502,
      'The academic data has an unexpected format.',
    );
  }
  return validate(payload);
}
