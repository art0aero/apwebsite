import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, createDedupeKey, ensureEnv, ensureMethodistAccess, getAuthContext, jsonResponse } from '../_shared/common.ts';

type AirtableRecord = {
  id: string;
  createdTime?: string;
  fields?: Record<string, unknown>;
};

type AirtableConfig = {
  apiKey: string;
  baseId: string;
  calendarTableName: string;
  studentsTableName: string | null;
  viewName: string | null;
  enablePush: boolean;
  emailField: string;
  statusField: string;
  dateField: string;
  lessonIdField: string;
  legacyLessonIdField: string | null;
  studentLinkField: string;
  titleField: string;
  descriptionField: string;
  levelField: string;
  costField: string;
  priorityField: string;
  displayField: string;
  fullNameField: string;
  phoneField: string;
  currentLevelField: string;
  targetLevelField: string;
  activeField: string;
  modifiedField: string;
  pushGuardMinutes: number;
  pullMaxRecords: number;
};

type LessonRow = {
  id: string;
  user_id: string;
  goal_id: string;
  plan_version_id: string;
  lesson_index: number;
  lesson_date: string;
  level: string;
  title: string;
  description: string;
  status: 'planned' | 'completed' | 'missed' | 'rescheduled';
  cost: number;
  priority_note: string | null;
  is_checkpoint: boolean;
  is_final_test: boolean;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone_e164: string | null;
};

type GoalMetaRow = {
  user_id: string;
  current_level: string | null;
  target_level: string | null;
  is_active: boolean;
};

function getConfig(): AirtableConfig {
  const calendarTableName = Deno.env.get('AIRTABLE_CALENDAR_TABLE_NAME') || Deno.env.get('AIRTABLE_TABLE_NAME');
  if (!calendarTableName) throw new Error('Missing env: AIRTABLE_CALENDAR_TABLE_NAME or AIRTABLE_TABLE_NAME');

  return {
    apiKey: ensureEnv('AIRTABLE_API_KEY'),
    baseId: ensureEnv('AIRTABLE_BASE_ID'),
    calendarTableName,
    studentsTableName: Deno.env.get('AIRTABLE_STUDENTS_TABLE_NAME') || null,
    viewName: Deno.env.get('AIRTABLE_VIEW_NAME') || null,
    enablePush: (Deno.env.get('AIRTABLE_ENABLE_PUSH') || 'false').toLowerCase() === 'true',
    emailField: Deno.env.get('AIRTABLE_EMAIL_FIELD') || 'email',
    statusField: Deno.env.get('AIRTABLE_STATUS_FIELD') || 'status',
    dateField: Deno.env.get('AIRTABLE_DATE_FIELD') || 'lesson_date',
    lessonIdField: Deno.env.get('AIRTABLE_LESSON_ID_FIELD') || 'sync_key',
    legacyLessonIdField: Deno.env.get('AIRTABLE_LEGACY_LESSON_ID_FIELD') || 'supabase_lesson_id',
    studentLinkField: Deno.env.get('AIRTABLE_STUDENT_LINK_FIELD') || 'student',
    titleField: Deno.env.get('AIRTABLE_TITLE_FIELD') || 'lesson_title',
    descriptionField: Deno.env.get('AIRTABLE_DESCRIPTION_FIELD') || 'lesson_description',
    levelField: Deno.env.get('AIRTABLE_LEVEL_FIELD') || 'level',
    costField: Deno.env.get('AIRTABLE_COST_FIELD') || 'cost',
    priorityField: Deno.env.get('AIRTABLE_PRIORITY_FIELD') || 'priority_note',
    displayField: Deno.env.get('AIRTABLE_DISPLAY_FIELD') || 'student_name_status',
    fullNameField: Deno.env.get('AIRTABLE_FULL_NAME_FIELD') || 'student_name',
    phoneField: Deno.env.get('AIRTABLE_PHONE_FIELD') || 'phone',
    currentLevelField: Deno.env.get('AIRTABLE_CURRENT_LEVEL_FIELD') || 'current_level',
    targetLevelField: Deno.env.get('AIRTABLE_TARGET_LEVEL_FIELD') || 'target_level',
    activeField: Deno.env.get('AIRTABLE_ACTIVE_FIELD') || 'is_active',
    modifiedField: Deno.env.get('AIRTABLE_LAST_MODIFIED_FIELD') || 'last_modified_at',
    pushGuardMinutes: Math.max(0, Number(Deno.env.get('AIRTABLE_PUSH_GUARD_MINUTES') || 10)),
    pullMaxRecords: Math.max(0, Number(Deno.env.get('AIRTABLE_PULL_MAX_RECORDS') || 1200)),
  };
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function isMissedStatus(statusRaw: unknown): boolean {
  const value = String(statusRaw || '').toLowerCase().trim();
  return ['missed', 'absent', 'no_show', 'noshow', 'пропуск', 'не был'].includes(value);
}

function isPresentStatus(statusRaw: unknown): boolean {
  const value = String(statusRaw || '').toLowerCase().trim();
  return ['present', 'attended', 'visited', 'был', 'посетил', 'completed', 'done', 'завершен'].includes(value);
}

function isRescheduledStatus(statusRaw: unknown): boolean {
  const value = String(statusRaw || '').toLowerCase().trim();
  return ['rescheduled', 'reschedule', 'перенос', 'перенесен'].includes(value);
}

function isPlannedStatus(statusRaw: unknown): boolean {
  const value = String(statusRaw || '').toLowerCase().trim();
  return ['planned', 'scheduled', 'запланирован', 'план'].includes(value);
}

function toLessonStatus(statusRaw: unknown): 'planned' | 'completed' | 'missed' | 'rescheduled' | null {
  if (isMissedStatus(statusRaw)) return 'missed';
  if (isPresentStatus(statusRaw)) return 'completed';
  if (isRescheduledStatus(statusRaw)) return 'rescheduled';
  if (isPlannedStatus(statusRaw)) return 'planned';
  return null;
}

function eventTypeForStatus(statusRaw: unknown): 'missed' | 'present' | 'rescheduled' {
  if (isMissedStatus(statusRaw)) return 'missed';
  if (isPresentStatus(statusRaw)) return 'present';
  return 'rescheduled';
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function airtableListRecords(config: AirtableConfig, tableName: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | null = null;

  do {
    const url = new URL(`https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    if (config.viewName) url.searchParams.set('view', config.viewName);
    if (offset) url.searchParams.set('offset', offset);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable list failed (${response.status}): ${text}`);
    }

    const body = await response.json();
    records.push(...(Array.isArray(body?.records) ? body.records : []));
    offset = body?.offset || null;
  } while (offset);

  return records;
}

async function airtableCreateBatch(config: AirtableConfig, tableName: string, records: Array<{ fields: Record<string, unknown> }>) {
  const response = await fetch(`https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records, typecast: true }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable create failed (${response.status}): ${text}`);
  }
}

