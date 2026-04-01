#!/usr/bin/env bash
set -euo pipefail

# Required env:
# SOURCE_PG_DSN=postgresql://...
# TARGET_PG_DSN=postgresql://...

: "${SOURCE_PG_DSN:?Missing SOURCE_PG_DSN}"
: "${TARGET_PG_DSN:?Missing TARGET_PG_DSN}"

WORKDIR="${WORKDIR:-/tmp/ap-supabase-migrate}"
mkdir -p "${WORKDIR}"

echo "Exporting source schema..."
pg_dump --schema-only --no-owner --no-privileges "${SOURCE_PG_DSN}" > "${WORKDIR}/schema.sql"

echo "Exporting source data..."
pg_dump --data-only --no-owner --no-privileges "${SOURCE_PG_DSN}" > "${WORKDIR}/data.sql"

echo "Importing schema into target..."
psql "${TARGET_PG_DSN}" -f "${WORKDIR}/schema.sql"

echo "Importing data into target..."
psql "${TARGET_PG_DSN}" -f "${WORKDIR}/data.sql"

echo "Done. Validate row counts manually before cutover."
