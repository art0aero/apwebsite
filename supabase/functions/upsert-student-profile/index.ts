import { CORS_HEADERS, getAuthContext, jsonResponse, parseJson } from '../_shared/common.ts';

type Payload = {
  full_name?: string;
  phone_e164?: string;
};

function normalizeName(raw: string | undefined): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(raw: string | undefined): string {
  const trimmed = String(raw || '').replace(/[^\d+]/g, '');
  if (!trimmed.startsWith('+')) return '';
  return `+${trimmed.slice(1).replace(/\D/g, '')}`;
}

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST' && req.method !== 'PATCH') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    const payload = await parseJson<Payload>(req);

    const fullName = normalizeName(payload.full_name);
    const phone = normalizePhone(payload.phone_e164);

    const fullNameValid = fullName.length >= 3;
    const phoneValid = isValidE164(phone);
    const isCompleted = fullNameValid && phoneValid;

    const { data, error } = await adminClient
      .from('student_profiles')
      .upsert(
        {
          user_id: user.id,
          email: user.email,
          full_name: fullName || null,
          phone_e164: phone || null,
          is_completed: isCompleted,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('user_id,email,full_name,phone_e164,is_completed,updated_at')
      .single();

    if (error) throw new Error(error.message);

    return jsonResponse({
      profile: data,
      validation: {
        full_name_valid: fullNameValid,
        phone_valid: phoneValid,
      },
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