async function airtableUpdateBatch(config: AirtableConfig, tableName: string, records: Array<{ id: string; fields: Record<string, unknown> }>) {
  const response = await fetch(`https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(tableName)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records, typecast: true }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable update failed (${response.status}): ${text}`);
  }
}

function trimOrNull(value: unknown): string | null {
  const raw = String(value || '').trim();
  return raw || null;
}

function isRecentlyModified(rawValue: unknown, minutes: number): boolean {
  if (minutes <= 0) return false;
  const value = trimOrNull(rawValue);
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const diffMs = Date.now() - date.getTime();
  return diffMs >= 0 && diffMs <= minutes * 60_000;
}

function recordModifiedAtMs(config: AirtableConfig, record: AirtableRecord): number {
  const raw = trimOrNull(record.fields?.[config.modifiedField]) || trimOrNull(record.createdTime);
  if (!raw) return 0;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getTime();
}

async function recalcPlanMeta(adminClient: SupabaseClient, planVersionId: string) {
  const { data: lessons, error: lessonsError } = await adminClient
    .from('study_lessons')
    .select('lesson_index,lesson_date,cost,status')
    .eq('plan_version_id', planVersionId)
    .order('lesson_index', { ascending: true });

  if (lessonsError) throw new Error(lessonsError.message);

  const totalLessons = (lessons || []).length;
  const completedLessons = (lessons || []).filter((item) => item.status === 'completed').length;
  const totalCost = (lessons || []).reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
  const remainingCost = (lessons || [])
    .filter((item) => item.status !== 'completed')
    .reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
  const endDate = lessons?.[lessons.length - 1]?.lesson_date || null;

  const { error: updateError } = await adminClient
    .from('study_plan_versions')
    .update({
      total_lessons: totalLessons,
      completed_lessons: completedLessons,
      total_cost: Number(totalCost.toFixed(2)),
      remaining_cost: Number(remainingCost.toFixed(2)),
      end_date: endDate,
    })
    .eq('id', planVersionId);

  if (updateError) throw new Error(updateError.message);
}

