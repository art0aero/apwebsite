import { CORS_HEADERS, getAuthContext, getMoscowDateString, jsonResponse, normalizeLevel, parseJson } from '../_shared/common.ts';
import { buildLessons, CEFR_LEVELS, comparePlanDelta } from '../_shared/planner.ts';

type Payload = {
  target_level?: string;
  lessons_per_week?: number;
  preferred_days?: number[];
  source_attempt_id?: string;
};

function normalizePreferredDays(days: number[] | undefined, lessonsPerWeek: number): number[] {
  const allowed = [...new Set((days || []).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 1 && item <= 7))];
  if (allowed.length) return allowed.sort((a, b) => a - b);

  const fallback = [1, 3, 5, 2, 4, 6, 7];
  return fallback.slice(0, Math.min(Math.max(lessonsPerWeek, 1), 7)).sort((a, b) => a - b);
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
  const order = ['A0', ...CEFR_LEVELS];
  const normalized = String(level || '').trim().toUpperCase();
  if (!normalized || normalized === 'BELOW A1') return 1;
  if (normalized === 'A0') return 0;
  const idx = order.indexOf(normalized as (typeof order)[number]);
  return idx >= 0 ? idx : 1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    const payload = await parseJson<Payload>(req);

    const targetLevel = String(payload.target_level || 'B1').trim().toUpperCase();
    if (!CEFR_LEVELS.includes(targetLevel as (typeof CEFR_LEVELS)[number])) {
      return jsonResponse({ error: 'Invalid target_level' }, 400);
    }

    const lessonsPerWeek = Math.min(7, Math.max(1, Math.round(Number(payload.lessons_per_week) || 3)));
    const preferredDays = normalizePreferredDays(payload.preferred_days, lessonsPerWeek);

    const { data: latestAttempt } = await adminClient
      .from('test_results')
      .select('level,attempt_id,completed_at')
      .eq('user_id', user.id)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentLevel = normalizeCurrentLevelForPlan(String(latestAttempt?.level || 'A1'));
    if (levelRank(targetLevel) <= levelRank(currentLevel)) {
      return jsonResponse({
        error: 'Target level must be higher than current level',
        current_level: currentLevel,
        target_level: targetLevel,
      }, 400);
    }

    const { data: curriculumRows, error: curriculumError } = await adminClient
      .from('study_curriculum')
      .select('level,path_from,path_to,track,ordinal,title,description,estimated_lessons,unit_code,source_file')
      .eq('is_active', true)
      .order('path_from', { ascending: true })
      .order('path_to', { ascending: true })
      .order('track', { ascending: true })
      .order('ordinal', { ascending: true });

    if (curriculumError) throw new Error(curriculumError.message);

    const { data: previousActiveVersion } = await adminClient
      .from('study_plan_versions')
      .select('id,end_date,remaining_cost')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await adminClient.from('study_goals').update({ is_active: false, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('is_active', true);

    const { data: createdGoal, error: goalError } = await adminClient
      .from('study_goals')
      .insert({
        user_id: user.id,
        current_level: currentLevel,
        target_level: targetLevel,
        lessons_per_week: lessonsPerWeek,
        preferred_days: preferredDays,
        b1_plus_enabled: false,
        is_active: true,
      })
      .select('*')
      .single();

    if (goalError || !createdGoal) throw new Error(goalError?.message || 'Failed to create goal');

    const plan = buildLessons({
      currentLevel,
      targetLevel,
      startDateIso: getMoscowDateString(new Date()),
      preferredDays,
      curriculumRows: (curriculumRows || []) as never,
      includeB1Plus: false,
    });

    const delta = comparePlanDelta(
      previousActiveVersion
        ? {
            end_date: String(previousActiveVersion.end_date),
            remaining_cost: Number(previousActiveVersion.remaining_cost || 0),
          }
        : null,
      {
        end_date: plan.end_date,
        total_cost: plan.total_cost,
      },
    );

    const { data: createdVersion, error: versionError } = await adminClient
      .from('study_plan_versions')
      .insert({
        goal_id: createdGoal.id,
        user_id: user.id,
        version_no: 1,
        status: 'draft',
        start_date: plan.start_date,
        end_date: plan.end_date,
        total_lessons: plan.total_lessons,
        total_cost: plan.total_cost,
        remaining_cost: plan.total_cost,
        delta_cost: delta.deltaCost,
        delta_days: delta.deltaDays,
        source_attempt_id: payload.source_attempt_id || latestAttempt?.attempt_id || null,
      })
      .select('*')
      .single();

    if (versionError || !createdVersion) throw new Error(versionError?.message || 'Failed to create plan version');

    if (plan.lessons.length) {
      const rows = plan.lessons.map((lesson) => ({
        user_id: user.id,
        goal_id: createdGoal.id,
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
        priority_note: null,
      }));

      const { error: lessonError } = await adminClient.from('study_lessons').insert(rows);
      if (lessonError) throw new Error(lessonError.message);

      const checkpoints = rows
        .filter((item) => item.is_checkpoint)
        .map((item) => ({
          user_id: user.id,
          goal_id: createdGoal.id,
          plan_version_id: createdVersion.id,
          checkpoint_type: item.is_final_test ? 'final_test' : 'level_retest',
          expected_level: item.checkpoint_level,
          scheduled_date: item.lesson_date,
        }));

      if (checkpoints.length) {
        const { error: checkpointError } = await adminClient.from('plan_checkpoints').insert(checkpoints);
        if (checkpointError) throw new Error(checkpointError.message);
      }
    }

    return jsonResponse({
      goal: createdGoal,
      plan_version: createdVersion,
      preview: {
        levels_path: plan.levels_path,
        lessons: plan.lessons,
        delta_days: delta.deltaDays,
        delta_cost: delta.deltaCost,
      },
      requires_confirmation: true,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
