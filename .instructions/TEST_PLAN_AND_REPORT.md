# Test Plan and Report

## Test Plan

### Scope
- Client: `test.html`, `results.html`, `shared/auth.js`
- Server: `supabase/functions/get-test-questions/index.ts`, `supabase/functions/submit-test/index.ts`
- Data layer: `question_bank`, `user_seen_questions`, `test_results` policies

### Environment
- Local host: `http://127.0.0.1:4173`
- Supabase project: `dvszkmkxamilxocawbml`
- Playwright: Chromium headless (`npx playwright test`)
- API checks: Node scripts against Supabase REST/Auth/Functions

### Ordered Checks (website-testing)
1. API baseline
- Create disposable QA users
- Validate `get-test-questions`/`submit-test` contracts
- Validate no repeats for first 500 questions (10 cycles x 50)
- Validate cycle reset on cycle 11
- Validate direct access to `correct_option` is blocked

2. Smoke UI
- `index.html`, `test.html`, `results.html` load without runtime errors

3. Core E2E
- Login -> start test -> answer 50 questions -> submit -> show result

4. Security
- XSS probe row from DB renders as plain text in results
- Probe JS does not execute (`window.__xss_probe` remains false)
- Results isolation: only current user rows are visible (count check)

5. Regression rerun
- Full Playwright suite rerun after fixes until all PASS

## Execution Report

### Iteration 1
- Result: FAILED
- Failure:
  - Playwright core flow stuck at registration step (test did not start)
- Root cause:
  - Environment requires email confirmation for new registrations, so UI register flow did not auto-enter test.
- Fix:
  - Updated core E2E scenario to use QA login (already confirmed account) instead of register in this environment.

### Iteration 2
- Result: PASSED
- API baseline:
  - PASS: 500 active questions
  - PASS distribution: A1=84, A2=84, B1=83, B2=83, C1=83, C2=83
  - PASS: first 10 test runs produced 500 unique question IDs
  - PASS: run 11 returned `cycle_reset=true`
  - PASS: direct `question_bank?select=correct_option` denied (`403`)
- Playwright:
  - PASS: smoke pages
  - PASS: results page checks (Starter label, XSS safe render, own rows only)
  - PASS: core 50-question flow to results
  - PASS: no runtime console/page errors in final run

## Artifacts
- `.instructions/api_baseline_result.json`
- `scripts/e2e.playwright.spec.js`
- `scripts/playwright.config.js`
- `supabase/data/question_bank.json`
- `supabase/data/question_bank.md`
- `/Users/art/Documents/Obsidian/Art/Школа/question_bank_500_cefr.md`

## Final Verdict
- All planned checks are PASS after bug-fix iteration.
- Critical security/functional requirements are satisfied in tested scope.
