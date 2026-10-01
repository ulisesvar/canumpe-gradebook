import type { Grade } from './calc';
import type { StudentGradeRow } from './buildGradebook';

export type SortKey = 'name' | 'account' | 'final';
export type SortDirection = 'asc' | 'desc';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Case- and accent-insensitive match on student name or account number. */
export function filterStudents(rows: readonly StudentGradeRow[], query: string): StudentGradeRow[] {
  const needle = normalize(query);
  if (needle === '') return [...rows];
  return rows.filter(
    (r) => normalize(r.fullName).includes(needle) || normalize(r.accountNumber).includes(needle),
  );
}

const compareText = (a: string, b: string) =>
  a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });

/** Sorts a copy. Incomplete (null) finals always sort last, in either direction. */
export function sortStudents(
  rows: readonly StudentGradeRow[],
  key: SortKey,
  direction: SortDirection,
): StudentGradeRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const byName = (a: StudentGradeRow, b: StudentGradeRow) =>
    compareText(a.lastName, b.lastName) || compareText(a.firstName, b.firstName);
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b);
    if (key === 'account')
      return sign * compareText(a.accountNumber, b.accountNumber) || byName(a, b);
    const fa: Grade = a.finalGrade;
    const fb: Grade = b.finalGrade;
    if (fa === null && fb === null) return byName(a, b);
    if (fa === null) return 1;
    if (fb === null) return -1;
    return sign * (fa - fb) || byName(a, b);
  });
}
