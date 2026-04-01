import fs from 'node:fs';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF;
const anonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_IPiv65AiEjXlmbebq-3jOQ_aVR-5_RY';
const explicitSupabaseUrl = process.env.SUPABASE_URL || '';
const testBaseUrl = process.env.TEST_BASE_URL || '';
const iterations = Math.max(3, Number(process.env.PERF_ITERATIONS || 8));
const baselinePath = path.resolve('.instructions/api_baseline_result.json');

if (!projectRef && !explicitSupabaseUrl) {
  console.error('Missing SUPABASE_URL or SUPABASE_PROJECT_REF');
  process.exit(1);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing ${baselinePath}. Run baseline checks first.`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const qaEmail = String(baseline.qa_email || '').trim();
const qaPassword = String(baseline.qa_password || '').trim();

if (!qaEmail || !qaPassword) {
  console.error('api_baseline_result.json must contain qa_email and qa_password');
  process.exit(1);
}

const supabaseBase = explicitSupabaseUrl || `https://${projectRef}.supabase.co`;

function quantile(sortedNumbers, q) {
  if (!sortedNumbers.length) return 0;
  const idx = Math.max(0, Math.min(sortedNumbers.length - 1, Math.floor(q * (sortedNumbers.length - 1))));
  return sortedNumbers[idx];
}

function summarize(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = sorted.reduce((sum, item) => sum + item, 0);
  return {
    count: sorted.length,
    min_ms: Number(sorted[0]?.toFixed(1) || 0),
    p50_ms: Number(quantile(sorted, 0.5).toFixed(1)),
    p95_ms: Number(quantile(sorted, 0.95).toFixed(1)),
    max_ms: Number(sorted[sorted.length - 1]?.toFixed(1) || 0),
    avg_ms: Number((total / sorted.length).toFixed(1)),
  };
}

async function timedFetch(label, url, options = {}) {
  const start = performance.now();
  const response = await fetch(url, options);
  const elapsed = performance.now() - start;
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return { elapsed, body };
}

async function signIn() {
  const { body } = await timedFetch('signIn', `${supabaseBase}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: qaEmail,
      password: qaPassword,
    }),
  });

  if (!body?.access_token) {
    throw new Error('signIn returned no access_token');
  }

  return body.access_token;
}

async function measureStaticPage(url) {
  const latencies = [];
  for (let i = 0; i < iterations; i += 1) {
    const { elapsed } = await timedFetch('static_page', url, { method: 'GET' });
    latencies.push(elapsed);
  }
  return summarize(latencies);
}

async function measureFunction(name, token, payload = {}, method = 'POST') {
  const latencies = [];
  for (let i = 0; i < iterations; i += 1) {
    const { elapsed } = await timedFetch(
      name,
      `${supabaseBase}/functions/v1/${name}`,
      {
        method,
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: method === 'GET' ? undefined : JSON.stringify(payload),
      },
    );
    latencies.push(elapsed);
  }
  return summarize(latencies);
}

async function main() {
  const token = await signIn();
  const report = {
    timestamp: new Date().toISOString(),
    iterations,
    supabase: {
      get_student_dashboard_core: await measureFunction('get-student-dashboard-core', token),
      get_student_dashboard_plan: await measureFunction('get-student-dashboard-plan', token),
      get_test_catalog: await measureFunction('get-test-catalog', token, {}, 'GET'),
      get_admin_dashboard: null,
    },
    web_host: null,
    diagnosis: '',
  };

  try {
    report.supabase.get_admin_dashboard = await measureFunction('get-admin-dashboard', token);
  } catch (error) {
    report.supabase.get_admin_dashboard = { error: error instanceof Error ? error.message : String(error) };
  }

  if (testBaseUrl) {
    const resultsUrl = `${testBaseUrl.replace(/\/$/, '')}/results.html`;
    report.web_host = await measureStaticPage(resultsUrl);
  }

  const dashboardCoreP95 = Number(report.supabase.get_student_dashboard_core?.p95_ms || 0);
  const dashboardPlanP95 = Number(report.supabase.get_student_dashboard_plan?.p95_ms || 0);
  const dashboardP95 = Math.max(dashboardCoreP95, dashboardPlanP95);
  const staticP95 = Number(report.web_host?.p95_ms || 0);
  if (dashboardP95 > 700 && (!staticP95 || staticP95 < dashboardP95 / 2)) {
    report.diagnosis = 'Основная задержка в Supabase Edge/DB вызовах, а не в отдаче статической страницы.';
  } else if (staticP95 > 1000 && dashboardP95 < 700) {
    report.diagnosis = 'Задержка заметна на стороне хостинга статики (Vercel/CDN).';
  } else {
    report.diagnosis = 'Задержка смешанная; GitHub не участвует в runtime-кликах, узкое место между браузером и Supabase/Vercel.';
  }

  const outPath = path.resolve('.instructions/perf_probe_result.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Saved report: ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
