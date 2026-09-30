/**
 * Pure grade arithmetic. null means "not graded" and is NEVER treated as 0.
 * Never use truthiness on grades: 0 is a real grade.
 */
export type Grade = number | null;

/** Mean of the non-null grades; null when nothing is graded. */
export function calculateAverage(grades: readonly Grade[]): Grade {
  let sum = 0;
  let count = 0;
  for (const grade of grades) {
    if (grade !== null) {
      sum += grade;
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
}

/** average_score_100 * weight_percent / 100; null if either input is unavailable. */
export function calculateContribution(average: Grade, weightPercent: Grade): Grade {
  if (average === null || weightPercent === null) return null;
  return (average * weightPercent) / 100;
}

/** Sum of block contributions; null if ANY block is unavailable (no invented zeros). */
export function calculateFinalGrade(...contributions: readonly Grade[]): Grade {
  let sum = 0;
  for (const contribution of contributions) {
    if (contribution === null) return null;
    sum += contribution;
  }
  return sum;
}
