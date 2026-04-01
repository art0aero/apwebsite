import { CORS_HEADERS, getAuthContext, jsonResponse } from '../_shared/common.ts';
import { loadDashboardCore, loadDashboardPlan } from '../_shared/dashboard.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    const core = await loadDashboardCore({
      adminClient,
      userId: user.id,
      userEmail: user.email,
    });
    const planPayload = await loadDashboardPlan({
      adminClient,
      userId: user.id,
      goalId: core.goal?.id || null,
    });

    return jsonResponse({
      user: core.user,
      role: core.role,
      profile: core.profile,
      latest_test_result: core.latest_test_result,
      goal: core.goal,
      plan: {
        active: planPayload.plan?.active || null,
        drafts: planPayload.plan?.drafts || [],
        lessons: planPayload.plan?.lessons || [],
        checkpoints: planPayload.plan?.checkpoints || [],
      },
      replan_usage: core.replan_usage,
      certificates: planPayload.certificates || [],
      insights: planPayload.insights || [],
      results_history: planPayload.results_history || [],
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