async function loadProfilesByUserIds(adminClient: SupabaseClient, userIds: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  for (const idsChunk of chunk([...new Set(userIds)], 200)) {
    if (!idsChunk.length) continue;

    const { data, error } = await adminClient
      .from('student_profiles')
      .select('user_id,email,full_name,phone_e164')
      .in('user_id', idsChunk);

    if (error) throw new Error(error.message);
    for (const row of data || []) map.set(String(row.user_id), row as ProfileRow);
  }
  return map;
}

async function loadGoalMetaByUserIds(adminClient: SupabaseClient, userIds: string[]): Promise<Map<string, GoalMetaRow>> {
  const map = new Map<string, GoalMetaRow>();
  for (const idsChunk of chunk([...new Set(userIds)], 200)) {
    if (!idsChunk.length) continue;

    const { data, error } = await adminClient
      .from('study_goals')
      .select('user_id,current_level,target_level,is_active,updated_at')
      .in('user_id', idsChunk)
      .eq('is_active', true)
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);

    for (const row of data || []) {
      const userId = String(row.user_id);
      if (map.has(userId)) continue;
      map.set(userId, {
        user_id: userId,
        current_level: row.current_level ? String(row.current_level) : null,
        target_level: row.target_level ? String(row.target_level) : null,
        is_active: Boolean(row.is_active),
      });
    }
  }
  return map;
}

async function syncStudentsTable(
  adminClient: SupabaseClient,
  config: AirtableConfig,
  profileMap: Map<string, ProfileRow>,
  goalMap: Map<string, GoalMetaRow>,
): Promise<{ studentRecordIdByEmail: Map<string, string>; studentsSynced: number }> {
  if (!config.studentsTableName) {
    return { studentRecordIdByEmail: new Map(), studentsSynced: 0 };
  }

  const profileRows = [...profileMap.values()].filter((row) => normalizeEmail(row.email));
  const studentRecords = await airtableListRecords(config, config.studentsTableName);

  const byEmail = new Map<string, string>();
  for (const record of studentRecords) {
    const email = normalizeEmail(record.fields?.[config.emailField]);
    if (email) byEmail.set(email, record.id);
  }

  const studentCreates: Array<{ fields: Record<string, unknown> }> = [];
  const studentUpdates: Array<{ id: string; fields: Record<string, unknown> }> = [];

  for (const row of profileRows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;

    const goal = goalMap.get(String(row.user_id));
    const currentLevel = trimOrNull(goal?.current_level) || '';
    const targetLevel = trimOrNull(goal?.target_level) || '';
    const isActive = Boolean(goal?.is_active);

    const fields: Record<string, unknown> = {
      [config.emailField]: email,
      [config.fullNameField]: row.full_name || '',
      [config.phoneField]: row.phone_e164 || '',
      [config.currentLevelField]: currentLevel,
      [config.targetLevelField]: targetLevel,
      [config.activeField]: isActive,
    };
    const recId = byEmail.get(email);
    if (recId) studentUpdates.push({ id: recId, fields });
    else studentCreates.push({ fields });
  }

  for (const batch of chunk(studentCreates, 10)) {
    await airtableCreateBatch(config, config.studentsTableName, batch);
  }
  for (const batch of chunk(studentUpdates, 10)) {
    await airtableUpdateBatch(config, config.studentsTableName, batch);
  }

  const refreshedRecords = await airtableListRecords(config, config.studentsTableName);
  const refreshedByEmail = new Map<string, string>();
  for (const record of refreshedRecords) {
    const email = normalizeEmail(record.fields?.[config.emailField]);
    if (email) refreshedByEmail.set(email, record.id);
  }

  return { studentRecordIdByEmail: refreshedByEmail, studentsSynced: profileRows.length };
}

function resolveLessonIdFromAirtableFields(config: AirtableConfig, fields: Record<string, unknown>): string | null {
  const direct = trimOrNull(fields[config.lessonIdField]);
  if (direct) return direct;
  if (!config.legacyLessonIdField || config.legacyLessonIdField === config.lessonIdField) return null;
  return trimOrNull(fields[config.legacyLessonIdField]);
}

function resolveLessonStatusDisplay(status: unknown): string {
  return String(status || 'planned').trim() || 'planned';
}

