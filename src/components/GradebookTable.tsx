import type { GradebookView, StudentGradeRow } from '../domain/buildGradebook';
import type { Grade } from '../domain/calc';
import { formatContribution, formatGrade, formatScore, NOT_GRADED } from '../domain/format';
import type { SortDirection, SortKey } from '../domain/students';
import { FinalValue } from './FinalCell';

interface Props {
  view: GradebookView;
  rows: StudentGradeRow[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onSelect: (studentId: number) => void;
}

function GradeCell({ grade, label }: { grade: Grade; label: string }) {
  return grade === null ? (
    <td className="num ungraded" title={`${label}: not graded`}>
      <span aria-label="not graded">{NOT_GRADED}</span>
    </td>
  ) : (
    <td className="num">{formatGrade(grade)}</td>
  );
}

export function GradebookTable({ view, rows, sortKey, sortDirection, onSort, onSelect }: Props) {
  const { tasks, exams, unclassified } = view.columns;
  const ariaSort = (key: SortKey) =>
    sortKey === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
  const SortButton = ({ k, children }: { k: SortKey; children: string }) => (
    <button type="button" className="sort" onClick={() => onSort(k)}>
      {children}
      {sortKey === k ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  );
  const taskSpan = tasks.length + 2;
  const examSpan = exams.length + 2;

  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Gradebook table">
      <table className="gradebook">
        <caption className="sr-only">Gradebook: grades, averages, contributions and final</caption>
        <thead>
          <tr>
            <th rowSpan={2} scope="col" className="sticky-1" aria-sort={ariaSort('name')}>
              <SortButton k="name">Student</SortButton>
            </th>
            <th rowSpan={2} scope="col" className="sticky-2" aria-sort={ariaSort('account')}>
              <SortButton k="account">Account</SortButton>
            </th>
            <th colSpan={taskSpan} scope="colgroup" className="group group-tasks">
              Tareas ({view.weights.tasks ?? NOT_GRADED}%)
            </th>
            <th colSpan={examSpan} scope="colgroup" className="group group-exams">
              Exámenes ({view.weights.exams ?? NOT_GRADED}%)
            </th>
            <th colSpan={2} scope="colgroup" className="group group-part">
              Participación / asistencia ({view.weights.participation ?? NOT_GRADED}%)
            </th>
            {unclassified.length > 0 && (
              <th colSpan={unclassified.length} scope="colgroup" className="group group-other">
                Other / unclassified (not weighted)
              </th>
            )}
            <th rowSpan={2} scope="col" className="group group-final" aria-sort={ariaSort('final')}>
              <SortButton k="final">CALIFICACIÓN FINAL</SortButton>
              <div className="hint">calculated by Gradebook</div>
            </th>
          </tr>
          <tr>
            {tasks.map((c) => (
              <th key={c.itemId} scope="col" title={c.name}>
                {c.name}
              </th>
            ))}
            <th scope="col">Tasks average</th>
            <th scope="col">Tasks contribution</th>
            {exams.map((c) => (
              <th key={c.itemId} scope="col" title={c.name}>
                {c.name}
              </th>
            ))}
            <th scope="col">Exams average</th>
            <th scope="col">Exams contribution</th>
            <th scope="col">Average</th>
            <th scope="col">Contribution</th>
            {unclassified.map((c) => (
              <th key={c.itemId} scope="col" title={`${c.name} (type: ${c.activityType})`}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={99}>No students match the search.</td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.studentId}>
              <th scope="row" className="sticky-1 student">
                <button type="button" className="link" onClick={() => onSelect(row.studentId)}>
                  {row.fullName}
                </button>
              </th>
              <td className="sticky-2">{row.accountNumber}</td>
              {row.tasks.activities.map((a) => (
                <GradeCell key={a.column.itemId} grade={a.grade} label={a.column.name} />
              ))}
              <td className="num strong">{formatScore(row.tasks.average)}</td>
              <td className="num strong">
                {formatContribution(row.tasks.contribution, row.tasks.weight)}
              </td>
              {row.exams.activities.map((a) => (
                <GradeCell key={a.column.itemId} grade={a.grade} label={a.column.name} />
              ))}
              <td className="num strong">{formatScore(row.exams.average)}</td>
              <td className="num strong">
                {formatContribution(row.exams.contribution, row.exams.weight)}
              </td>
              <td className="num strong">{formatScore(row.participation.average)}</td>
              <td className="num strong">
                {formatContribution(row.participation.contribution, row.participation.weight)}
              </td>
              {row.unclassified.map((a) => (
                <GradeCell key={a.column.itemId} grade={a.grade} label={a.column.name} />
              ))}
              <td className="num final">
                <FinalValue row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
