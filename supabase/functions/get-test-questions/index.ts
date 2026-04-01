import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type RequestPayload = {
  count?: number;
  test_id?: string;
  mode?: 'placement' | 'checkpoint' | 'final';
  target_level?: string;
};

type QuestionRow = {
  id: number;
  level: string;
  question_text: string;
  options: unknown;
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((value) => String(value));
}

const ALLOWED_MODES = new Set(['placement', 'checkpoint', 'final']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: 'Missing Supabase env vars' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
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
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let payload: RequestPayload = {};
    try {
      payload = (await req.json()) as RequestPayload;
    } catch {
      payload = {};
    }

    const requestedCount = Number(payload.count ?? 50);
    const count = Number.isFinite(requestedCount) ? Math.min(100, Math.max(1, Math.round(requestedCount))) : 50;
    const testId = String(payload.test_id || 'english-placement').trim() || 'english-placement';
    const requestedMode = String(payload.mode || 'placement').trim().toLowerCase();
    const mode = ALLOWED_MODES.has(requestedMode) ? requestedMode : 'placement';
    const targetLevel = String(payload.target_level || '').trim().toUpperCase() || null;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: allQuestionsData, error: allQuestionsError } = await adminClient
      .from('question_bank')
      .select('id,level,question_text,options')
      .eq('is_active', true);

    if (allQuestionsError) {
      return jsonResponse({ error: allQuestionsError.message }, 500);
    }

    const allQuestions = (allQuestionsData ?? []) as QuestionRow[];
    if (allQuestions.length === 0) {
      return jsonResponse({ error: 'Question bank is empty' }, 500);
    }

    const { data: seenData, error: seenError } = await adminClient
      .from('user_seen_questions')
      .select('question_id')
      .eq('user_id', user.id);

    if (seenError) {
      return jsonResponse({ error: seenError.message }, 500);
    }

    const seenIds = new Set((seenData ?? []).map((row) => Number(row.question_id)));
    const unseen = allQuestions.filter((question) => !seenIds.has(Number(question.id)));

    const selected: QuestionRow[] = [];
    const uniqueIds = new Set<number>();
    let cycleReset = false;

    for (const item of shuffle(unseen)) {
      if (selected.length >= count) break;
      if (uniqueIds.has(item.id)) continue;
      selected.push(item);
      uniqueIds.add(item.id);
    }

    if (selected.length < count) {
      cycleReset = true;
      const { error: resetError } = await adminClient.from('user_seen_questions').delete().eq('user_id', user.id);
      if (resetError) {
        return jsonResponse({ error: resetError.message }, 500);
      }

      for (const item of shuffle(allQuestions)) {
        if (selected.length >= count) break;
        if (uniqueIds.has(item.id)) continue;
        selected.push(item);
        uniqueIds.add(item.id);
      }
    }

    const responseQuestions = selected.map((question) => ({
      id: Number(question.id),
      level: String(question.level),
      question: String(question.question_text),
      options: normalizeOptions(question.options),
    }));

    return jsonResponse({
      questions: responseQuestions,
      count: responseQuestions.length,
      cycle_reset: cycleReset,
      total_question_bank: allQuestions.length,
      unseen_before_request: unseen.length,
      test_id: testId,
      mode,
      target_level: targetLevel,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
