#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  echo "Create .env from .env.example, or run 'make worktree-env' and use .env.worktree."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

E2E_BACKEND_PORT="${E2E_BACKEND_PORT:-18081}"
API_URL="${NEXT_PUBLIC_API_URL:-}"
if [ -z "$API_URL" ]; then
  API_URL="http://localhost:${E2E_BACKEND_PORT}"
fi
WS_URL="${NEXT_PUBLIC_WS_URL:-}"
if [ -z "$WS_URL" ]; then
  WS_URL="ws://localhost:${E2E_BACKEND_PORT}/ws"
fi
DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER:-multica}:${POSTGRES_PASSWORD:-multica}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-multica}?sslmode=disable}"

server_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> Using env file: $ENV_FILE"
bash scripts/ensure-postgres.sh "$ENV_FILE"
echo "==> Running migrations..."
(cd server && go run ./cmd/migrate up)

if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
  echo "==> Reusing backend at ${API_URL}"
else
  echo "==> Starting backend for E2E at ${API_URL}"
  (
    cd server
    PORT="$E2E_BACKEND_PORT" \
      NEXT_PUBLIC_API_URL="$API_URL" \
      NEXT_PUBLIC_WS_URL="$WS_URL" \
      FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:${DESKTOP_RENDERER_PORT:-5173}}" \
      go run ./cmd/server
  ) &
  server_pid="$!"
  for _ in $(seq 1 60); do
    if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -sf "${API_URL}/health" >/dev/null 2>&1; then
    echo "E2E backend did not become healthy at ${API_URL}"
    exit 1
  fi
fi

if [ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

export E2E_DATABASE_URL="${E2E_DATABASE_URL:-$DATABASE_URL}"
export NEXT_PUBLIC_API_URL="$API_URL"
export VITE_API_URL="$API_URL"
export VITE_WS_URL="$WS_URL"

pnpm exec playwright test e2e/origin-smoke.spec.ts
