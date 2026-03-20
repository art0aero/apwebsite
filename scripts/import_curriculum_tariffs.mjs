import fs from 'node:fs';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF;
const serviceKey = process.env.SUPABASE_SECRET;

if (!projectRef || !serviceKey) {
  console.error('Missing env vars: SUPABASE_PROJECT_REF and SUPABASE_SECRET');
  process.exit(1);
}

const inputPath = process.argv[2] || 'docs';
const absPath = path.resolve(inputPath);
const baseUrl = `https://${projectRef}.supabase.co`;

const LEVEL_TARIFFS = [
  { level: 'A1', price_per_lesson: 1500, currency: 'RUB' },
  { level: 'A2', price_per_lesson: 1500, currency: 'RUB' },
  { level: 'B1', price_per_lesson: 1500, currency: 'RUB' },
  { level: 'B2', price_per_lesson: 1500, currency: 'RUB' },
  { level: 'C1', price_per_lesson: 1500, currency: 'RUB' },
  { level: 'C2', price_per_lesson: 1650, currency: 'RUB' },
];

const FILE_MAPPING = [
  { candidates: ['Beginner - A1.md'], path_from: 'A0', path_to: 'A1', track: 'core' },
  { candidates: ['A1-A2.md'], path_from: 'A1', path_to: 'A2', track: 'core' },
  { candidates: ['A2-B1.md'], path_from: 'A2', path_to: 'B1', track: 'core' },
  { candidates: ['B1-B2.md'], path_from: 'B1', path_to: 'B2', track: 'core' },
  { candidates: ['B1+.md'], path_from: 'B1', path_to: 'B2', track: 'b1_plus' },
  { candidates: ['B2-C2.md', 'B2-C1.md'], path_from: 'B2', path_to: 'C1', track: 'core' },
  { candidates: ['С1-С2.md', 'C1-C2.md'], path_from: 'C1', path_to: 'C2', track: 'core' },
];

function stripMarkdown(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value) {
  return stripMarkdown(value).toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();
}

function parseEstimatedLessons(value) {
  const raw = stripMarkdown(value).toLowerCase();
  const range = raw.match(/(\d+)\s*-\s*(\d+)/);
  if (range) {
    return Math.max(Number(range[1] || 1), Number(range[2] || 1));
  }

  const single = raw.match(/(\d+)/);
  if (single) return Math.max(1, Number(single[1] || 1));
  return 1;
}

