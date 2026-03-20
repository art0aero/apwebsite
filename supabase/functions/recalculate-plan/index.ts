import { CORS_HEADERS, getAuthContext, getMoscowDateString, jsonResponse, normalizeLevel, parseJson } from '../_shared/common.ts';
import { buildLessons, CEFR_LEVELS, comparePlanDelta, nextVersionNo } from '../_shared/planner.ts';

type Payload = {
  target_level?: string;
  lessons_per_week?: number;
  preferred_days?: number[];
  b1_plus_enabled?: boolean;
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    const payload = await parseJson<Payload>(req);

    const dateMsk = getMoscowDateString(new Date());

    const { data: usageRow, error: usageReadError } = await adminClient
      .from('replan_usage_daily')
      .select('usage_count')
      .eq('user_id', user.id)
      .eq('date_msk', dateMsk)
      .maybeSingle();

    if (usageReadError) throw new Error(usageReadError.message);

    const currentUsage = Number(usageRow?.usage_count || 0);
    if (currentUsage >= 5) {
      return jsonResponse({ error: 'Daily replan limit reached (5/5)', limit: 5, used: currentUsage }, 429);
    }

    const { data: goal, error: goalError } = await adminClient
      .from('study_goals')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (goalError) throw new Error(goalError.message);
    if (!goal) return jsonResponse({ error: 'Active goal not found' }, 404);

    const targetLevel = String(payload.target_level || goal.target_level || 'B1').trim().toUpperCase();
    if (!CEFR_LEVELS.includes(targetLevel as (typeof CEFR_LEVELS)[number])) {
      return jsonResponse({ error: 'Invalid target_level' }, 400);
    }

    const lessonsPerWeek = Math.min(7, Math.max(1, Math.round(Number(payload.lessons_per_week ?? goal.lessons_per_week) || 3)));
    const preferredDays = normalizePreferredDays(payload.preferred_days ?? goal.preferred_days, lessonsPerWeek);

    const { data: latestAttempt } = await adminClient
      .from('test_results')
      .select('level,attempt_id,completed_at')
      .eq('user_id', user.id)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentLevel = normalizeCurrentLevelForPlan(String(latestAttempt?.level || goal.current_level || 'A1'));
    const includeB1Plus = typeof payload.b1_plus_enabled === 'boolean'
      ? payload.b1_plus_enabled
      : Boolean(goal.b1_plus_enabled);

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
      includeB1Plus,
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

    const { data: createdVersion, error: createVersionError } = await adminClient
      .from('study_plan_versions')
      .insert({
        goal_id: goal.id,
        user_id: user.id,
        version_no: versionNo,
        status: 'draft',
        start_date: plan.start_date,
        end_date: plan.end_date,
        total_lessons: plan.total_lessons,
        total_cost: plan.total_cost,
        remaining_cost: plan.total_cost,
        delta_cost: delta.deltaCost,
        delta_days: delta.deltaDays,
        source_attempt_id: latestAttempt?.attempt_id || null,
        change_reason: payload.reason || 'manual_replan',
      })
      .select('*')
      .single();

    if (createVersionError || !createdVersion) throw new Error(createVersionError?.message || 'Failed to create draft version');

    if (plan.lessons.length) {
      const lessonRows = plan.lessons.map((lesson) => ({
        user_id: user.id,
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
          user_id: user.id,
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

    const { error: usageWriteError } = await adminClient
      .from('replan_usage_daily')
      .upsert({
        user_id: user.id,
        date_msk: dateMsk,
        usage_count: currentUsage + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date_msk' });

    if (usageWriteError) throw new Error(usageWriteError.message);

    const { error: goalUpdateError } = await adminClient
      .from('study_goals')
      .update({
        current_level: currentLevel,
        target_level: targetLevel,
        lessons_per_week: lessonsPerWeek,
        preferred_days: preferredDays,
        b1_plus_enabled: includeB1Plus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', goal.id);

    if (goalUpdateError) throw new Error(goalUpdateError.message);

    return jsonResponse({
      plan_version: createdVersion,
      preview: {
        levels_path: plan.levels_path,
        lessons: plan.lessons,
        delta_days: delta.deltaDays,
        delta_cost: delta.deltaCost,
      },
      usage: {
        limit: 5,
        used: currentUsage + 1,
        remaining: Math.max(0, 5 - (currentUsage + 1)),
        date_msk: dateMsk,
      },
      requires_confirmation: true,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
