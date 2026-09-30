import { calculateAverage, calculateContribution, calculateFinalGrade, type Grade } from './calc';
import type { GradebookContract } from './contract';

export type BlockKey = 'tasks' | 'exams' | 'participation';

export const BLOCK_LABELS: Record<BlockKey, string> = {
  tasks: 'Tareas',
  exams: 'Exámenes',
  participation: 'Participación / asistencia',
};

/** Academic API evaluation category codes backing each visible block. */
export const CATEGORY_CODES: Record<BlockKey, string> = {
  tasks: 'tasks',
  exams: 'exams',
  participation: 'attendance_participation',
};

/** Weights this MVP is designed around; deviations are reported, never overwritten. */
export const EXPECTED_WEIGHTS: Record<BlockKey, number> = {
  tasks: 40,
  exams: 40,
  participation: 20,
};

/** Reporting classification by activity type (independent of category assignment). */
const ACTIVITY_BLOCK: Record<string, 'tasks' | 'exams'> = { assign: 'tasks', quiz: 'exams' };

export interface ActivityColumn {
  itemId: number;
  name: string;
  activityType: string;
  index: number;
}

export interface ActivityGrade {
  column: ActivityColumn;
  grade: Grade;
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
  fullName: string;
  tasks: ActivityBlock;
  exams: ActivityBlock;
  participation: ScoreBlock;
  unclassified: ActivityGrade[];
  /** Gradebook-calculated; NOT an Academic API field. */
  finalGrade: Grade;
  missing: BlockKey[];
  complete: boolean;
}

export interface GradebookView {
  course: GradebookContract['course'];
  columns: { tasks: ActivityColumn[]; exams: ActivityColumn[]; unclassified: ActivityColumn[] };
  weights: Record<BlockKey, Grade>;
  diagnostics: string[];
  rows: StudentGradeRow[];
}

const BLOCKS: BlockKey[] = ['tasks', 'exams', 'participation'];

function resolveWeights(data: GradebookContract, diagnostics: string[]): Record<BlockKey, Grade> {
  const weights: Record<BlockKey, Grade> = { tasks: null, exams: null, participation: null };
  for (const block of BLOCKS) {
    const code = CATEGORY_CODES[block];
    const found = data.students.flatMap((s) =>
      s.evaluation.categories.filter((c) => c.code === code).map((c) => c.weight_percent),
    );
    const distinct = [...new Set(found)];
    if (data.students.length > 0 && distinct.length === 0) {
      diagnostics.push(
        `Missing category: the API evaluation has no "${code}" category (${BLOCK_LABELS[block]}).`,
      );
    } else if (found.length < data.students.length) {
      diagnostics.push(
        `Missing category: ${data.students.length - found.length} student(s) have no "${code}" category.`,
      );
    }
    if (distinct.length > 1) {
      diagnostics.push(
        `Inconsistent weights for ${BLOCK_LABELS[block]}: ${distinct.join(', ')}. Using ${distinct[0]}.`,
      );
    }
    weights[block] = distinct[0] ?? null;
  }
  const resolved = BLOCKS.map((b) => weights[b]);
  if (resolved.every((w) => w !== null)) {
    const sum = resolved.reduce<number>((a, w) => a + (w ?? 0), 0);
    if (sum !== 100) diagnostics.push(`Configured weights add up to ${sum}%, not 100%.`);
  }
  const differs = BLOCKS.some((b) => weights[b] !== null && weights[b] !== EXPECTED_WEIGHTS[b]);
  if (differs) {
    const actual = BLOCKS.map((b) => weights[b] ?? '—').join('/');
    diagnostics.push(
      `Configured weights (${actual}) differ from the 40/40/20 scheme this report was designed around. Displayed values use the configured weights.`,
    );
  }
  return weights;
}

/** Maps the validated API contract to the UI view model. */
export function buildGradebook(data: GradebookContract): GradebookView {
  const diagnostics: string[] = [];
  const columns: GradebookView['columns'] = { tasks: [], exams: [], unclassified: [] };

  data.columns.forEach((c, index) => {
    const column: ActivityColumn = {
      itemId: c.item_id,
      name: c.name,
      activityType: c.activity_type,
      index,
    };
    const block = ACTIVITY_BLOCK[c.activity_type];
    (block ? columns[block] : columns.unclassified).push(column);
  });
  if (columns.unclassified.length > 0) {
    const types = [...new Set(columns.unclassified.map((c) => c.activityType))].join(', ');
    diagnostics.push(
      `${columns.unclassified.length} activity column(s) of unknown type (${types}) are not included in any weighted block.`,
    );
  }

  const weights = resolveWeights(data, diagnostics);

  const rows = data.students.map((student): StudentGradeRow => {
    const gradeFor = (column: ActivityColumn): ActivityGrade => ({
      column,
      grade: student.grades[column.index] ?? null,
    });
    const activityBlock = (block: 'tasks' | 'exams'): ActivityBlock => {
      const activities = columns[block].map(gradeFor);
      const average = calculateAverage(activities.map((a) => a.grade));
      return {
        activities,
        average,
        weight: weights[block],
        contribution: calculateContribution(average, weights[block]),
      };
    };
    const tasks = activityBlock('tasks');
    const exams = activityBlock('exams');
    const category = student.evaluation.categories.find(
      (c) => c.code === CATEGORY_CODES.participation,
    );
    const participationAverage = category?.score_100 ?? null;
    const participation: ScoreBlock = {
      average: participationAverage,
      weight: weights.participation,
      contribution: calculateContribution(participationAverage, weights.participation),
    };
    const finalGrade = calculateFinalGrade(
      tasks.contribution,
      exams.contribution,
      participation.contribution,
    );
    const blocks: Record<BlockKey, ScoreBlock> = { tasks, exams, participation };
    const missing = BLOCKS.filter((b) => blocks[b].contribution === null);
    return {
      studentId: student.student_id,
      accountNumber: student.account_number,
      fullName: student.full_name,
      tasks,
      exams,
      participation,
      unclassified: columns.unclassified.map(gradeFor),
      finalGrade,
      missing,
      complete: finalGrade !== null,
    };
  });

  return { course: data.course, columns, weights, diagnostics, rows };
}
