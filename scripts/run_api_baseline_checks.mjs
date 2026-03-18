import fs from 'node:fs';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF;
const serviceKey = process.env.SUPABASE_SECRET;
const anonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_IPiv65AiEjXlmbebq-3jOQ_aVR-5_RY';

if (!projectRef || !serviceKey || !anonKey) {
  console.error('Missing env vars. Need SUPABASE_PROJECT_REF, SUPABASE_SECRET, SUPABASE_ANON_KEY');
  process.exit(1);
}

const baseUrl = `https://${projectRef}.supabase.co`;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body };
}

async function createUser(email, password) {
  const { ok, status, body } = await fetchJson(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  });

  if (!ok) {
    throw new Error(`createUser failed (${status}): ${JSON.stringify(body)}`);
  }

  return body;
}

async function signIn(email, password) {
  const { ok, status, body } = await fetchJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!ok || !body?.access_token) {
    throw new Error(`signIn failed (${status}): ${JSON.stringify(body)}`);
  }

  return body;
}

async function callEdge(name, accessToken, payload) {
  const { ok, status, body } = await fetchJson(`${baseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });

  if (!ok) {
    throw new Error(`${name} failed (${status}): ${JSON.stringify(body)}`);
  }

  return body;
}

async function insertTestResult(row) {
  const { ok, status, body } = await fetchJson(`${baseUrl}/rest/v1/test_results`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!ok) {
    throw new Error(`insert test_results failed (${status}): ${JSON.stringify(body)}`);
  }
}

async function checkQuestionBankExposure(accessToken) {
  const { status, body } = await fetchJson(`${baseUrl}/rest/v1/question_bank?select=id,correct_option&limit=1`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (status >= 400) {
    return { pass: true, mode: 'denied', status };
  }

  if (Array.isArray(body) && body.length === 0) {
    return { pass: true, mode: 'empty', status };
  }

  return { pass: false, mode: 'exposed', status, body };
}

async function main() {
  const stamp = Date.now();
  const qaEmail = `qa_${stamp}@example.test`;
  const foreignEmail = `qa_foreign_${stamp}@example.test`;
  const qaPassword = `Qa_${stamp}_Pass!1`;
  const foreignPassword = `Qa_${stamp}_Foreign!1`;

  console.log('Creating QA users...');
  const qaUser = await createUser(qaEmail, qaPassword);
  const foreignUser = await createUser(foreignEmail, foreignPassword);

  console.log('Signing in QA user...');
  const qaSession = await signIn(qaEmail, qaPassword);
  const qaToken = qaSession.access_token;

  console.log('Checking direct question_bank exposure...');
  const exposure = await checkQuestionBankExposure(qaToken);
  if (!exposure.pass) {
    throw new Error(`question_bank exposure detected: ${JSON.stringify(exposure)}`);
  }

  console.log('Running 11 cycles of get-test-questions + submit-test...');
  const firstTenUniqueIds = new Set();

  for (let cycle = 1; cycle <= 11; cycle += 1) {
    const questionPack = await callEdge('get-test-questions', qaToken, { count: 50 });

    if (!Array.isArray(questionPack.questions) || questionPack.questions.length !== 50) {
      throw new Error(`Cycle ${cycle}: expected 50 questions, got ${questionPack.questions?.length}`);
    }

    const ids = questionPack.questions.map((q) => Number(q.id));
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error(`Cycle ${cycle}: duplicate IDs inside one question pack`);
    }

    if (cycle <= 10) {
      for (const id of ids) {
        if (firstTenUniqueIds.has(id)) {
          throw new Error(`Cycle ${cycle}: repeated question ${id} before exhausting first 500`);
        }
        firstTenUniqueIds.add(id);
      }

      if (questionPack.cycle_reset) {
        throw new Error(`Cycle ${cycle}: cycle_reset should be false before exhaustion`);
      }
    }

    if (cycle === 11 && !questionPack.cycle_reset) {
      throw new Error('Cycle 11: expected cycle_reset=true after full bank exhaustion');
    }

    const answers = questionPack.questions.map((q) => ({
      question_id: Number(q.id),
      selected_option: 0,
    }));

    const submitResult = await callEdge('submit-test', qaToken, {
      answers,
      time_seconds: 1200,
      client_meta: {
        source: 'api-baseline',
      },
    });

    if (typeof submitResult?.score !== 'number' || !submitResult?.level) {
      throw new Error(`Cycle ${cycle}: submit-test response shape is invalid`);
    }
  }

  if (firstTenUniqueIds.size !== 500) {
    throw new Error(`Expected 500 unique IDs after 10 cycles, got ${firstTenUniqueIds.size}`);
  }

  console.log('Injecting A1 Starter row for UI regression check...');
  await insertTestResult({
    user_id: qaUser.id,
    user_email: qaEmail,
    answers: [],
    score: 20,
    normalized_score: 0.1,
    level: 'A1',
    level_badge: 'A1 - Starter',
    breakdown: { A1: 20, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
    time_seconds: 333,
    completed_at: new Date().toISOString(),
  });

  console.log('Injecting foreign-user row for visibility isolation check...');
  await insertTestResult({
    user_id: foreignUser.id,
    user_email: foreignEmail,
    answers: [],
    score: 99,
    normalized_score: 0.99,
    level: 'C2',
    level_badge: 'C2 - Proficiency',
    breakdown: { A1: 100, A2: 100, B1: 100, B2: 100, C1: 100, C2: 100 },
    time_seconds: 60,
    completed_at: new Date().toISOString(),
  });

  const summary = {
    qa_email: qaEmail,
    qa_password: qaPassword,
    qa_expected_results_count: 12,
    foreign_email: foreignEmail,
    first_ten_unique_questions: firstTenUniqueIds.size,
    direct_question_bank_exposure: exposure,
  };

  const outPath = path.resolve('.instructions/api_baseline_result.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('API baseline passed.');
  console.log(`Saved: ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
