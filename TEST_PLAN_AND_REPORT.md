# Test Plan and Report

## Method
Testing executed according to website-testing skill workflow:
1. API baseline
2. Smoke UI
3. Core E2E flow (Playwright)
4. Security checks (XSS / unsafe labels)
5. Regression rerun

## Scope
- `results.html`: result filtering by user and level title rendering.
- `submit-test` integration and auth flow stability.

## API Baseline
- Unauthorized call to `submit-test` returns `401` (expected).
- Authorized call with valid user JWT returns `200` (expected).

## Iteration A (Bug Found Earlier)
- Bug: users could see чужие результаты.
- Fix: query now filters by `.eq('user_id', currentUser.id)`.
- Status: fixed.

## Iteration B (Current Task)
- Bug: A1 card could show injected label text (`Inject`) from `level_badge`.
- Fix: level title rendering now uses trusted level map in UI; `A1 -> Starter`.
- Status: fixed.

## Playwright E2E Result (Final)
- PASS `test.html loads without page errors`
- PASS `login redirects to test section`
- PASS `result badge is populated after finish`
- PASS `submit-test returns 200`
- PASS `results.html shows results section for authenticated user`
- PASS `results list renders cards`
- PASS `results do not display injected text as level title`
- PASS `A1 results display Starter label`
- PASS `no injected img nodes from DB payload`
- PASS `XSS payload did not execute`
- PASS `no console errors during flow`

## Final Verdict
All checks passed. No open bugs in tested scope.
