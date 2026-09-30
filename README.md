# CANUMPE Gradebook

Read-only, teacher-facing grade report for one course: every student's activities,
category averages, **weighted contribution (earned / maximum)** and a calculated final.

Gradebook is a *consumer* of the Academic API. It is not a second academic system:
it has no database, owns no student data, and **does not access Moodle (or any Moodle
database) directly**.

```
Moodle -> Moodle Sync -> Academic Database -> Academic API -> CANUMPE Gradebook -> Teacher browser

Browser --HTTP--> Gradebook (Express) --Bearer key, server-side--> Academic API
   (no key)        GET /api/gradebook     GET {base}/admin/courses/{COURSE_ID}/gradebook
```

## Local development (Docker only)

Requires only Docker / Docker Compose. Nothing is installed on the host.

```sh
cp .env.example .env      # optional; defaults to fixture mode
docker compose up --build # http://localhost:3000  (hot reload; Vite runs inside the server)
```

Run quality gates inside the container:

```sh
./docker-test.sh lint        # eslint
./docker-test.sh typecheck   # tsc --noEmit (strict)
./docker-test.sh test        # vitest
./docker-test.sh build       # vite build + server bundle
./docker-test.sh format      # prettier --write
```

## Data sources

| `DATA_SOURCE` | Behaviour |
|---|---|
| `fixture` (default) | `GET /api/gradebook` returns `data/gradebook.fixture.json`. No credentials, no network. The UI shows a "FIXTURE MODE" banner. |
| `api` | `GET /api/gradebook` calls the Academic API and returns the validated response. |

The fixture is **synthetic test data** (course "FIXTURE - synthetic test course"), shaped like the
documented contract. To use real data offline, replace its contents (or point `FIXTURE_PATH` at another
file, e.g. `data/x.real.json`, which is git-ignored) — no UI change is needed.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATA_SOURCE` | no | `fixture` (default) or `api` |
| `PORT` | no | Listen port (default 3000) |
| `ACADEMIC_API_BASE_URL` | api mode | e.g. `https://academic.example` (no assumed production URL) |
| `ACADEMIC_API_KEY` | api mode | Admin API key. Server-side only; sent as `Authorization: Bearer <key>` |
| `COURSE_ID` | api mode | Numeric course id |
| `ACADEMIC_API_GRADEBOOK_PATH` | no | Default `/admin/courses/{course_id}/gradebook` |
| `ACADEMIC_API_TIMEOUT_MS` | no | Default 10000 |
| `FIXTURE_PATH` | no | Default `data/gradebook.fixture.json` |

## Security model

- The API key lives only in the server process. It is never sent to the browser, logged, or included in errors.
- The browser cannot choose the upstream URL, course or credentials: `/api/gradebook` takes no input. No open proxy.
- Redirects from the Academic API are refused so the key cannot be forwarded elsewhere.
- Responses are validated with Zod on the server and again in the browser; unexpected data is rejected, not rendered.
- `.env` is git-ignored; fixtures contain no credentials. `/health` only reports that the process is up.

## Academic API dependency

Endpoint: `GET /admin/courses/{course_id}/gradebook` (admin key). All assumed field names are in **one
file**: [`src/domain/contract.ts`](src/domain/contract.ts). Reconcile it with the live endpoint the first time
API mode is run. Current assumptions (the local Academic API repo does not contain this endpoint yet):

- `course{course_id, short_name, full_name}`, `columns[{item_id, name, activity_type}]`
- `students[{student_id, account_number, full_name, grades[], evaluation}]`, `grades` aligned by index to `columns`, values already normalised 0-100 or `null`
- `evaluation.categories[{code, name, weight_percent, score_100, contribution}]` with codes `tasks`, `exams`, `attendance_participation` (mapped in [`buildGradebook.ts`](src/domain/buildGradebook.ts))
- Bearer authentication, as in the existing Academic API.

## Grade calculation rules

- `assign` -> **Tareas**, `quiz` -> **Exámenes** (by activity type, not by category assignment). Other types are listed as "Other / unclassified", excluded from weighted blocks, and reported in Diagnostics.
- Block average = mean of **non-null** grades. Contribution = `average * weight / 100`, shown as `earned / max` (e.g. `38.00 / 40`).
- **Participación / asistencia** is one block; its score comes from the API's combined category (the internal attendance/participation split stays inside the Academic API).
- Weights come from the API evaluation. If they differ from 40/40/20 (or don't add to 100, or a category is missing) the actual values are displayed and a diagnostic is shown.
- **CALIFICACIÓN FINAL** = tasks + exams + participation contributions. It is calculated by Gradebook; the Academic API has no final-grade field (`current_score_100` is not used as one).

### NULL semantics

`null` = not graded, **never 0**. Shown as `—`; a real zero shows `0`. A block with no graded activity has no
average/contribution, and the final becomes *Incomplete* (naming the missing block) rather than being computed with a zero. Incomplete finals sort last.

## Tests

`./docker-test.sh test` — calculation, mapping/validation, HTTP (fixture mode, API mode against a mocked Academic API, key never in responses), and UI (React Testing Library). No test touches production.

## Build and production

`docker build --target prod -t canumpe-gradebook .` produces a runtime-only image (no dev dependencies, runs as non-root, has a Docker `HEALTHCHECK` on `GET /health`).
[`compose.prod.yml`](compose.prod.yml) is prepared for `/opt/canumpe/gradebook` (image `ghcr.io/ulisesvar/canumpe-gradebook`, bound to 127.0.0.1 for a reverse proxy / Cloudflare tunnel, future host `gradebook.canumpe.com`).

**Deployment: not done.** No server, DNS or Cloudflare changes are part of this MVP. CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, build and validates the Docker build; it does not push an image.

## Known limitations

- The live gradebook field names are assumed (see above) until verified against the real endpoint.
- No authentication in front of the Gradebook itself; it is expected to sit behind the CANUMPE reverse proxy/tunnel access control.
- Single course (`COURSE_ID`), read-only.
