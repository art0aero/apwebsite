export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const LEARNING_NODES = ['A0', ...CEFR_LEVELS] as const;

export type CefrLevel = (typeof CEFR_LEVELS)[number];
export type LearningNode = (typeof LEARNING_NODES)[number];
export type CurriculumTrack = 'core' | 'b1_plus';

export type CurriculumRow = {
  level: CefrLevel;
  path_from: LearningNode | string;
  path_to: CefrLevel | string;
  track: CurriculumTrack | string;
  ordinal: number;
  title: string;
  description: string;
  estimated_lessons: number;
  unit_code?: string | null;
  source_file?: string | null;
};

export type PlannedLesson = {
  lesson_index: number;
  lesson_date: string;
  level: CefrLevel;
  title: string;
  description: string;
  cost: number;
  duration_minutes: number;
  track: CurriculumTrack;
  path_from: LearningNode;
  path_to: CefrLevel;
  is_checkpoint: boolean;
  checkpoint_level: string | null;
  is_final_test: boolean;
};

type TransitionStep = {
  path_from: LearningNode;
  path_to: CefrLevel;
  track: CurriculumTrack;
};

export function levelToIndex(level: string): number {
  return CEFR_LEVELS.indexOf(level as CefrLevel);
}

function nodeIndex(node: string): number {
  return LEARNING_NODES.indexOf(node as LearningNode);
}

function normalizeStartNode(level: string | null | undefined): LearningNode {
  const normalized = String(level || '').trim();
  if (!normalized) return 'A1';
  if (normalized === 'Below A1' || normalized === 'A0' || normalized.toLowerCase() === 'below a1') return 'A0';
  if (LEARNING_NODES.includes(normalized as LearningNode)) return normalized as LearningNode;
  return 'A1';
}

export function toCefrLevel(level: string): CefrLevel {
  const normalized = String(level || '').trim().toUpperCase();
  if (normalized === 'BELOW A1' || normalized === 'A0') return 'A1';
  if (CEFR_LEVELS.includes(normalized as CefrLevel)) return normalized as CefrLevel;
  return 'A1';
}

function fallbackTransitionForTarget(target: CefrLevel): TransitionStep {
  const targetIdx = nodeIndex(target);
  const from = LEARNING_NODES[Math.max(0, targetIdx - 1)] as LearningNode;
  return {
    path_from: from,
    path_to: target,
    track: 'core',
  };
}

function buildTransitionSteps(currentLevel: string, targetLevel: string, includeB1Plus: boolean): TransitionStep[] {
  const startNode = normalizeStartNode(currentLevel);
  const target = toCefrLevel(targetLevel);

  const startIdx = nodeIndex(startNode);
  const targetIdx = nodeIndex(target);

  if (targetIdx <= startIdx) {
    return [fallbackTransitionForTarget(target)];
  }

  const steps: TransitionStep[] = [];
  for (let idx = startIdx + 1; idx <= targetIdx; idx += 1) {
    const from = LEARNING_NODES[idx - 1] as LearningNode;
    const to = LEARNING_NODES[idx] as CefrLevel;

    steps.push({
      path_from: from,
      path_to: to,
      track: 'core',
    });

    if (includeB1Plus && from === 'B1' && to === 'B2') {
      steps.push({
        path_from: from,
        path_to: to,
        track: 'b1_plus',
      });
    }
  }

  return steps;
}

function isoDateFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getIsoDayOfWeek(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function planLessonDates(startDateIso: string, preferredDays: number[], count: number): string[] {
  const safeDays = [...new Set(preferredDays)]
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7)
    .sort((a, b) => a - b);

  const days = safeDays.length ? safeDays : [1, 3, 5];

  const startDate = new Date(`${startDateIso}T00:00:00.000Z`);
  let cursor = new Date(startDate.getTime());
  const result: string[] = [];

  while (result.length < count) {
    const weekday = getIsoDayOfWeek(cursor);
    if (days.includes(weekday)) {
      result.push(isoDateFromDate(cursor));
    }
    cursor = addDays(cursor, 1);
  }

  return result;
}

function normalizeTrack(value: string): CurriculumTrack {
  return value === 'b1_plus' ? 'b1_plus' : 'core';
}

function normalizePathFrom(value: string): LearningNode {
  const normalized = String(value || '').trim().toUpperCase();
  if (LEARNING_NODES.includes(normalized as LearningNode)) return normalized as LearningNode;
  return 'A1';
}

function normalizePathTo(value: string): CefrLevel {
  return toCefrLevel(value);
}

function resolveLessonCost(step: TransitionStep): number {
  return step.path_from === 'C1' && step.path_to === 'C2' ? 1650 : 1500;
}

function addDurationNote(description: string): string {
  const base = String(description || '').trim();
  const durationText = 'Длительность урока: 60 минут.';
  if (!base) return durationText;
  if (base.includes('60 минут')) return base;
  return `${base}\n${durationText}`;
}

function buildLevelsPath(currentLevel: string, targetLevel: string): CefrLevel[] {
  const startNode = normalizeStartNode(currentLevel);
  const target = toCefrLevel(targetLevel);

  const startIdx = nodeIndex(startNode);
  const targetIdx = nodeIndex(target);

  if (targetIdx < 1) return ['A1'];

  if (targetIdx < startIdx) {
    return [target];
  }

  const fromIdx = Math.max(1, startIdx);
  const levels: CefrLevel[] = [];
  for (let idx = fromIdx; idx <= targetIdx; idx += 1) {
    levels.push(LEARNING_NODES[idx] as CefrLevel);
  }
  return levels;
}

