import { CORS_HEADERS, getAuthContext, getMoscowDateString, jsonResponse } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);

    const [
      profileResult,
      latestResult,
      goalResult,
      usageResult,
      certificatesResult,
      insightsResult,
      roleResult,
    ] = await Promise.all([
      adminClient.from('student_profiles').select('*').eq('user_id', user.id).maybeSingle(),
      adminClient
        .from('test_results')
        .select('*')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      adminClient
        .from('study_goals')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      adminClient
        .from('replan_usage_daily')
        .select('usage_count,date_msk')
        .eq('user_id', user.id)
        .eq('date_msk', getMoscowDateString(new Date()))
        .maybeSingle(),
      adminClient
        .from('certificates')
        .select('id,level,certificate_type,status,verify_token,pdf_url,issued_at,metadata')
        .eq('user_id', user.id)
        .order('issued_at', { ascending: false })
        .limit(10),
      adminClient
        .from('ai_insights')
        .select('id,summary,items,source,created_at,attempt_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10),
      adminClient
        .from('user_roles')
        .select('role,allowlisted,email')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    if (profileResult.error) throw new Error(profileResult.error.message);
    if (latestResult.error) throw new Error(latestResult.error.message);
    if (goalResult.error) throw new Error(goalResult.error.message);
    if (usageResult.error) throw new Error(usageResult.error.message);
    if (certificatesResult.error) throw new Error(certificatesResult.error.message);
    if (insightsResult.error) throw new Error(insightsResult.error.message);
    if (roleResult.error) throw new Error(roleResult.error.message);

    const goal = goalResult.data;

    let activePlan = null;
    let draftPlans: unknown[] = [];
    let lessons: unknown[] = [];
    let checkpoints: unknown[] = [];

    if (goal) {
      const planResponse = await adminClient
        .from('study_plan_versions')
        .select('*')
        .eq('goal_id', goal.id)
        .order('version_no', { ascending: false });

      if (planResponse.error) throw new Error(planResponse.error.message);

      const plans = planResponse.data || [];
      activePlan = plans.find((item) => item.status === 'active') || null;
      draftPlans = plans.filter((item) => item.status === 'draft');

      const selectedPlanId = (activePlan?.id || draftPlans[0]?.id || null) as string | null;
      if (selectedPlanId) {
        const [lessonRes, checkpointRes] = await Promise.all([
          adminClient
            .from('study_lessons')
            .select('*')
            .eq('plan_version_id', selectedPlanId)
            .order('lesson_index', { ascending: true }),
          adminClient
            .from('plan_checkpoints')
            .select('*')
            .eq('plan_version_id', selectedPlanId)
            .order('scheduled_date', { ascending: true }),
        ]);

        if (lessonRes.error) throw new Error(lessonRes.error.message);
        if (checkpointRes.error) throw new Error(checkpointRes.error.message);

        lessons = lessonRes.data || [];
        checkpoints = checkpointRes.data || [];
      }
    }

    return jsonResponse({
      user: {
        id: user.id,
        email: user.email,
      },
      role: roleResult.data || null,
      profile: profileResult.data || {
        user_id: user.id,
        email: user.email,
        full_name: null,
        phone_e164: null,
        is_completed: false,
      },
      latest_test_result: latestResult.data || null,
      goal: goal || null,
      plan: {
        active: activePlan,
        drafts: draftPlans,
        lessons,
        checkpoints,
      },
      replan_usage: {
        limit: 5,
        used: Number(usageResult.data?.usage_count || 0),
        date_msk: usageResult.data?.date_msk || getMoscowDateString(new Date()),
      },
      certificates: certificatesResult.data || [],
      insights: insightsResult.data || [],
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
