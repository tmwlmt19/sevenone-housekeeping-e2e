import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load `.env` FIRST so both this config and everything under src/ see it.
loadEnv({ path: path.resolve(__dirname, '.env') })

const REPO_ROOT = path.resolve(__dirname, '..')
const SERVICE_DIR =
  process.env.E2E_SERVICE_DIR ??
  path.join(REPO_ROOT, 'sevenone-housekeeping-service')
const LOGIN_DIR = path.join(REPO_ROOT, 'sevenone-housekeeping-login')
const WEB_DIR = path.join(REPO_ROOT, 'sevenone-housekeeping-web')
const ADMIN_DIR = path.join(REPO_ROOT, 'sevenone-housekeeping-admin')

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000'
const LOGIN_URL = process.env.E2E_LOGIN_URL ?? 'http://localhost:5174'
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:5175'

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in before running the e2e suite.`,
    )
  }
  return v
}

// The DSN the e2e backend must use — the isolated Neon `e2e` branch, NEVER prod.
// Passed explicitly so it overrides whatever is in the service repo's own .env
// (pydantic-settings: real env vars take precedence over the .env file).
const E2E_DATABASE_URL = required('E2E_DATABASE_URL')

export default defineConfig({
  testDir: './tests',
  // Each test provisions its own uniquely-named hotel, so tests are independent
  // and safe to run in parallel against the one shared backend + e2e DB branch.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // Rich failure artifacts — the whole point is fast diagnosis of a red test.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Boot the whole system. Order doesn't matter (Playwright waits on each
  // `url`), but the backend must come up for the frontends to be useful.
  webServer: [
    {
      name: 'api',
      command: '.venv/bin/uvicorn app.main:app --port 8000 --log-level warning',
      cwd: SERVICE_DIR,
      url: `${API_URL}/health`,
      // NEVER reuse a server we can't prove points at the e2e branch — if :8000
      // is already taken (e.g. a dev backend on prod), fail loudly instead of
      // silently testing against the wrong database.
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        JWT_SECRET:
          process.env.E2E_JWT_SECRET ?? 'e2e-test-secret-not-for-production',
        // Blank ⇒ password-reset emails become a logged no-op (dev/test).
        RESEND_API_KEY: '',
        CORS_ORIGINS: `${WEB_URL},${LOGIN_URL},${ADMIN_URL}`,
        PASSWORD_RESET_URL_BASE: `${LOGIN_URL}/reset-password`,
      },
    },
    // The vite configs pin no port, so we pass one explicitly with --strictPort
    // (fail rather than silently pick another) to guarantee the SSO cross-app
    // URLs line up: login 5174, web 5173, admin 5175.
    {
      name: 'login',
      command: 'pnpm dev --port 5174 --strictPort',
      cwd: LOGIN_DIR,
      url: LOGIN_URL,
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      name: 'web',
      command: 'pnpm dev --port 5173 --strictPort',
      cwd: WEB_DIR,
      url: WEB_URL,
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      name: 'admin',
      command: 'pnpm dev --port 5175 --strictPort',
      cwd: ADMIN_DIR,
      url: ADMIN_URL,
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
})
