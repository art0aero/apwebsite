const apiKey = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID || 'appguP61S25V4iiCB';

if (!apiKey) {
  console.error('Missing AIRTABLE_API_KEY');
  process.exit(1);
}

const metaBase = `https://api.airtable.com/v0/meta/bases/${baseId}`;

async function request(path, method = 'GET', body) {
  const response = await fetch(`${metaBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const err = new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(data)}`);
    err.status = response.status;
    throw err;
  }

  return data;
}

async function getTables() {
  const data = await request('/tables');
  return Array.isArray(data?.tables) ? data.tables : [];
}

function findTable(tables, name) {
  return tables.find((table) => String(table.name || '').trim() === name) || null;
}

function hasField(table, fieldName) {
  return (table.fields || []).some((field) => field.name === fieldName);
}

async function createTable(name, primaryFieldName) {
  const data = await request('/tables', 'POST', {
    name,
    fields: [
      {
        name: primaryFieldName,
        type: 'singleLineText',
      },
    ],
  });
  return data;
}

async function createField(tableId, field) {
  return request(`/tables/${tableId}/fields`, 'POST', field);
}

async function ensureTable(name, primaryFieldName) {
  const tables = await getTables();
  const existing = findTable(tables, name);
  if (existing) return existing;

  const created = await createTable(name, primaryFieldName);
  return created;
}

async function refreshTable(name) {
  const tables = await getTables();
  const table = findTable(tables, name);
  if (!table) throw new Error(`Table not found after create: ${name}`);
  return table;
}

async function ensureFields(tableName, fieldSpecs) {
  let table = await refreshTable(tableName);

  for (const spec of fieldSpecs) {
    if (hasField(table, spec.name)) continue;
    await createField(table.id, spec);
    table = await refreshTable(tableName);
  }

  return table;
}

function selectChoices(names) {
  return {
    choices: names.map((name) => ({ name })),
  };
}

async function tryCreateCalendarViews(calendarTableId) {
  const attempts = [
    {
      path: `/tables/${calendarTableId}/views`,
      body: {
        name: 'Calendar',
        type: 'calendar',
        options: {
          dateFieldId: null,
        },
      },
    },
    {
      path: `/tables/${calendarTableId}/views`,
      body: {
        name: 'Timeline',
        type: 'timeline',
      },
    },
  ];

  const results = [];
  for (const attempt of attempts) {
    try {
      await request(attempt.path, 'POST', attempt.body);
      results.push({ name: attempt.body.name, created: true });
    } catch (error) {
      results.push({ name: attempt.body.name, created: false, reason: error.message });
    }
  }

  return results;
}

async function main() {
  const students = await ensureTable('Students', 'email');

  await ensureFields('Students', [
    { name: 'student_name', type: 'singleLineText' },
    { name: 'phone', type: 'phoneNumber' },
    { name: 'current_level', type: 'singleSelect', options: selectChoices(['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']) },
    { name: 'target_level', type: 'singleSelect', options: selectChoices(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) },
    {
      name: 'is_active',
      type: 'checkbox',
      options: {
        color: 'greenBright',
        icon: 'check',
      },
    },
  ]);

  const calendar = await ensureTable('Student Calendar', 'student_name_status');

  await ensureFields('Student Calendar', [
    { name: 'sync_key', type: 'singleLineText' },
    { name: 'student_name_status', type: 'singleLineText' },
    { name: 'supabase_lesson_id', type: 'singleLineText' },
    {
      name: 'student',
      type: 'multipleRecordLinks',
      options: {
        linkedTableId: students.id,
      },
    },
    { name: 'email', type: 'singleLineText' },
    { name: 'student_name', type: 'singleLineText' },
    { name: 'phone', type: 'phoneNumber' },
    {
      name: 'lesson_date',
      type: 'date',
      options: {
        dateFormat: {
          name: 'iso',
          format: 'YYYY-MM-DD',
        },
      },
    },
    {
      name: 'status',
      type: 'singleSelect',
      options: selectChoices(['planned', 'completed', 'missed', 'rescheduled']),
    },
    { name: 'lesson_title', type: 'singleLineText' },
    { name: 'lesson_description', type: 'multilineText' },
    {
      name: 'level',
      type: 'singleSelect',
      options: selectChoices(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
    },
    {
      name: 'cost',
      type: 'currency',
      options: {
        symbol: '₽',
        precision: 0,
      },
    },
    { name: 'priority_note', type: 'multilineText' },
    {
      name: 'last_modified_at',
      type: 'dateTime',
      options: {
        dateFormat: {
          name: 'iso',
          format: 'YYYY-MM-DD',
        },
        timeFormat: {
          name: '24hour',
          format: 'HH:mm',
        },
        timeZone: 'utc',
      },
    },
  ]);

  const calendarTable = await refreshTable('Student Calendar');
  const viewResults = await tryCreateCalendarViews(calendarTable.id);

  console.log(JSON.stringify({
    ok: true,
    base_id: baseId,
    students_table_id: students.id,
    calendar_table_id: calendarTable.id,
    views: viewResults,
    note: 'If views are not created, Airtable metadata API likely does not support view creation for this base/plan; create Calendar and Timeline views manually in UI.',
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