function studentDisplayName(profile: ProfileRow | undefined): string {
  return trimOrNull(profile?.full_name) || trimOrNull(profile?.email) || 'Ученик';
}

function normalizeCalendarFields(
  config: AirtableConfig,
  lesson: LessonRow,
  profile: ProfileRow | undefined,
  studentRecordId: string | null,
): Record<string, unknown> {
  const display = `${studentDisplayName(profile)} • ${resolveLessonStatusDisplay(lesson.status)}`;

  const fields: Record<string, unknown> = {
    [config.lessonIdField]: lesson.id,
    [config.displayField]: display,
    [config.emailField]: profile?.email || '',
    [config.fullNameField]: profile?.full_name || '',
    [config.phoneField]: profile?.phone_e164 || '',
    [config.studentLinkField]: studentRecordId ? [studentRecordId] : [],
    [config.dateField]: lesson.lesson_date,
    [config.statusField]: lesson.status,
    [config.titleField]: lesson.title,
    [config.descriptionField]: lesson.description,
    [config.levelField]: lesson.level,
    [config.costField]: Number(lesson.cost || 0),
    [config.priorityField]: lesson.priority_note || '',
  };

  if (config.legacyLessonIdField && config.legacyLessonIdField !== config.lessonIdField) {
    fields[config.legacyLessonIdField] = display;
  }

  return fields;
}

async function pushSupabaseCalendarToAirtable(adminClient: SupabaseClient, config: AirtableConfig) {
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - 90);

  const toDate = new Date();
  toDate.setUTCDate(toDate.getUTCDate() + 365);

  const { data: lessons, error: lessonsError } = await adminClient
    .from('study_lessons')
    .select('id,user_id,goal_id,plan_version_id,lesson_index,lesson_date,level,title,description,status,cost,priority_note,is_checkpoint,is_final_test')
    .gte('lesson_date', fromDate.toISOString().slice(0, 10))
    .lte('lesson_date', toDate.toISOString().slice(0, 10))
    .order('lesson_date', { ascending: true })
    .limit(5000);

  if (lessonsError) throw new Error(lessonsError.message);

  const lessonRows = (lessons || []) as LessonRow[];
  if (!lessonRows.length) return { created: 0, updated: 0, students_synced: 0 };

  const profileMap = await loadProfilesByUserIds(adminClient, lessonRows.map((item) => item.user_id));
  const goalMap = await loadGoalMetaByUserIds(adminClient, lessonRows.map((item) => item.user_id));

  let studentRecordIdByEmail = new Map<string, string>();
  let studentsSynced = 0;
  if (config.studentsTableName) {
    const synced = await syncStudentsTable(adminClient, config, profileMap, goalMap);
    studentRecordIdByEmail = synced.studentRecordIdByEmail;
    studentsSynced = synced.studentsSynced;
  }

  const airtableRows = await airtableListRecords(config, config.calendarTableName);
  const airtableByLessonId = new Map<string, { id: string; modifiedAt: string | null }>();
  for (const record of airtableRows) {
    const lessonId = resolveLessonIdFromAirtableFields(config, record.fields || {});
    if (lessonId) {
      airtableByLessonId.set(lessonId, {
        id: record.id,
        modifiedAt: trimOrNull(record.fields?.[config.modifiedField]) || trimOrNull(record.createdTime),
      });
    }
  }

  const toCreate: Array<{ fields: Record<string, unknown> }> = [];
  const toUpdate: Array<{ id: string; fields: Record<string, unknown> }> = [];
  let skippedByGuard = 0;

  for (const lesson of lessonRows) {
    const profile = profileMap.get(lesson.user_id);
    const studentRecordId = studentRecordIdByEmail.get(normalizeEmail(profile?.email)) || null;
    const fields = normalizeCalendarFields(config, lesson, profile, studentRecordId);
    const existing = airtableByLessonId.get(lesson.id);
    if (existing?.id) {
      if (isRecentlyModified(existing.modifiedAt, config.pushGuardMinutes)) {
        skippedByGuard += 1;
        continue;
      }
      toUpdate.push({ id: existing.id, fields });
    } else {
      toCreate.push({ fields });
    }
  }

  for (const batch of chunk(toCreate, 10)) {
    await airtableCreateBatch(config, config.calendarTableName, batch);
  }
  for (const batch of chunk(toUpdate, 10)) {
    await airtableUpdateBatch(config, config.calendarTableName, batch);
  }

  return { created: toCreate.length, updated: toUpdate.length, students_synced: studentsSynced, guard_skipped: skippedByGuard };
}

