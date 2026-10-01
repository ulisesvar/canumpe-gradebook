# CANUMPE Gradebook

Teacher-facing grade report for one course: every student's activities,
category averages, **weighted contribution (earned / maximum)** and a calculated final.
It is read-only except for one thing: the **Participación** tab, which records participation
observations through the Academic API (see "Participation capture").

Gradebook is a _consumer_ of the Academic API. It is not a second academic system:
it has no database, owns no student data, and **does not access Moodle (or any Moodle
database) directly**.

```
Moodle -> Moodle Sync -> Academic Database -> Academic API -> CANUMPE Gradebook -> Teacher browser

Browser --HTTP--> Gradebook (Express) --X-API-Key, server-side--> Academic API
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

| `DATA_SOURCE`       | Behaviour                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `fixture` (default) | `GET /api/gradebook` returns `data/gradebook.fixture.json`. No credentials, no network. The UI shows a "FIXTURE MODE" banner. |
| `api`               | `GET /api/gradebook` calls the Academic API and returns the validated response.                                               |

The fixture is **synthetic test data** with the real course's scheme and assignment state (only Tarea 01 assigned, no participation); a fully assigned variant lives in `src/test/` for tests. To use real data offline, replace its contents (or point `FIXTURE_PATH` at another
file, e.g. `data/x.real.json`, which is git-ignored) — no UI change is needed.

### Environment variables

| Variable                      | Required | Description                                                     |
| ----------------------------- | -------- | --------------------------------------------------------------- |
| `DATA_SOURCE`                 | no       | `fixture` (default) or `api`                                    |
| `PORT`                        | no       | Listen port (default 3000)                                      |
| `ACADEMIC_API_BASE_URL`       | api mode | e.g. `https://academic.example` (no assumed production URL)     |
| `ACADEMIC_API_KEY`            | api mode | Admin API key. Server-side only; sent as the `X-API-Key` header |
| `COURSE_ID`                   | api mode | Numeric course id                                               |
| `ACADEMIC_API_GRADEBOOK_PATH` | no       | Default `/admin/courses/{course_id}/gradebook`                  |
| `ACADEMIC_API_TIMEOUT_MS`     | no       | Default 10000                                                   |
| `FIXTURE_PATH`                | no       | Default `data/gradebook.fixture.json`                           |

## Participation capture

