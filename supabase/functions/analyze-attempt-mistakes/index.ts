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

function parseAiJsonContent(raw: unknown): { summary: string; items: InsightItem[] } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

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
}

type OpenAiAnalyzeResult = {
  result: { summary: string; items: InsightItem[] } | null;
  error: string | null;
};

async function openAiAnalyze(rows: Array<{ question_text: string; question_level: string }>): Promise<OpenAiAnalyzeResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return { result: null, error: 'OPENAI_API_KEY is missing' };
  if (!rows.length) return { result: null, error: 'No mistake rows for AI analysis' };

  const configuredModel = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';
  const modelCandidates = [...new Set([
    configuredModel,
    configuredModel.startsWith('openai/') ? configuredModel.replace(/^openai\//, '') : `openai/${configuredModel}`,
  ])];
  const baseUrlRaw = String(Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com').trim().replace(/\/+$/, '');
  const baseUrl = baseUrlRaw.endsWith('/v1') ? baseUrlRaw.slice(0, -3) : baseUrlRaw;
  const responsesUrl = `${baseUrl}/v1/responses`;
  const chatCompletionsUrl = `${baseUrl}/v1/chat/completions`;
  const systemText = 'Ты методист английского. Верни JSON формата {"summary": string, "items": [{"issue": string, "why": string, "focus": string, "priority": "high|medium|low", "level": "A1|A2|B1|B2|C1|C2"}]}. Без лишнего текста.';
  const userText = `Ошибочные вопросы ученика: ${JSON.stringify(rows)}`;
  let lastError = 'OpenAI request failed in both responses/chat modes';

  for (const model of modelCandidates) {
    try {
      const response = await fetch(responsesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: systemText }] },
            { role: 'user', content: [{ type: 'input_text', text: userText }] },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'mistake_analysis',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  summary: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        issue: { type: 'string' },
                        why: { type: 'string' },
                        focus: { type: 'string' },
                        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                        level: { type: 'string' },
                      },
                      required: ['issue', 'why', 'focus', 'priority', 'level'],
                    },
                  },
                },
                required: ['summary', 'items'],
              },
            },
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const parsed = parseAiJsonContent(data?.output_text || '');
        if (parsed && parsed.items.length) return { result: parsed, error: null };
        lastError = `OpenAI responses (${model}) returned empty or invalid JSON payload`;
      } else {
        const errorBody = await response.text();
        const brief = errorBody.slice(0, 220);
        lastError = response.status === 401
          ? `OpenAI auth failed (${model}): ${brief}`
          : `OpenAI responses failed (${response.status}, ${model}): ${brief}`;
      }
    } catch {
      // Fall through to chat completions compatibility mode.
    }

    try {
      const response = await fetch(chatCompletionsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemText },
            { role: 'user', content: userText },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const brief = errorBody.slice(0, 220);
        lastError = response.status === 401
          ? `OpenAI auth failed (${model}): ${brief}`
          : `OpenAI chat completions failed (${response.status}, ${model}): ${brief}`;
        continue;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      const parsed = parseAiJsonContent(content);
      if (parsed && parsed.items.length) return { result: parsed, error: null };
      lastError = `OpenAI chat completions (${model}) returned empty or invalid JSON payload`;
    } catch {
      // Try next model candidate.
    }
  }

  return { result: null, error: lastError };
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

    const aiProbe = await openAiAnalyze(rows);
    const aiResult = aiProbe.result;
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
      openai_error: source === 'fallback' ? aiProbe.error : null,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
