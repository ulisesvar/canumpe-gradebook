/**
 * The only arithmetic the Gradebook owns. Category scores and contributions
 * come from the Academic API; nothing here recomputes them.
 * null means "no data" and is NEVER treated as 0.
 */
export type Grade = number | null;

/**
 * Report final = sum of the required block contributions. null ("INCOMPLETA") if ANY
 * block is unavailable: no renormalisation over the remaining blocks, no invented zeros.
 */
export function calculateFinalGrade(...contributions: readonly Grade[]): Grade {
  let sum = 0;
  for (const contribution of contributions) {
    if (contribution === null) return null;
    sum += contribution;
  }
  return Math.round(sum * 100) / 100;
}
