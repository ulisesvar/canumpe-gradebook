import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';

/**
 * The Academic API admin key lives only in the backend process. These tests build the real
 * production frontend bundle and read the client source to prove it never ships to the browser.
 */
const SECRET = 'sk-test-SECRET-must-never-ship-9f3a1c7e';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(full) : Promise.resolve([full]);
    }),
  );
  return nested.flat();
}

describe('the Academic API key never reaches the browser', () => {
  it('is absent from the production frontend bundle, even if the build environment has it', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'gradebook-bundle-'));
    const saved = {
      key: process.env.ACADEMIC_API_KEY,
      viteKey: process.env.VITE_ACADEMIC_API_KEY,
    };
    // Worst case: the secret is present in the build environment under both names.
    process.env.ACADEMIC_API_KEY = SECRET;
    process.env.VITE_ACADEMIC_API_KEY = SECRET;
    try {
      await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });

      const files = await filesUnder(outDir);
      expect(files.some((f) => f.endsWith('.js'))).toBe(true);
      expect(files.some((f) => f.endsWith('index.html'))).toBe(true);
      for (const file of files) {
        const text = await readFile(file, 'utf8');
        expect(text, file).not.toContain(SECRET);
        expect(text, file).not.toContain('X-API-Key');
        expect(text, file).not.toContain('ACADEMIC_API_KEY');
      }
    } finally {
      for (const [name, value] of [
        ['ACADEMIC_API_KEY', saved.key],
        ['VITE_ACADEMIC_API_KEY', saved.viteKey],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('is not referenced by any client source file (no env vars, headers or browser storage)', async () => {
    const sources = (await filesUnder('src')).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.includes('/test/'),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = await readFile(file, 'utf8');
      for (const forbidden of [
        'X-API-Key',
        'ACADEMIC_API_KEY',
        'import.meta.env',
        'VITE_',
        'localStorage',
        'sessionStorage',
      ]) {
        expect(text, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
