import request from 'supertest';
import fixture from '../data/gradebook.fixture.json';
import { createApp } from './app';
import { loadConfig, type Config } from './config';

const SECRET = 'test-secret-key-123';
const apiEnv = {
  DATA_SOURCE: 'api',
  ACADEMIC_API_BASE_URL: 'https://academic.invalid/',
  ACADEMIC_API_KEY: SECRET,
  COURSE_ID: '42',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GET /health', () => {
  it('is ok without any Academic API configuration', async () => {
    const res = await request(createApp(loadConfig({}))).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
  it('stays ok when the Academic API is down', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const res = await request(createApp(loadConfig(apiEnv), { fetchImpl })).get('/health');
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GET /api/gradebook (fixture mode)', () => {
  it('returns the fixture without touching the network', async () => {
    const fetchImpl = vi.fn();
    const res = await request(createApp(loadConfig({}), { fetchImpl })).get('/api/gradebook');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fixture');
    expect(res.body.data.students).toHaveLength(fixture.students.length);
    expect(res.body.data.scheme).toHaveLength(3);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('reports a missing fixture as config_error', async () => {
    const config = loadConfig({ FIXTURE_PATH: 'data/nope.json' });
    const res = await request(createApp(config)).get('/api/gradebook');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('config_error');
  });
});

describe('GET /api/gradebook (api mode)', () => {
  const config: Config = loadConfig(apiEnv);

  it('calls the configured endpoint with the key server-side and never leaks it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(fixture));
    const res = await request(createApp(config, { fetchImpl })).get('/api/gradebook');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('api');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://academic.invalid/admin/courses/42/gradebook');
    expect(init.headers['X-API-Key']).toBe(SECRET);
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.headers)).not.toContain(SECRET);
  });

  it('ignores anything the browser sends (no open proxy)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(fixture));
    await request(createApp(config, { fetchImpl }))
      .get('/api/gradebook?course_id=1&url=http://evil.test')
      .set('X-API-Key', 'attacker');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://academic.invalid/admin/courses/42/gradebook');
    expect(fetchImpl.mock.calls[0]![1].headers['X-API-Key']).toBe(SECRET);
  });

  it.each([
    [401, 502, 'unauthorized'],
    [403, 502, 'forbidden'],
    [404, 404, 'course_not_found'],
    [500, 502, 'api_unavailable'],
  ])('maps upstream %i ({detail} body) to %i %s', async (upstream, status, error) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ detail: `upstream says ${SECRET} is bad` }, upstream));
    const res = await request(createApp(config, { fetchImpl })).get('/api/gradebook');
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('upstream says'); // detail is not forwarded
  });

  it('maps network failure to api_unavailable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${SECRET}`));
    const res = await request(createApp(config, { fetchImpl })).get('/api/gradebook');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('api_unavailable');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('rejects a malformed Academic API response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(json({ course: {}, columns: 'x' }));
    const res = await request(createApp(config, { fetchImpl })).get('/api/gradebook');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('malformed_response');
  });
});

describe('loadConfig', () => {
  it('requires api settings in api mode, naming variables but not values', () => {
    expect(() => loadConfig({ DATA_SOURCE: 'api' })).toThrow(/ACADEMIC_API_KEY/);
  });
  it('rejects a non-numeric COURSE_ID (it is interpolated into a path)', () => {
    expect(() => loadConfig({ ...apiEnv, COURSE_ID: '1/../../x' })).toThrow(/COURSE_ID/);
  });
  it('never includes the key in error text', () => {
    try {
      loadConfig({ ...apiEnv, ACADEMIC_API_BASE_URL: 'not a url' });
    } catch (e) {
      expect(String(e)).not.toContain(SECRET);
    }
  });
});
