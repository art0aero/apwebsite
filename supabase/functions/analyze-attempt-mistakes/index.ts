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
  selected_option_text?: string;
  correct_option_text?: string;
};

type TestAnswer = {
  question_id?: number;
  selected_option?: number;
};

type TestResultRow = {
  attempt_id?: string | null;
  answers?: TestAnswer[] | null;
};

type LessonHint = {
  lesson_index: number;
  level: string;
  title: string;
  description?: string;
};

function normalizeCefrLevel(raw: unknown): string {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'A0' || value === 'BELOW A1') return 'A1';
  if (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(value)) return value;
  return 'A1';
}

function fallbackAnalyze(rows: Array<WrongRow>): { summary: string; items: InsightItem[] } {
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

  const items: InsightItem[] = sortedTopics.map(([topic], idx) => {
    const sample = rows.find((row) => row.question_text.toLowerCase().includes(topic.toLowerCase())) || rows[idx] || null;
    const delta = sample?.selected_option_text && sample?.correct_option_text
      ? `В ответе выбран вариант «${sample.selected_option_text}», но корректно «${sample.correct_option_text}».`
      : 'Есть повторяющиеся ошибки в формулировках этого блока.';

    return {
      issue: topic,
      why: `${delta} Это указывает на пробел в паттерне «${topic}».`,
      focus: `На ближайших уроках уровня ${weakestLevel} выделить отдельный блок на тему «${topic}»: правило + 8-10 целевых примеров + мини-практика в речи.`,
      priority: idx === 0 ? 'high' : idx <= 2 ? 'medium' : 'low',
      level: weakestLevel,
    };
  });

  const summary = rows.length
    ? `Найдено ${rows.length} ошибок. Основной фокус: уровень ${weakestLevel}, темы ${items.map((item) => item.issue).join(', ')}.`
    : 'По текущей попытке ошибок не найдено.';

  return { summary, items };
}

function normalizeInsightObject(parsed: Record<string, unknown>): { summary: string; items: InsightItem[] } {
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: InsightItem[] = rawItems
    .map((item: unknown) => ({
      issue: String((item as { issue?: string }).issue || '').trim(),
      why: String((item as { why?: string }).why || '').trim(),
      focus: String((item as { focus?: string }).focus || '').trim(),
      priority: ['high', 'medium', 'low'].includes(String((item as { priority?: string }).priority))
        ? (String((item as { priority?: string }).priority) as 'high' | 'medium' | 'low')
        : 'medium',
      level: normalizeCefrLevel((item as { level?: string }).level || 'A1'),
    }))
    .filter((item) => item.issue && item.why && item.focus)
    .slice(0, 8);

  return {
    summary: String(parsed.summary || '').trim() || 'Персональный разбор сформирован.',
    items,
  };
}

function stripMarkdownJsonFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function parseAiJsonContent(raw: unknown): { summary: string; items: InsightItem[] } | null {
  if (!raw) return null;

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return normalizeInsightObject(raw as Record<string, unknown>);
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const parsed = parseAiJsonContent(item);
      if (parsed && parsed.items.length) return parsed;
    }
    return null;
  }

  if (typeof raw !== 'string') return null;
  const prepared = stripMarkdownJsonFence(raw);
  if (!prepared) return null;

  try {
    const parsed = JSON.parse(prepared) as Record<string, unknown>;
    return normalizeInsightObject(parsed);
  } catch {
    const jsonStart = prepared.indexOf('{');
    const jsonEnd = prepared.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        const extracted = prepared.slice(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(extracted) as Record<string, unknown>;
        return normalizeInsightObject(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractCandidatePayloads(payload: unknown): unknown[] {
  const candidates: unknown[] = [payload];
  const data = payload as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return candidates;

  if (data.output_text) candidates.push(data.output_text);
  if (Array.isArray(data.output)) {
    for (const outputItem of data.output) {
      candidates.push(outputItem);
      const content = (outputItem as { content?: unknown }).content;
      if (Array.isArray(content)) {
        for (const part of content) {
          candidates.push(part);
          if ((part as { text?: unknown }).text) candidates.push((part as { text?: unknown }).text);
          if ((part as { output_text?: unknown }).output_text) candidates.push((part as { output_text?: unknown }).output_text);
        }
      }
    }
  }

  if (Array.isArray(data.choices)) {
    for (const choice of data.choices) {
      candidates.push(choice);
      const message = (choice as { message?: unknown }).message;
      if (message) candidates.push(message);
      const content = (message as { content?: unknown })?.content;
      if (content) candidates.push(content);
    }
  }

  return candidates;
}

function getFirstReadableText(payloads: unknown[]): string {
  for (const payload of payloads) {
    if (typeof payload === 'string' && payload.trim()) return stripMarkdownJsonFence(payload).trim();
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) return stripMarkdownJsonFence(text).trim();
      const content = (payload as { content?: unknown }).content;
      if (typeof content === 'string' && content.trim()) return stripMarkdownJsonFence(content).trim();
    }
  }
  return '';
}

function buildLooseOpenAiResult(rawText: string, rows: WrongRow[]): { summary: string; items: InsightItem[] } | null {
  const plain = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!plain) return null;
  const fallback = fallbackAnalyze(rows);
  return {
    summary: plain.slice(0, 650),
    items: fallback.items.slice(0, 8),
  };
}

