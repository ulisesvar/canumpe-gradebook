import express, { type Express } from 'express';
import type { GradebookEnvelope } from '../src/domain/contract';
import type { Config } from './config';
import { fetchFromAcademicApi, GradebookError, loadFixture } from './gradebookSource';

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

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Not found.' });
  });

  return app;
}
