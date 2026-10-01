import { z } from 'zod';

/** The only values a participation observation can have (Academic API: 0..3). 0 is a real value. */
export const PARTICIPATION_VALUES = [0, 1, 2, 3] as const;
export type ParticipationValue = (typeof PARTICIPATION_VALUES)[number];

/**
 * Body the browser sends to POST /api/participation: ONE new observation for one student.
 * Unknown keys are dropped and never forwarded; the course, URL and credentials are server-side.
 */
export const participationRequestSchema = z.object({
  student_id: z.number().int().positive(),
  value: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

export const participationErrorCodes = [
  'invalid_request',
  'unsupported_media_type',
  'forbidden_origin',
  'read_only_source',
  'not_found',
  'unauthorized',
  'forbidden',
  'api_unavailable',
] as const;
export type ParticipationErrorCode = (typeof participationErrorCodes)[number];
