import { createClient } from 'jsr:@supabase/supabase-js@2';

type SubmittedAnswer = {
  question_id: number;
  selected_option: number;
};

type RequestPayload = {
  answers: SubmittedAnswer[];
  time_seconds: number;
  client_meta?: Record<string, unknown>;
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
  A1: 'Elementary',
  A2: 'Pre-Intermediate',
  B1: 'Intermediate',
  B2: 'Upper-Intermediate',
  C1: 'Advanced',
  C2: 'Proficiency',
};

const QUESTION_BANK: Record<number, { level: (typeof LEVEL_ORDER)[number]; correct: number }> = {
  1: { level: 'A1', correct: 1 },
  2: { level: 'A1', correct: 1 },
  3: { level: 'A1', correct: 0 },
  4: { level: 'A1', correct: 0 },
  5: { level: 'A1', correct: 0 },
  6: { level: 'A1', correct: 1 },
  7: { level: 'A1', correct: 1 },
  8: { level: 'A1', correct: 1 },
  9: { level: 'A2', correct: 2 },
  10: { level: 'A2', correct: 1 },
  11: { level: 'A2', correct: 2 },
  12: { level: 'A2', correct: 1 },
  13: { level: 'A2', correct: 1 },
  14: { level: 'A2', correct: 2 },
  15: { level: 'A2', correct: 1 },
  16: { level: 'A2', correct: 1 },
  17: { level: 'B1', correct: 1 },
  18: { level: 'B1', correct: 0 },
  19: { level: 'B1', correct: 1 },
  20: { level: 'B1', correct: 1 },
  21: { level: 'B1', correct: 1 },
  22: { level: 'B1', correct: 1 },
  23: { level: 'B1', correct: 0 },
  24: { level: 'B1', correct: 1 },
  25: { level: 'B1', correct: 3 },
  26: { level: 'B1', correct: 1 },
  27: { level: 'B2', correct: 2 },
  28: { level: 'B2', correct: 1 },
  29: { level: 'B2', correct: 1 },
  30: { level: 'B2', correct: 1 },
  31: { level: 'B2', correct: 0 },
  32: { level: 'B2', correct: 1 },
  33: { level: 'B2', correct: 1 },
  34: { level: 'B2', correct: 2 },
  35: { level: 'B2', correct: 1 },
  36: { level: 'B2', correct: 2 },
  37: { level: 'C1', correct: 1 },
  38: { level: 'C1', correct: 0 },
  39: { level: 'C1', correct: 1 },
  40: { level: 'C1', correct: 1 },
  41: { level: 'C1', correct: 0 },
  42: { level: 'C1', correct: 3 },
  43: { level: 'C1', correct: 1 },
  44: { level: 'C1', correct: 0 },
  45: { level: 'C2', correct: 1 },
  46: { level: 'C2', correct: 3 },
  47: { level: 'C2', correct: 1 },
  48: { level: 'C2', correct: 1 },
  49: { level: 'C2', correct: 1 },
  50: { level: 'C2', correct: 0 },
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

function calculateResult(answers: SubmittedAnswer[]) {
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
    const question = QUESTION_BANK[item.question_id];
    if (!question) continue;

    levelScores[question.level].total += 1;
    if (item.selected_option === question.correct) {
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
      if (!QUESTION_BANK[item.question_id]) {
        return jsonResponse({ error: `Unknown question_id: ${item.question_id}` }, 400);
      }
      if (!Number.isInteger(item.selected_option) || item.selected_option < 0 || item.selected_option > 3) {
        return jsonResponse({ error: `Invalid selected_option for question ${item.question_id}` }, 400);
      }
    }

    const timeSeconds = Number(payload.time_seconds || 0);
    const completedAt = new Date().toISOString();
    const result = calculateResult(cleanedAnswers);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { error: insertError } = await adminClient.from('test_results').insert({
      user_id: user.id,
      user_email: user.email,
      answers: cleanedAnswers,
      score: result.score,
      normalized_score: result.normalized_score,
      level: result.level,
      level_badge: result.level_badge,
      breakdown: result.breakdown,
      time_seconds: Number.isFinite(timeSeconds) ? Math.max(0, Math.round(timeSeconds)) : 0,
      completed_at: completedAt,
    });

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500);
    }

    return jsonResponse({
      score: result.score,
      normalized_score: result.normalized_score,
      level: result.level,
      level_badge: result.level_badge,
      breakdown: result.breakdown,
      completed_at: completedAt,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
