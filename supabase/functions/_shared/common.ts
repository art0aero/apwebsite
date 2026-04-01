import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

export function ensureEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

export async function parseJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getMoscowDateString(baseDate = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(baseDate);
}

export function normalizeLevel(level: string | null | undefined): string {
  const normalized = String(level || '').trim();
  if (!normalized) return 'A1';
  if (['Below A1', 'A0', 'BEGINNER', 'Beginner', 'below a1'].includes(normalized)) return 'A1';
  return normalized;
}

export type AuthContext = {
  user: {
    id: string;
    email: string;
  };
  authClient: SupabaseClient;
  adminClient: SupabaseClient;
};

export async function getAuthContext(req: Request): Promise<AuthContext> {
  const supabaseUrl = ensureEnv('SUPABASE_URL');
  const anonKey = ensureEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = ensureEnv('SUPABASE_SERVICE_ROLE_KEY');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    throw new Error('Unauthorized');
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  return {
    user: {
      id: user.id,
      email: user.email || '',
    },
    authClient,
    adminClient,
  };
}

export async function ensureMethodistAccess(
  adminClient: SupabaseClient,
  userId: string,
  userEmail: string,
): Promise<void> {
  const { data, error } = await adminClient
    .from('user_roles')
    .select('role,allowlisted,email')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const role = String(data?.role || '');
  const allowlisted = Boolean(data?.allowlisted);
  const roleEmail = String(data?.email || '').toLowerCase();

  const isMethodist = role === 'methodist' || role === 'admin';
  const emailMatches = roleEmail && roleEmail === userEmail.toLowerCase();

  if (!isMethodist || !allowlisted || !emailMatches) {
    throw new Error('Forbidden: methodist access required');
  }
}

export function createDedupeKey(parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => String(part ?? '')).join('::');
}
