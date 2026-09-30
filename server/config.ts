import { z } from 'zod';

export interface Config {
  dataSource: 'fixture' | 'api';
  port: number;
  fixturePath: string;
  academicApi: {
    baseUrl: string;
    apiKey: string;
    courseId: string;
    gradebookPath: string;
    timeoutMs: number;
  } | null;
}

const empty = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  DATA_SOURCE: z.preprocess(empty, z.enum(['fixture', 'api']).default('fixture')),
  PORT: z.preprocess(empty, z.coerce.number().int().min(1).max(65535).default(3000)),
  FIXTURE_PATH: z.preprocess(empty, z.string().default('data/gradebook.fixture.json')),
  ACADEMIC_API_BASE_URL: z.preprocess(empty, z.url({ protocol: /^https?$/ }).optional()),
  ACADEMIC_API_KEY: z.preprocess(empty, z.string().min(1).optional()),
  // digits only: the id is interpolated into a URL path
  COURSE_ID: z.preprocess(empty, z.string().regex(/^\d+$/).optional()),
  ACADEMIC_API_GRADEBOOK_PATH: z.preprocess(
    empty,
    z
      .string()
      .startsWith('/')
      .includes('{course_id}')
      .default('/admin/courses/{course_id}/gradebook'),
  ),
  ACADEMIC_API_TIMEOUT_MS: z.preprocess(empty, z.coerce.number().int().min(100).default(10000)),
});

/** Throws with variable NAMES only; values (notably the API key) are never included. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Invalid configuration for: ${names.join(', ')}`);
  }
  const e = parsed.data;
  let academicApi: Config['academicApi'] = null;
  if (e.DATA_SOURCE === 'api') {
    const missing = (
      [
        ['ACADEMIC_API_BASE_URL', e.ACADEMIC_API_BASE_URL],
        ['ACADEMIC_API_KEY', e.ACADEMIC_API_KEY],
        ['COURSE_ID', e.COURSE_ID],
      ] as const
    )
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`DATA_SOURCE=api requires: ${missing.join(', ')}`);
    }
    academicApi = {
      baseUrl: e.ACADEMIC_API_BASE_URL!.replace(/\/+$/, ''),
      apiKey: e.ACADEMIC_API_KEY!,
      courseId: e.COURSE_ID!,
      gradebookPath: e.ACADEMIC_API_GRADEBOOK_PATH,
      timeoutMs: e.ACADEMIC_API_TIMEOUT_MS,
    };
  }
  return { dataSource: e.DATA_SOURCE, port: e.PORT, fixturePath: e.FIXTURE_PATH, academicApi };
}
