#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1:-docker-compose.yml}"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Compose file not found: ${COMPOSE_FILE}"
  exit 1
fi

python3 - "${COMPOSE_FILE}" <<'PY'
import pathlib
import sys

compose = pathlib.Path(sys.argv[1])
text = compose.read_text(encoding="utf-8")
before = 'curl -sSfL --head -o /dev/null -H \\"Authorization: Bearer ${ANON_KEY}\\" http://localhost:4000/api/tenants/realtime-dev/health'
after = 'code=$(curl -sS -o /dev/null -w "%{http_code}" -H \\"Authorization: Bearer ${ANON_KEY}\\" http://localhost:4000/api/tenants/realtime-dev/health || true); [ $$code = 200 ] || [ $$code = 403 ]'

if before not in text:
    print("Realtime healthcheck pattern not found, skipping patch.")
    sys.exit(0)

new_text = text.replace(before, after)
compose.write_text(new_text, encoding="utf-8")
print("Patched realtime healthcheck in", compose)
PY