async function resolveProfileByEmail(
  adminClient: SupabaseClient,
  cache: Map<string, { user_id: string; email: string } | null>,
  email: string,
) {
  if (cache.has(email)) return cache.get(email) || null;

  const { data, error } = await adminClient
    .from('student_profiles')
    .select('user_id,email')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const normalized = data?.user_id ? { user_id: String(data.user_id), email: String(data.email || email) } : null;
  cache.set(email, normalized);
  return normalized;
}

async function findLessonToPatch(
  adminClient: SupabaseClient,
  lessonId: string | null,
  userId: string | null,
  lessonDate: string | null,
): Promise<LessonRow | null> {
  if (lessonId) {
    const { data, error } = await adminClient
      .from('study_lessons')
      .select('id,user_id,goal_id,plan_version_id,lesson_index,lesson_date,level,title,description,status,cost,priority_note,is_checkpoint,is_final_test')
      .eq('id', lessonId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return data as LessonRow;
  }

  if (!userId) return null;

  if (lessonDate) {
    const { data, error } = await adminClient
      .from('study_lessons')
      .select('id,user_id,goal_id,plan_version_id,lesson_index,lesson_date,level,title,description,status,cost,priority_note,is_checkpoint,is_final_test')
      .eq('user_id', userId)
      .eq('lesson_date', lessonDate)
      .order('lesson_index', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data?.id) return data as LessonRow;
  }

  const { data, error } = await adminClient
    .from('study_lessons')
    .select('id,user_id,goal_id,plan_version_id,lesson_index,lesson_date,level,title,description,status,cost,priority_note,is_checkpoint,is_final_test')
    .eq('user_id', userId)
    .in('status', ['planned', 'rescheduled'])
    .order('lesson_index', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? (data as LessonRow) : null;
}

async function pullAirtableUpdatesToSupabase(adminClient: SupabaseClient, config: AirtableConfig, records: AirtableRecord[]) {
  const profileCache = new Map<string, { user_id: string; email: string } | null>();
  const touchedPlanIds = new Set<string>();

  let processed = 0;
  let skipped = 0;
  let affectedLessons = 0;

  for (const record of records) {
    const fields = record.fields || {};
    const email = normalizeEmail(fields[config.emailField]);
    const statusRaw = fields[config.statusField];
    const lessonDate = normalizeDate(fields[config.dateField]);
    const lessonId = resolveLessonIdFromAirtableFields(config, fields);
    const modifiedToken = trimOrNull(fields[config.modifiedField]) || trimOrNull(record.createdTime) || String(statusRaw || '');

    const dedupeKey = createDedupeKey([record.id, modifiedToken, lessonDate || 'no_date']);

    const { data: existingEvent, error: existingError } = await adminClient
      .from('attendance_events')
      .select('id')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (existingEvent?.id) {
      skipped += 1;
      continue;
    }

    const profile = email ? await resolveProfileByEmail(adminClient, profileCache, email) : null;
    const lesson = await findLessonToPatch(adminClient, lessonId, profile?.user_id || null, lessonDate);

    let matchedLessonId: string | null = null;

    if (lesson?.id) {
      matchedLessonId = lesson.id;

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), attendance_source: 'airtable' };

      const incomingStatus = toLessonStatus(statusRaw);
      if (incomingStatus) patch.status = incomingStatus;

      const incomingDate = normalizeDate(fields[config.dateField]);
      if (incomingDate) patch.lesson_date = incomingDate;

      const incomingLevel = trimOrNull(fields[config.levelField]);
      if (incomingLevel) patch.level = incomingLevel.toUpperCase();

      const incomingTitle = trimOrNull(fields[config.titleField]);
      if (incomingTitle) patch.title = incomingTitle;

      const incomingDescription = trimOrNull(fields[config.descriptionField]);
      if (incomingDescription) patch.description = incomingDescription;

      const incomingPriority = trimOrNull(fields[config.priorityField]);
      if (incomingPriority !== null) patch.priority_note = incomingPriority;

      const rawCost = fields[config.costField];
      if (rawCost !== undefined && rawCost !== null && rawCost !== '') {
        const cost = Number(rawCost);
        if (Number.isFinite(cost)) patch.cost = cost;
      }

      if (Object.keys(patch).length > 0) {
        const { error: updateError } = await adminClient
          .from('study_lessons')
          .update(patch)
          .eq('id', lesson.id);

        if (updateError) throw new Error(updateError.message);
      }

      touchedPlanIds.add(lesson.plan_version_id);
      affectedLessons += 1;

      if (isMissedStatus(statusRaw)) {
        const { data: latestLesson, error: latestError } = await adminClient
          .from('study_lessons')
          .select('lesson_index,lesson_date')
          .eq('plan_version_id', lesson.plan_version_id)
          .order('lesson_index', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestError) throw new Error(latestError.message);

        const anchorDate = new Date(`${latestLesson?.lesson_date || lesson.lesson_date}T00:00:00.000Z`);
        anchorDate.setUTCDate(anchorDate.getUTCDate() + 7);

        const { error: insertError } = await adminClient.from('study_lessons').insert({
          user_id: lesson.user_id,
          goal_id: lesson.goal_id,
          plan_version_id: lesson.plan_version_id,
          lesson_index: Number(latestLesson?.lesson_index || lesson.lesson_index) + 1,
          lesson_date: anchorDate.toISOString().slice(0, 10),
          level: lesson.level,
          title: `${lesson.title} (перенос)`,
          description: lesson.description,
          status: 'rescheduled',
          cost: lesson.cost,
          attendance_source: 'airtable',
          is_checkpoint: false,
          is_final_test: false,
          priority_note: lesson.priority_note,
        });

        if (insertError) throw new Error(insertError.message);

        touchedPlanIds.add(lesson.plan_version_id);
      }
    } else {
      skipped += 1;
    }

    const { error: eventError } = await adminClient.from('attendance_events').insert({
      user_id: profile?.user_id || lesson?.user_id || null,
      student_email: email || profile?.email || '',
      lesson_id: matchedLessonId,
      event_type: eventTypeForStatus(statusRaw),
      source: 'airtable',
      dedupe_key: dedupeKey,
      raw_payload: {
        record_id: record.id,
        fields,
      },
      event_at: new Date().toISOString(),
    });

    if (eventError) throw new Error(eventError.message);
    processed += 1;
  }

  for (const planId of touchedPlanIds) {
    await recalcPlanMeta(adminClient, planId);
  }

  return {
    processed,
    skipped,
    affected_lessons: affectedLessons,
    touched_plan_versions: touchedPlanIds.size,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    let payload: { mode?: 'both' | 'pull_only' | 'push_only' } = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const requestedMode = String(payload?.mode || 'both').toLowerCase();
    const mode = (requestedMode === 'pull_only' || requestedMode === 'push_only') ? requestedMode : 'both';

    const config = getConfig();

    const supabaseUrl = ensureEnv('SUPABASE_URL');
    const serviceRoleKey = ensureEnv('SUPABASE_SERVICE_ROLE_KEY');
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const cronSecret = Deno.env.get('SYNC_CRON_SECRET');
    const authHeader = req.headers.get('Authorization') || '';
    const cronAuthorized = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

    if (!cronAuthorized) {
      const auth = await getAuthContext(req);
      await ensureMethodistAccess(auth.adminClient, auth.user.id, auth.user.email);
    }

    const airtableRecords = await airtableListRecords(config, config.calendarTableName);

    let pullStats = { processed: 0, skipped: 0, affected_lessons: 0, touched_plan_versions: 0 };
    if (mode !== 'push_only') {
      const sortedByModified = [...airtableRecords].sort((a, b) => recordModifiedAtMs(config, b) - recordModifiedAtMs(config, a));
      const pullRecords = config.pullMaxRecords > 0 ? sortedByModified.slice(0, config.pullMaxRecords) : sortedByModified;
      pullStats = await pullAirtableUpdatesToSupabase(adminClient, config, pullRecords);
    }

    let pushStats = { created: 0, updated: 0, students_synced: 0, guard_skipped: 0 };
    if (config.enablePush && mode !== 'pull_only') {
      pushStats = await pushSupabaseCalendarToAirtable(adminClient, config);
    }

    return jsonResponse({
      ok: true,
      mode,
      records_total: airtableRecords.length,
      pull_records_processed: mode === 'push_only'
        ? 0
        : (config.pullMaxRecords > 0 ? Math.min(airtableRecords.length, config.pullMaxRecords) : airtableRecords.length),
      push: {
        enabled: config.enablePush,
        ...pushStats,
      },
      pull: pullStats,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
