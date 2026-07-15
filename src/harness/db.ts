import { createHash } from 'node:crypto'

import pg from 'pg'

import { DATABASE_URL } from '../config'

/**
 * Direct DB access to the Neon `e2e` branch, for the few things the HTTP API
 * can't do for a test. Kept deliberately tiny — prefer the API for setup.
 *
 * The main use is minting a password-reset token: in dev the reset email is a
 * logged no-op, so to drive the reset *screen* end-to-end we insert a token the
 * same way the backend would (SHA-256 of the raw value) and hand the raw token
 * to the UI. See AUTH-06.
 */
let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 4,
    })
  }
  return pool
}

/** Mirror of the backend's `_hash_token` (app/routers/auth.py). */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf-8').digest('hex')
}

/** Insert a live, single-use reset token for a user; return the raw token to
 * put in the reset URL. Mirrors what `POST /auth/forgot-password` would store. */
export async function mintResetToken(
  userId: string,
  { ttlMinutes = 30 }: { ttlMinutes?: number } = {},
): Promise<string> {
  const raw = randomToken()
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
  await getPool().query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(raw), expiresAt],
  )
  return raw
}

/** Whether a given raw reset token has been consumed (used_at set). */
export async function isResetTokenUsed(raw: string): Promise<boolean> {
  const { rows } = await getPool().query<{ used_at: Date | null }>(
    `SELECT used_at FROM password_reset_tokens WHERE token_hash = $1`,
    [hashToken(raw)],
  )
  return rows.length > 0 && rows[0].used_at !== null
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

function randomToken(): string {
  return createHash('sha256')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex')
}
