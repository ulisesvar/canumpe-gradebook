import { calculateFinalGrade, type Grade } from './calc';
import type { GradebookContract } from './contract';

export type BlockKey = 'tasks' | 'exams' | 'participation';

export const BLOCK_LABELS: Record<BlockKey, string> = {
  tasks: 'Tareas',
  exams: 'Exámenes',
  participation: 'Participación / asistencia',
};

/** Weights this MVP is designed around; deviations are reported, never overwritten. */
export const EXPECTED_WEIGHTS: Record<BlockKey, number> = {
  tasks: 40,
  exams: 40,
  participation: 20,
};

/**
 * The three grading blocks are identified from scheme[] by category NAME, once; every later
 * lookup (columns, student results, weights) uses the resolved category_id. calculation_type is
 * deliberately NOT used: in the real course "Participación / asistencia" is a GRADE_ITEMS category.
 * Names are compared ignoring case, accents and spacing around "/".
 */
export const BLOCK_CATEGORY_NAMES: Record<BlockKey, string[]> = {
  tasks: ['Entregables / tareas', 'Tareas', 'Tasks'],
  exams: ['Exámenes', 'Examenes', 'Exams'],
  participation: [
    'Participación / asistencia',
    'Asistencia / participación',
    'Participation / attendance',
  ],
};

const normalizeName = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

export interface ActivityColumn {
  activityId: number;
  name: string;
  activityType: string | null;
  maxGrade: number;
  categoryId: number | null;
  categoryName: string | null;
  /** false = shown but excluded from the category score by the Academic API */
  counts: boolean | null;
  index: number;
}

export interface ActivityGrade {
  column: ActivityColumn;
  /** raw grade on the activity's own scale */
  grade: Grade;
  /** normalised percentage, the value displayed and compared */
  score100: Grade;
}

export interface ScoreBlock {
  average: Grade;
  weight: Grade;
  contribution: Grade;
}

export interface ActivityBlock extends ScoreBlock {
  activities: ActivityGrade[];
}

export interface StudentGradeRow {
  studentId: number;
  accountNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  tasks: ActivityBlock;
  exams: ActivityBlock;
  participation: ActivityBlock;
  /** Activities outside the weighted blocks (unassigned or another category). */
  unclassified: ActivityGrade[];
  /** Gradebook-calculated; NOT an Academic API field. null = INCOMPLETA. */
  finalGrade: Grade;
  missing: BlockKey[];
  complete: boolean;
  /** Explains why participation/attendance is null, when the API says so. */
  participationNotes: string[];
  /** Academic API's own current grade (renormalised); shown for reference only. */
  apiCurrent: { score100: Grade; grade10: Grade; evaluatedWeight: number };
}

export interface GradebookView {
  course: GradebookContract['course'];
  columns: {
    tasks: ActivityColumn[];
    exams: ActivityColumn[];
    participation: ActivityColumn[];
    unclassified: ActivityColumn[];
  };
  weights: Record<BlockKey, Grade>;
  diagnostics: string[];
  rows: StudentGradeRow[];
}

const BLOCKS: BlockKey[] = ['tasks', 'exams', 'participation'];

type SchemeEntry = GradebookContract['scheme'][number];

function resolveCategories(
  data: GradebookContract,
  diagnostics: string[],
): Record<BlockKey, SchemeEntry | null> {
  const resolve = (block: BlockKey): SchemeEntry | null => {
    const names = BLOCK_CATEGORY_NAMES[block].map(normalizeName);
    const matches = data.scheme.filter((s) => names.includes(normalizeName(s.name)));
    if (matches.length === 1) return matches[0]!;
    diagnostics.push(
      matches.length === 0
        ? `Missing category: no scheme category matches ${BLOCK_LABELS[block]}.`
        : `Ambiguous category: several scheme categories match ${BLOCK_LABELS[block]}.`,
    );
    return null;
  };
  return {
    tasks: resolve('tasks'),
    exams: resolve('exams'),
    participation: resolve('participation'),
  };
}

function checkScheme(
  data: GradebookContract,
  categories: Record<BlockKey, SchemeEntry | null>,
  diagnostics: string[],
) {
  const used = new Set(BLOCKS.map((b) => categories[b]?.category_id));
  const others = data.scheme.filter((s) => !used.has(s.category_id));
  if (others.length > 0) {
    diagnostics.push(
      `Scheme categories not shown in this report (and not in the final): ${others.map((s) => s.name).join(', ')}.`,
    );
  }
  const total = data.scheme.reduce((sum, s) => sum + s.weight_percent, 0);
  if (Math.abs(total - 100) > 0.005) {
    diagnostics.push(`Configured weights add up to ${total}%, not 100%.`);
  }
  const differs = BLOCKS.some((b) => {
    const w = categories[b]?.weight_percent;
    return w !== undefined && w !== EXPECTED_WEIGHTS[b];
  });
  if (differs) {
    const actual = BLOCKS.map((b) => categories[b]?.weight_percent ?? '—').join('/');
    diagnostics.push(
      `Configured weights (${actual}) differ from the 40/40/20 scheme this report was designed around. Displayed values use the configured weights.`,
    );
  }
}

