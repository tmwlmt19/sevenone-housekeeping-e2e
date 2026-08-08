# sevenone-housekeeping-e2e

Whole-system, end-to-end tests for **SevenOne Housekeeping** — the ones that
prove the four separately-deployed apps actually work *together*, the way a real
user experiences them: log in on one origin, get handed across to another via an
SSO cookie, do a job, and see the effect land in the database.

If you've never written browser tests before, read this top to bottom once. It
explains not just *how* to run the suite but *why* it's built the way it is, so
the test files read like plain English afterwards.

---

## 1. What this repo tests (and what it doesn't)

SevenOne Housekeeping is **four apps around one backend**:

| App | Origin (local) | Who uses it |
| --- | --- | --- |
| `service` (FastAPI backend) | `:8000` | everyone (HTTP API) |
| `login` (SSO entry point) | `:5174` | everyone signs in here |
| `web` (hotel ops app) | `:5173` | manager, front desk, housekeeper |
| `admin` (platform console) | `:5175` | platform admin |

A single user journey **crosses origins**: you sign in at `login:5174`, and the
login app sets a session cookie on the shared parent domain and redirects you to
`web:5173` or `admin:5175`. Each app also talks to the backend at `:8000`.

This repo owns the tests that need **more than one of those pieces at once** —
the SSO handoff, role-based routing, tenant isolation, and cross-app side effects
(e.g. a housekeeper completing a task flips a room to *clean*, which the manager
then sees). Narrow, single-app logic is tested inside each app's own repo
(component/unit tests) and the backend's `pytest` suite; it does **not** belong
here.

Every scenario is catalogued twice:

- **[`docs/test-scenarios.md`](docs/test-scenarios.md)** — the precise, per-test
  walkthrough: what each test clicks, in what order, and exactly what it asserts.
  Start here to understand or modify a specific test.
- **`sevenone-docs/housekeeping/testing/user-paths.md`** — the product-level path
  catalogue (the intended behavior each ID represents), the source of truth the
  tests are written *against*.

---

## 2. How it runs (the big picture)

```
playwright.config.ts
   │  boots 4 web servers (api, login, web, admin) and waits for each to be ready
   │  points the backend at the Neon `e2e` DB branch (NEVER prod)
   ▼
tests/*.spec.ts
   │  import { test, expect } from '../src/fixtures'   ← the custom test, not @playwright/test
   ▼
src/fixtures.ts
   │  gives every test two things for free:
   │   • `hotel`  — a freshly provisioned, uniquely-named hotel (its own data)
   │   • `page`   — wired with diagnostics (console/network captured on failure)
   ▼
src/harness/*  — the toolkit each test builds on (seed, api, login, ui, step, db)
```

Two design decisions make the whole thing tractable:

**a) Every test owns its data.** The `hotel` fixture calls the *real*
`POST /hotels/provision` to create a hotel with a unique name and unique staff
emails (`mgr-<suffix>@…`, `hk-<suffix>@…`). Because no two tests share a hotel,
they can run **fully in parallel** and need **no database reset** between runs.
There is no global "seed" step and no teardown of test data — the Neon `e2e`
branch just accumulates disposable hotels, and you re-branch it when you want a
clean slate.

