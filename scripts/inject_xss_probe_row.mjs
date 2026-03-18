import fs from 'node:fs';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF;
const serviceKey = process.env.SUPABASE_SECRET;
const anonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_IPiv65AiEjXlmbebq-3jOQ_aVR-5_RY';

if (!projectRef || !serviceKey) {
  console.error('Missing SUPABASE_PROJECT_REF or SUPABASE_SECRET');
  process.exit(1);
}

const resultPath = path.resolve('.instructions/api_baseline_result.json');
const baseline = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const baseUrl = `https://${projectRef}.supabase.co`;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const session = await fetchJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: baseline.qa_email,
      password: baseline.qa_password,
    }),
  });

  const userId = session.user?.id;
  if (!userId) {
    throw new Error('Unable to resolve QA user id');
  }

  await fetchJson(`${baseUrl}/rest/v1/test_results`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      user_email: baseline.qa_email,
      answers: [],
      score: 55,
      normalized_score: 0.55,
      level: '<img src=x onerror="window.__xss_probe=1">',
      level_badge: '<svg onload="window.__xss_probe=1">',
      breakdown: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
      time_seconds: 42,
      completed_at: new Date().toISOString(),
    }),
  });

  baseline.qa_expected_results_count = Number(baseline.qa_expected_results_count || 0) + 1;
  fs.writeFileSync(resultPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

  console.log(`Inserted XSS probe row for ${baseline.qa_email}. Expected count: ${baseline.qa_expected_results_count}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
