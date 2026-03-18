import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const baselinePath = path.resolve('.instructions/api_baseline_result.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const qaEmail = baseline.qa_email;
const qaPassword = baseline.qa_password;
const expectedResultsCount = Number(baseline.qa_expected_results_count);

function collectErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test('Smoke pages load without runtime errors', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/index.html');
  await page.goto('/test.html');
  await page.goto('/results.html');

  expect(errors, `Console errors: ${JSON.stringify(errors)}`).toHaveLength(0);
});

test('Results page: own rows only, Starter label, XSS safe', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/results.html');
  await page.fill('#form-login input[type="email"]', qaEmail);
  await page.fill('#form-login input[type="password"]', qaPassword);
  await page.locator('#form-login button[type="submit"]').click();

  await page.waitForSelector('#results-list', { state: 'visible' });
  await page.waitForTimeout(1500);

  await expect(page.locator('#user-email')).toContainText(qaEmail);
  await expect(page.locator('#results-list > div')).toHaveCount(expectedResultsCount, { timeout: 20000 });

  const listText = await page.locator('#results-list').innerText();
  expect(listText).toContain('Starter');
  expect(listText).toContain('<img src=x onerror="window.__xss_probe=1">');

  const xssExecuted = await page.evaluate(() => Boolean(window.__xss_probe));
  expect(xssExecuted).toBe(false);
  expect(errors, `Console errors: ${JSON.stringify(errors)}`).toHaveLength(0);
});

test('Core flow: register, complete 50-question test, get result', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/test.html');
  await page.fill('#form-login input[type="email"]', qaEmail);
  await page.fill('#form-login input[type="password"]', qaPassword);
  await page.locator('#form-login button[type="submit"]').click();

  await page.waitForSelector('#question-text', { state: 'visible', timeout: 30000 });

  for (let i = 0; i < 50; i += 1) {
    await page.locator('#options-container label').first().click();
    await page.locator('#btn-next').click();
    if (i < 49) {
      await page.waitForTimeout(80);
    }
  }

  await page.waitForSelector('#results-section', { state: 'visible', timeout: 30000 });
  const badge = await page.locator('#res-level-badge').innerText();
  expect(badge.trim().length).toBeGreaterThan(0);
  expect(badge).not.toContain('Inject');

  expect(errors, `Console errors: ${JSON.stringify(errors)}`).toHaveLength(0);
});
