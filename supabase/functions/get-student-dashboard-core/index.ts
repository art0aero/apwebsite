import { CORS_HEADERS, getAuthContext, jsonResponse } from '../_shared/common.ts';
import { loadDashboardCore } from '../_shared/dashboard.ts';

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
    return jsonResponse(core);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
