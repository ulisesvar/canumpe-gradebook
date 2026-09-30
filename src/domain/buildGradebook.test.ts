import fixture from '../../data/gradebook.fixture.json';
import { buildGradebook } from './buildGradebook';
import { gradebookSchema, type GradebookContract } from './contract';

const contract = (): GradebookContract => gradebookSchema.parse(structuredClone(fixture));
const view = () => buildGradebook(contract());
const row = (name: string) => view().rows.find((r) => r.fullName.includes(name))!;

describe('contract validation', () => {
  it('accepts the documented shape (fixture)', () => {
    expect(gradebookSchema.safeParse(fixture).success).toBe(true);
  });
  it('rejects a response missing students', () => {
    const rest: Partial<typeof fixture> = structuredClone(fixture);
    delete rest.students;
    expect(gradebookSchema.safeParse(rest).success).toBe(false);
  });
  it('rejects grades not aligned with columns', () => {
    const bad = structuredClone(fixture);
    bad.students[0]!.grades.pop();
    expect(gradebookSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects string grades', () => {
    const bad = structuredClone(fixture) as unknown as { students: { grades: unknown[] }[] };
    bad.students[0]!.grades[0] = '100';
    expect(gradebookSchema.safeParse(bad).success).toBe(false);
  });
});

describe('buildGradebook', () => {
  it('classifies assign as tasks and quiz as exams', () => {
    const v = view();
    expect(v.columns.tasks.map((c) => c.name)).toEqual(['Task 01', 'Task 02', 'Task 03']);
    expect(v.columns.exams.map((c) => c.name)).toEqual(['Exam 01', 'Exam 02']);
  });
  it('does not silently classify unknown types; reports them', () => {
    const v = view();
    expect(v.columns.unclassified.map((c) => c.activityType)).toEqual(['forum']);
    expect(v.diagnostics.some((d) => d.includes('unknown type'))).toBe(true);
    // Golf has a forum grade of 70 that must not leak into any block
    expect(row('Golf').exams.average).toBe(60);
  });
  it('classifies by activity type even if the API categories disagree', () => {
    const data = contract();
    data.students[0]!.evaluation.categories = data.students[0]!.evaluation.categories.map((c) => ({
      ...c,
      score_100: 1,
    }));
    expect(buildGradebook(data).rows[0]!.tasks.average).toBe(100);
  });
  it('reads weights from the API evaluation', () => {
    expect(view().weights).toEqual({ tasks: 40, exams: 40, participation: 20 });
    expect(view().diagnostics.some((d) => d.includes('differ'))).toBe(false);
  });
  it('shows configured weights and a diagnostic when they differ from 40/40/20', () => {
    const data = contract();
    for (const s of data.students) {
      s.evaluation.categories.find((c) => c.code === 'tasks')!.weight_percent = 50;
    }
    const v = buildGradebook(data);
    expect(v.weights.tasks).toBe(50);
    expect(v.diagnostics.some((d) => d.includes('differ'))).toBe(true);
    expect(v.diagnostics.some((d) => d.includes('not 100%'))).toBe(true);
    expect(v.rows[0]!.tasks.contribution).toBe(50);
  });
  it('reports a missing category and makes every final incomplete', () => {
    const data = contract();
    for (const s of data.students) {
      s.evaluation.categories = s.evaluation.categories.filter((c) => c.code !== 'exams');
    }
    const v = buildGradebook(data);
    expect(v.diagnostics.some((d) => d.includes('Missing category'))).toBe(true);
    expect(v.rows.every((r) => r.finalGrade === null && r.missing.includes('exams'))).toBe(true);
  });

  describe('student scenarios', () => {
    it('normal student, complete final', () => {
      const r = row('Alpha');
      expect(r.tasks.average).toBe(100);
      expect(r.tasks.contribution).toBe(40);
      expect(r.exams.average).toBe(85);
      expect(r.exams.contribution).toBe(34);
      expect(r.participation.average).toBe(90);
      expect(r.participation.contribution).toBe(18);
      expect(r.finalGrade).toBe(92);
      expect(r.complete).toBe(true);
    });
    it('zero grades stay zero and the final stays complete', () => {
      const r = row('Bravo');
      expect(r.tasks.activities[0]!.grade).toBe(0);
      expect(r.tasks.average).toBe(50);
      expect(r.participation.average).toBe(0);
      expect(r.participation.contribution).toBe(0);
      expect(r.finalGrade).toBe(40);
    });
    it('ungraded task is excluded from the average, not zeroed', () => {
      const r = row('Charlie');
      expect(r.tasks.activities[2]!.grade).toBeNull();
      expect(r.tasks.average).toBe(90);
      expect(r.finalGrade).toBe(96);
    });
    it('some exams ungraded: average over graded exams', () => {
      const r = row('Delta');
      expect(r.exams.average).toBe(70);
      expect(r.finalGrade).toBe(76);
    });
    it('missing participation gives an incomplete final, not a zero', () => {
      const r = row('Echo');
      expect(r.participation.average).toBeNull();
      expect(r.finalGrade).toBeNull();
      expect(r.complete).toBe(false);
      expect(r.missing).toEqual(['participation']);
    });
    it('no exams graded gives an incomplete final', () => {
      const r = row('Foxtrot');
      expect(r.exams.average).toBeNull();
      expect(r.missing).toEqual(['exams']);
      expect(r.finalGrade).toBeNull();
    });
  });
});
