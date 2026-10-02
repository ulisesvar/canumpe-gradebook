import { useState } from 'react';
import type {
  ActivityColumn,
  ActivityGrade,
  GradebookView,
  StudentGradeRow,
} from '../domain/buildGradebook';
import {
  compactActivityLabel,
  formatContribution,
  formatGrade,
  formatScore,
  NOT_GRADED,
} from '../domain/format';
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

/** Shows the normalised score_100 (never the raw grade); null is "—", 0 is "0". */
function GradeCell({ activity }: { activity: ActivityGrade }) {
  const { column, score100, grade } = activity;
  const excluded = column.counts === false;
  const className = ['num', score100 === null ? 'ungraded' : '', excluded ? 'excluded' : '']
    .filter(Boolean)
    .join(' ');
  const detail =
    grade === null
      ? `${column.name}: not graded`
      : `${column.name}: ${formatGrade(grade)} / ${formatGrade(column.maxGrade)}`;
  return (
    <td
      className={className}
      title={excluded ? `${detail} (does not count toward the grade)` : detail}
    >
      {score100 === null ? (
        <span aria-label="not graded">{NOT_GRADED}</span>
      ) : (
        formatGrade(score100)
      )}
    </td>
  );
}

/** `label` is the compact display text; the original name stays in the tooltip. */
function ActivityHeader({ column, label }: { column: ActivityColumn; label?: string }) {
  const note = column.counts === false ? ' — does not count toward the grade' : '';
  return (
    <th
      scope="col"
      className={column.counts === false ? 'excluded' : undefined}
      title={`${column.name} (max ${formatGrade(column.maxGrade)}${column.activityType ? `, ${column.activityType}` : ''})${note}`}
    >
      {label ?? column.name}
      {column.counts === false ? ' *' : ''}
    </th>
  );
}

export function GradebookTable({ view, rows, sortKey, sortDirection, onSort, onSelect }: Props) {
  const { tasks, exams, participation, unclassified } = view.columns;
  const ariaSort = (key: SortKey) =>
    sortKey === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
  const SortButton = ({ k, children }: { k: SortKey; children: string }) => (
    <button type="button" className="sort" onClick={() => onSort(k)}>
      {children}
      {sortKey === k ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  );
  // Purely visual: which student row stays sharp while the others are blurred.
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const activeFocusId = rows.some((r) => r.studentId === focusedId) ? focusedId : null;
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
            <th colSpan={participation.length + 2} scope="colgroup" className="group group-part">
              Participación / asistencia ({view.weights.participation ?? NOT_GRADED}%)
            </th>
            {unclassified.length > 0 && (
              <th colSpan={unclassified.length} scope="colgroup" className="group group-other">
                Other / unassigned (not in final)
              </th>
            )}
            <th rowSpan={2} scope="col" className="group group-final" aria-sort={ariaSort('final')}>
              <SortButton k="final">CALIFICACIÓN FINAL</SortButton>
              <div className="hint">calculated by Gradebook</div>
            </th>
          </tr>
          <tr>
            {tasks.map((c, i) => (
              <ActivityHeader
                key={c.activityId}
                column={c}
                label={compactActivityLabel('tasks', i)}
              />
            ))}
            <th scope="col">Tasks average</th>
            <th scope="col">Tasks contribution</th>
            {exams.map((c, i) => (
              <ActivityHeader
                key={c.activityId}
                column={c}
                label={compactActivityLabel('exams', i)}
              />
            ))}
            <th scope="col">Exams average</th>
            <th scope="col">Exams contribution</th>
            {participation.map((c, i) => (
              <ActivityHeader
                key={c.activityId}
                column={c}
                label={compactActivityLabel('participation', i)}
              />
            ))}
            <th scope="col">Average</th>
            <th scope="col">Contribution</th>
            {unclassified.map((c) => (
              <ActivityHeader key={c.activityId} column={c} />
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
            <tr
              key={row.studentId}
              className={
                activeFocusId !== null && activeFocusId !== row.studentId ? 'blurred' : undefined
              }
            >
              <th scope="row" className="sticky-1 student">
                <div className="student-cell">
                  <button type="button" className="link" onClick={() => onSelect(row.studentId)}>
                    {row.fullName}
                  </button>
                  <button
                    type="button"
                    className="focus-toggle"
                    aria-pressed={activeFocusId === row.studentId}
                    aria-label={`Focus on ${row.fullName}`}
                    title={`Focus on ${row.fullName}`}
                    onClick={() =>
                      setFocusedId(activeFocusId === row.studentId ? null : row.studentId)
                    }
                  >
                    <span aria-hidden="true">◎</span>
                  </button>
                </div>
              </th>
              <td className="sticky-2">{row.accountNumber}</td>
              {row.tasks.activities.map((a) => (
                <GradeCell key={a.column.activityId} activity={a} />
              ))}
              <td className="num strong">{formatScore(row.tasks.average)}</td>
              <td className="num strong">
                {formatContribution(row.tasks.contribution, row.tasks.weight)}
              </td>
              {row.exams.activities.map((a) => (
                <GradeCell key={a.column.activityId} activity={a} />
              ))}
              <td className="num strong">{formatScore(row.exams.average)}</td>
              <td className="num strong">
                {formatContribution(row.exams.contribution, row.exams.weight)}
              </td>
              {row.participation.activities.map((a) => (
                <GradeCell key={a.column.activityId} activity={a} />
              ))}
              <td className="num strong">{formatScore(row.participation.average)}</td>
              <td className="num strong">
                {formatContribution(row.participation.contribution, row.participation.weight)}
              </td>
              {row.unclassified.map((a) => (
                <GradeCell key={a.column.activityId} activity={a} />
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
