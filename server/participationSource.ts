import type { ParticipationErrorCode, ParticipationValue } from '../src/domain/participation';
import type { Config } from './config';

export class ParticipationError extends Error {
  constructor(
    readonly code: ParticipationErrorCode,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Records ONE new participation observation through the Academic API's existing
 * POST /admin/courses/{course_id}/students/{student_id}/participation. Every call creates a new
 * observation (nothing is replaced or grouped); observed_at is left to the Academic API and the
 * average / score are computed there, never here.
 *
 * The path is fixed: only the course (from configuration) and the validated integer student id
 * reach the URL, only the value (0..3) reaches the body.
 */
export async function postParticipationObservation(
  api: NonNullable<Config['academicApi']>,
  studentId: number,
  value: ParticipationValue,
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = `${api.baseUrl}/admin/courses/${api.courseId}/students/${studentId}/participation`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'X-API-Key': api.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value }),
      // never follow redirects: they could carry the X-API-Key header elsewhere
      redirect: 'error',
      signal: AbortSignal.timeout(api.timeoutMs),
    });
  } catch {
    throw new ParticipationError('api_unavailable', 502, 'The Academic API did not respond.');
  }
  // Only the status is used: upstream text ({"detail": "..."}) is never forwarded.
  if (response.status === 201) return;
  if (response.status === 401) {
    throw new ParticipationError('unauthorized', 502, 'The Academic API rejected the API key.');
  }
  if (response.status === 403) {
    throw new ParticipationError(
      'forbidden',
      502,
      'The API key is not allowed to record participation.',
    );
  }
  if (response.status === 404) {
    throw new ParticipationError(
      'not_found',
      404,
      'The student or course was not found (or the student is not enrolled).',
    );
  }
  if (response.status === 422) {
    throw new ParticipationError('invalid_request', 400, 'The Academic API rejected the value.');
  }
  console.error(`Academic API returned HTTP ${response.status} recording participation`);
  throw new ParticipationError('api_unavailable', 502, 'The Academic API returned an error.');
}
