import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, ensureEnv, ensureMethodistAccess, getAuthContext, jsonResponse, parseJson } from '../_shared/common.ts';

type IssuePayload = {
  student_user_id?: string;
  goal_id?: string;
  plan_version_id?: string;
  level?: string;
  certificate_type?: 'badge' | 'final';
  metadata?: Record<string, unknown>;
};

function token(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const verifyToken = String(url.searchParams.get('token') || '').trim();
      if (!verifyToken) return jsonResponse({ error: 'token is required' }, 400);

      const supabaseUrl = ensureEnv('SUPABASE_URL');
      const serviceRoleKey = ensureEnv('SUPABASE_SERVICE_ROLE_KEY');
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data, error } = await adminClient
        .from('certificates')
        .select('*')
        .eq('verify_token', verifyToken)
        .eq('status', 'issued')
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return jsonResponse({ error: 'Certificate not found' }, 404);

      return jsonResponse({ certificate: data });
    }

    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const { user, adminClient } = await getAuthContext(req);
    const payload = await parseJson<IssuePayload>(req);

    const isSelfIssue = !payload.student_user_id || payload.student_user_id === user.id;
    if (!isSelfIssue) {
      await ensureMethodistAccess(adminClient, user.id, user.email);
    }

    const studentId = String(payload.student_user_id || user.id);
    const type = payload.certificate_type === 'badge' ? 'badge' : 'final';
    const level = String(payload.level || 'A1').trim().toUpperCase();

    const verifyToken = token();

    const { data: inserted, error: insertError } = await adminClient
      .from('certificates')
      .insert({
        user_id: studentId,
        goal_id: payload.goal_id || null,
        plan_version_id: payload.plan_version_id || null,
        level,
        certificate_type: type,
        status: 'issued',
        verify_token: verifyToken,
        pdf_url: null,
        metadata: payload.metadata || {},
      })
      .select('*')
      .single();

    if (insertError || !inserted) throw new Error(insertError?.message || 'Failed to issue certificate');

    const verify_url = `/certificate.html?token=${verifyToken}`;

    return jsonResponse({
      certificate: inserted,
      verify_url,
      pdf_url: inserted.pdf_url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: message }, message.startsWith('Forbidden') ? 403 : 500);
  }
});
