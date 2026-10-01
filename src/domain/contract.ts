import { z } from 'zod';

/**
 * Runtime schema for the Academic API's GET /admin/courses/{course_id}/gradebook
 * (canumpe-academic-platform v0.2.1, app/api/schemas/gradebook.py).
 *
 * null always means "not calculable / not graded" (never 0). `grade` is on the
 * activity's own scale (max_grade); `score_100` is the normalised percentage.
 * The API exposes NO final grade. Unknown extra fields are ignored.
 */
const num = z.number().finite();
const id = z.number().int();

export const calculationTypes = ['GRADE_ITEMS', 'ATTENDANCE_PARTICIPATION'] as const;

const schemeEntrySchema = z.object({
  category_id: id,
  name: z.string(),
  calculation_type: z.string(),
  weight_percent: num,
  sort_order: z.number().int(),
});

const columnShape = {
  activity_id: id,
  name: z.string(),
  activity_type: z.string().nullable(),
  max_grade: num,
  category_id: id.nullable(),
  category_name: z.string().nullable(),
  counts_toward_current_grade: z.boolean().nullable(),
};
const columnSchema = z.object(columnShape);
const gradeCellSchema = z.object({
  ...columnShape,
  grade: num.nullable(),
  score_100: num.nullable(),
});

const categoryResultSchema = z.object({
  category_id: id,
  name: z.string(),
  calculation_type: z.string(),
  weight_percent: num,
  category_score_100: num.nullable(),
  contribution_points: num.nullable(),
});

const studentSchema = z.object({
  student_id: id,
  account_number: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  full_name: z.string(),
  grades: z.array(gradeCellSchema),
  attendance: z.object({
    closed_sessions: z.number().int(),
    present_sessions: z.number().int(),
    absent_sessions: z.number().int(),
    score_100: num.nullable(),
  }),
  participation: z.object({
    participation_count: z.number().int(),
    participation_average: num.nullable(),
    participation_score_100: num.nullable(),
  }),
  // present only when the course has an ATTENDANCE_PARTICIPATION category; its
  // internal 33/67 build-up is intentionally not modelled (not shown in the report)
  attendance_participation: z.object({ category_score_100: num.nullable() }).nullable(),
  categories: z.array(categoryResultSchema),
  weighted_points_earned: num,
  evaluated_weight_percent: num,
  current_score_100: num.nullable(),
  current_grade_10: num.nullable(),
});

export const gradebookSchema = z
  .object({
    course: z.object({ course_id: id, name: z.string() }),
    scheme: z.array(schemeEntrySchema),
    columns: z.array(columnSchema),
    students: z.array(studentSchema),
  })
  .superRefine((data, ctx) => {
    const unique = (values: number[], label: string) => {
      if (new Set(values).size !== values.length) {
        ctx.addIssue({ code: 'custom', message: `Duplicate ${label}` });
      }
    };
    unique(
      data.scheme.map((s) => s.category_id),
      'scheme category_id',
    );
    unique(
      data.columns.map((c) => c.activity_id),
      'column activity_id',
    );
    unique(
      data.students.map((s) => s.student_id),
      'student_id',
    );
    data.students.forEach((student, i) => {
      const path = ['students', i, 'grades'];
      if (student.grades.length !== data.columns.length) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `grades has ${student.grades.length} cells but there are ${data.columns.length} columns`,
        });
        return;
      }
      student.grades.forEach((cell, j) => {
        if (cell.activity_id !== data.columns[j]!.activity_id) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, j],
            message: 'grade cell not aligned with columns',
          });
        }
        if (cell.grade === null && cell.score_100 !== null) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, j],
            message: 'score_100 set but grade is null',
          });
        }
      });
    });
  });

export type GradebookContract = z.infer<typeof gradebookSchema>;

/** What the Gradebook backend returns to the browser. */
export const gradebookEnvelopeSchema = z.object({
  source: z.enum(['fixture', 'api']),
  data: gradebookSchema,
});
export type GradebookEnvelope = z.infer<typeof gradebookEnvelopeSchema>;

export const errorCodes = [
  'api_unavailable',
  'unauthorized',
  'forbidden',
  'course_not_found',
  'malformed_response',
  'config_error',
] as const;
export type ErrorCode = (typeof errorCodes)[number];
