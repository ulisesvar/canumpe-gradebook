import { useMemo, useRef, useState } from 'react';
import { PARTICIPATION_ERROR_MESSAGES, ParticipationFailure, recordParticipation } from '../api';
import type { GradebookContract } from '../domain/contract';
import { formatScore } from '../domain/format';
import { PARTICIPATION_VALUES, type ParticipationValue } from '../domain/participation';

type Student = GradebookContract['students'][number];

interface Props {
  students: readonly Student[];
  /** false in fixture mode: there is no Academic API to record into. */
  canWrite: boolean;
  /** Reloads the gradebook after observations were recorded; rejects if the reload fails. */
  onRecorded: () => Promise<void>;
}

interface Outcome {
  recorded: number;
  failures: { studentId: number; name: string; message: string }[];
  refreshFailed: boolean;
}

const compareNames = (a: Student, b: Student) =>
  a.last_name.localeCompare(b.last_name, 'es', { sensitivity: 'base', numeric: true }) ||
  a.first_name.localeCompare(b.first_name, 'es', { sensitivity: 'base', numeric: true });

/** "Se registró 1 observación" / "Se registraron 3 observaciones". */
const recordedText = (n: number) =>
  `Se ${n === 1 ? 'registró' : 'registraron'} ${n} ${n === 1 ? 'observación' : 'observaciones'}`;

/**
 * Participation capture: pick 0, 1, 2 or 3 for the students being evaluated and record them.
 * Each selected student produces ONE new observation (value only); an empty control means "no
 * observation" and sends nothing. 0 is a real value. The count / average / score shown come from
 * the Academic API's gradebook — nothing is averaged here.
 */
export function ParticipationCapture({ students, canWrite, onRecorded }: Props) {
  const [selection, setSelection] = useState<Partial<Record<number, ParticipationValue>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // A ref, not state: a second click in the same tick must not start a second run.
  const running = useRef(false);

  const rows = useMemo(() => [...students].sort(compareNames), [students]);
  const selectedCount = Object.keys(selection).length;

  const choose = (studentId: number, value: ParticipationValue) => {
    setOutcome(null);
    setSelection((previous) => {
      const next = { ...previous };
      // Choosing the selected value again clears it back to empty ("no observation").
      if (previous[studentId] === value) delete next[studentId];
      else next[studentId] = value;
      return next;
    });
  };

  const submit = async () => {
    if (running.current || !canWrite) return;
    const pending = rows.flatMap((student) => {
      const value = selection[student.student_id];
      return value === undefined ? [] : [{ student, value }];
    });
    if (pending.length === 0) return;

    running.current = true;
    setSubmitting(true);
    setOutcome(null);

    const recordedIds = new Set<number>();
    const failures: Outcome['failures'] = [];
    // One at a time, in display order: every selected student gets exactly one new observation.
    for (const { student, value } of pending) {
      try {
        await recordParticipation(student.student_id, value);
        recordedIds.add(student.student_id);
      } catch (err) {
        failures.push({
          studentId: student.student_id,
          name: student.full_name,
          message:
            PARTICIPATION_ERROR_MESSAGES[
              err instanceof ParticipationFailure ? err.code : 'api_unavailable'
            ],
        });
      }
    }

    // Clear what was recorded so the next capture is a NEW observation; keep the failed ones so
    // they can be retried without re-recording the rest.
    setSelection((previous) => {
      const next = { ...previous };
      recordedIds.forEach((id) => delete next[id]);
      return next;
    });

    let refreshFailed = false;
    if (recordedIds.size > 0) {
      try {
        await onRecorded();
      } catch {
        refreshFailed = true;
      }
    }
    setOutcome({ recorded: recordedIds.size, failures, refreshFailed });
    setSubmitting(false);
    running.current = false;
  };

  return (
    <section className="participation" aria-labelledby="participation-heading">
      <h2 id="participation-heading">Participación</h2>
      <p className="hint">
        Seleccione 0, 1, 2 o 3 para cada alumno que desee evaluar. Los alumnos sin selección no se
        registran. Cada registro crea una observación nueva; el promedio lo calcula la Academic API.
      </p>
      {!canWrite && (
        <p className="notice notice-fixture" role="note">
          Modo FIXTURE: no hay una Academic API a la que registrar. La captura está deshabilitada.
        </p>
      )}

      <div className="table-scroll">
        <table className="participation-table">
          <caption className="sr-only">Captura de participación por alumno</caption>
          <thead>
            <tr>
              <th scope="col">Alumno</th>
              <th scope="col">Cuenta</th>
              <th scope="col" className="num">
                Observaciones
              </th>
              <th scope="col" className="num">
                Promedio (0–3)
              </th>
              <th scope="col" className="num">
                Score (0–100)
              </th>
              <th scope="col">Nueva observación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((student) => {
              const selected = selection[student.student_id];
              return (
                <tr key={student.student_id}>
                  <th scope="row" className="student-name">
                    {student.full_name}
                  </th>
                  <td>{student.account_number}</td>
                  <td className="num">{student.participation.participation_count}</td>
                  <td className="num">
                    {formatScore(student.participation.participation_average)}
                  </td>
                  <td className="num">
                    {formatScore(student.participation.participation_score_100)}
                  </td>
                  <td>
                    <div
                      role="radiogroup"
                      aria-label={`Nueva observación de ${student.full_name}`}
                      className="value-picker"
                    >
                      {PARTICIPATION_VALUES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={selected === value}
                          className={selected === value ? 'value selected' : 'value'}
                          disabled={submitting || !canWrite}
                          onClick={() => choose(student.student_id, value)}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="participation-actions">
        <button
          type="button"
          className="primary"
          disabled={!canWrite || submitting || selectedCount === 0}
          onClick={() => void submit()}
        >
          {submitting ? 'Registrando…' : 'Registrar participación'}
        </button>
        <span aria-live="polite">
          {selectedCount === 0
            ? 'Ningún alumno seleccionado'
            : `${selectedCount} ${selectedCount === 1 ? 'alumno seleccionado' : 'alumnos seleccionados'}`}
        </span>
      </div>

      {outcome && outcome.failures.length === 0 && (
        <p role="status" className="notice participation-ok">
          {recordedText(outcome.recorded)}.
          {outcome.refreshFailed &&
            ' No se pudo actualizar la tabla; recargue la página para ver los valores nuevos.'}
        </p>
      )}
      {outcome && outcome.failures.length > 0 && (
        <div role="alert" className="notice notice-error">
          <p>
            {outcome.recorded > 0
              ? `${recordedText(outcome.recorded)}, pero falló el registro de ${outcome.failures.length} ${outcome.failures.length === 1 ? 'alumno' : 'alumnos'}. Su selección se conservó para reintentar:`
              : `No se registró ninguna observación. Falló el registro de ${outcome.failures.length} ${outcome.failures.length === 1 ? 'alumno' : 'alumnos'}. Su selección se conservó para reintentar:`}
          </p>
          <ul>
            {outcome.failures.map((failure) => (
              <li key={failure.studentId}>
                {failure.name}: {failure.message}
              </li>
            ))}
          </ul>
          {outcome.refreshFailed && (
            <p>No se pudo actualizar la tabla; recargue la página para ver los valores nuevos.</p>
          )}
        </div>
      )}
    </section>
  );
}
