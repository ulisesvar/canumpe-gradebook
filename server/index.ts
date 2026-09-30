import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { createApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig(process.env);
  const app = createApp(config);
  const server = createServer(app);

  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve('dist');
    app.use(express.static(dist));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    // Development: Vite runs inside this process, so one container serves UI + API with HMR.
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(config.port, () => {
    console.log(
      `CANUMPE Gradebook listening on :${config.port} (data source: ${config.dataSource})`,
    );
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Fatal error');
  process.exit(1);
});
