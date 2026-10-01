import real from '../../data/gradebook.fixture.json';
import complete from '../test/gradebookComplete.json';
import { buildGradebook } from './buildGradebook';
import { gradebookSchema, type GradebookContract } from './contract';

/** `complete`: every block assigned. `real`: snapshot of the real course state (synthetic values). */
const contract = (src: unknown = complete): GradebookContract =>
  gradebookSchema.parse(structuredClone(src));
const view = (data = contract()) => buildGradebook(data);
const row = (name: string, v = view()) => v.rows.find((r) => r.firstName === name)!;

describe('contract validation (real Academic API shape)', () => {
  it('accepts both fixtures', () => {
    expect(gradebookSchema.safeParse(complete).success).toBe(true);
    expect(gradebookSchema.safeParse(real).success).toBe(true);
  });
  it('rejects a response missing scheme', () => {
    const bad: Partial<typeof complete> = structuredClone(complete);
    delete bad.scheme;
    expect(gradebookSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects the old assumed shape', () => {
    expect(gradebookSchema.safeParse({ course: { course_id: 1, full_name: 'x' } }).success).toBe(
      false,
    );
  });
  it('rejects grade cells not aligned with columns', () => {
    const bad = structuredClone(complete);
    bad.students[0]!.grades.reverse();
    expect(gradebookSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects a score_100 without a grade', () => {
    const bad = structuredClone(complete);
    bad.students[1]!.grades[3]!.score_100 = 50; // Bravo Tarea 04: grade null
    expect(gradebookSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects string grades', () => {
    const bad = structuredClone(complete) as unknown as {
      students: { grades: { grade: unknown }[] }[];
    };
    bad.students[0]!.grades[0]!.grade = '100';
    expect(gradebookSchema.safeParse(bad).success).toBe(false);
  });
});

describe('block identity (from scheme, by name -> category_id)', () => {
  it('REGRESSION: "Participación / asistencia" with calculation_type=GRADE_ITEMS is the 20% block', () => {
    const data = contract();
    const entry = data.scheme.find((s) => s.name === 'Participación / asistencia')!;
    expect(entry.calculation_type).toBe('GRADE_ITEMS');
    const v = view(data);
    expect(v.weights.participation).toBe(20);
    expect(row('Alpha', v).participation).toMatchObject({
      weight: 20,
      average: 90,
      contribution: 18,
    });
    expect(v.diagnostics.some((d) => d.includes('Missing category'))).toBe(false);
  });
  it('recognises the three real category names', () => {
    expect(view().weights).toEqual({ tasks: 40, exams: 40, participation: 20 });
    expect(view().diagnostics.some((d) => d.includes('differ'))).toBe(false);
  });
  it('does not depend on calculation_type (ATTENDANCE_PARTICIPATION works too)', () => {
    const data = contract();
    data.scheme.find((s) => s.name === 'Participación / asistencia')!.calculation_type =
      'ATTENDANCE_PARTICIPATION';
    expect(view(data).weights.participation).toBe(20);
  });
  it('does not pick a category by calculation_type alone', () => {
    const data = contract();
    data.scheme.find((s) => s.name === 'Participación / asistencia')!.name = 'Something else';
    data.scheme.find((s) => s.name === 'Something else')!.calculation_type =
      'ATTENDANCE_PARTICIPATION';
    const v = view(data);
    expect(v.weights.participation).toBeNull();
    expect(v.diagnostics.some((d) => d.includes('Missing category'))).toBe(true);
    expect(v.rows.every((r) => r.finalGrade === null)).toBe(true);
  });
  it('is tolerant of case, accents and spacing in names', () => {
    const data = contract();
    data.scheme[0]!.name = 'ENTREGABLES/TAREAS';
    data.scheme[2]!.name = 'examenes';
    expect(view(data).weights).toEqual({ tasks: 40, exams: 40, participation: 20 });
  });
  it('uses category_id as identity: a renamed category_name on columns changes nothing', () => {
    const data = contract();
    for (const c of data.columns) if (c.category_id === 1) c.category_name = 'Renamed';
    for (const s of data.students)
      for (const g of s.grades) if (g.category_id === 1) g.category_name = 'Renamed';
    expect(view(data).columns.tasks).toHaveLength(4);
  });
  it('resolves weights from scheme[] (not hard-coded)', () => {
    const data = contract();
    data.scheme[0]!.weight_percent = 50;
    data.scheme[2]!.weight_percent = 30;
    const v = view(data);
    expect(v.weights).toEqual({ tasks: 50, exams: 30, participation: 20 });
    expect(v.diagnostics.some((d) => d.includes('differ from the 40/40/20'))).toBe(true);
  });
  it('reports ambiguity instead of guessing', () => {
    const data = contract();
    data.scheme.push({
      category_id: 9,
      name: 'Tareas',
      calculation_type: 'GRADE_ITEMS',
      weight_percent: 0,
      sort_order: 9,
    });
    const v = view(data);
    expect(v.weights.tasks).toBeNull();
    expect(v.diagnostics.some((d) => d.includes('Ambiguous'))).toBe(true);
  });
});

describe('category membership', () => {
  it('places columns by category_id', () => {
    const v = view();
    expect(v.columns.tasks.map((c) => c.name)).toEqual([
      'Tarea 01',
      'Tarea 02',
      'Tarea 03',
      'Tarea 04 (not counted)',
    ]);
    expect(v.columns.participation.map((c) => c.name)).toEqual(['Participación 01']);
    expect(v.columns.exams.map((c) => c.name)).toEqual(['Examen 1', 'Examen 2']);
    expect(v.columns.unclassified.map((c) => c.name)).toEqual(['Extra 01 (unassigned)']);
  });
  it('does not let activity_type override category membership', () => {
    const data = contract();
    data.columns[0]!.activity_type = 'quiz'; // a "quiz" inside Tareas stays in Tareas
    data.columns[7]!.activity_type = 'quiz'; // an unassigned item stays out
    const v = view(data);
    expect(v.columns.tasks[0]!.name).toBe('Tarea 01');
    expect(v.columns.exams.map((c) => c.name)).toEqual(['Examen 1', 'Examen 2']);
    expect(v.columns.unclassified).toHaveLength(1);
  });
  it('keeps the unassigned activity out of every weighted block', () => {
    const foxtrot = row('Foxtrot');
    expect(foxtrot.unclassified[0]!.score100).toBe(100);
    expect(foxtrot.tasks.average).toBe(100);
    expect(foxtrot.finalGrade).toBe(90);
  });
  it('shows the not-counted activity but the API excludes it from the category score', () => {
    const v = view();
    expect(v.diagnostics.some((d) => d.includes('do not count'))).toBe(true);
    const alpha = row('Alpha', v);
    expect(alpha.tasks.activities.find((a) => a.column.counts === false)!.score100).toBe(50);
    expect(alpha.tasks.average).toBe(96.67); // (100+100+90)/3
  });
});

describe('real course state (Tarea 02/03 and Examen 1 unassigned, participation null)', () => {
  const v = () => view(contract(real));

  it('resolves the real scheme', () => {
    expect(v().weights).toEqual({ tasks: 40, exams: 40, participation: 20 });
  });
  it('only Tarea 01 is in Tareas; unassigned Tarea 02, Tarea 03 and Examen 1 stay visible but separate', () => {
    expect(v().columns.tasks.map((c) => c.name)).toEqual(['Tarea 01']);
    expect(v().columns.exams).toEqual([]);
    expect(v().columns.unclassified.map((c) => c.name)).toEqual([
      'Tarea 02',
      'Tarea 03',
      'Examen 1',
    ]);
  });
  it('unassigned activities do not contribute to Tareas or Exámenes, even when graded', () => {
    const alpha = row('Alpha', v()); // graded 80 / 90 / 70 / 85
    expect(alpha.tasks.average).toBe(80); // Tarea 01 only
    expect(alpha.tasks.contribution).toBe(32);
    expect(alpha.exams.average).toBeNull();
    expect(alpha.exams.contribution).toBeNull();
    expect(alpha.unclassified.map((a) => a.score100)).toEqual([90, 70, 85]);
  });
  it('null participation stays null (not zero) with an explanatory note', () => {
    const alpha = row('Alpha', v());
    expect(alpha.participation).toMatchObject({ average: null, weight: 20, contribution: null });
    expect(alpha.participationNotes).toContain('No participation data has been entered.');
  });
  it('final is INCOMPLETA and names every missing block; current_score_100 is not used', () => {
    const alpha = row('Alpha', v());
    expect(alpha.finalGrade).toBeNull();
    expect(alpha.complete).toBe(false);
    expect(alpha.missing).toEqual(['exams', 'participation']);
    expect(alpha.apiCurrent.score100).toBe(80); // renormalised by the API; ignored
  });
  it('a real zero in Tarea 01 stays zero (contribution 0) while the final stays incomplete', () => {
    const bravo = row('Bravo', v());
    expect(bravo.tasks.average).toBe(0);
    expect(bravo.tasks.contribution).toBe(0);
    expect(bravo.finalGrade).toBeNull();
  });
  it('diagnoses the unassigned columns', () => {
    expect(v().diagnostics.some((d) => d.includes('unassigned or in another category'))).toBe(true);
  });
});

describe('API-provided category results', () => {
  it('uses score_100 (normalised), not raw grade, for activities', () => {
    const t2 = row('Alpha').tasks.activities[1]!;
    expect(t2.grade).toBe(10);
    expect(t2.column.maxGrade).toBe(10);
    expect(t2.score100).toBe(100);
  });
  it('uses category_score_100 and contribution_points as given', () => {
    const alpha = row('Alpha');
    expect(alpha.tasks).toMatchObject({ average: 96.67, weight: 40, contribution: 38.67 });
    expect(alpha.exams).toMatchObject({ average: 85, weight: 40, contribution: 34 });
    expect(alpha.participation).toMatchObject({ average: 90, weight: 20, contribution: 18 });
  });
  it('flags a contribution inconsistent with score × weight', () => {
    const data = contract();
    data.students[0]!.categories[0]!.contribution_points = 10;
    expect(view(data).diagnostics.some((d) => d.includes('score × weight'))).toBe(true);
  });
});

describe('final grade', () => {
  it('is tasks + exams + participation contributions when all exist', () => {
    const alpha = row('Alpha');
    expect(alpha.finalGrade).toBe(90.67); // 38.67 + 18 + 34
    expect(alpha.complete).toBe(true);
    expect(alpha.missing).toEqual([]);
    expect(row('Delta').finalGrade).toBe(80);
  });
  it('null participation makes the final INCOMPLETA (not renormalised)', () => {
    const charlie = row('Charlie');
    expect(charlie.participation.average).toBeNull();
    expect(charlie.finalGrade).toBeNull();
    expect(charlie.missing).toEqual(['participation']);
    expect(charlie.apiCurrent.score100).toBe(100); // the API would say 100; must not be used
  });
  it('a category with nothing graded makes the final incomplete', () => {
    const echo = row('Echo');
    expect(echo.exams.average).toBeNull();
    expect(echo.missing).toEqual(['exams']);
    expect(echo.finalGrade).toBeNull();
    expect(echo.apiCurrent.score100).toBe(93.33);
  });
  it('real zeros (including participation) stay zero and the final stays complete', () => {
    const bravo = row('Bravo');
    expect(bravo.tasks.activities[0]!.score100).toBe(0);
    expect(bravo.exams.activities[0]!.score100).toBe(0);
    expect(bravo.participation).toMatchObject({ average: 0, contribution: 0 });
    expect(bravo.finalGrade).toBe(40);
  });
  it('an ungraded activity is null and excluded by the API from the average, not zero', () => {
    const delta = row('Delta');
    expect(delta.tasks.activities[2]!.score100).toBeNull();
    expect(delta.tasks.average).toBe(80);
  });
  it('a missing category makes every final incomplete and is diagnosed', () => {
    const data = contract();
    data.scheme = data.scheme.filter((s) => s.name !== 'Exámenes');
    for (const s of data.students) s.categories = s.categories.filter((c) => c.name !== 'Exámenes');
    const v = view(data);
    expect(v.diagnostics.some((d) => d.includes('Missing category'))).toBe(true);
    expect(v.weights.exams).toBeNull();
    expect(v.rows.every((r) => r.finalGrade === null && r.missing.includes('exams'))).toBe(true);
    expect(v.columns.exams).toEqual([]);
  });
});
