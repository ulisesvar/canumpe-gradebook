import { useCallback, useEffect, useMemo, useState } from 'react';
import { ERROR_MESSAGES, fetchGradebook, LoadError } from './api';
import { GradebookTable } from './components/GradebookTable';
import { ParticipationCapture } from './components/ParticipationCapture';
import { StudentDetail } from './components/StudentDetail';
import { buildGradebook, type GradebookView } from './domain/buildGradebook';
import type { ErrorCode, GradebookContract } from './domain/contract';
import { formatWeight } from './domain/format';
import { filterStudents, sortStudents, type SortDirection, type SortKey } from './domain/students';

type State =
  | { status: 'loading' }
  | { status: 'error'; code: ErrorCode }
  | { status: 'ready'; view: GradebookView; source: 'fixture' | 'api'; data: GradebookContract };

type Tab = 'grades' | 'participation';

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('grades');

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchGradebook()
      .then((envelope) => {
        if (!cancelled) {
          setState({
            status: 'ready',
            view: buildGradebook(envelope.data),
            source: envelope.source,
            data: envelope.data,
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            code: err instanceof LoadError ? err.code : 'api_unavailable',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Reloads the gradebook in place (no loading screen, selected tab and captured values kept).
  // Rejects if the reload fails; the caller reports it.
  const refresh = useCallback(async () => {
    const envelope = await fetchGradebook();
    setState({
      status: 'ready',
      view: buildGradebook(envelope.data),
      source: envelope.source,
      data: envelope.data,
    });
  }, []);

  const view = state.status === 'ready' ? state.view : null;
  const rows = useMemo(
    () => (view ? sortStudents(filterStudents(view.rows, query), sortKey, sortDirection) : []),
    [view, query, sortKey, sortDirection],
  );

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'final' ? 'desc' : 'asc');
    }
  };

  const closeDetail = useCallback(() => setSelectedId(null), []);
  const selected = view?.rows.find((r) => r.studentId === selectedId) ?? null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>CANUMPE Gradebook</h1>
        {view && (
          <p className="subtitle">
            {view.course.name} (course {view.course.course_id})
          </p>
        )}
      </header>

      {state.status === 'loading' && <p role="status">Loading gradebook…</p>}

      {state.status === 'error' && (
        <div role="alert" className="notice notice-error">
          <p>{ERROR_MESSAGES[state.code]}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {state.status === 'ready' && view && (
        <>
          {state.source === 'fixture' && (
            <p className="notice notice-fixture" role="note">
              FIXTURE MODE: synthetic test data, not real academic records.
            </p>
          )}
          <section className="summary" aria-label="Course summary">
            <span>Students: {view.rows.length}</span>
            <span>Tasks: {view.columns.tasks.length}</span>
            <span>Exams: {view.columns.exams.length}</span>
            <span className="weights">
              Current weights: Tasks {formatWeight(view.weights.tasks)} · Exams{' '}
              {formatWeight(view.weights.exams)} · Participation / attendance{' '}
              {formatWeight(view.weights.participation)}
            </span>
          </section>

          {view.diagnostics.length > 0 && (
            <section className="notice notice-warn" role="region" aria-label="Diagnostics">
              <strong>Diagnostics</strong>
              <ul>
                {view.diagnostics.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </section>
          )}

          <div role="tablist" aria-label="Vistas del Gradebook" className="tabs">
            <button
              type="button"
              role="tab"
              id="tab-grades"
              aria-selected={tab === 'grades'}
              aria-controls="panel-grades"
              onClick={() => setTab('grades')}
            >
              Calificaciones
            </button>
            <button
              type="button"
              role="tab"
              id="tab-participation"
              aria-selected={tab === 'participation'}
              aria-controls="panel-participation"
              onClick={() => setTab('participation')}
            >
              Participación
            </button>
          </div>

          <div
            role="tabpanel"
            id="panel-grades"
            aria-labelledby="tab-grades"
            hidden={tab !== 'grades'}
          >
            <div className="toolbar">
              <label>
                Search student or account{' '}
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name or account number"
                />
              </label>
              <span aria-live="polite">
                {rows.length} of {view.rows.length} shown
              </span>
            </div>

            <GradebookTable
              view={view}
              rows={rows}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={onSort}
              onSelect={setSelectedId}
            />
            <p className="legend">
              “—” = no data / not graded (never counted as 0). “0” = a real zero. Activity cells
              show the normalised score (0–100); * = does not count toward the grade. Averages and
              contributions come from the Academic API. Final = Tareas + Exámenes + Participación /
              asistencia contributions, calculated by the Gradebook (not an Academic API field);
              with any block missing it is INCOMPLETA, never renormalised.
            </p>

            {selected && <StudentDetail view={view} row={selected} onClose={closeDetail} />}
          </div>

          {/* Stays mounted (only hidden) so captured values survive switching tabs. */}
          <div
            role="tabpanel"
            id="panel-participation"
            aria-labelledby="tab-participation"
            hidden={tab !== 'participation'}
          >
            <ParticipationCapture
              students={state.data.students}
              canWrite={state.source === 'api'}
              onRecorded={refresh}
            />
          </div>
        </>
      )}
    </div>
  );
}
