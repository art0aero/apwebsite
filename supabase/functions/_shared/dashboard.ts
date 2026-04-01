import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getMoscowDateString } from './common.ts';

type DashboardCoreInput = {
  adminClient: SupabaseClient;
  userId: string;
  userEmail: string;
};

type DashboardPlanInput = {
  adminClient: SupabaseClient;
  userId: string;
  goalId?: string | null;
};

export async function loadDashboardCore(params: DashboardCoreInput) {
  const { adminClient, userId, userEmail } = params;
  const nowMsk = getMoscowDateString(new Date());

  const [
    profileResult,
    latestResult,
    goalResult,
    usageResult,
    roleResult,
  ] = await Promise.all([
    adminClient.from('student_profiles').select('*').eq('user_id', userId).maybeSingle(),
    adminClient
      .from('test_results')
      .select('*')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('study_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('replan_usage_daily')
      .select('usage_count,date_msk')
      .eq('user_id', userId)
      .eq('date_msk', nowMsk)
      .maybeSingle(),
    adminClient
      .from('user_roles')
      .select('role,allowlisted,email')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (latestResult.error) throw new Error(latestResult.error.message);
  if (goalResult.error) throw new Error(goalResult.error.message);
  if (usageResult.error) throw new Error(usageResult.error.message);
  if (roleResult.error) throw new Error(roleResult.error.message);

  const goal = goalResult.data || null;
  let activePlanSummary = null;
  let draftPlanCount = 0;

  if (goal?.id) {
    const { data: planVersions, error: versionsError } = await adminClient
      .from('study_plan_versions')
      .select('id,status,version_no,start_date,end_date,total_lessons,completed_lessons,total_cost,remaining_cost,delta_days,delta_cost')
      .eq('goal_id', goal.id)
      .order('version_no', { ascending: false });

    if (versionsError) throw new Error(versionsError.message);
    const versions = planVersions || [];
    activePlanSummary = versions.find((item) => item.status === 'active') || null;
    draftPlanCount = versions.filter((item) => item.status === 'draft').length;
  }

  return {
    user: {
      id: userId,
      email: userEmail,
    },
    role: roleResult.data || null,
    profile: profileResult.data || {
      user_id: userId,
      email: userEmail,
      full_name: null,
      phone_e164: null,
      is_completed: false,
    },
    latest_test_result: latestResult.data || null,
    goal,
    replan_usage: {
      limit: 5,
      used: Number(usageResult.data?.usage_count || 0),
      date_msk: usageResult.data?.date_msk || nowMsk,
    },
    plan_summary: {
      active: activePlanSummary,
      draft_count: draftPlanCount,
    },
  };
}

export async function loadDashboardPlan(params: DashboardPlanInput) {
  const { adminClient, userId } = params;
  let goalId = params.goalId || null;
  let goal = null;

  if (goalId) {
    const { data: goalById, error: goalByIdError } = await adminClient
      .from('study_goals')
      .select('*')
      .eq('id', goalId)
      .eq('user_id', userId)
      .maybeSingle();
    if (goalByIdError) throw new Error(goalByIdError.message);
    goal = goalById || null;
  }

  if (!goal) {
    const { data: activeGoal, error: activeGoalError } = await adminClient
      .from('study_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeGoalError) throw new Error(activeGoalError.message);
    goal = activeGoal || null;
    goalId = goal?.id || null;
  }

  let activePlan = null;
  let draftPlans: unknown[] = [];
  let lessons: unknown[] = [];
  let checkpoints: unknown[] = [];

  if (goalId) {
    const planResponse = await adminClient
      .from('study_plan_versions')
      .select('*')
      .eq('goal_id', goalId)
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
          .select('id,lesson_index,lesson_date,level,title,description,cost,status,is_checkpoint,checkpoint_level,is_final_test,priority_note')
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

  const [certificatesResult, insightsResult, resultsHistoryResult] = await Promise.all([
    adminClient
      .from('certificates')
      .select('id,level,certificate_type,status,verify_token,pdf_url,issued_at,metadata')
      .eq('user_id', userId)
      .order('issued_at', { ascending: false })
      .limit(10),
    adminClient
      .from('ai_insights')
      .select('id,summary,items,source,created_at,attempt_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    adminClient
      .from('test_results')
      .select('id,attempt_id,score,level,level_badge,mode,completed_at')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(40),
  ]);

  if (certificatesResult.error) throw new Error(certificatesResult.error.message);
  if (insightsResult.error) throw new Error(insightsResult.error.message);
  if (resultsHistoryResult.error) throw new Error(resultsHistoryResult.error.message);

  return {
    goal: goal || null,
    plan: {
      active: activePlan,
      drafts: draftPlans,
      lessons,
      checkpoints,
    },
    certificates: certificatesResult.data || [],
    insights: insightsResult.data || [],
    results_history: resultsHistoryResult.data || [],
  };
}
