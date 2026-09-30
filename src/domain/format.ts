import type { Grade } from './calc';

export const NOT_GRADED = '—';

/** Individual activity grade: 0 stays "0", null is "—". */
export function formatGrade(grade: Grade): string {
  if (grade === null) return NOT_GRADED;
  return Number.isInteger(grade) ? String(grade) : grade.toFixed(2);
}

/** Averages, contributions and finals: two decimals, null is "—". */
export function formatScore(value: Grade): string {
  return value === null ? NOT_GRADED : value.toFixed(2);
}

export function formatWeight(weight: Grade): string {
  return weight === null ? NOT_GRADED : `${weight}%`;
}

/** "38.00 / 40" */
export function formatContribution(contribution: Grade, weight: Grade): string {
  return `${formatScore(contribution)} / ${weight === null ? NOT_GRADED : weight}`;
}
