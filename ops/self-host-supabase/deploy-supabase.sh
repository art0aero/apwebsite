#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
PATCH_REALTIME_HEALTHCHECK="${SCRIPT_DIR}/patch-realtime-healthcheck.sh"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy env.example to .env first."
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

: "${INSTALL_DIR:?Missing INSTALL_DIR}"
: "${SUPABASE_REPO_TAG:?Missing SUPABASE_REPO_TAG}"
: "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD}"
: "${JWT_SECRET:?Missing JWT_SECRET}"
: "${ANON_KEY:?Missing ANON_KEY}"
: "${SERVICE_ROLE_KEY:?Missing SERVICE_ROLE_KEY}"
: "${DASHBOARD_USERNAME:?Missing DASHBOARD_USERNAME}"
: "${DASHBOARD_PASSWORD:?Missing DASHBOARD_PASSWORD}"

mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

if [[ ! -d supabase ]]; then
  git clone --depth 1 --branch "${SUPABASE_REPO_TAG}" https://github.com/supabase/supabase.git
else
  cd supabase
  git fetch --tags --force
  git checkout "${SUPABASE_REPO_TAG}"
  cd ..
fi

cd "${INSTALL_DIR}/supabase/docker"
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

replace_or_add() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|g" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

replace_or_add "POSTGRES_PASSWORD" "${POSTGRES_PASSWORD}"
replace_or_add "JWT_SECRET" "${JWT_SECRET}"
replace_or_add "ANON_KEY" "${ANON_KEY}"
replace_or_add "SERVICE_ROLE_KEY" "${SERVICE_ROLE_KEY}"
replace_or_add "DASHBOARD_USERNAME" "${DASHBOARD_USERNAME}"
replace_or_add "DASHBOARD_PASSWORD" "${DASHBOARD_PASSWORD}"
replace_or_add "SITE_URL" "${SUPABASE_PUBLIC_URL}"
replace_or_add "API_EXTERNAL_URL" "${SUPABASE_PUBLIC_URL}"
replace_or_add "STUDIO_DEFAULT_ORGANIZATION" "AP Website"
replace_or_add "STUDIO_DEFAULT_PROJECT" "${PROJECT_NAME:-ap-supabase}"

if [[ -n "${SMTP_HOST:-}" ]]; then
  replace_or_add "SMTP_ADMIN_EMAIL" "${SMTP_USER}"
  replace_or_add "SMTP_HOST" "${SMTP_HOST}"
  replace_or_add "SMTP_PORT" "${SMTP_PORT}"
  replace_or_add "SMTP_USER" "${SMTP_USER}"
  replace_or_add "SMTP_PASS" "${SMTP_PASS}"
fi

if [[ -x "${PATCH_REALTIME_HEALTHCHECK}" ]]; then
  bash "${PATCH_REALTIME_HEALTHCHECK}" "docker-compose.yml"
fi

docker compose pull
docker compose up -d

echo "Supabase self-host stack deployed."
echo "Check: docker compose ps"
