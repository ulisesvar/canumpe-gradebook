import express, { type Express } from 'express';
import type { GradebookEnvelope } from '../src/domain/contract';
import {
  participationRequestSchema,
  type ParticipationErrorCode,
} from '../src/domain/participation';
import type { Config } from './config';
import { fetchFromAcademicApi, GradebookError, loadFixture } from './gradebookSource';
import { ParticipationError, postParticipationObservation } from './participationSource';

export interface AppDeps {
  fetchImpl?: typeof fetch;
}

/** API routes only. Static assets / Vite are attached by index.ts. */
export function createApp(config: Config, deps: AppDeps = {}): Express {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const app = express();
  app.disable('x-powered-by');

  // Liveness only: deliberately does not touch the Academic API.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/gradebook', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const data =
        config.dataSource === 'fixture'
          ? await loadFixture(config.fixturePath)
          : await fetchFromAcademicApi(config.academicApi!, fetchImpl);
      const body: GradebookEnvelope = { source: config.dataSource, data };
      res.json(body);
    } catch (err) {
      if (err instanceof GradebookError) {
        res.status(err.httpStatus).json({ error: err.code, message: err.message });
      } else {
        console.error('Unexpected error loading gradebook');
        res.status(500).json({ error: 'api_unavailable', message: 'Unexpected server error.' });
      }
    }
  });

  // The only write route: records ONE new participation observation (student_id + value).
  // The admin API key stays in this process; the browser never sees it and cannot choose the
  // course, URL or credentials. Like the rest of the app it relies on the access control in front
  // of the Gradebook, and additionally refuses cross-site browser requests and non-JSON bodies.
  app.post(
    '/api/participation',
    express.raw({ type: 'application/json', limit: '1kb' }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const fail = (code: ParticipationErrorCode, status: number, message: string) =>
        res.status(status).json({ error: code, message });

      // Browsers label every request; the Gradebook's own page sends "same-origin". Anything else
      // (cross-site / same-site pages) is refused. Non-browser clients send no label.
      const site = req.get('sec-fetch-site');
      if (site !== undefined && site !== 'same-origin') {
        return fail('forbidden_origin', 403, 'Cross-site requests are not allowed.');
      }
      // JSON only: a cross-origin page cannot send this content type without a CORS preflight,
      // and this server answers none.
      if (!/^application\/json(\s*;|$)/i.test(req.get('content-type') ?? '')) {
        return fail('unsupported_media_type', 415, 'Send the request as application/json.');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
      } catch {
        return fail('invalid_request', 400, 'The request body is not valid JSON.');
      }
      const parsed = participationRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return fail(
          'invalid_request',
          400,
          'student_id must be a positive integer and value must be 0, 1, 2 or 3.',
        );
      }
      if (config.dataSource !== 'api' || config.academicApi === null) {
        return fail(
          'read_only_source',
          409,
          'Recording participation requires DATA_SOURCE=api (fixture mode is read-only).',
        );
      }
      try {
        await postParticipationObservation(
          config.academicApi,
          parsed.data.student_id,
          parsed.data.value,
          fetchImpl,
        );
        res.status(201).json({ ok: true });
      } catch (err) {
        if (err instanceof ParticipationError) {
          fail(err.code, err.httpStatus, err.message);
        } else {
          console.error('Unexpected error recording participation');
          fail('api_unavailable', 500, 'Unexpected server error.');
        }
      }
    },
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Not found.' });
  });

  return app;
}
