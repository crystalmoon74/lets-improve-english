// Progress lives in localStorage; audio recordings (Blobs) live in IndexedDB.
const KEY = 'lie.state.v1';
const DAY = 24 * 60 * 60 * 1000;
export const REVIEW_INTERVAL = 7 * DAY;
export const CHECKS_PER_ROUND = 5;
export const ROUNDS = 3;

const blank = () => ({ level: null, articles: {}, words: {} });

let state = load();

function load() {
  try {
    return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return blank();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save progress', e);
  }
}

export const getLevel = () => state.level;
export function setLevel(level) {
  state.level = level;
  save();
}

export function articleProgress(id) {
  return (state.articles[id] ??= { readingDone: false, vocab: {}, answers: {} });
}

// Read-only view for rendering lists, so browsing doesn't create empty entries.
export const peekProgress = (id) => state.articles[id] ?? { readingDone: false, vocab: {}, answers: {} };

export function markReadingDone(id) {
  const p = articleProgress(id);
  p.readingDone = true;
  p.readingAt = Date.now();
  save();
}

export function markAnswered(id, qIndex, answered) {
  const p = articleProgress(id);
  if (answered) p.answers[qIndex] = Date.now();
  else delete p.answers[qIndex];
  save();
}

export const wordKey = (word) => word.toLowerCase().trim();

// mark: 'known' | 'unknown'. Unknown words join the study list at round 1.
export function markWord(article, vocab, mark) {
  const p = articleProgress(article.id);
  p.vocab[vocab.word] = mark;
  const key = wordKey(vocab.word);
  if (mark === 'unknown' && !state.words[key]) {
    state.words[key] = {
      word: vocab.word,
      pos: vocab.pos,
      pron: vocab.pron,
      definition: vocab.definition,
      ko: vocab.ko,
      audio: vocab.audio,
      example: vocab.examples[0]?.text ?? '',
      exampleAudio: vocab.examples[0]?.audio ?? '',
      articleId: article.id,
      articleTitle: article.title,
      addedAt: Date.now(),
      round: 1,
      checks: Array(CHECKS_PER_ROUND).fill(false),
      completed: [], // [{round, at}]
      dueAt: Date.now(),
      mastered: false,
    };
  } else if (mark === 'known') {
    const w = state.words[key];
    // Only drop it if the user hasn't started studying it yet.
    if (w && w.round === 1 && !w.checks.some(Boolean) && w.articleId === article.id) delete state.words[key];
  }
  save();
}

export const allWords = () => Object.values(state.words);
export const getWord = (key) => state.words[key];

// Stage of a word for display: learning in round N now, waiting for round N, or mastered.
export function wordStage(w, now = Date.now()) {
  if (w.mastered) return 'mastered';
  return w.dueAt <= now ? 'due' : 'waiting';
}

// Toggling the last of the 5 checkboxes completes the round and schedules the next one a week later.
export function toggleCheck(key, i) {
  const w = state.words[key];
  if (!w || w.mastered || wordStage(w) !== 'due') return null;
  w.checks[i] = !w.checks[i];
  let event = null;
  if (w.checks.every(Boolean)) {
    w.completed.push({ round: w.round, at: Date.now() });
    event = { completedRound: w.round };
    if (w.round >= ROUNDS) {
      w.mastered = true;
    } else {
      w.round += 1;
      w.checks = Array(CHECKS_PER_ROUND).fill(false);
      w.dueAt = Date.now() + REVIEW_INTERVAL;
    }
  }
  save();
  return event;
}

export function removeWord(key) {
  delete state.words[key];
  save();
}

export const dueCount = () => allWords().filter((w) => wordStage(w) === 'due').length;

// ---------- IndexedDB recordings ----------
let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('lie-recordings', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('recordings', mode);
    const req = fn(t.objectStore('recordings'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const saveRecording = (key, rec) => tx('readwrite', (s) => s.put(rec, key));
export const getRecording = (key) => tx('readonly', (s) => s.get(key)).catch(() => undefined);
export const deleteRecording = (key) => tx('readwrite', (s) => s.delete(key));
