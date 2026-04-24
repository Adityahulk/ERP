#!/usr/bin/env bash
# Start BizFlow locally without Docker: Homebrew Postgres + Redis, then API + Vite.
#
# Every run this script will:
#   1) Start Redis + Postgres (Homebrew)
#   2) Ensure DB role/database `bizflow`
#   3) Run `npm run migrate:dev` in backend (applies any pending SQL migrations)
#   4) Run `npm run seed:dev` only if the `users` table is empty (so login works: admin@demo.com / Demo@1234)
#   5) Start backend + frontend dev servers
#
# Usage (from repo root):
#   chmod +x scripts/start-local.sh    # once
#   ./scripts/start-local.sh
#
# Optional env:
#   SKIP_MIGRATE=1   — do not run migrations
#   SKIP_SEED=1     — do not auto-seed when DB has no users
#   FORCE_SEED=1    — always run seed (fails if demo data already exists; use backend `npm run reset` instead)
#
# Prerequisites:
#   brew install postgresql@15 redis
#   echo 'export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"' >> ~/.zshrc   # Apple Silicon
#   # or: export PATH="/usr/local/opt/postgresql@15/bin:$PATH"                   # Intel Mac
#   cd backend && npm install && cd ../frontend && npm install
#
# Stops both dev servers when you press Ctrl+C.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
SUPERUSER="${BOOTSTRAP_PG_USER:-$(whoami)}"

echo "== BizFlow local start =="

# --- Redis (Homebrew) -------------------------------------------------------
if command -v brew >/dev/null 2>&1; then
  if brew list redis &>/dev/null; then
    echo "→ Starting Redis (brew services)…"
    brew services start redis 2>/dev/null || true
  else
    echo "! Redis not installed. Run: brew install redis"
  fi
else
  echo "! Homebrew not found. Install Redis and start it on port 6379, or install: https://brew.sh"
fi

if command -v redis-cli >/dev/null 2>&1; then
  for _ in $(seq 1 40); do
    if redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -q PONG; then
      echo "→ Redis is up."
      break
    fi
    sleep 0.25
  done
else
  echo "! redis-cli not in PATH — ensure Redis is running (${REDIS_URL:-redis://127.0.0.1:6379})"
fi

# --- PostgreSQL (Homebrew) --------------------------------------------------
if command -v brew >/dev/null 2>&1; then
  if brew list postgresql@15 &>/dev/null; then
    echo "→ Starting PostgreSQL 15 (brew services)…"
    brew services start postgresql@15 2>/dev/null || true
  elif brew list postgresql@14 &>/dev/null; then
    echo "→ Starting PostgreSQL 14 (brew services)…"
    brew services start postgresql@14 2>/dev/null || true
  elif brew list postgresql &>/dev/null; then
    echo "→ Starting PostgreSQL (brew services)…"
    brew services start postgresql 2>/dev/null || true
  else
    echo "! PostgreSQL not found. Run: brew install postgresql@15"
  fi
fi

echo "→ Waiting for Postgres…"
for _ in $(seq 1 60); do
  if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 || pg_isready >/dev/null 2>&1; then
      echo "→ Postgres is accepting connections."
      break
    fi
  fi
  sleep 0.5
done

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not in PATH. Add Postgres to PATH, e.g.:"
  echo "  export PATH=\"/opt/homebrew/opt/postgresql@15/bin:\$PATH\""
  exit 1
fi

# Prefer Unix socket (peer auth); fall back to TCP.
psql_super() {
  if psql -U "$SUPERUSER" -d postgres -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null 2>&1; then
    psql -U "$SUPERUSER" -d postgres -v ON_ERROR_STOP=1 "$@"
  elif psql -h "$PGHOST" -p "$PGPORT" -U "$SUPERUSER" -d postgres -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null 2>&1; then
    psql -h "$PGHOST" -p "$PGPORT" -U "$SUPERUSER" -d postgres -v ON_ERROR_STOP=1 "$@"
  else
    echo "ERROR: Cannot connect to Postgres as '${SUPERUSER}' (tried socket and ${PGHOST}:${PGPORT})."
    echo "Try: export BOOTSTRAP_PG_USER=postgres && ./scripts/start-local.sh"
    return 1
  fi
}

