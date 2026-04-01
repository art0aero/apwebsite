#!/usr/bin/env bash
set -euo pipefail

OUT_DIR=".instructions"
mkdir -p "${OUT_DIR}"
OUT_FILE="${OUT_DIR}/sql_explain_result.txt"

run_psql() {
  local sql="$1"
  psql "${DATABASE_URL}" -c "${sql}"
}

run_supabase_linked() {
  local sql="$1"
  npx supabase db query --linked "${sql}" -o table
}

run_query() {
  local sql="$1"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    run_psql "${sql}"
    return
  fi

  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    run_supabase_linked "${sql}"
    return
  fi

  echo "Missing DATABASE_URL or SUPABASE_ACCESS_TOKEN for linked Supabase query"
  exit 1
}

{
  echo "=== EXPLAIN test_results user_id+completed_at desc ==="
  run_query "EXPLAIN (ANALYZE, BUFFERS) SELECT id, completed_at FROM public.test_results WHERE user_id = (SELECT user_id FROM public.test_results WHERE user_id IS NOT NULL LIMIT 1) ORDER BY completed_at DESC LIMIT 40;"
  echo
  echo "=== EXPLAIN study_plan_versions goal_id+version_no desc ==="
  run_query "EXPLAIN (ANALYZE, BUFFERS) SELECT id, version_no FROM public.study_plan_versions WHERE goal_id = (SELECT goal_id FROM public.study_plan_versions WHERE goal_id IS NOT NULL LIMIT 1) ORDER BY version_no DESC LIMIT 20;"
  echo
  echo "=== EXPLAIN plan_checkpoints plan_version_id+scheduled_date ==="
  run_query "EXPLAIN (ANALYZE, BUFFERS) SELECT id, scheduled_date FROM public.plan_checkpoints WHERE plan_version_id = (SELECT plan_version_id FROM public.plan_checkpoints WHERE plan_version_id IS NOT NULL LIMIT 1) ORDER BY scheduled_date ASC LIMIT 40;"
} | tee "${OUT_FILE}"

echo "Saved: ${OUT_FILE}"
