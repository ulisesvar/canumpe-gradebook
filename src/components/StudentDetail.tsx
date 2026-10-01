import { useEffect, useRef, type ReactNode } from 'react';
import {
  BLOCK_LABELS,
  type ActivityBlock,
  type GradebookView,
  type ScoreBlock,
  type StudentGradeRow,
} from '../domain/buildGradebook';
import { formatContribution, formatGrade, formatScore, formatWeight } from '../domain/format';
import { FinalValue } from './FinalCell';

interface Props {
  view: GradebookView;
  row: StudentGradeRow;
  onClose: () => void;
}

function BlockSummary({ block }: { block: ScoreBlock }) {
  return (
    <dl className="block-summary">
      <dt>Average</dt>
      <dd>{formatScore(block.average)}</dd>
      <dt>Weight</dt>
      <dd>{formatWeight(block.weight)}</dd>
      <dt>Contribution</dt>
      <dd>{formatContribution(block.contribution, block.weight)}</dd>
    </dl>
  );
}

function ActivitySection({
  title,
  block,
  children,
}: {
  title: string;
  block: ActivityBlock;
  children?: ReactNode;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {block.activities.length > 0 && (
        <table className="detail-table">
          <thead>
            <tr>
              <th scope="col">Activity</th>
              <th scope="col">Grade</th>
              <th scope="col">Score /100</th>
            </tr>
          </thead>
          <tbody>
            {block.activities.map((a) => (
              <tr key={a.column.activityId}>
                <td>
                  {a.column.name}
                  {a.column.counts === false && ' * (not counted)'}
                </td>
                <td className="num">
                  {a.grade === null ? (
                    <span aria-label="not graded">—</span>
                  ) : (
                    `${formatGrade(a.grade)} / ${formatGrade(a.column.maxGrade)}`
                  )}
                </td>
                <td className="num">
                  {a.score100 === null ? (
                    <span aria-label="not graded">—</span>
                  ) : (
                    formatGrade(a.score100)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <BlockSummary block={block} />
      {children}
    </section>
  );
}

export function StudentDetail({ row, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <aside
        className="detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-head">
          <div>
            <h2 id="detail-title">{row.fullName}</h2>
            <p>Account: {row.accountNumber}</p>
          </div>
          <button type="button" ref={closeRef} onClick={onClose}>
            Close
          </button>
        </div>
        <ActivitySection title={BLOCK_LABELS.tasks} block={row.tasks} />
        <ActivitySection title={BLOCK_LABELS.exams} block={row.exams} />
        <ActivitySection title={BLOCK_LABELS.participation} block={row.participation}>
          {row.participationNotes.map((n) => (
            <p key={n} className="note">
              {n}
            </p>
          ))}
        </ActivitySection>
        {row.unclassified.length > 0 && (
          <section>
            <h3>Other / unassigned (not in final)</h3>
            <ul>
              {row.unclassified.map((a) => (
                <li key={a.column.activityId}>
                  {a.column.name}:{' '}
                  {a.grade === null
                    ? '—'
                    : `${formatGrade(a.grade)} / ${formatGrade(a.column.maxGrade)}`}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="detail-final">
          <h3>Calificación final (calculated by Gradebook)</h3>
          <p className="final-value">
            <FinalValue row={row} />
          </p>
          <p className="note">
            Academic API current grade: {formatScore(row.apiCurrent.score100)} / 100 (calculated
            only from currently evaluated categories; not used as the final grade).
          </p>
        </section>
      </aside>
    </div>
  );
}
