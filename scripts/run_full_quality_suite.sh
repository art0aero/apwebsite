#!/usr/bin/env bash
set -euo pipefail

echo "== 1) API baseline =="
node scripts/run_api_baseline_checks.mjs

echo "== 2) Unit checks =="
node scripts/run_unit_checks.mjs

echo "== 3) Endpoint smoke =="
node scripts/run_mvp_v3_endpoint_smoke.mjs

echo "== 4) Playwright checks =="
node scripts/run_playwright_checks.mjs

echo "== 5) Latency probe =="
node scripts/run_latency_probe.mjs

echo "Quality suite finished."