type OpenAiAnalyzeResult = {
  result: { summary: string; items: InsightItem[] } | null;
  error: string | null;
};

async function openAiAnalyze(rows: WrongRow[], lessonHints: LessonHint[]): Promise<OpenAiAnalyzeResult> {
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
  const systemText = [
    'Ты ИнстантМетодист - сильный методист английского по CEFR.',
    'Задача: разобрать только реальные ошибки ученика и дать персональные рекомендации без воды.',
    'Обязательно используй разницу между selected_option_text и correct_option_text, если она дана.',
    'Для каждого пункта items:',
    '1) issue: конкретный пробел (правило/конструкция/лексика).',
    '2) why: почему ответ неверный (краткое обоснование на основе ошибки).',
    '3) focus: что делать на уроке + привязка к одному из lesson_hints в формате "Урок #N (LEVEL): TITLE ...".',
    '4) priority: high/medium/low.',
    '5) level: один из A1,A2,B1,B2,C1,C2 где закрывать пробел.',
    'Не выдумывай факты, которых нет во входных данных.',
    'Верни только JSON объекта формата {"summary": string, "items": [...]}, без markdown и без пояснений вне JSON.',
  ].join(' ');
  const userPayload = {
    mistakes: rows.slice(0, 80).map((row) => ({
      question_text: row.question_text,
      question_level: normalizeCefrLevel(row.question_level),
      selected_option_text: row.selected_option_text || '',
      correct_option_text: row.correct_option_text || '',
    })),
    lesson_hints: (lessonHints || []).slice(0, 120).map((lesson) => ({
      lesson_index: lesson.lesson_index,
      level: normalizeCefrLevel(lesson.level),
      title: lesson.title,
    })),
    output_language: 'ru',
    max_items: 6,
  };
  const userText = JSON.stringify(userPayload);
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
        const payloads = extractCandidatePayloads(data);
        for (const payload of payloads) {
          const parsed = parseAiJsonContent(payload);
          if (parsed && parsed.items.length) return { result: parsed, error: null };
        }
        const loose = buildLooseOpenAiResult(getFirstReadableText(payloads), rows);
        if (loose && loose.items.length) return { result: loose, error: null };
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
      const payloads = extractCandidatePayloads(data);
      for (const payload of payloads) {
        const parsed = parseAiJsonContent(payload);
        if (parsed && parsed.items.length) return { result: parsed, error: null };
      }
      const loose = buildLooseOpenAiResult(getFirstReadableText(payloads), rows);
      if (loose && loose.items.length) return { result: loose, error: null };
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
    .select('question_text,question_level,selected_option_text,correct_option_text')
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
    .select('id,question_text,level,correct_option,options')
    .in('id', questionIds);

  if (questionError) throw new Error(questionError.message);

  const questionMap = new Map<number, { question_text: string; level: string; correct_option: number; options: string[] }>();
  for (const row of questions || []) {
    const optionsRaw = (row as { options?: unknown }).options;
    const options = Array.isArray(optionsRaw) ? optionsRaw.map((item) => String(item || '')) : [];
    questionMap.set(Number((row as { id: number }).id), {
      question_text: String((row as { question_text?: string }).question_text || ''),
      level: String((row as { level?: string }).level || 'A1'),
      correct_option: Number((row as { correct_option?: number }).correct_option ?? -1),
      options,
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
      selected_option_text: question.options[item.selected_option] || '',
      correct_option_text: question.options[question.correct_option] || '',
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

    const { data: activePlan } = await adminClient
      .from('study_plan_versions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let plannedLessons: Array<{
      id: string;
      lesson_index: number;
      level: string;
      title: string;
      description: string | null;
      priority_note: string | null;
      status: string;
    }> = [];

    if (activePlan?.id) {
      const { data: lessonsData, error: lessonsError } = await adminClient
        .from('study_lessons')
        .select('id,lesson_index,level,title,description,priority_note,status')
        .eq('plan_version_id', activePlan.id)
        .in('status', ['planned', 'rescheduled'])
        .order('lesson_index', { ascending: true })
        .limit(500);

      if (lessonsError) throw new Error(lessonsError.message);
      plannedLessons = (lessonsData || []) as typeof plannedLessons;
    }

    const lessonHints: LessonHint[] = plannedLessons.map((lesson) => ({
      lesson_index: Number(lesson.lesson_index || 0),
      level: normalizeCefrLevel(lesson.level),
      title: String(lesson.title || ''),
      description: String(lesson.description || ''),
    }));

    const aiProbe = await openAiAnalyze(rows, lessonHints);
    const aiResult = aiProbe.result;
    const fallbackResult = fallbackAnalyze(rows);
    const finalResult = aiResult && aiResult.items.length ? aiResult : fallbackResult;
    const source = aiResult && aiResult.items.length ? 'openai' : 'fallback';

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
      const updates: Array<{ id: string; priority_note: string }> = [];
      for (const item of finalResult.items) {
        const match = plannedLessons.find((lesson) => !lesson.priority_note && normalizeCefrLevel(lesson.level) === item.level);
        if (!match) continue;
        updates.push({
          id: String(match.id),
          priority_note: `ИнстантМетодист: ${item.issue}. ${item.focus}`,
        });
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
