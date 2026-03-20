import { CORS_HEADERS, getAuthContext, jsonResponse, parseJson } from '../_shared/common.ts';

type Payload = {
  attempt_id?: string;
};

type InsightItem = {
  issue: string;
  why: string;
  focus: string;
  priority: 'high' | 'medium' | 'low';
  level: string;
};

type WrongRow = {
  question_text: string;
  question_level: string;
};

type TestAnswer = {
  question_id?: number;
  selected_option?: number;
};

type TestResultRow = {
  attempt_id?: string | null;
  answers?: TestAnswer[] | null;
};

function fallbackAnalyze(rows: Array<{ question_text: string; question_level: string }>): { summary: string; items: InsightItem[] } {
  const levelStats = new Map<string, number>();
  const buckets = new Map<string, string[]>();

  for (const row of rows) {
    const level = String(row.question_level || 'A1');
    levelStats.set(level, (levelStats.get(level) || 0) + 1);

    const text = row.question_text.toLowerCase();
    let topic = 'Общая грамматика и лексика';
    if (text.includes('reported speech') || text.includes('said')) topic = 'Косвенная речь';
    if (text.includes('conditional')) topic = 'Условные предложения';
    if (text.includes('preposition') || text.includes('for ') || text.includes('since')) topic = 'Предлоги времени и места';
    if (text.includes('phrasal')) topic = 'Фразовые глаголы';
    if (text.includes('article') || text.includes('a ') || text.includes('the ')) topic = 'Артикли';

    if (!buckets.has(topic)) buckets.set(topic, []);
    const list = buckets.get(topic)!;
    if (list.length < 3) list.push(row.question_text);
  }

  const sortedTopics = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  const weakestLevel = [...levelStats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'A1';

  const items: InsightItem[] = sortedTopics.map(([topic], idx) => ({
    issue: topic,
    why: `Ошибки повторяются в блоке «${topic}», поэтому текущая причина - пробел в базовом правиле/паттерне.`,
    focus: `Повторить правило и сделать 15-20 упражнений на тему «${topic}».`,
    priority: idx === 0 ? 'high' : idx <= 2 ? 'medium' : 'low',
    level: weakestLevel,
  }));

  const summary = rows.length
    ? `Найдено ${rows.length} ошибок. Основной фокус: уровень ${weakestLevel}, темы ${items.map((item) => item.issue).join(', ')}.`
    : 'По текущей попытке ошибок не найдено.';

  return { summary, items };
}

async function openAiAnalyze(rows: Array<{ question_text: string; question_level: string }>): Promise<{ summary: string; items: InsightItem[] } | null> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return null;

  const model = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';
  const endpoint = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1/chat/completions';

  const prompt = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Ты методист английского. Верни JSON формата {"summary": string, "items": [{"issue": string, "why": string, "focus": string, "priority": "high|medium|low", "level": "A1|A2|B1|B2|C1|C2"}]}. Без лишнего текста.',
      },
      {
        role: 'user',
        content: `Ошибочные вопросы ученика: ${JSON.stringify(rows)}`,
      },
    ],
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(prompt),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return null;

    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items: InsightItem[] = rawItems
      .map((item: unknown) => ({
        issue: String((item as { issue?: string }).issue || '').trim(),
        why: String((item as { why?: string }).why || '').trim(),
        focus: String((item as { focus?: string }).focus || '').trim(),
        priority: ['high', 'medium', 'low'].includes(String((item as { priority?: string }).priority))
          ? (String((item as { priority?: string }).priority) as 'high' | 'medium' | 'low')
          : 'medium',
        level: String((item as { level?: string }).level || 'A1').trim().toUpperCase(),
      }))
      .filter((item) => item.issue && item.why && item.focus)
      .slice(0, 8);

    return {
      summary: String(parsed.summary || '').trim() || 'Персональный разбор сформирован.',
      items,
    };
  } catch {
    return null;
  }
}

async function loadWrongRowsFromAttemptItems(
  userId: string,
  attemptId: string,
  adminClient: any,
): Promise<WrongRow[]> {
  if (!attemptId) return [];

  const { data, error } = await adminClient
    .from('attempt_items')
    .select('question_text,question_level')
    .eq('user_id', userId)
    .eq('attempt_id', attemptId)
    .eq('is_correct', false)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as WrongRow[];
}

