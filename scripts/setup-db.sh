#!/usr/bin/env bash
#
# One-time (idempotent) prep of the Neon `e2e` branch: run migrations to head and
# seed the platform admin the suite provisions hotels as. Safe to re-run.
#
# Reads config from ../ .env (the e2e suite's env). Requires the backend repo's
# virtualenv at ../sevenone-housekeeping-service/.venv.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$HERE/.." && pwd)"
SERVICE_DIR="${E2E_SERVICE_DIR:-$(cd "$E2E_DIR/.." && pwd)/sevenone-housekeeping-service}"

# Load the e2e .env
if [[ ! -f "$E2E_DIR/.env" ]]; then
  echo "✗ $E2E_DIR/.env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$E2E_DIR/.env"
set +a

: "${E2E_DATABASE_URL:?E2E_DATABASE_URL must be set in .env}"
: "${E2E_ADMIN_EMAIL:?E2E_ADMIN_EMAIL must be set in .env}"
: "${E2E_ADMIN_PASSWORD:?E2E_ADMIN_PASSWORD must be set in .env}"

VENV_PY="$SERVICE_DIR/.venv/bin/python"
VENV_ALEMBIC="$SERVICE_DIR/.venv/bin/alembic"
if [[ ! -x "$VENV_PY" ]]; then
  echo "✗ backend venv not found at $SERVICE_DIR/.venv — set up the service repo first." >&2
  exit 1
fi

export DATABASE_URL="$E2E_DATABASE_URL"
export JWT_SECRET="${E2E_JWT_SECRET:-e2e-test-secret-not-for-production}"

echo "▶ Running migrations against the e2e branch…"
( cd "$SERVICE_DIR" && "$VENV_ALEMBIC" upgrade head )

echo "▶ Seeding e2e platform admin ($E2E_ADMIN_EMAIL)…"
( cd "$SERVICE_DIR" && "$VENV_PY" -m app.seed \
    --email "$E2E_ADMIN_EMAIL" \
    --password "$E2E_ADMIN_PASSWORD" \
    --name "E2E Admin" )

echo "✓ e2e branch ready."
