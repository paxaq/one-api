#!/usr/bin/env bash
# Backup Postgres from the compose stack into ./backups/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="backups/oneapi-${STAMP}.dump"
COMPOSE=(podman compose -f docker-compose.yml)
if ! command -v podman >/dev/null 2>&1; then
  COMPOSE=(docker compose -f docker-compose.yml)
fi
USER_NAME="${POSTGRES_USER:-oneapi}"
DB_NAME="${POSTGRES_DB:-oneapi}"
echo "Writing ${OUT}..."
"${COMPOSE[@]}" exec -T postgres pg_dump -U "${USER_NAME}" -Fc "${DB_NAME}" > "${OUT}"
ls -lh "${OUT}"
echo "OK"
