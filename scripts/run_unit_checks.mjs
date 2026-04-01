import fs from 'node:fs';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF;
const explicitSupabaseUrl = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_IPiv65AiEjXlmbebq-3jOQ_aVR-5_RY';
const baselinePath = path.resolve('.instructions/api_baseline_result.json');

if (!explicitSupabaseUrl && !projectRef) {
  console.error('Missing SUPABASE_URL or SUPABASE_PROJECT_REF');
  process.exit(1);
}
if (!fs.existsSync(baselinePath)) {
  console.error(`Missing ${baselinePath}. Run baseline checks first.`);
  process.exit(1);
}

const baseUrl = explicitSupabaseUrl || `https://${projectRef}.supabase.co`;
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const qaEmail = String(baseline.qa_email || '').trim();
const qaPassword = String(baseline.qa_password || '').trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

async function signIn() {
  const { ok, status, body } = await fetchJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: qaEmail, password: qaPassword }),
  });

  if (!ok || !body?.access_token) {
    throw new Error(`signIn failed (${status}): ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function callEdge(name, token, payload = {}, method = 'POST') {
  const { ok, status, body } = await fetchJson(`${baseUrl}/functions/v1/${name}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(payload),
  });

  return { ok, status, body };
}

function normalizeLevel(level) {
  const raw = String(level || '').trim().toUpperCase();
  if (!raw || raw === 'BELOW A1') return 'A1';
  if (raw === 'A0') return 'A1';
  return raw;
}

function lowerOrEqualTarget(level) {
  const raw = String(level || '').trim().toUpperCase();
  if (!raw || raw === 'A0' || raw === 'BELOW A1') {
    return 'A0';
  }
  const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const current = normalizeLevel(level);
  const idx = order.indexOf(current);
  if (idx <= 0) return 'A1';
  return order[idx - 1];
}

async function main() {
  const token = await signIn();
  const report = {
    run_at: new Date().toISOString(),
    checks: [],
  };

  const log = (name, details = {}) => {
    report.checks.push({ name, pass: true, details });
    console.log(`PASS: ${name}`);
  };

  const coreRes = await callEdge('get-student-dashboard-core', token, {}, 'POST');
  assert(coreRes.ok, `core endpoint failed: ${coreRes.status}`);
  assert(coreRes.body?.user?.email, 'core: missing user.email');
  assert(coreRes.body?.replan_usage?.limit === 5, 'core: invalid replan_usage.limit');
  log('dashboard-core-shape');

  const planRes = await callEdge('get-student-dashboard-plan', token, {}, 'POST');
  assert(planRes.ok, `plan endpoint failed: ${planRes.status}`);
  assert(Array.isArray(planRes.body?.plan?.lessons), 'plan: lessons must be array');
  assert(Array.isArray(planRes.body?.results_history), 'plan: results_history must be array');
  log('dashboard-plan-shape');

  const currentLevel = coreRes.body?.latest_test_result?.level || coreRes.body?.goal?.current_level || 'A1';
  const badTarget = lowerOrEqualTarget(currentLevel);

  const createRes = await callEdge('create-goal-and-plan', token, {
    target_level: badTarget,
    lessons_per_week: 3,
    preferred_days: [1, 3, 5],
  });
  assert(!createRes.ok && createRes.status === 400, 'target-level guard: expected 400 on create-goal-and-plan');
  log('target-level-guard-create', { current_level: currentLevel, attempted_target: badTarget });

  const outPath = path.resolve('.instructions/unit_result.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Saved: ${outPath}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
