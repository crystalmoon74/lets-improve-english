// Fetches recent Engoo Daily News articles and writes a simplified data/articles.json.
// Engoo's API has no CORS headers, so the browser app cannot call it directly;
// this script runs locally (npm run fetch) or daily in GitHub Actions.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.engoo.com/api';
const DAILY_NEWS_CATEGORY = '0225ae09-5d63-41c2-bd75-693985d07d78';
const ENGOO_BRAND = '5a4657f2-e151-4c48-9cce-000000000002';
const PER_LEVEL = 10;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'articles.json');

// Engoo content levels (1-10) mapped to the app's three levels.
// Daily News has almost no level 1-3 articles, so Beginner takes the easiest available (≤5).
export function appLevel(contentLevel) {
  if (contentLevel <= 5) return 'beginner';
  if (contentLevel === 6) return 'intermediate';
  return 'advanced';
}

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (lets-improve-english)' } });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

// Engoo responses replace repeated objects with {_ref: key}; inline them.
function resolver(references) {
  const resolve = (v, depth = 0) => {
    if (depth > 30 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => resolve(x, depth + 1));
    if (v._ref && Object.keys(v).length === 1) return resolve(references[v._ref], depth + 1);
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = resolve(x, depth + 1);
    return out;
  };
  return resolve;
}

function uuidToShortId(uuid) {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
}

function slugify(title) {
  return title.toLowerCase().replace(/['’_]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const text = (t) => (t?.text ?? '').trim();

// Picks 3 open-ended questions: 2 from Discussion, 1 from Further Discussion
// (falls back to whichever list has more if one is short).
function pickQuestions(discussion, further) {
  const score = (q) => {
    let s = Math.min(q.length, 140) / 10;
    if (/^(why|how|what)\b/i.test(q)) s += 6;
    if (/\b(do you think|would you|your (thoughts|opinion)|in your country|if you)\b/i.test(q)) s += 5;
    if (/^(do|does|did|are|is|have|has)\s+you\s+(know|have)\b/i.test(q)) s -= 3;
    return s;
  };
  const best = (list, n) => [...list].sort((a, b) => score(b) - score(a)).slice(0, n);
  let picks = [...best(discussion, 2).map((q) => ({ q, from: 'Discussion' })), ...best(further, 1).map((q) => ({ q, from: 'Further Discussion' }))];
  if (picks.length < 3) {
    const rest = [...discussion.map((q) => ({ q, from: 'Discussion' })), ...further.map((q) => ({ q, from: 'Further Discussion' }))]
      .filter((x) => !picks.some((p) => p.q === x.q));
    picks = picks.concat(rest.sort((a, b) => score(b.q) - score(a.q)).slice(0, 3 - picks.length));
  }
  return picks.map((p) => ({ text: p.q, section: p.from }));
}

function simplifyLesson(lesson, header) {
  const vocab = [];
  const paragraphs = [];
  const discussion = [];
  const further = [];

  for (const ex of lesson.exercises ?? []) {
    const title = text(ex.title_text).toLowerCase();
    for (const sec of ex.sections ?? []) {
      if (sec._type === 'VocabSection') {
        for (const vw of sec.vocab_section_words ?? []) {
          const w = vw.word ?? vw.local_word;
          if (!w) continue;
          vocab.push({
            word: w.word,
            pos: w.part_of_speech ?? '',
            pron: (w.pronunciations ?? [])[0] ?? '',
            definition: w.definition ?? '',
            ko: (w.translations ?? []).find((t) => t.language === 'ko')?.translations?.join(', ') ?? '',
            audio: w.sound?.url ?? '',
            examples: (vw.vocab_section_word_sentences ?? [])
              .map((s) => s.word_sentence?.sentence ?? s.local_sentence ?? s.global_sentence)
              .filter(Boolean)
              .map((s) => ({ text: s.text, audio: s.sound?.url ?? '' })),
          });
        }
      } else if (sec._type === 'ArticleSection') {
        for (const p of sec.paragraphs ?? []) {
          const sentences = (p.paragraph_sentences ?? []).map((s) => ({ text: text(s.text), audio: s.sound?.url ?? '' }));
          if (sentences.length) paragraphs.push({ heading: text(p.title_text), sentences });
        }
      } else if (sec._type === 'QuestionSection') {
        const qs = (sec.questions ?? []).map((q) => text(q.text)).filter(Boolean);
        if (title.startsWith('further')) further.push(...qs);
        else if (title.startsWith('discussion')) discussion.push(...qs);
      }
    }
  }

  const title = text(header.title_text);
  return {
    id: header.master_id,
    title,
    intro: text(header.introduction_text),
    image: header.image?.url ?? '',
    contentLevel: header.content_level,
    level: appLevel(header.content_level),
    publishedAt: header.first_published_at,
    url: `https://engoo.com/app/daily-news/article/${slugify(title)}/${uuidToShortId(header.master_id)}`,
    paragraphs,
    vocab,
    discussion,
    furtherDiscussion: further,
    questions: pickQuestions(discussion, further),
  };
}

async function main() {
  const params = new URLSearchParams({
    category: DAILY_NEWS_CATEGORY, for_brand: ENGOO_BRAND, direction: 'desc', order: 'last_published_at',
    min_level: '1', max_level: '10', page_size: '120', published_latest: 'true', start: '0', type: 'Published',
  });
  const list = await getJson(`${API}/lesson_headers?${params}`);
  const headers = list.data.map(resolver(list.references));

  const chosen = { beginner: [], intermediate: [], advanced: [] };
  for (const h of headers) {
    const bucket = chosen[appLevel(h.content_level)];
    if (bucket.length < PER_LEVEL) bucket.push(h);
  }

  const articles = [];
  for (const h of Object.values(chosen).flat()) {
    try {
      const res = await getJson(`${API}/lessons/${h.master_id}/current`);
      const article = simplifyLesson(resolver(res.references)(res.data), h);
      if (article.paragraphs.length) articles.push(article);
      console.log(`✓ [${article.level}] ${article.title}`);
    } catch (e) {
      console.warn(`✗ ${text(h.title_text)}: ${e.message}`);
    }
  }
  articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), articles }, null, 1));
  console.log(`Wrote ${articles.length} articles to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
