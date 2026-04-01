import { CORS_HEADERS, getAuthContext, jsonResponse } from '../_shared/common.ts';
import { loadDashboardPlan } from '../_shared/dashboard.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    const planPayload = await loadDashboardPlan({
      adminClient,
      userId: user.id,
    });
    return jsonResponse(planPayload);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
