import { CORS_HEADERS, getAuthContext, jsonResponse } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const { adminClient } = await getAuthContext(req);
    const { data, error } = await adminClient
      .from('test_catalog')
      .select('id,title,subtitle,description,question_count,duration_minutes,is_active')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);

    return jsonResponse({ tests: data || [] });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
