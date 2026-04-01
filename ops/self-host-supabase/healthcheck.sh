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
: "${SUPABASE_PUBLIC_URL:?Missing SUPABASE_PUBLIC_URL}"

cd "${INSTALL_DIR}/supabase/docker"

echo "=== docker compose ps ==="
docker compose ps

echo
echo "=== API health ==="

check_http_up() {
  local label="$1"
  local url="$2"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" "${url}" || true)"
  if [[ "${code}" == "200" || "${code}" == "401" ]]; then
    echo "${label}: OK (${code})"
  else
    echo "${label}: FAIL (${code})"
  fi
}

check_http_up "REST" "${SUPABASE_PUBLIC_URL}/rest/v1/"
check_http_up "AUTH" "${SUPABASE_PUBLIC_URL}/auth/v1/settings"