The **Participación** tab lists every student of the course with the current observation count, average
and score (read from the Academic API's gradebook; nothing is averaged here) and a `[0] [1] [2] [3]` control.
All controls start empty. **Registrar participación** records one **new** observation for each student that has
a value selected and nothing for the others; an empty control means "no observation", and `0` is a real value that
is sent as `0`. Recording the same student again adds another observation (it never replaces or groups the earlier
one), so Alexander captured as 2 and later as 1 has two observations, average 1.5, score 50 — computed by the
Academic API. After a capture the recorded controls are cleared and the table is reloaded; a student whose request
failed keeps its selection and is named in the error message, so retrying does not record the others twice.

There is no date or session selector (the Academic API stamps `observed_at`), and no edit or delete in the UI. The
Academic API's `DELETE` remains available outside this UI. Requests are sent one student at a time; the Academic API
has no idempotency key, so after an unconfirmed failure (timeout / error) check the observation count before retrying.

Browser → backend: `POST /api/participation` with `{"student_id": <positive integer>, "value": 0|1|2|3}`.
Backend → Academic API: `POST /admin/courses/{COURSE_ID}/students/{student_id}/participation` with `{"value": n}`,
reusing the existing `ACADEMIC_API_BASE_URL`, `ACADEMIC_API_KEY` and `COURSE_ID` (no new configuration). In fixture mode
the route answers `409` and the tab is disabled.

## Security model

- The API key lives only in the server process. It is never sent to the browser, logged, or included in errors.
- The browser cannot choose the upstream URL, course or credentials: `/api/gradebook` takes no input. No open proxy.
- The only write route, `POST /api/participation`, accepts just a validated `student_id` and `value` (anything else is
  dropped); the course, URL and key stay server-side. It refuses non-JSON bodies and browser requests that are not
  `Sec-Fetch-Site: same-origin`, and answers no CORS headers. Like the rest of the app it relies on the access control in
  front of the Gradebook. A test builds the production bundle and checks the API key is not in it.
- Redirects from the Academic API are refused so the key cannot be forwarded elsewhere.
- Responses are validated with Zod on the server and again in the browser; unexpected data is rejected, not rendered.
- `.env` is git-ignored; fixtures contain no credentials. `/health` only reports that the process is up.

## Academic API dependency

Endpoint: `GET /admin/courses/{course_id}/gradebook` (no `/api/v1` prefix), header `X-API-Key: <admin key>`;
`{course_id}` is the academic DB id (not the Moodle id). Errors are `{"detail": "..."}` (401 bad key, 403 not an
admin key, 404 course not found); Gradebook maps them by status and never forwards the text.

The contract was taken from `canumpe-academic-platform` v0.2.1 (`app/api/schemas/gradebook.py`) and lives in one
file, [`src/domain/contract.ts`](src/domain/contract.ts): `course{course_id,name}`, `scheme[]`, `columns[]`,
`students[]` (`grades[]` = column fields + `grade` raw / `score_100` normalised, `categories[]`, `attendance`,
`participation`, `attendance_participation`, `current_score_100`, `current_grade_10`, ...). The API has **no final grade**.

## Grade calculation rules

- **Weights** come from `scheme[].weight_percent`. The three blocks are identified from `scheme[]` **by category name**
  (`BLOCK_CATEGORY_NAMES` in [`buildGradebook.ts`](src/domain/buildGradebook.ts)): "Entregables / tareas" (Tareas),
  "Participación / asistencia" and "Exámenes". `calculation_type` is **not** used (in the real course the participation
  category is `GRADE_ITEMS`). Once resolved, everything uses `category_id`. Missing or ambiguous → diagnostic and INCOMPLETA finals.
  Weights other than 40/40/20 are displayed as configured and flagged.
- **Membership** is the API's `category_id`, never `activity_type`. Items with `counts_toward_current_grade=false` stay
  visible (marked `*`) but the API excludes them from the category score. Unassigned items (or items in other categories)
  are shown under "Other / unassigned" and never affect the final.
- Activity cells show `score_100` (raw `grade` and `max_grade` in the tooltip); raw grades are never averaged.
- Block **average** = `categories[].category_score_100` and **contribution** = `contribution_points` from the API
  (not recomputed; an inconsistency with score × weight / 100 is diagnosed). Shown as `38.67 / 40`.
- **Participación / asistencia** is one block (the internal attendance/participation split is not shown in the report).
- **CALIFICACIÓN FINAL** = tasks + exams + participation contributions, calculated by Gradebook. If **any** of the three
  is null the final is **INCOMPLETA**: nothing is renormalised and nothing becomes 0. `current_score_100` /
  `current_grade_10` are renormalised by the API over evaluated categories and are **not** used as the final
  (the student detail shows them for reference only).

### NULL semantics

`null` = no data / not graded, **never 0**. Shown as `—`; a real zero shows `0`. E.g. `participation_score_100 = null`
means no participation observations have been entered yet, not zero participation. A null block makes the final
INCOMPLETA (naming the missing block). Incomplete finals sort last.

## Tests

`./docker-test.sh test` — calculation, mapping/validation, HTTP (fixture mode, API mode against a mocked Academic API, key never in responses), and UI (React Testing Library). No test touches production.

## Build and production

`docker build --target prod -t canumpe-gradebook .` produces a runtime-only image (no dev dependencies, runs as non-root, has a Docker `HEALTHCHECK` on `GET /health`).
[`compose.prod.yml`](compose.prod.yml) is prepared for `/opt/canumpe/gradebook` (image `ghcr.io/ulisesvar/canumpe-gradebook`, bound to 127.0.0.1 for a reverse proxy / Cloudflare tunnel, future host `gradebook.canumpe.com`).

**Deployment: not done.** No server, DNS or Cloudflare changes are part of this MVP. CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, build and validates the Docker build; it does not push an image.

## Known limitations

- Categories are recognised by name; renaming one in the Academic API requires updating `BLOCK_CATEGORY_NAMES`.
- API mode has not been run against the live API.
- No authentication in front of the Gradebook itself; it is expected to sit behind the CANUMPE reverse proxy/tunnel access control.
- Single course (`COURSE_ID`). Read-only except participation capture (`POST /api/participation`).
