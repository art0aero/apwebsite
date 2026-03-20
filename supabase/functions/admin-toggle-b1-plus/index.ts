import { CORS_HEADERS, ensureMethodistAccess, getAuthContext, getMoscowDateString, jsonResponse, normalizeLevel, parseJson } from '../_shared/common.ts';
import { buildLessons, CEFR_LEVELS, comparePlanDelta, nextVersionNo } from '../_shared/planner.ts';

type Payload = {
  student_user_id?: string;
  enabled?: boolean;
  reason?: string;
};

function normalizePreferredDays(days: number[] | undefined, fallbackCount: number): number[] {
  const clean = [...new Set((days || []).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 1 && item <= 7))]
    .sort((a, b) => a - b);
  if (clean.length) return clean;
  return [1, 3, 5, 2, 4, 6, 7].slice(0, Math.min(Math.max(fallbackCount, 1), 7)).sort((a, b) => a - b);
}

function normalizeCurrentLevelForPlan(rawLevel: string): string {
  const normalized = String(rawLevel || '').trim();
  if (!normalized) return 'A1';
  if (normalized === 'Below A1' || normalized === 'A0' || normalized.toLowerCase() === 'below a1') return 'A0';
  const upper = normalized.toUpperCase();
  if (CEFR_LEVELS.includes(upper as (typeof CEFR_LEVELS)[number])) return upper;
  return normalizeLevel(normalized);
}

