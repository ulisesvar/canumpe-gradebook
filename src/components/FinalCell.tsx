import { BLOCK_LABELS, type StudentGradeRow } from '../domain/buildGradebook';
import { formatScore } from '../domain/format';

export function finalMissingText(row: StudentGradeRow): string {
  return row.missing.map((b) => BLOCK_LABELS[b]).join(', ');
}

export function FinalValue({ row }: { row: StudentGradeRow }) {
  if (row.finalGrade !== null) return <strong>{formatScore(row.finalGrade)}</strong>;
  return (
    <span className="incomplete" title={`Incompleta. Falta: ${finalMissingText(row)}`}>
      <strong>—</strong> INCOMPLETA
      <small> (falta: {finalMissingText(row)})</small>
    </span>
  );
}
