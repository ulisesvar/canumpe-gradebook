import { z } from 'zod';

/**
 * Runtime schema for GET /admin/courses/{course_id}/gradebook.
 *
 * This is the ONLY place that knows the Academic API field names. The exact
 * field names below follow the documented shape (course / columns / students,
 * per-student grades aligned to columns, evaluation with categories) and must
 * be reconciled with the live endpoint once it is reachable.
 *
 * Grades are already normalised to 0-100 by the Academic API; null = not graded.
 */
const score = z.number().finite().min(0);
const weight = z.number().finite().min(0).max(100);

export const evaluationCategorySchema = z.object({
  code: z.string().min(1),
  name: z.string(),
  weight_percent: weight,
  score_100: score.nullable(),
  contribution: z.number().finite().nullable(),
});

export const gradebookSchema = z
  .object({
    course: z.object({
      course_id: z.number().int(),
      short_name: z.string(),
      full_name: z.string(),
    }),
    columns: z.array(
      z.object({
        item_id: z.number().int(),
        name: z.string(),
        activity_type: z.string().min(1),
      }),
    ),
    students: z.array(
      z.object({
        student_id: z.number().int(),
        account_number: z.string(),
        full_name: z.string(),
        grades: z.array(score.nullable()),
        evaluation: z.object({
          categories: z.array(evaluationCategorySchema),
          current_score_100: score.nullable(),
          current_grade_10: z.number().finite().nullable(),
        }),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    const itemIds = new Set<number>();
    for (const column of data.columns) {
      if (itemIds.has(column.item_id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate column item_id ${column.item_id}` });
      }
      itemIds.add(column.item_id);
    }
    const studentIds = new Set<number>();
    data.students.forEach((student, i) => {
      if (studentIds.has(student.student_id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate student_id ${student.student_id}` });
      }
      studentIds.add(student.student_id);
      if (student.grades.length !== data.columns.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['students', i, 'grades'],
          message: `grades has ${student.grades.length} entries but there are ${data.columns.length} columns`,
        });
      }
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