export function buildLessons(params: {
  currentLevel: string;
  targetLevel: string;
  startDateIso: string;
  preferredDays: number[];
  curriculumRows: CurriculumRow[];
  includeB1Plus?: boolean;
}) {
  const {
    currentLevel,
    targetLevel,
    startDateIso,
    preferredDays,
    curriculumRows,
    includeB1Plus = false,
  } = params;

  const steps = buildTransitionSteps(currentLevel, targetLevel, includeB1Plus);

  const lessonDrafts: Array<Omit<PlannedLesson, 'lesson_date' | 'lesson_index'>> = [];

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];

    const rows = (curriculumRows || [])
      .filter((row) => (
        normalizePathFrom(String(row.path_from)) === step.path_from
        && normalizePathTo(String(row.path_to)) === step.path_to
        && normalizeTrack(String(row.track || 'core')) === step.track
      ))
      .sort((a, b) => Number(a.ordinal || 0) - Number(b.ordinal || 0));

    if (!rows.length) {
      for (let i = 1; i <= 8; i += 1) {
        lessonDrafts.push({
          level: step.path_to,
          title: `${step.path_from}→${step.path_to}${step.track === 'b1_plus' ? ' (B1+)' : ''}: Практика ${i}`,
          description: addDurationNote(`Тема ${i} перехода ${step.path_from}→${step.path_to}. Временный контент до импорта полной программы.`),
          cost: resolveLessonCost(step),
          duration_minutes: 60,
          track: step.track,
          path_from: step.path_from,
          path_to: step.path_to,
          is_checkpoint: false,
          checkpoint_level: null,
          is_final_test: false,
        });
      }
    } else {
      for (const row of rows) {
        const lessonCount = Math.max(1, Number(row.estimated_lessons) || 1);
        for (let repeat = 0; repeat < lessonCount; repeat += 1) {
          lessonDrafts.push({
            level: step.path_to,
            title: String(row.title || `${step.path_from}→${step.path_to}`),
            description: addDurationNote(String(row.description || '')),
            cost: resolveLessonCost(step),
            duration_minutes: 60,
            track: step.track,
            path_from: step.path_from,
            path_to: step.path_to,
            is_checkpoint: false,
            checkpoint_level: null,
            is_final_test: false,
          });
        }
      }
    }

    const nextStep = steps[stepIndex + 1];
    const isBoundary = !nextStep || nextStep.path_from !== step.path_from || nextStep.path_to !== step.path_to;

    if (isBoundary && lessonDrafts.length > 0) {
      const lastIndex = lessonDrafts.length - 1;
      lessonDrafts[lastIndex].is_checkpoint = true;
      lessonDrafts[lastIndex].checkpoint_level = step.path_to;
      lessonDrafts[lastIndex].title = `${lessonDrafts[lastIndex].title} + Ретест ${step.path_to}`;
    }
  }

  if (lessonDrafts.length > 0) {
    const target = toCefrLevel(targetLevel);
    const lastIndex = lessonDrafts.length - 1;
    lessonDrafts[lastIndex].is_checkpoint = true;
    lessonDrafts[lastIndex].is_final_test = true;
    lessonDrafts[lastIndex].checkpoint_level = target;
    lessonDrafts[lastIndex].title = `${lessonDrafts[lastIndex].title} + Финальный тест`;
  }

  const dates = planLessonDates(startDateIso, preferredDays, lessonDrafts.length);

  const lessons: PlannedLesson[] = lessonDrafts.map((item, idx) => ({
    lesson_index: idx + 1,
    lesson_date: dates[idx],
    level: item.level,
    title: item.title,
    description: item.description,
    cost: item.cost,
    duration_minutes: item.duration_minutes,
    track: item.track,
    path_from: item.path_from,
    path_to: item.path_to,
    is_checkpoint: item.is_checkpoint,
    checkpoint_level: item.checkpoint_level,
    is_final_test: item.is_final_test,
  }));

  const totalCost = lessons.reduce((sum, lesson) => sum + (Number(lesson.cost) || 0), 0);

  return {
    levels_path: buildLevelsPath(currentLevel, targetLevel),
    lessons,
    start_date: lessons[0]?.lesson_date ?? startDateIso,
    end_date: lessons[lessons.length - 1]?.lesson_date ?? startDateIso,
    total_lessons: lessons.length,
    total_cost: Number(totalCost.toFixed(2)),
  };
}

export function nextVersionNo(existing: Array<{ version_no: number }>): number {
  if (!Array.isArray(existing) || existing.length === 0) return 1;
  return Math.max(...existing.map((item) => Number(item.version_no) || 0)) + 1;
}

export function comparePlanDelta(previous: { end_date: string; remaining_cost: number } | null, next: {
  end_date: string;
  total_cost: number;
}) {
  if (!previous) {
    return { deltaDays: 0, deltaCost: 0 };
  }

  const prevDate = new Date(`${previous.end_date}T00:00:00.000Z`).getTime();
  const nextDate = new Date(`${next.end_date}T00:00:00.000Z`).getTime();
  const deltaDays = Math.round((nextDate - prevDate) / (1000 * 60 * 60 * 24));
  const deltaCost = Number((next.total_cost - Number(previous.remaining_cost || 0)).toFixed(2));

  return { deltaDays, deltaCost };
}
