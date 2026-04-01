import fs from 'node:fs';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF;
const serviceKey = process.env.SUPABASE_SECRET;
const anonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_IPiv65AiEjXlmbebq-3jOQ_aVR-5_RY';
const explicitSupabaseUrl = process.env.SUPABASE_URL || '';
const airtableApiKey = process.env.AIRTABLE_API_KEY || '';
const airtableBaseId = process.env.AIRTABLE_BASE_ID || '';
const airtableStudentsTable = process.env.AIRTABLE_STUDENTS_TABLE_NAME || 'Students';
const airtableCalendarTable = process.env.AIRTABLE_CALENDAR_TABLE_NAME || 'Student Calendar';

if ((!projectRef && !explicitSupabaseUrl) || !serviceKey || !anonKey) {
  console.error('Missing env vars. Need SUPABASE_URL or SUPABASE_PROJECT_REF, plus SUPABASE_SECRET and SUPABASE_ANON_KEY');
  process.exit(1);
}

const baseUrl = explicitSupabaseUrl || `https://${projectRef}.supabase.co`;

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createUser(email, password) {
  const res = await fetchJson(`${baseUrl}/auth/v1/admin/users`, {
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

  if (!res.ok) throw new Error(`createUser failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

async function signIn(email, password) {
  const res = await fetchJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok || !res.body?.access_token) {
    throw new Error(`signIn failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return res.body;
}

async function callEdge(name, accessToken, payload = {}, method = 'POST') {
  const res = await fetchJson(`${baseUrl}/functions/v1/${name}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
  });

  if (!res.ok) {
    throw new Error(`${name} failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return res.body;
}

async function upsertUserRole({ userId, email, role, allowlisted }) {
  const res = await fetchJson(`${baseUrl}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      user_id: userId,
      email,
      role,
      allowlisted,
    }),
  });

  if (!res.ok) throw new Error(`upsertUserRole failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function airtableListRecords(tableName) {
  if (!airtableApiKey || !airtableBaseId) return [];
  const records = [];
  let offset = null;

  do {
    const url = new URL(`https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${airtableApiKey}`,
      },
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      throw new Error(`Airtable list ${tableName} failed (${response.status}): ${JSON.stringify(body)}`);
    }

    records.push(...(Array.isArray(body?.records) ? body.records : []));
    offset = body?.offset || null;
  } while (offset);

  return records;
}

async function run() {
  const stamp = Date.now();
  const studentEmail = `mvp_student_${stamp}@example.test`;
  const methodistEmail = `mvp_methodist_${stamp}@example.test`;
  const studentPassword = `Mvp_${stamp}_Student!1`;
  const methodistPassword = `Mvp_${stamp}_Methodist!1`;

  const report = {
    run_at: new Date().toISOString(),
    student_email: studentEmail,
    methodist_email: methodistEmail,
    checks: [],
  };

  const logCheck = (name, details = {}) => {
    report.checks.push({ name, pass: true, details });
    console.log(`PASS: ${name}`);
  };

  console.log('Creating student + methodist users...');
  const studentUser = await createUser(studentEmail, studentPassword);
  const methodistUser = await createUser(methodistEmail, methodistPassword);
  assert(studentUser?.id, 'Student user creation did not return id');
  assert(methodistUser?.id, 'Methodist user creation did not return id');
  logCheck('create_users', { student_user_id: studentUser.id, methodist_user_id: methodistUser.id });

  console.log('Signing in users...');
  const studentSession = await signIn(studentEmail, studentPassword);
  const methodistSession = await signIn(methodistEmail, methodistPassword);
  const studentToken = studentSession.access_token;
  const methodistToken = methodistSession.access_token;
  assert(studentToken && methodistToken, 'Missing access tokens');
  logCheck('sign_in');

  console.log('Setting methodist role...');
  await upsertUserRole({
    userId: methodistUser.id,
    email: methodistEmail,
    role: 'methodist',
    allowlisted: true,
  });
  logCheck('upsert_methodist_role');

  console.log('Smoke: get-test-catalog...');
  const catalog = await callEdge('get-test-catalog', studentToken, {}, 'POST');
  assert(Array.isArray(catalog.tests), 'get-test-catalog: tests must be array');
  assert(catalog.tests.length >= 1, 'get-test-catalog: expected at least 1 active test');
  logCheck('get-test-catalog', { tests: catalog.tests.length });

  console.log('Smoke: placement attempt via get-test-questions + submit-test...');
  const questionPack = await callEdge('get-test-questions', studentToken, { count: 50 });
  assert(Array.isArray(questionPack.questions) && questionPack.questions.length === 50, 'get-test-questions must return 50 questions');
  const answers = questionPack.questions.map((q) => ({
    question_id: Number(q.id),
    selected_option: 0,
  }));
  const submit = await callEdge('submit-test', studentToken, {
    answers,
    time_seconds: 900,
    test_id: 'english-placement',
    mode: 'placement',
  });
  assert(submit.attempt_id, 'submit-test: missing attempt_id');
  assert(typeof submit.score === 'number', 'submit-test: score must be number');
  logCheck('submit-test', { attempt_id: submit.attempt_id, level: submit.level, score: submit.score });

  console.log('Smoke: upsert-student-profile...');
  const profile = await callEdge('upsert-student-profile', studentToken, {
    full_name: 'QA Student Smoke',
    phone_e164: '+79991234567',
  });
  assert(profile.profile?.is_completed === true, 'upsert-student-profile: profile should be completed');
  logCheck('upsert-student-profile');

  console.log('Smoke: create-goal-and-plan + confirm...');
  const createdPlan = await callEdge('create-goal-and-plan', studentToken, {
    target_level: 'B2',
    lessons_per_week: 3,
    preferred_days: [1, 3, 5],
  });
  assert(createdPlan.plan_version?.id, 'create-goal-and-plan: missing plan_version.id');
  assert(Array.isArray(createdPlan.preview?.lessons) && createdPlan.preview.lessons.length > 0, 'create-goal-and-plan: empty lessons');
  logCheck('create-goal-and-plan', { lessons: createdPlan.preview.lessons.length });

  const confirmedInitial = await callEdge('confirm-plan-version', studentToken, {
    plan_version_id: createdPlan.plan_version.id,
  });
  assert(confirmedInitial.activated === true, 'confirm-plan-version: activated must be true');
  logCheck('confirm-plan-version (initial)');

  console.log('Smoke: get-student-dashboard-core + get-student-dashboard-plan...');
  const dashboardCore = await callEdge('get-student-dashboard-core', studentToken, {}, 'POST');
  assert(dashboardCore.goal?.target_level === 'B2', 'get-student-dashboard-core: expected target_level B2');
  const dashboardPlan1 = await callEdge('get-student-dashboard-plan', studentToken, {}, 'POST');
  assert(Array.isArray(dashboardPlan1.plan?.lessons) && dashboardPlan1.plan.lessons.length > 0, 'get-student-dashboard-plan: lessons must exist');
  logCheck('get-student-dashboard-core', { target_level: dashboardCore.goal?.target_level || null });
  logCheck('get-student-dashboard-plan', { lessons: dashboardPlan1.plan.lessons.length });

  console.log('Smoke: recalculate-plan + confirm...');
  const recalculated = await callEdge('recalculate-plan', studentToken, {
    target_level: 'B2',
    lessons_per_week: 3,
    preferred_days: [2, 4, 6],
    reason: 'qa_smoke_replan',
  });
  assert(recalculated.plan_version?.id, 'recalculate-plan: missing draft plan_version.id');
  assert(recalculated.usage?.used >= 1, 'recalculate-plan: usage.used should increase');
  logCheck('recalculate-plan', { usage_used: recalculated.usage.used });

  const confirmedReplan = await callEdge('confirm-plan-version', studentToken, {
    plan_version_id: recalculated.plan_version.id,
  });
  assert(confirmedReplan.activated === true, 'confirm-plan-version (replan): activated must be true');
  logCheck('confirm-plan-version (replan)');

  console.log('Smoke: analyze-attempt-mistakes...');
  const analysis = await callEdge('analyze-attempt-mistakes', studentToken, {
    attempt_id: submit.attempt_id,
  });
  assert(analysis.insight?.id, 'analyze-attempt-mistakes: missing insight.id');
  assert(['openai', 'fallback'].includes(String(analysis.source)), 'analyze-attempt-mistakes: invalid source');
  logCheck('analyze-attempt-mistakes', { source: analysis.source });

  console.log('Smoke: admin dashboard...');
  const adminDashboard = await callEdge('get-admin-dashboard', methodistToken, {}, 'POST');
  assert(Array.isArray(adminDashboard.students), 'get-admin-dashboard: students must be array');
  const studentRow = adminDashboard.students.find((item) => item?.profile?.user_id === studentUser.id);
  assert(studentRow, 'get-admin-dashboard: created student not found');
  logCheck('get-admin-dashboard', { students: adminDashboard.students.length });

  const adminStudentDetails = await callEdge('get-admin-dashboard', methodistToken, { student_user_id: studentUser.id }, 'POST');
  assert(Array.isArray(adminStudentDetails.selected_student?.attempts), 'admin selected_student.attempts must be array');
  logCheck('get-admin-dashboard (selected student)', {
    attempts: adminStudentDetails.selected_student.attempts.length,
  });

  console.log('Smoke: get-attempt-review...');
  const attemptReview = await callEdge('get-attempt-review', methodistToken, {
    attempt_id: submit.attempt_id,
  });
  assert(Array.isArray(attemptReview.rows), 'get-attempt-review: rows must be array');
  assert(attemptReview.rows.length > 0, 'get-attempt-review: rows must not be empty');
  logCheck('get-attempt-review', { rows: attemptReview.rows.length, source: attemptReview.source });

  console.log('Smoke: admin-toggle-b1-plus...');
  const toggle = await callEdge('admin-toggle-b1-plus', methodistToken, {
    student_user_id: studentUser.id,
    enabled: true,
    reason: 'qa_smoke_enable',
  });
  assert(toggle.ok === true, 'admin-toggle-b1-plus: expected ok=true');
  assert(toggle.b1_plus_enabled === true, 'admin-toggle-b1-plus: expected b1_plus_enabled=true');
  logCheck('admin-toggle-b1-plus', { end_date: toggle.preview?.end_date, total_lessons: toggle.preview?.total_lessons });

  console.log('Smoke: admin-update-lessons (update first lesson)...');
  const dashboardPlan2 = await callEdge('get-student-dashboard-plan', studentToken, {}, 'POST');
  const activePlanId = dashboardPlan2.plan?.active?.id;
  const firstLesson = Array.isArray(dashboardPlan2.plan?.lessons) ? dashboardPlan2.plan.lessons[0] : null;
  assert(activePlanId && firstLesson?.id, 'admin-update-lessons precheck failed: no active plan/lesson');
  const lessonUpdated = await callEdge('admin-update-lessons', methodistToken, {
    action: 'update',
    student_user_id: studentUser.id,
    plan_version_id: activePlanId,
    lesson_id: firstLesson.id,
    lesson: {
      priority_note: 'QA smoke priority note',
    },
  });
  assert(lessonUpdated.ok === true, 'admin-update-lessons: expected ok=true');
  logCheck('admin-update-lessons');

  console.log('Smoke: sync-attendance-airtable...');
  const syncResult = await callEdge('sync-attendance-airtable', methodistToken, { mode: 'pull_only' }, 'POST');
  assert(syncResult.ok === true, 'sync-attendance-airtable: expected ok=true');
  logCheck('sync-attendance-airtable', {
    pull: syncResult.pull || {},
    push: syncResult.push || {},
  });

  if (airtableApiKey && airtableBaseId) {
    console.log('Smoke: Airtable field integrity...');
    const studentsRecords = await airtableListRecords(airtableStudentsTable);
    const calendarRecords = await airtableListRecords(airtableCalendarTable);

    const studentRecord = studentsRecords.find((row) => normalizeEmail(row?.fields?.email) === normalizeEmail(studentEmail));
    assert(studentRecord, 'Airtable Students: test student row not found');

    const currentLevel = String(studentRecord.fields?.current_level || '').trim();
    const targetLevel = String(studentRecord.fields?.target_level || '').trim();
    const isActive = Boolean(studentRecord.fields?.is_active);
    assert(currentLevel.length > 0, 'Airtable Students: current_level is empty');
    assert(targetLevel.length > 0, 'Airtable Students: target_level is empty');
    assert(isActive === true, 'Airtable Students: is_active must be true for active goal');

    const studentCalendarRows = calendarRecords.filter((row) => normalizeEmail(row?.fields?.email) === normalizeEmail(studentEmail));
    assert(studentCalendarRows.length > 0, 'Airtable Student Calendar: no rows for test student');

    const linkedRow = studentCalendarRows.find((row) => Array.isArray(row?.fields?.student) && row.fields.student.length > 0);
    assert(linkedRow, 'Airtable Student Calendar: field `student` link is empty');

    const readableRow = studentCalendarRows.find((row) => String(row?.fields?.student_name_status || '').includes('•'));
    assert(readableRow, 'Airtable Student Calendar: `student_name_status` is not populated');

    const legacyReadable = studentCalendarRows.find((row) => String(row?.fields?.supabase_lesson_id || '').includes('•'));
    assert(legacyReadable, 'Airtable Student Calendar: `supabase_lesson_id` is not human-readable');

    logCheck('airtable-integrity', {
      students_rows: studentsRecords.length,
      calendar_rows: calendarRecords.length,
      student_calendar_rows: studentCalendarRows.length,
      current_level: currentLevel,
      target_level: targetLevel,
      student_linked: true,
    });
  }

  const outPath = path.resolve('.instructions/mvp_v3_endpoint_smoke_result.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('MVP v3 endpoint smoke passed.');
  console.log(`Saved: ${outPath}`);
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
