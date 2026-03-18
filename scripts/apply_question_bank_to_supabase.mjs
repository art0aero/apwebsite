import fs from 'node:fs';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const serviceKey = process.env.SUPABASE_SECRET;

if (!projectRef || !accessToken || !serviceKey) {
  console.error('Missing required env vars: SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN, SUPABASE_SECRET');
  process.exit(1);
}

const managementBase = `https://api.supabase.com/v1/projects/${projectRef}`;
const restBase = `https://${projectRef}.supabase.co/rest/v1`;

async function runSql(query) {
  const response = await fetch(`${managementBase}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SQL request failed (${response.status}): ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function restRequest(endpoint, method, body, prefer = 'return=minimal') {
  const response = await fetch(`${restBase}${endpoint}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`REST request failed (${response.status}) ${method} ${endpoint}: ${text}`);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const setupSqlPath = path.resolve('supabase/sql/001_question_bank_setup.sql');
  const setupSql = fs.readFileSync(setupSqlPath, 'utf8');
  const questionBankPath = path.resolve('supabase/data/question_bank.json');
  const questionBank = JSON.parse(fs.readFileSync(questionBankPath, 'utf8'));

  if (!Array.isArray(questionBank) || questionBank.length !== 500) {
    throw new Error(`Expected 500 questions in ${questionBankPath}`);
  }

  console.log('Applying SQL setup...');
  await runSql(setupSql);

  console.log('Resetting question_bank table...');
  await runSql('truncate table public.question_bank restart identity cascade;');

  console.log('Inserting question bank rows...');
  const payloadRows = questionBank.map((row) => ({
    level: row.level,
    question_text: row.question_text,
    options: row.options,
    correct_option: row.correct_option,
    is_active: true,
  }));

  const chunkSize = 100;
  for (let i = 0; i < payloadRows.length; i += chunkSize) {
    const chunk = payloadRows.slice(i, i + chunkSize);
    await restRequest('/question_bank', 'POST', chunk);
    console.log(`Inserted rows ${i + 1}-${i + chunk.length}`);
  }

  console.log('Verifying counts...');
  const countRows = await runSql('select count(*)::int as total from public.question_bank where is_active = true;');
  const distributionRows = await runSql(`
    select level, count(*)::int as total
    from public.question_bank
    where is_active = true
    group by level
    order by level;
  `);

  console.log('Total active questions:', countRows?.[0]?.total ?? 'unknown');
  console.log('Distribution:', distributionRows);

  if ((countRows?.[0]?.total ?? 0) !== 500) {
    throw new Error('Verification failed: total active questions is not 500');
  }

  const expected = { A1: 84, A2: 84, B1: 83, B2: 83, C1: 83, C2: 83 };
  for (const row of distributionRows || []) {
    if (expected[row.level] !== Number(row.total)) {
      throw new Error(`Verification failed for ${row.level}: expected ${expected[row.level]}, got ${row.total}`);
    }
  }

  console.log('Supabase question bank sync completed successfully.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