**b) Seed through the API, assert through the API + the UI.** Setup (create a
hotel, a task, file a request) goes through the real backend endpoints, so the
data the UI renders is exactly what a real admin/manager would have produced. The
test then drives the **UI** for the behavior under test and, where it matters,
makes an **authoritative check** back through the API (e.g. "the room really is
`clean` in the DB"), so a green test means the whole stack agreed, not just that
some text appeared on screen.

---

## 3. Running the suite

### Prerequisites

- The four sibling repos checked out next to this one:
  `../sevenone-housekeeping-{service,login,web,admin}`. Playwright boots them.
- Backend deps installed in `service` (`.venv` with uvicorn); frontend deps
  installed in each app (`pnpm install`).
- A **Neon `e2e` branch** — an isolated, disposable copy of the database. Never
  point this at staging or prod.

### One-time setup

```bash
pnpm install
pnpm install:browsers          # Playwright's Chromium
cp .env.example .env           # then fill it in (see below)
```

`.env` (gitignored — treat as a secret):

| Var | What it is |
| --- | --- |
| `E2E_DATABASE_URL` | libpq DSN for the Neon **`e2e`** branch. The backend gets this as `DATABASE_URL`; `db.ts` uses it directly. |
| `E2E_JWT_SECRET` | any random string; the e2e backend signs cookies with it. |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | the seeded platform admin the suite provisions hotels as. |
| `E2E_*_URL` | app origins; defaults match the ports below. |
| `E2E_SERVICE_DIR` | optional override for where the backend repo lives. |

The **`e2e` admin account must already exist** on the `e2e` branch (it's the one
identity the suite can't self-provision, since provisioning requires being an
admin). Seed it once with `pnpm setup:db` (see `scripts/setup-db.sh`).

### Run

```bash
pnpm test                 # headless, all specs, parallel
pnpm test:headed          # watch it drive a real browser
pnpm test:ui              # Playwright's interactive UI mode
pnpm test:cross-role      # just the flagship X-ROLE-01 journey
pnpm test manager.spec.ts # one file
pnpm report               # open the HTML report from the last run
```

Playwright starts all four servers itself (`webServer` in the config) and waits
for each `url` to respond before running. The backend is booted with
`reuseExistingServer: false` — if `:8000` is already taken it **fails loudly**
rather than risk testing against a dev backend wired to the wrong database. The
frontends set `reuseExistingServer: true`, so an already-running `pnpm dev` is
reused.

Ports are pinned (`--strictPort`): **login 5174, web 5173, admin 5175, api
8000**. They must line up because the SSO redirect URLs are absolute.

---

## 4. The harness (`src/`)

Everything a test needs is here. Read these five files and you can read any test.

| File | Responsibility |
| --- | --- |
| `config.ts` | Reads `.env` into typed constants: `APP` (the four origins), `ADMIN` (seed admin creds), `DATABASE_URL`, `TEST_USER_PASSWORD`, `E2E_EMAIL_DOMAIN`. |
| `fixtures.ts` | The custom `test`/`expect` every spec imports. Extends Playwright with the `hotel` fixture and diagnostics-wired `page`. **Import from here, not `@playwright/test`.** |
| `harness/seed.ts` | `provisionHotel(opts)` → a `SeededHotel` (admin client + manager + housekeeper + a room, forced-change already cleared). Options: `withFrontDesk`, `withSecondHousekeeper`, `clearForcedChange`, custom `rooms`, `label`. `uniqueSuffix()` makes collision-proof names. |
| `harness/api.ts` | `Api` — a thin bearer-token HTTP client for seeding and out-of-band assertions. `Api.loggedIn(email, pw)` returns an authenticated client. Every non-2xx throws an `ApiError` carrying method/URL/status/body, so a failed *setup* is self-describing. `rawStatus()` returns the code instead of throwing, for boundary tests (assert a specific 403/404/409). |
| `harness/login.ts` | `loginAs(page, email, pw, { expect: 'web' \| 'admin', firstLoginNewPassword? })` — drives the **real** login app and waits for the SSO redirect to land on the right app. This is the single entry point that proves the cross-origin cookie works. Also `logout()` and `expectLoginRejected()`. |
| `harness/ui.ts` | Helpers for the shadcn/Radix `<Select>`, which is a `combobox` button + a portal of `option`s, **not** a native `<select>`: `chooseOption(page, trigger, name)` and `selectShowing(page, text)` (the trigger currently showing `text`). |
| `harness/step.ts` | The `Journey` / `journey('ID')` helper. Wrap each meaningful action in `journey.step('label', async () => …)`. It numbers and logs steps (`▶ [MGR-04] step 3 — …`, then `✓`/`✗`), wraps the body in a Playwright `test.step` (so the trace/report shows step boundaries), and annotates the exact step that threw. When a test goes red you read the console top-to-bottom: the last `▶` with no matching `✓` is where it broke. |
| `harness/diagnostics.ts` | `attachDiagnostics(page, testInfo)` — collects browser `console.error`, page errors, and every `>= 400` response for the life of the test, and attaches them to the report **only on failure**. Wired automatically by the `page` fixture. |
| `harness/db.ts` | Direct `pg` access to the `e2e` branch for the few things the API can't do — chiefly minting a password-reset token (`mintResetToken`) so the reset *screen* can be driven end-to-end even though the reset email is a dev no-op, and checking a token was consumed (`isResetTokenUsed`). Kept deliberately tiny; prefer the API. |

### Writing a new test — the recipe

```ts
import { APP } from '../src/config'
import { expect, test } from '../src/fixtures'          // ← not @playwright/test
import { loginAs } from '../src/harness/login'
import { journey } from '../src/harness/step'

test('MGR-NN: short description of the path', async ({ page, hotel }) => {
  const j = journey('MGR-NN')

  await j.step('seed anything extra through the API', async () => {
    await hotel.admin.createTask(hotel.hotelId, { /* … */ })
  })
  await j.step('drive the UI for the behavior under test', async () => {
    await loginAs(page, hotel.manager.email, hotel.manager.password, { expect: 'web' })
    await page.goto(`${APP.web}/tasks`)
    // …click things…
  })
  await j.step('assert authoritatively through the API', async () => {
    const tasks = await hotel.admin.listTasks(hotel.hotelId)
    expect(tasks.length).toBe(1)
  })
})
```

Conventions:

- **Own your data** — use the `hotel` fixture (or `provisionHotel(...)` when you
  need extra staff). Never depend on data another test created.
- **Seed via `hotel.admin` / `Api`, not the DB.** Reach for `harness/db.ts` only
  when there's no endpoint (basically: reset tokens).
- **Give every test an ID** (`MGR-NN`, `FD-NN`, …) that matches an entry in the
  path catalogue, and wrap steps in `journey.step` so failures are diagnosable.
- **Prefer role/name locators** (`getByRole('button', { name: 'Save' })`,
  `getByLabel('Email')`) and the `ui.ts` helpers for selects.
- **End on an authoritative check** where a UI assertion alone could pass without
  the backend actually agreeing.

---

## 5. Naming and the ID scheme

Tests are grouped by role, and each ID names a path in the catalogue:

| Prefix | Area | File |
| --- | --- | --- |
| `AUTH-*` | login, SSO, forced change, reset, logout, redirects | `auth.spec.ts` |
| `ADM-*` | admin console: provisioning, editing, request queue | `admin.spec.ts` |
| `MGR-*` | manager: dashboard, rooms, tasks, staff, requests, workload | `manager.spec.ts` |
| `FD-*` | front-desk role (manager powers minus requests) | `front-desk.spec.ts` |
| `HK-*` | housekeeper: mobile My Tasks, hard walls | `housekeeper.spec.ts` |
| `X-ROLE-*` | the flagship multi-role, multi-app journey | `cross-role.spec.ts` |
| `*-N` | unhappy / boundary paths (rejections, 4xx, isolation) | inline, or `boundaries.spec.ts` |

---

## 6. Diagnosing a failure

A red test gives you, in one place:

1. **The console log** — scroll to the last `▶ [ID] step N — …` with no matching
   `✓`. That's the step that broke.
2. **The HTML report** (`pnpm report`) — the same step labels on a timeline, plus
   the **trace** (DOM snapshots you can scrub through), a **screenshot**, and a
   **video** (all retained on failure), and the **attached console/network** log
   from diagnostics.
3. **`ApiError`** — if setup failed (not the assertion), the thrown error already
   contains the method, URL, status, and response body of the bad call.

Common causes: a server didn't boot (check the ports are free), `.env` points at
the wrong branch, or the `e2e` admin isn't seeded.

---

## 7. Repository layout

```
playwright.config.ts     boots the 4 apps; pins the e2e DB; artifact settings
.env.example             copy to .env (gitignored) and fill in
scripts/setup-db.sh      one-time seed of the e2e platform admin
src/
  config.ts              typed .env constants
  fixtures.ts            the custom test/expect + hotel fixture
  harness/
    seed.ts              provisionHotel() and SeededHotel
    api.ts               Api HTTP client + ApiError
    login.ts             loginAs / logout / expectLoginRejected
    ui.ts                Radix <Select> helpers
    step.ts              Journey / journey() step logging
    diagnostics.ts       console/network capture on failure
    db.ts                direct pg access (reset tokens only)
tests/
  auth.spec.ts  admin.spec.ts  manager.spec.ts  front-desk.spec.ts
  housekeeper.spec.ts  cross-role.spec.ts  boundaries.spec.ts
docs/
  test-scenarios.md      per-test walkthroughs (flow + assertions)
```
