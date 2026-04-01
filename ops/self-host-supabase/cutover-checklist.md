# Cutover Checklist (15-30 min read-only window)

## Pre-cutover (T-24h)
- Dry-run migration on staging namespace completed.
- Smoke + E2E + latency probe passed on self-host target.
- Backup snapshot created (managed + self-host target).
- Rollback env values prepared.

## T-15 min
- Announce maintenance/read-only window.
- Enable read-only mode in app layer (block write actions in UI + edge paths except auth/session).
- Pause background sync jobs that write (attendance push/pull, admin bulk updates).

## Data move
- Run final schema sync.
- Run final data delta sync (`public`, `auth`, `storage` metadata).
- Validate row counts for critical tables:
  - `test_results`
  - `study_goals`
  - `study_plan_versions`
  - `study_lessons`
  - `attempt_items`
  - `ai_insights`
  - `certificates`

## Switch
- Update `shared/config.js` to new self-host `SUPABASE_URL` + keys.
- Update server-side env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- Deploy edge functions.

## Acceptance gate
- `run_api_baseline_checks.mjs` PASS
- `run_mvp_v3_endpoint_smoke.mjs` PASS
- `run_playwright_checks.mjs` PASS
- `run_latency_probe.mjs` PASS with:
  - `get-student-dashboard-core` p95 < 450ms
  - `get-student-dashboard-plan` p95 < 900ms

## Rollback (if gate failed)
- Restore previous config/env (managed Supabase URL/keys).
- Re-enable managed endpoints.
- Disable self-host write path.
- Post incident notes + retry window.
