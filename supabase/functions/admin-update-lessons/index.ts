import { CORS_HEADERS, ensureMethodistAccess, getAuthContext, jsonResponse, parseJson } from '../_shared/common.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Payload = {
  action?: 'add' | 'update' | 'delete';
  student_user_id?: string;
  plan_version_id?: string;
  lesson_id?: string;
  lesson?: {
    lesson_date?: string;
    level?: string;
    title?: string;
    description?: string;
    status?: 'planned' | 'completed' | 'missed' | 'rescheduled';
    cost?: number;
    is_checkpoint?: boolean;
    is_final_test?: boolean;
    priority_note?: string;
  };
};

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    await ensureMethodistAccess(adminClient, user.id, user.email);

    const payload = await parseJson<Payload>(req);
    const action = payload.action;

    if (!action) return jsonResponse({ error: 'action is required' }, 400);

    const planVersionId = String(payload.plan_version_id || '').trim();
    if (!planVersionId) return jsonResponse({ error: 'plan_version_id is required' }, 400);

    let result: Record<string, unknown> | null = null;

    if (action === 'add') {
      const lesson = payload.lesson || {};
      const title = String(lesson.title || '').trim();
      const description = String(lesson.description || '').trim();
      const level = String(lesson.level || 'A1').trim().toUpperCase();
      const lessonDate = String(lesson.lesson_date || '').trim();

      if (!title || !description || !lessonDate) {
        return jsonResponse({ error: 'lesson.title, lesson.description, lesson.lesson_date are required' }, 400);
      }

      const { data: lastLesson, error: lastLessonError } = await adminClient
        .from('study_lessons')
        .select('lesson_index,user_id,goal_id')
        .eq('plan_version_id', planVersionId)
        .order('lesson_index', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastLessonError) throw new Error(lastLessonError.message);
      if (!lastLesson) return jsonResponse({ error: 'No lessons found in plan' }, 404);

      const { data: inserted, error: insertError } = await adminClient
        .from('study_lessons')
        .insert({
          user_id: payload.student_user_id || lastLesson.user_id,
          goal_id: lastLesson.goal_id,
          plan_version_id: planVersionId,
          lesson_index: Number(lastLesson.lesson_index || 0) + 1,
          lesson_date: lessonDate,
          level,
          title,
          description,
          status: lesson.status || 'planned',
          cost: Number(lesson.cost || 0),
          is_checkpoint: Boolean(lesson.is_checkpoint),
          is_final_test: Boolean(lesson.is_final_test),
          priority_note: lesson.priority_note || null,
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (insertError) throw new Error(insertError.message);
      result = inserted;
    }

    if (action === 'update') {
      const lessonId = String(payload.lesson_id || '').trim();
      if (!lessonId) return jsonResponse({ error: 'lesson_id is required for update' }, 400);

      const patch = payload.lesson || {};
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (patch.lesson_date) updatePayload.lesson_date = patch.lesson_date;
      if (patch.level) updatePayload.level = String(patch.level).toUpperCase();
      if (patch.title) updatePayload.title = patch.title;
      if (patch.description) updatePayload.description = patch.description;
      if (patch.status) updatePayload.status = patch.status;
      if (typeof patch.cost === 'number') updatePayload.cost = patch.cost;
      if (typeof patch.is_checkpoint === 'boolean') updatePayload.is_checkpoint = patch.is_checkpoint;
      if (typeof patch.is_final_test === 'boolean') updatePayload.is_final_test = patch.is_final_test;
      if (typeof patch.priority_note === 'string') updatePayload.priority_note = patch.priority_note;

      const { data: updated, error: updateError } = await adminClient
        .from('study_lessons')
        .update(updatePayload)
        .eq('id', lessonId)
        .eq('plan_version_id', planVersionId)
        .select('*')
        .single();

      if (updateError) throw new Error(updateError.message);
      result = updated;
    }

    if (action === 'delete') {
      const lessonId = String(payload.lesson_id || '').trim();
      if (!lessonId) return jsonResponse({ error: 'lesson_id is required for delete' }, 400);

      const { data: deleted, error: deleteError } = await adminClient
        .from('study_lessons')
        .delete()
        .eq('id', lessonId)
        .eq('plan_version_id', planVersionId)
        .select('*')
        .single();

      if (deleteError) throw new Error(deleteError.message);
      result = deleted;

      const { data: restLessons } = await adminClient
        .from('study_lessons')
        .select('id,lesson_index')
        .eq('plan_version_id', planVersionId)
        .order('lesson_index', { ascending: true });

      let idx = 1;
      for (const lesson of restLessons || []) {
        await adminClient
          .from('study_lessons')
          .update({ lesson_index: idx, updated_at: new Date().toISOString() })
          .eq('id', lesson.id);
        idx += 1;
      }
    }

    await recalcPlanMeta(adminClient, planVersionId);

    await adminClient.from('admin_audit_logs').insert({
      actor_user_id: user.id,
      actor_email: user.email,
      student_user_id: payload.student_user_id || null,
      action: `lesson_${action}`,
      payload,
    });

    return jsonResponse({ ok: true, action, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: message }, message.startsWith('Forbidden') ? 403 : 500);
  }
});