/** Maps the validated API contract to the UI view model. */
export function buildGradebook(data: GradebookContract): GradebookView {
  const diagnostics: string[] = [];
  const categories = resolveCategories(data, diagnostics);
  checkScheme(data, categories, diagnostics);

  const weights: Record<BlockKey, Grade> = {
    tasks: categories.tasks?.weight_percent ?? null,
    exams: categories.exams?.weight_percent ?? null,
    participation: categories.participation?.weight_percent ?? null,
  };

  const columns: GradebookView['columns'] = {
    tasks: [],
    exams: [],
    participation: [],
    unclassified: [],
  };
  data.columns.forEach((c, index) => {
    const column: ActivityColumn = {
      activityId: c.activity_id,
      name: c.name,
      activityType: c.activity_type,
      maxGrade: c.max_grade,
      categoryId: c.category_id,
      categoryName: c.category_name,
      counts: c.counts_toward_current_grade,
      index,
    };
    // Category membership (category_id) decides; activity_type never does. Unassigned
    // (category_id null) and other-category items stay out of every block.
    const block = BLOCKS.find(
      (k) => c.category_id !== null && c.category_id === categories[k]?.category_id,
    );
    columns[block ?? 'unclassified'].push(column);
  });
  const notCounted = data.columns.filter(
    (c) => c.category_id !== null && c.counts_toward_current_grade === false,
  ).length;
  if (notCounted > 0) {
    diagnostics.push(
      `${notCounted} activity column(s) do not count toward the grade (marked *); the API excludes them from the category score.`,
    );
  }
  if (columns.unclassified.length > 0) {
    diagnostics.push(
      `${columns.unclassified.length} activity column(s) are unassigned or in another category; they are shown separately and do not affect the final.`,
    );
  }

  let contributionMismatch = false;
  const rows = data.students.map((student): StudentGradeRow => {
    const gradeFor = (column: ActivityColumn): ActivityGrade => {
      const cell = student.grades[column.index]!;
      return { column, grade: cell.grade, score100: cell.score_100 };
    };
    const scoreBlock = (entry: SchemeEntry | null): ScoreBlock => {
      const result = entry
        ? student.categories.find((c) => c.category_id === entry.category_id)
        : undefined;
      const average = result?.category_score_100 ?? null;
      const contribution = result?.contribution_points ?? null;
      const weight = entry?.weight_percent ?? null;
      if (
        average !== null &&
        contribution !== null &&
        weight !== null &&
        Math.abs((average * weight) / 100 - contribution) > 0.011
      ) {
        contributionMismatch = true;
      }
      return { average, weight, contribution };
    };
    const tasks: ActivityBlock = {
      ...scoreBlock(categories.tasks),
      activities: columns.tasks.map(gradeFor),
    };
    const exams: ActivityBlock = {
      ...scoreBlock(categories.exams),
      activities: columns.exams.map(gradeFor),
    };
    const participation: ActivityBlock = {
      ...scoreBlock(categories.participation),
      activities: columns.participation.map(gradeFor),
    };

    const blocks: Record<BlockKey, ScoreBlock> = { tasks, exams, participation };
    const missing = BLOCKS.filter((b) => blocks[b].contribution === null);
    const finalGrade = calculateFinalGrade(
      tasks.contribution,
      exams.contribution,
      participation.contribution,
    );

    const participationNotes: string[] = [];
    if (student.participation.participation_count === 0) {
      participationNotes.push('No participation data has been entered.');
    }
    if (student.attendance.closed_sessions === 0) {
      participationNotes.push('The course has no closed attendance sessions.');
    }

    return {
      studentId: student.student_id,
      accountNumber: student.account_number,
      firstName: student.first_name,
      lastName: student.last_name,
      fullName: student.full_name,
      tasks,
      exams,
      participation,
      unclassified: columns.unclassified.map(gradeFor),
      finalGrade,
      missing,
      complete: finalGrade !== null,
      participationNotes,
      apiCurrent: {
        score100: student.current_score_100,
        grade10: student.current_grade_10,
        evaluatedWeight: student.evaluated_weight_percent,
      },
    };
  });
  if (contributionMismatch) {
    diagnostics.push(
      'Some API category contributions do not equal score × weight / 100; displayed values are the API values.',
    );
  }

  return { course: data.course, columns, weights, diagnostics, rows };
}