function parseMarkdownTableRows(markdown) {
  const lines = String(markdown || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'));

  if (lines.length < 2) return [];

  const rawHeader = lines[0].split('|').map((part) => part.trim()).filter(Boolean);
  const header = rawHeader.map(normalizeHeader);

  const col = {
    unit: header.findIndex((item) => item.includes('unit')),
    grammar: header.findIndex((item) => item.includes('grammar')),
    topic: header.findIndex((item) => item.includes('topic')),
    vocab: header.findIndex((item) => item.includes('vocabulary')),
    goals: header.findIndex((item) => item.includes('goals')),
    estimated: header.findIndex((item) => item.includes('estimated') && item.includes('lesson')),
  };

  const rows = [];
  for (const line of lines.slice(2)) {
    if (/^\|\s*-+/.test(line.trim())) continue;

    const cells = line.split('|').map((part) => part.trim()).filter(Boolean);
    if (!cells.length) continue;

    const unitCode = stripMarkdown(cells[col.unit] || '');
    const grammar = stripMarkdown(cells[col.grammar] || '');
    const topic = stripMarkdown(cells[col.topic] || '');
    const vocabulary = stripMarkdown(cells[col.vocab] || '');
    const goals = stripMarkdown(cells[col.goals] || '');
    const estimated = parseEstimatedLessons(cells[col.estimated] || '1');

    const title = `${unitCode || 'Unit'} — ${topic || grammar || 'Practice'}`.slice(0, 240);
    const description = [
      grammar ? `Grammar: ${grammar}` : null,
      topic ? `Topic: ${topic}` : null,
      vocabulary ? `Vocabulary: ${vocabulary}` : null,
      goals ? `Goals: ${goals}` : null,
    ].filter(Boolean).join('\n');

    rows.push({
      unit_code: unitCode || null,
      title,
      description,
      estimated_lessons: estimated,
    });
  }

  return rows;
}

function resolveMappedFile(mappingItem, availableFiles) {
  for (const candidate of mappingItem.candidates) {
    if (availableFiles.includes(candidate)) return candidate;
  }
  return null;
}

function parseFromDocsDirectory(dirPath) {
  const availableFiles = fs.readdirSync(dirPath).filter((item) => item.toLowerCase().endsWith('.md'));

  const curriculum = [];

  for (const mapping of FILE_MAPPING) {
    const fileName = resolveMappedFile(mapping, availableFiles);
    if (!fileName) {
      throw new Error(`Missing curriculum file for transition ${mapping.path_from}->${mapping.path_to}. Expected one of: ${mapping.candidates.join(', ')}`);
    }

    const fullPath = path.join(dirPath, fileName);
    const markdown = fs.readFileSync(fullPath, 'utf8');
    const rows = parseMarkdownTableRows(markdown);

    if (!rows.length) {
      throw new Error(`No lesson rows found in ${fileName}`);
    }

    rows.forEach((row, index) => {
      curriculum.push({
        level: mapping.path_to,
        path_from: mapping.path_from,
        path_to: mapping.path_to,
        track: mapping.track,
        ordinal: index + 1,
        title: row.title,
        description: row.description,
        estimated_lessons: row.estimated_lessons,
        unit_code: row.unit_code,
        source_file: fileName,
        is_active: true,
      });
    });
  }

  return {
    curriculum,
    tariffs: LEVEL_TARIFFS,
  };
}

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Input JSON must be an object with curriculum and tariffs arrays');
  }

  const curriculum = Array.isArray(parsed.curriculum) ? parsed.curriculum : [];
  const tariffs = Array.isArray(parsed.tariffs) ? parsed.tariffs : LEVEL_TARIFFS;

  return { curriculum, tariffs };
}

async function restRequest(endpoint, method, body, prefer = 'return=representation') {
  const response = await fetch(`${baseUrl}/rest/v1${endpoint}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`${method} ${endpoint} failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  const useJson = absPath.toLowerCase().endsWith('.json');
  const { curriculum, tariffs } = useJson
    ? parseJsonFile(absPath)
    : parseFromDocsDirectory(absPath);

  console.log(`Loaded curriculum rows: ${curriculum.length}`);
  console.log(`Loaded tariff rows: ${tariffs.length}`);

  await restRequest('/study_curriculum?is_active=eq.true', 'DELETE');

  const normalizedCurriculum = curriculum.map((row, index) => ({
    level: String(row.level || '').toUpperCase(),
    path_from: String(row.path_from || 'A1').toUpperCase(),
    path_to: String(row.path_to || row.level || 'A1').toUpperCase(),
    track: String(row.track || 'core').toLowerCase(),
    ordinal: Number(row.ordinal ?? index + 1),
    title: String(row.title || '').trim(),
    description: String(row.description || '').trim(),
    estimated_lessons: Math.max(1, Number(row.estimated_lessons || 1)),
    unit_code: row.unit_code ? String(row.unit_code).trim() : null,
    source_file: row.source_file ? String(row.source_file).trim() : null,
    is_active: true,
  }));

  if (normalizedCurriculum.length) {
    await restRequest('/study_curriculum', 'POST', normalizedCurriculum);
  }

  await restRequest('/study_tariffs?level=not.is.null', 'DELETE');
  if (tariffs.length) {
    const normalizedTariffs = tariffs.map((row) => ({
      level: String(row.level || '').toUpperCase(),
      price_per_lesson: Number(row.price_per_lesson || 1500),
      currency: String(row.currency || 'RUB').toUpperCase(),
    }));

    await restRequest('/study_tariffs', 'POST', normalizedTariffs);
  }

  const verifyCurriculum = await restRequest('/study_curriculum?select=id,path_from,path_to,track&is_active=eq.true', 'GET');
  const verifyTariffs = await restRequest('/study_tariffs?select=level,price_per_lesson,currency', 'GET');

  console.log(`Imported active curriculum rows: ${verifyCurriculum.length}`);
  console.log(`Imported tariffs rows: ${verifyTariffs.length}`);
  console.log('Done');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
