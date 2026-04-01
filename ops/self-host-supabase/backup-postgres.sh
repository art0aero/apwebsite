#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}"
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

: "${INSTALL_DIR:?Missing INSTALL_DIR}"
: "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD}"

BACKUP_DIR="${INSTALL_DIR}/backups"
mkdir -p "${BACKUP_DIR}"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/postgres_${STAMP}.sql.gz"

cd "${INSTALL_DIR}/supabase/docker"
docker compose exec -T db pg_dumpall -U postgres | gzip -c > "${OUT_FILE}"

find "${BACKUP_DIR}" -type f -name "postgres_*.sql.gz" -mtime +30 -delete

echo "Backup saved: ${OUT_FILE}"
