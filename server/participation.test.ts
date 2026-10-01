import request from 'supertest';
import { createApp } from './app';
import { loadConfig, type Config } from './config';

const SECRET = 'test-secret-key-123';
const apiEnv = {
  DATA_SOURCE: 'api',
  ACADEMIC_API_BASE_URL: 'https://academic.invalid/',
  ACADEMIC_API_KEY: SECRET,
  COURSE_ID: '42',
};
const config: Config = loadConfig(apiEnv);

/** What the Academic API answers for a recorded observation (the Gradebook ignores the body). */
const created = () =>
  new Response(
    JSON.stringify({
      observation_id: 1,
      value: 0,
      participation_count: 1,
      participation_average: 0.0,
      participation_score_100: 0.0,
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
const upstream = (status: number, body: unknown = { detail: 'upstream text must not leak' }) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const appWith = (fetchImpl: typeof fetch, cfg: Config = config) => createApp(cfg, { fetchImpl });
const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  request(app)
    .post('/api/participation')
    .send(body as object);

describe('POST /api/participation (api mode)', () => {
  it('records ONE observation with the key server-side and never leaks it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(created());
    const res = await post(appWith(fetchImpl), { student_id: 7, value: 2 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://academic.invalid/admin/courses/42/students/7/participation');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe(SECRET);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"value":2}');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.headers)).not.toContain(SECRET);
  });

  it('sends a ZERO as a real zero (value 0, never dropped or defaulted)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(created());
    const res = await post(appWith(fetchImpl), { student_id: 7, value: 0 });

    expect(res.status).toBe(201);
    expect(fetchImpl.mock.calls[0]![1].body).toBe('{"value":0}');
  });

  it.each([0, 1, 2, 3])('forwards value %i exactly', async (value) => {
    const fetchImpl = vi.fn().mockResolvedValue(created());
    await post(appWith(fetchImpl), { student_id: 3, value });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toEqual({ value });
  });

  it('never sends a date: observed_at is left to the Academic API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(created());
    await post(appWith(fetchImpl), {
      student_id: 7,
      value: 1,
      observed_at: '2020-01-01T00:00:00Z',
    });
    expect(Object.keys(JSON.parse(fetchImpl.mock.calls[0]![1].body))).toEqual(['value']);
  });

  it('ignores anything else the browser sends (no open proxy)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(created());
    const res = await request(appWith(fetchImpl))
      .post('/api/participation?course_id=1&url=http://evil.test')
      .set('X-API-Key', 'attacker')
      .send({ student_id: 7, value: 2, course_id: 1, url: 'http://evil.test', api_key: 'x' });

    expect(res.status).toBe(201);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://academic.invalid/admin/courses/42/students/7/participation');
    expect(init.headers['X-API-Key']).toBe(SECRET);
    expect(init.body).toBe('{"value":2}');
  });

  it('every request creates a new observation: two for the same student are two calls', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => created());
    const app = appWith(fetchImpl);

    await post(app, { student_id: 7, value: 2 });
    await post(app, { student_id: 7, value: 1 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'POST']);
    expect(fetchImpl.mock.calls.map(([, init]) => init.body)).toEqual([
      '{"value":2}',
      '{"value":1}',
    ]);
  });

  it('uses the configured API base URL without a double slash', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(created());
    await post(appWith(fetchImpl), { student_id: 12, value: 3 });
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://academic.invalid/admin/courses/42/students/12/participation',
    );
  });
});

describe('POST /api/participation (validation)', () => {
  it.each([
    ['value -1', { student_id: 7, value: -1 }],
    ['value 4', { student_id: 7, value: 4 }],
    ['value 1.5', { student_id: 7, value: 1.5 }],
    ['value "2" (string)', { student_id: 7, value: '2' }],
    ['value null', { student_id: 7, value: null }],
    ['value missing', { student_id: 7 }],
    ['student_id 0', { student_id: 0, value: 1 }],
    ['student_id -1', { student_id: -1, value: 1 }],
    ['student_id 1.5', { student_id: 1.5, value: 1 }],
    ['student_id "7" (string)', { student_id: '7', value: 1 }],
    ['student_id path trick', { student_id: '7/../../x', value: 1 }],
    ['student_id null', { student_id: null, value: 1 }],
    ['student_id missing', { value: 1 }],
    ['an array', [{ student_id: 7, value: 1 }]],
    ['an empty object', {}],
  ])('rejects %s without calling the Academic API', async (_label, body) => {
    const fetchImpl = vi.fn();
    const res = await post(appWith(fetchImpl), body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an empty or malformed JSON body', async () => {
    const fetchImpl = vi.fn();
    const app = appWith(fetchImpl);

    const empty = await request(app)
      .post('/api/participation')
      .set('Content-Type', 'application/json');
    const broken = await request(app)
      .post('/api/participation')
      .set('Content-Type', 'application/json')
      .send('{"student_id": 7, "value":');

    expect([empty.status, broken.status]).toEqual([400, 400]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('POST /api/participation (browser safety)', () => {
  it.each(['cross-site', 'same-site', 'none'])(
    'refuses a request the browser labels Sec-Fetch-Site: %s',
    async (site) => {
      const fetchImpl = vi.fn();
      const res = await request(appWith(fetchImpl))
        .post('/api/participation')
        .set('Sec-Fetch-Site', site)
        .send({ student_id: 7, value: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden_origin');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('accepts the Gradebook page itself (same-origin) and clients that send no label', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => created());
    const app = appWith(fetchImpl);

    const sameOrigin = await request(app)
      .post('/api/participation')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ student_id: 7, value: 1 });
    const unlabeled = await post(app, { student_id: 7, value: 1 });

    expect([sameOrigin.status, unlabeled.status]).toEqual([201, 201]);
  });

  it.each(['application/x-www-form-urlencoded', 'text/plain'])(
    'refuses %s (only JSON is accepted)',
    async (contentType) => {
      const fetchImpl = vi.fn();
      const res = await request(appWith(fetchImpl))
        .post('/api/participation')
        .set('Content-Type', contentType)
        .send('student_id=7&value=1');

      expect(res.status).toBe(415);
      expect(res.body.error).toBe('unsupported_media_type');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('answers no CORS headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(created());
    const res = await request(appWith(fetchImpl))
      .post('/api/participation')
      .set('Origin', 'https://evil.test')
      .send({ student_id: 7, value: 1 });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('only exists as POST', async () => {
    const res = await request(appWith(vi.fn())).get('/api/participation');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/participation (fixture mode)', () => {
  it('is read-only: refuses to record and never touches the network', async () => {
    const fetchImpl = vi.fn();
    const res = await post(createApp(loadConfig({}), { fetchImpl }), { student_id: 7, value: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('read_only_source');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('POST /api/participation (Academic API errors)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    [401, 502, 'unauthorized'],
    [403, 502, 'forbidden'],
    [404, 404, 'not_found'],
    [422, 400, 'invalid_request'],
    [500, 502, 'api_unavailable'],
    [200, 502, 'api_unavailable'],
  ])('maps upstream %i to %i %s without forwarding upstream text', async (status, http, error) => {
    const fetchImpl = vi.fn().mockResolvedValue(upstream(status));
    const res = await post(appWith(fetchImpl), { student_id: 7, value: 1 });

    expect(res.status).toBe(http);
    expect(res.body.error).toBe(error);
    expect(JSON.stringify(res.body)).not.toContain('upstream text must not leak');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('maps a network failure to api_unavailable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`boom ${SECRET}`));
    const res = await post(appWith(fetchImpl), { student_id: 7, value: 1 });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('api_unavailable');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});
