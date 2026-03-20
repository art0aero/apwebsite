import { CORS_HEADERS, ensureMethodistAccess, getAuthContext, jsonResponse, parseJson } from '../_shared/common.ts';

type Payload = {
  attempt_id?: string;
};

type AnswerRow = {
  question_id: number;
  selected_option: number;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    await ensureMethodistAccess(adminClient, user.id, user.email);

    const payload = await parseJson<Payload>(req);
    const attemptId = String(payload.attempt_id || '').trim();

    if (!attemptId) return jsonResponse({ error: 'attempt_id is required' }, 400);

    const { data: itemRows, error: itemError } = await adminClient
      .from('attempt_items')
      .select('question_id,question_text,question_level,selected_option,selected_option_text,correct_option,correct_option_text,is_correct,created_at')
      .eq('attempt_id', attemptId)
      .order('created_at', { ascending: true });

    if (itemError) throw new Error(itemError.message);

    if (itemRows && itemRows.length) {
      return jsonResponse({
        attempt_id: attemptId,
        rows: itemRows,
        source: 'attempt_items',
      });
    }

    const { data: attempt, error: attemptError } = await adminClient
      .from('test_results')
      .select('user_id,attempt_id,answers,completed_at,level,score,test_id,mode,target_level')
      .eq('attempt_id', attemptId)
      .maybeSingle();

    if (attemptError) throw new Error(attemptError.message);
    if (!attempt) return jsonResponse({ error: 'Attempt not found' }, 404);

    const answers = Array.isArray(attempt.answers) ? (attempt.answers as AnswerRow[]) : [];
    const ids = [...new Set(answers.map((item) => Number(item.question_id)).filter((item) => Number.isInteger(item) && item > 0))];

    const { data: questions, error: questionError } = await adminClient
      .from('question_bank')
      .select('id,level,question_text,options,correct_option')
      .in('id', ids);

    if (questionError) throw new Error(questionError.message);

    const questionById = new Map<number, Record<string, unknown>>();
    for (const row of questions || []) {
      questionById.set(Number(row.id), row);
    }

    const rows = answers.map((answer) => {
      const q = questionById.get(Number(answer.question_id));
      const options = Array.isArray(q?.options) ? q.options.map((item) => String(item)) : [];
      const selectedOption = Number(answer.selected_option);
      const correctOption = Number(q?.correct_option ?? -1);
      return {
        question_id: Number(answer.question_id),
        question_text: String(q?.question_text || ''),
        question_level: String(q?.level || ''),
        selected_option: selectedOption,
        selected_option_text: options[selectedOption] || '',
        correct_option: correctOption,
        correct_option_text: options[correctOption] || '',
        is_correct: selectedOption === correctOption,
      };
    });

    return jsonResponse({
      attempt_id: attemptId,
      source: 'reconstructed',
      rows,
      meta: {
        user_id: attempt.user_id,
        completed_at: attempt.completed_at,
        level: attempt.level,
        score: attempt.score,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: message }, message.startsWith('Forbidden') ? 403 : 500);
  }
});
