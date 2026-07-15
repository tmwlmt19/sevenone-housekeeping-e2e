/**
 * Central test configuration: app origins, the seeded admin, and DB access.
 * Everything is read from `.env` (loaded by playwright.config.ts before tests
 * import this). Absolute app URLs are used throughout because a single journey
 * crosses three origins (login → hotel/admin), so there is no single baseURL.
 */

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`,
    )
  }
  return v
}

/** The four running processes, by origin. */
export const APP = {
  api: env('E2E_API_URL', 'http://localhost:8000'),
  login: env('E2E_LOGIN_URL', 'http://localhost:5174'),
  web: env('E2E_WEB_URL', 'http://localhost:5173'),
  admin: env('E2E_ADMIN_URL', 'http://localhost:5175'),
} as const

/** The seeded platform admin the suite provisions hotels as. */
export const ADMIN = {
  email: env('E2E_ADMIN_EMAIL', 'admin@e2e-sevenone.com'),
  password: env('E2E_ADMIN_PASSWORD', 'E2eAdmin123!'),
} as const

/** libpq DSN for the Neon e2e branch (used by the `pg` client in db.ts). */
export const DATABASE_URL = env('E2E_DATABASE_URL')

/**
 * The known password every fixture-provisioned staff member ends up with, once
 * the seed helper has cleared their forced first-login change. Tests that log in
 * as a manager/housekeeper use this. (The forced-change ceremony itself is
 * exercised separately by AUTH-04 / X-ROLE-01 against a *fresh* user.)
 */
export const TEST_USER_PASSWORD = 'E2eUserPass123!'

/**
 * Emails must use a real-looking TLD — the backend's email validator rejects
 * reserved TLDs like `.test`/`.example`. We namespace every generated address
 * under this domain so e2e data is obvious and never collides with real users.
 */
export const E2E_EMAIL_DOMAIN = 'e2e-sevenone.com'