async function loadWrongRowsFromLegacyAnswers(
  testResult: TestResultRow | null,
  adminClient: any,
): Promise<WrongRow[]> {
  if (!testResult || !Array.isArray(testResult.answers) || !testResult.answers.length) return [];

  const normalizedAnswers = testResult.answers
    .map((item) => ({
      question_id: Number(item?.question_id),
      selected_option: Number(item?.selected_option),
    }))
    .filter((item) => Number.isInteger(item.question_id) && item.question_id > 0 && Number.isInteger(item.selected_option));

  if (!normalizedAnswers.length) return [];

  const questionIds = [...new Set(normalizedAnswers.map((item) => item.question_id))];
  const { data: questions, error: questionError } = await adminClient
    .from('question_bank')
    .select('id,question_text,level,correct_option')
    .in('id', questionIds);

  if (questionError) throw new Error(questionError.message);

  const questionMap = new Map<number, { question_text: string; level: string; correct_option: number }>();
  for (const row of questions || []) {
    questionMap.set(Number((row as { id: number }).id), {
      question_text: String((row as { question_text?: string }).question_text || ''),
      level: String((row as { level?: string }).level || 'A1'),
      correct_option: Number((row as { correct_option?: number }).correct_option ?? -1),
    });
  }

  const wrongRows: WrongRow[] = [];
  for (const item of normalizedAnswers) {
    const question = questionMap.get(item.question_id);
    if (!question) continue;
    if (item.selected_option === question.correct_option) continue;
    wrongRows.push({
      question_text: question.question_text,
      question_level: question.level,
    });
  }

  return wrongRows;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { user, adminClient } = await getAuthContext(req);
    const payload = await parseJson<Payload>(req);

    const requestedAttemptId = String(payload.attempt_id || '').trim();
    let selectedResult: TestResultRow | null = null;

    if (requestedAttemptId) {
      const { data: requestedResult, error: requestedError } = await adminClient
        .from('test_results')
        .select('attempt_id,answers,completed_at')
        .eq('user_id', user.id)
        .eq('attempt_id', requestedAttemptId)
        .maybeSingle();

      if (requestedError) throw new Error(requestedError.message);
      selectedResult = (requestedResult as TestResultRow | null) || null;
    }

    if (!selectedResult) {
      const { data: latestResult, error: latestError } = await adminClient
        .from('test_results')
        .select('attempt_id,answers,completed_at')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw new Error(latestError.message);
      selectedResult = (latestResult as TestResultRow | null) || null;
    }

    if (!selectedResult) return jsonResponse({ error: 'No attempts found for analysis' }, 404);

    const attemptId = String(selectedResult.attempt_id || '').trim();
    let rows = await loadWrongRowsFromAttemptItems(user.id, attemptId, adminClient);
    if (!rows.length) {
      rows = await loadWrongRowsFromLegacyAnswers(selectedResult, adminClient);
    }

    const aiResult = await openAiAnalyze(rows);
    const fallbackResult = fallbackAnalyze(rows);
    const finalResult = aiResult && aiResult.items.length ? aiResult : fallbackResult;
    const source = aiResult && aiResult.items.length ? 'openai' : 'fallback';

    const { data: activePlan } = await adminClient
      .from('study_plan_versions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: insightRow, error: insightError } = await adminClient
      .from('ai_insights')
      .insert({
        user_id: user.id,
        attempt_id: attemptId || null,
        plan_version_id: activePlan?.id || null,
        source,
        summary: finalResult.summary,
        items: finalResult.items,
      })
      .select('*')
      .single();

    if (insightError) throw new Error(insightError.message);

    if (activePlan?.id && finalResult.items.length) {
      const { data: lessons } = await adminClient
        .from('study_lessons')
        .select('id,level,priority_note,status')
        .eq('plan_version_id', activePlan.id)
        .in('status', ['planned', 'rescheduled'])
        .order('lesson_index', { ascending: true });

      const updates: Array<{ id: string; priority_note: string }> = [];
      for (const item of finalResult.items) {
        const match = (lessons || []).find((lesson) => !lesson.priority_note && String(lesson.level).toUpperCase() === item.level);
        if (!match) continue;
        updates.push({ id: String(match.id), priority_note: `Особый фокус: ${item.issue}. ${item.focus}` });
      }

      for (const update of updates.slice(0, 6)) {
        await adminClient
          .from('study_lessons')
          .update({ priority_note: update.priority_note, updated_at: new Date().toISOString() })
          .eq('id', update.id);
      }
    }

    return jsonResponse({
      insight: insightRow,
      source,
      analyzed_attempt_id: attemptId || null,
      rows_count: rows.length,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
