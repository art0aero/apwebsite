import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
const baselinePath = path.resolve('.instructions/api_baseline_result.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const qaEmail = baseline.qa_email;
const qaPassword = baseline.qa_password;
const expectedResultsCount = Number(baseline.qa_expected_results_count);

if (!qaEmail || !qaPassword || !Number.isFinite(expectedResultsCount)) {
  throw new Error('api_baseline_result.json is missing required QA fields');
}

function createConsoleCollector(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(String(error));
  });
  return errors;
}

async function login(page, email, password) {
  await page.fill('#form-login input[type="email"]', email);
  await page.fill('#form-login input[type="password"]', password);
  await page.locator('#form-login button').click();
}

async function waitForDashboardAfterLogin(page, timeoutMs = 30000) {
  await page.waitForFunction(() => {
    const dashboard = document.getElementById('dashboard-section');
    const authError = document.getElementById('auth-error');
    const dashboardVisible = dashboard && !dashboard.classList.contains('hidden');
    const hasAuthError = authError && !authError.classList.contains('hidden') && String(authError.textContent || '').trim().length > 0;
    return dashboardVisible || hasAuthError;
  }, { timeout: timeoutMs });

  const authErrorText = await page.locator('#auth-error').textContent();
  const isAuthErrorVisible = await page.locator('#auth-error').isVisible().catch(() => false);
  if (isAuthErrorVisible && authErrorText && authErrorText.trim().length > 0) {
    throw new Error(`Login failed in UI: ${authErrorText.trim()}`);
  }
}

async function waitForResultCardsCount(page, expected, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = await page.locator('#results-list > div').count();
    if (count === expected) return count;
    await page.waitForTimeout(300);
  }
  return page.locator('#results-list > div').count();
}

async function run() {
  const browser = await chromium.launch({ headless: true });

  try {
    const smokeContext = await browser.newContext();
    const smokePage = await smokeContext.newPage();
    const smokeErrors = createConsoleCollector(smokePage);

    await smokePage.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await smokePage.goto(`${baseUrl}/test.html`, { waitUntil: 'domcontentloaded' });
    await smokePage.goto(`${baseUrl}/results.html`, { waitUntil: 'domcontentloaded' });

    if (smokeErrors.length > 0) {
      throw new Error(`Smoke console errors: ${JSON.stringify(smokeErrors.slice(0, 5))}`);
    }

    await smokeContext.close();

    const resultsContext = await browser.newContext();
    const resultsPage = await resultsContext.newPage();
    const resultsErrors = createConsoleCollector(resultsPage);

    await resultsPage.goto(`${baseUrl}/results.html`, { waitUntil: 'domcontentloaded' });
    await login(resultsPage, qaEmail, qaPassword);
    await waitForDashboardAfterLogin(resultsPage);

    await resultsPage.waitForSelector('#results-list', { state: 'visible' });
    await resultsPage.waitForTimeout(1000);

    const cardsCount = await waitForResultCardsCount(resultsPage, expectedResultsCount);
    if (cardsCount < expectedResultsCount) {
      throw new Error(`Results visibility mismatch: expected at least ${expectedResultsCount}, got ${cardsCount}`);
    }

    const emailText = await resultsPage.locator('#user-email').textContent();
    if (!emailText || !emailText.includes(qaEmail)) {
      throw new Error(`Wrong user email in header: ${emailText}`);
    }

    const listText = await resultsPage.locator('#results-list').innerText();
    if (!listText.includes('Starter')) {
      throw new Error('Starter label is missing for A1 result card');
    }

    const xssExecuted = await resultsPage.evaluate(() => Boolean(window.__xss_probe));
    if (xssExecuted) {
      throw new Error('XSS probe executed in results page');
    }

    const suspiciousNodes = await resultsPage.locator('#results-list img, #results-list svg, #results-list script').count();
    if (suspiciousNodes > 0) {
      throw new Error(`Potential XSS render detected: found ${suspiciousNodes} suspicious nodes in results list`);
    }

    const statsSelectors = ['#stat-total-lessons', '#stat-completed-lessons', '#stat-avg-cost', '#stat-monthly-payment'];
    for (const selector of statsSelectors) {
      const text = await resultsPage.locator(selector).textContent();
      if (text === null) {
        throw new Error(`Missing expected stats field: ${selector}`);
      }
    }

    const xssMarkerVisibleAsText = listText.includes('window.__xss_probe=1');

    if (resultsErrors.length > 0) {
      throw new Error(`Results page console errors: ${JSON.stringify(resultsErrors.slice(0, 5))}`);
    }

    await resultsContext.close();

    const coreContext = await browser.newContext();
    const testPage = await coreContext.newPage();
    const coreErrors = createConsoleCollector(testPage);

    await testPage.goto(`${baseUrl}/test.html`, { waitUntil: 'domcontentloaded' });
    await testPage.fill('#form-login input[type="email"]', qaEmail);
    await testPage.fill('#form-login input[type="password"]', qaPassword);
    await testPage.locator('#form-login button').click();

    await testPage.waitForSelector('#question-text', { state: 'visible', timeout: 30000 });

    for (let i = 0; i < 50; i += 1) {
      await testPage.waitForSelector('#options-container input[type="radio"]', { state: 'visible', timeout: 30000 });
      await testPage.locator('#options-container input[type="radio"]').first().check({ force: true });
      await testPage.waitForFunction(() => {
        const next = document.getElementById('btn-next');
        return Boolean(next && !next.disabled);
      }, { timeout: 30000 });
      await testPage.locator('#btn-next').click();
      if (i < 49) {
        await testPage.waitForTimeout(80);
      }
    }

    await testPage.waitForSelector('#results-section', { state: 'visible', timeout: 30000 });

    const badge = await testPage.locator('#res-level-badge').innerText();
    if (!badge || badge.trim().length === 0) {
      throw new Error('Test completion badge is empty');
    }

    if (badge.includes('Inject')) {
      throw new Error(`Unexpected level text in badge: ${badge}`);
    }

    if (coreErrors.length > 0) {
      throw new Error(`Core flow console errors: ${JSON.stringify(coreErrors.slice(0, 5))}`);
    }

    await coreContext.close();

    const report = {
      smoke: 'pass',
      results_page: 'pass',
      core_flow: 'pass',
      qa_email: qaEmail,
      results_cards_count: cardsCount,
      xss_probe_executed: false,
      xss_marker_visible_as_text: xssMarkerVisibleAsText,
      suspicious_nodes_in_results_list: suspiciousNodes,
      starter_label_found: true,
    };

    const outPath = path.resolve('.instructions/playwright_result.json');
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log('Playwright checks passed.');
    console.log(`Saved: ${outPath}`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
