import { createClient } from 'jsr:@supabase/supabase-js@2';

type SubmittedAnswer = {
  question_id: number;
  selected_option: number;
};

type RequestPayload = {
  answers: SubmittedAnswer[];
  time_seconds: number;
  client_meta?: Record<string, unknown>;
  test_id?: string;
  mode?: 'placement' | 'checkpoint' | 'final';
  target_level?: string | null;
};

type QuestionBankRow = {
  id: number;
  level: (typeof LEVEL_ORDER)[number];
  correct_option: number;
  question_text: string;
  options: string[];
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
const LEVEL_WEIGHTS = [1, 2, 4, 8, 16, 32];
const LEVEL_BOUNDARIES = [0.08, 0.2, 0.35, 0.5, 0.7, 0.9];

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  'Below A1': 'Beginner',
  A1: 'Starter',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper-Intermediate',
  C1: 'Advanced',
  C2: 'Proficiency',
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

function calculateResult(answers: SubmittedAnswer[], questionMap: Map<number, QuestionBankRow>) {
  const levelScores = {
    A1: { correct: 0, total: 0 },
    A2: { correct: 0, total: 0 },
    B1: { correct: 0, total: 0 },
    B2: { correct: 0, total: 0 },
    C1: { correct: 0, total: 0 },
    C2: { correct: 0, total: 0 },
  } as Record<(typeof LEVEL_ORDER)[number], { correct: number; total: number }>;

  let totalCorrect = 0;

  for (const item of answers) {
    const question = questionMap.get(item.question_id);
    if (!question) continue;

    levelScores[question.level].total += 1;
    if (item.selected_option === question.correct_option) {
      levelScores[question.level].correct += 1;
      totalCorrect += 1;
    }
  }

  const percentages = LEVEL_ORDER.map((level) => {
    const score = levelScores[level];
    if (!score.total) return 0;
    return (score.correct / score.total) * 100;
  });

  const effectiveScores: number[] = [];
  let currentMin = 100;
  for (const pct of percentages) {
    currentMin = Math.min(currentMin, pct);
    effectiveScores.push(currentMin);
  }

  const weightedSum = effectiveScores.reduce((sum, score, i) => sum + score * LEVEL_WEIGHTS[i], 0);
  const maxPossible = LEVEL_WEIGHTS.reduce((sum, weight) => sum + 100 * weight, 0);
  const normalizedScore = weightedSum / maxPossible;

  const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  let finalLevel = 'C2';
  for (let i = 0; i < LEVEL_BOUNDARIES.length; i += 1) {
    if (normalizedScore < LEVEL_BOUNDARIES[i]) {
      finalLevel = i === 0 ? 'Below A1' : levels[i - 1];
      break;
    }
  }

  const overallPercentage = Math.round((totalCorrect / answers.length) * 100);
  const breakdown = LEVEL_ORDER.reduce<Record<string, number>>((acc, level, idx) => {
    acc[level] = Math.round(percentages[idx]);
    return acc;
  }, {});

  return {
    score: overallPercentage,
    normalized_score: normalizedScore,
    level: finalLevel,
    level_badge: `${finalLevel} - ${LEVEL_DESCRIPTIONS[finalLevel] || ''}`,
    breakdown,
  };
}

function normalizeLevel(level: string | null | undefined): string {
  const normalized = String(level || '').trim();
  if (normalized === 'Below A1' || normalized === 'A0') return 'A1';
  return normalized || 'A1';
}

function levelIndex(level: string): number {
  const idx = LEVEL_ORDER.indexOf(normalizeLevel(level) as (typeof LEVEL_ORDER)[number]);
  return idx >= 0 ? idx : 0;
}

function certificateTypeFromMode(mode: string): 'badge' | 'final' {
  return mode === 'final' ? 'final' : 'badge';
}

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

    const payload = (await req.json()) as RequestPayload;
    if (!payload || !Array.isArray(payload.answers) || payload.answers.length !== 50) {
      return jsonResponse({ error: 'Payload must include 50 answers' }, 400);
    }

    const cleanedAnswers: SubmittedAnswer[] = payload.answers.map((item) => ({
      question_id: Number(item.question_id),
      selected_option: Number(item.selected_option),
    }));

    for (const item of cleanedAnswers) {
      if (!Number.isInteger(item.question_id) || item.question_id <= 0) {
        return jsonResponse({ error: `Invalid question_id: ${item.question_id}` }, 400);
      }
      if (!Number.isInteger(item.selected_option) || item.selected_option < 0 || item.selected_option > 3) {
        return jsonResponse({ error: `Invalid selected_option for question ${item.question_id}` }, 400);
      }
    }

    const uniqueQuestionIds = [...new Set(cleanedAnswers.map((item) => item.question_id))];
    if (uniqueQuestionIds.length !== cleanedAnswers.length) {
      return jsonResponse({ error: 'Duplicate question_id in payload' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: questionRowsData, error: questionRowsError } = await adminClient
      .from('question_bank')
      .select('id,level,correct_option,question_text,options')
      .in('id', uniqueQuestionIds)
      .eq('is_active', true);

    if (questionRowsError) {
      return jsonResponse({ error: questionRowsError.message }, 500);
    }

    const questionRows = (questionRowsData ?? []) as QuestionBankRow[];
    if (questionRows.length !== uniqueQuestionIds.length) {
      return jsonResponse({ error: 'Some question IDs are invalid or inactive' }, 400);
    }

    const questionMap = new Map<number, QuestionBankRow>();
    for (const row of questionRows) {
      questionMap.set(Number(row.id), {
        id: Number(row.id),
        level: row.level,
        correct_option: Number(row.correct_option),
        question_text: String((row as { question_text?: string }).question_text || ''),
        options: Array.isArray((row as { options?: unknown }).options)
          ? ((row as { options: unknown[] }).options || []).map((item) => String(item))
          : [],
      });
    }

    const timeSeconds = Number(payload.time_seconds || 0);
    const completedAt = new Date().toISOString();
    const result = calculateResult(cleanedAnswers, questionMap);
    const testId = String(payload.test_id || 'english-placement').trim() || 'english-placement';
    const requestedMode = String(payload.mode || 'placement').trim().toLowerCase();
    const mode = ['placement', 'checkpoint', 'final'].includes(requestedMode) ? requestedMode : 'placement';
    const targetLevel = payload.target_level ? String(payload.target_level).toUpperCase().trim() : null;
    const attemptId = crypto.randomUUID();

    const seenRows = uniqueQuestionIds.map((questionId) => ({
      user_id: user.id,
      question_id: questionId,
      seen_at: completedAt,
    }));

    const { error: seenError } = await adminClient
      .from('user_seen_questions')
      .upsert(seenRows, { onConflict: 'user_id,question_id' });

    if (seenError) {
      return jsonResponse({ error: seenError.message }, 500);
    }

    const { error: insertError } = await adminClient.from('test_results').insert({
      attempt_id: attemptId,
      user_id: user.id,
      user_email: user.email,
      answers: cleanedAnswers,
      score: result.score,
      normalized_score: result.normalized_score,
      level: result.level,
      level_badge: result.level_badge,
      breakdown: result.breakdown,
      test_id: testId,
      mode,
      target_level: targetLevel,
      is_checkpoint: mode === 'checkpoint',
      is_final_test: mode === 'final',
      time_seconds: Number.isFinite(timeSeconds) ? Math.max(0, Math.round(timeSeconds)) : 0,
      completed_at: completedAt,
    });

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500);
    }

    const attemptItems = cleanedAnswers.map((item) => {
      const q = questionMap.get(item.question_id);
      const options = q?.options || [];
      const selected = Number(item.selected_option);
      const correct = Number(q?.correct_option ?? -1);
      return {
        attempt_id: attemptId,
        user_id: user.id,
        test_id: testId,
        mode,
        target_level: targetLevel,
        question_id: item.question_id,
        question_text: String(q?.question_text || ''),
        question_level: String(q?.level || ''),
        selected_option: selected,
        selected_option_text: options[selected] || '',
        correct_option: correct,
        correct_option_text: options[correct] || '',
        is_correct: selected === correct,
      };
    });

    if (attemptItems.length) {
      const { error: attemptItemsError } = await adminClient.from('attempt_items').insert(attemptItems);
      if (attemptItemsError) {
        return jsonResponse({ error: attemptItemsError.message }, 500);
      }
    }

    if (mode === 'checkpoint' || mode === 'final') {
      const target = normalizeLevel(targetLevel || result.level);
      const achieved = normalizeLevel(result.level);
      const delta = levelIndex(target) - levelIndex(achieved);

      const { data: activePlan } = await adminClient
        .from('study_plan_versions')
        .select('id,end_date')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activePlan?.id && activePlan.end_date && delta !== 0) {
        const endDate = new Date(`${activePlan.end_date}T00:00:00.000Z`);
        if (delta > 0) {
          endDate.setUTCDate(endDate.getUTCDate() + delta * 14);
        } else {
          endDate.setUTCDate(endDate.getUTCDate() + delta * 7);
        }

        await adminClient
          .from('study_plan_versions')
          .update({ end_date: endDate.toISOString().slice(0, 10) })
          .eq('id', activePlan.id);
      }

      if (levelIndex(achieved) >= levelIndex(target)) {
        const verifyToken = crypto.randomUUID().replaceAll('-', '');
        await adminClient.from('certificates').insert({
          user_id: user.id,
          plan_version_id: activePlan?.id || null,
          level: achieved,
          certificate_type: certificateTypeFromMode(mode),
          status: 'issued',
          verify_token: verifyToken,
          metadata: {
            mode,
            target_level: target,
            attempt_id: attemptId,
            score: result.score,
            issued_by: 'auto_submit_test',
          },
        });
      }
    }

    return jsonResponse({
      attempt_id: attemptId,
      score: result.score,
      normalized_score: result.normalized_score,
      level: result.level,
      level_badge: result.level_badge,
      breakdown: result.breakdown,
      completed_at: completedAt,
      test_id: testId,
      mode,
      target_level: targetLevel,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
