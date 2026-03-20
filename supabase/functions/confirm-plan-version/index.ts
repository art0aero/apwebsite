import { CORS_HEADERS, getAuthContext, jsonResponse, parseJson } from '../_shared/common.ts';

type Payload = {
  plan_version_id?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    const payload = await parseJson<Payload>(req);
    const planVersionId = String(payload.plan_version_id || '').trim();

    if (!planVersionId) return jsonResponse({ error: 'plan_version_id is required' }, 400);

    const { data: version, error: versionError } = await adminClient
      .from('study_plan_versions')
      .select('id,goal_id,user_id,status,version_no')
      .eq('id', planVersionId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (versionError) throw new Error(versionError.message);
    if (!version) return jsonResponse({ error: 'Plan version not found' }, 404);

    const goalId = String(version.goal_id);

    const { error: archiveError } = await adminClient
      .from('study_plan_versions')
      .update({ status: 'archived' })
      .eq('goal_id', goalId)
      .eq('user_id', user.id)
      .in('status', ['active', 'draft']);

    if (archiveError) throw new Error(archiveError.message);

    const { data: activeVersion, error: activateError } = await adminClient
      .from('study_plan_versions')
      .update({ status: 'active', confirmed_at: new Date().toISOString() })
      .eq('id', planVersionId)
      .eq('user_id', user.id)
      .select('*')
      .single();

    if (activateError || !activeVersion) throw new Error(activateError?.message || 'Failed to activate plan');

    const { error: goalUpdateError } = await adminClient
      .from('study_goals')
      .update({
        active_plan_version_id: planVersionId,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', goalId)
      .eq('user_id', user.id);

    if (goalUpdateError) throw new Error(goalUpdateError.message);

    const { data: lessons, error: lessonError } = await adminClient
      .from('study_lessons')
      .select('*')
      .eq('plan_version_id', planVersionId)
      .order('lesson_index', { ascending: true });

    if (lessonError) throw new Error(lessonError.message);

    return jsonResponse({
      plan_version: activeVersion,
      lessons: lessons || [],
      activated: true,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