echo "→ Ensuring role + database bizflow (superuser: ${SUPERUSER})…"
if ! psql_super <<'SQL'
DO $body$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bizflow') THEN
    CREATE ROLE bizflow LOGIN PASSWORD 'bizflow_dev';
  END IF;
END
$body$;

SELECT format('CREATE DATABASE %I OWNER bizflow', 'bizflow')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bizflow')\gexec

ALTER DATABASE bizflow OWNER TO bizflow;
GRANT ALL PRIVILEGES ON DATABASE bizflow TO bizflow;
SQL
then
  exit 1
fi

# --- Load DATABASE_URL (same as backend/.env) ------------------------------
load_database_url() {
  DATABASE_URL="${DATABASE_URL:-}"
  if [[ -z "$DATABASE_URL" && -f "$ROOT/backend/.env" ]]; then
    line="$(grep -E '^[[:space:]]*DATABASE_URL=' "$ROOT/backend/.env" | tail -n1 || true)"
    DATABASE_URL="${line#*=}"
    DATABASE_URL="${DATABASE_URL//\"/}"
    DATABASE_URL="${DATABASE_URL//\'/}"
  fi
  DATABASE_URL="${DATABASE_URL:-postgresql://bizflow:bizflow_dev@127.0.0.1:5432/bizflow}"
  export DATABASE_URL
}
load_database_url

BACKEND_PORT="$(grep -E '^[[:space:]]*PORT=' "$ROOT/backend/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d \"\' | tr -d '[:space:]')"
BACKEND_PORT="${BACKEND_PORT:-5001}"

# --- Migrations -------------------------------------------------------------
if [[ "${SKIP_MIGRATE:-}" != "1" ]]; then
  echo "→ Applying database migrations (npm run migrate:dev)…"
  (cd "$ROOT/backend" && npm run migrate:dev)
else
  echo "→ Skipping migrations (SKIP_MIGRATE=1)."
fi

# --- Seed demo users when DB is empty ---------------------------------------
if [[ "${SKIP_SEED:-}" != "1" ]]; then
  user_count="$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*)::bigint FROM users WHERE is_deleted = false;" 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "$user_count" =~ ^[0-9]+$ ]] || user_count=0
  if [[ "${FORCE_SEED:-}" == "1" ]]; then
    echo "→ FORCE_SEED=1: running npm run seed:dev (will error if data already exists)…"
    (cd "$ROOT/backend" && npm run seed:dev)
  elif [[ "$user_count" -eq 0 ]]; then
    echo "→ No users found; running npm run seed:dev (demo: admin@demo.com / Demo@1234)…"
    (cd "$ROOT/backend" && npm run seed:dev)
  else
    echo "→ Found ${user_count} user(s); skipping seed. (Wipe + reseed: cd backend && npm run reset)"
  fi
else
  echo "→ Skipping seed check (SKIP_SEED=1)."
fi

# --- Dev servers ------------------------------------------------------------
echo "→ Starting backend :${BACKEND_PORT} and frontend :3000…"
echo "   App: http://localhost:3000   API health: http://localhost:${BACKEND_PORT}/health"
echo "   Ctrl+C stops both."
echo ""

BPID="" FPID=""
cleanup() {
  echo ""
  echo "→ Shutting down dev servers…"
  [[ -n "${BPID:-}" ]] && kill "$BPID" 2>/dev/null || true
  [[ -n "${FPID:-}" ]] && kill "$FPID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

( cd "$ROOT/backend" && npm run dev ) & BPID=$!
( cd "$ROOT/frontend" && npm run dev ) & FPID=$!
# shellcheck disable=SC2069
wait $BPID $FPID
