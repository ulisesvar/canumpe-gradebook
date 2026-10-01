import {
  errorCodes,
  gradebookEnvelopeSchema,
  type ErrorCode,
  type GradebookEnvelope,
} from './domain/contract';
import {
  participationErrorCodes,
  type ParticipationErrorCode,
  type ParticipationValue,
} from './domain/participation';

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

export class ParticipationFailure extends Error {
  constructor(readonly code: ParticipationErrorCode) {
    super(code);
  }
}

export const PARTICIPATION_ERROR_MESSAGES: Record<ParticipationErrorCode, string> = {
  invalid_request: 'La solicitud no es válida (el valor debe ser 0, 1, 2 o 3).',
  unsupported_media_type: 'El servidor rechazó el formato de la solicitud.',
  forbidden_origin: 'El servidor rechazó la solicitud por su origen.',
  read_only_source:
    'El Gradebook está en modo fixture: no hay una Academic API a la que registrar.',
  not_found:
    'El alumno o el curso no se encontró en la Academic API (o el alumno no está inscrito).',
  unauthorized: 'El Gradebook no está autorizado en la Academic API (API key inválida).',
  forbidden: 'Las credenciales del Gradebook no tienen permiso para registrar participación.',
  api_unavailable:
    'No se pudo confirmar el registro (la Academic API no respondió o devolvió un error). Revise el número de observaciones antes de reintentar.',
};

/**
 * Records ONE new participation observation (student + value 0..3) through the Gradebook backend,
 * which holds the Academic API key. The average and score are computed by the Academic API.
 */
export async function recordParticipation(
  studentId: number,
  value: ParticipationValue,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/participation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId, value }),
    });
  } catch {
    throw new ParticipationFailure('api_unavailable');
  }
  if (response.ok) return;
  let code: unknown;
  try {
    code = ((await response.json()) as { error?: unknown } | null)?.error;
  } catch {
    code = undefined;
  }
  throw new ParticipationFailure(
    participationErrorCodes.find((c) => c === code) ?? 'api_unavailable',
  );
}