function levelRank(level: string): number {
  const normalized = String(level || '').trim().toUpperCase();
  if (normalized === 'A0' || normalized === 'BELOW A1') return 0;
  if (normalized === 'A1') return 1;
  if (normalized === 'A2') return 2;
  if (normalized === 'B1') return 3;
  if (normalized === 'B2') return 4;
  if (normalized === 'C1') return 5;
  if (normalized === 'C2') return 6;
  return 1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    await ensureMethodistAccess(adminClient, user.id, user.email);

    const payload = await parseJson<Payload>(req);
    const studentUserId = String(payload.student_user_id || '').trim();

    if (!studentUserId) return jsonResponse({ error: 'student_user_id is required' }, 400);

    const { data: goal, error: goalError } = await adminClient
      .from('study_goals')
      .select('*')
      .eq('user_id', studentUserId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (goalError) throw new Error(goalError.message);
    if (!goal) return jsonResponse({ error: 'Active goal not found for student' }, 404);

    const targetLevel = String(goal.target_level || '').trim().toUpperCase();

    const { data: latestAttempt, error: attemptError } = await adminClient
      .from('test_results')
      .select('level,attempt_id,completed_at')
      .eq('user_id', studentUserId)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attemptError) throw new Error(attemptError.message);

    const currentLevel = normalizeCurrentLevelForPlan(String(latestAttempt?.level || goal.current_level || 'A1'));
    const currentRank = levelRank(currentLevel);
    const targetRank = levelRank(targetLevel);
    const canUseB1Plus = currentRank <= 3 && targetRank >= 4;
    if (!canUseB1Plus) {
      return jsonResponse({ error: 'B1+ is available only when path includes B1->B2 transition' }, 400);
    }

    const enabled = typeof payload.enabled === 'boolean' ? payload.enabled : !Boolean(goal.b1_plus_enabled);
    const lessonsPerWeek = Math.min(7, Math.max(1, Math.round(Number(goal.lessons_per_week) || 3)));
    const preferredDays = normalizePreferredDays(goal.preferred_days, lessonsPerWeek);

    const { data: versions, error: versionsError } = await adminClient
      .from('study_plan_versions')
      .select('id,version_no,status,end_date,remaining_cost')
      .eq('goal_id', goal.id)
      .order('version_no', { ascending: true });

    if (versionsError) throw new Error(versionsError.message);

    const activeVersion = (versions || []).find((item) => item.status === 'active') || null;
    const versionNo = nextVersionNo((versions || []) as Array<{ version_no: number }>);

    const { data: curriculumRows, error: curriculumError } = await adminClient
      .from('study_curriculum')
      .select('level,path_from,path_to,track,ordinal,title,description,estimated_lessons,unit_code,source_file')
      .eq('is_active', true)
      .order('path_from', { ascending: true })
      .order('path_to', { ascending: true })
      .order('track', { ascending: true })
      .order('ordinal', { ascending: true });

    if (curriculumError) throw new Error(curriculumError.message);

    const plan = buildLessons({
      currentLevel,
      targetLevel,
      startDateIso: getMoscowDateString(new Date()),
      preferredDays,
      curriculumRows: (curriculumRows || []) as never,
      includeB1Plus: enabled,
    });

    const delta = comparePlanDelta(
      activeVersion
        ? {
            end_date: String(activeVersion.end_date),
            remaining_cost: Number(activeVersion.remaining_cost || 0),
          }
        : null,
      {
        end_date: plan.end_date,
        total_cost: plan.total_cost,
      },
    );

    const { error: archiveError } = await adminClient
      .from('study_plan_versions')
      .update({ status: 'archived' })
      .eq('goal_id', goal.id)
      .in('status', ['active', 'draft']);

    if (archiveError) throw new Error(archiveError.message);

    const { data: createdVersion, error: createVersionError } = await adminClient
      .from('study_plan_versions')
      .insert({
        goal_id: goal.id,
        user_id: studentUserId,
        version_no: versionNo,
        status: 'active',
        start_date: plan.start_date,
        end_date: plan.end_date,
        total_lessons: plan.total_lessons,
        total_cost: plan.total_cost,
        remaining_cost: plan.total_cost,
        delta_cost: delta.deltaCost,
        delta_days: delta.deltaDays,
        source_attempt_id: latestAttempt?.attempt_id || null,
        change_reason: payload.reason || (enabled ? 'admin_enable_b1_plus' : 'admin_disable_b1_plus'),
        confirmed_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (createVersionError || !createdVersion) throw new Error(createVersionError?.message || 'Failed to create active plan version');

    if (plan.lessons.length) {
      const lessonRows = plan.lessons.map((lesson) => ({
        user_id: studentUserId,
        goal_id: goal.id,
        plan_version_id: createdVersion.id,
        lesson_index: lesson.lesson_index,
        lesson_date: lesson.lesson_date,
        level: lesson.level,
        title: lesson.title,
        description: lesson.description,
        cost: lesson.cost,
        is_checkpoint: lesson.is_checkpoint,
        checkpoint_level: lesson.checkpoint_level,
        is_final_test: lesson.is_final_test,
      }));

      const { error: lessonError } = await adminClient.from('study_lessons').insert(lessonRows);
      if (lessonError) throw new Error(lessonError.message);

      const checkpointRows = lessonRows
        .filter((item) => item.is_checkpoint)
        .map((item) => ({
          user_id: studentUserId,
          goal_id: goal.id,
          plan_version_id: createdVersion.id,
          checkpoint_type: item.is_final_test ? 'final_test' : 'level_retest',
          expected_level: item.checkpoint_level,
          scheduled_date: item.lesson_date,
        }));

      if (checkpointRows.length) {
        const { error: checkpointError } = await adminClient.from('plan_checkpoints').insert(checkpointRows);
        if (checkpointError) throw new Error(checkpointError.message);
      }
    }

    const { error: goalUpdateError } = await adminClient
      .from('study_goals')
      .update({
        current_level: currentLevel,
        lessons_per_week: lessonsPerWeek,
        preferred_days: preferredDays,
        b1_plus_enabled: enabled,
        active_plan_version_id: createdVersion.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', goal.id);

    if (goalUpdateError) throw new Error(goalUpdateError.message);

    await adminClient.from('admin_audit_logs').insert({
      actor_user_id: user.id,
      actor_email: user.email,
      student_user_id: studentUserId,
      action: 'toggle_b1_plus',
      payload: {
        enabled,
        reason: payload.reason || null,
        plan_version_id: createdVersion.id,
      },
    });

    return jsonResponse({
      ok: true,
      goal_id: goal.id,
      b1_plus_enabled: enabled,
      plan_version: createdVersion,
      preview: {
        levels_path: plan.levels_path,
        total_lessons: plan.total_lessons,
        total_cost: plan.total_cost,
        end_date: plan.end_date,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: message }, message.startsWith('Forbidden') ? 403 : 500);
  }
});
