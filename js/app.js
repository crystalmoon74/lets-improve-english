import * as store from './store.js';
import { recordingSupported, unsupportedReason, startRecording, extensionFor } from './recorder.js';

const LEVELS = {
  beginner: { label: 'Beginner', ko: '초급', desc: 'Engoo 레벨 4–5 · 짧고 쉬운 기사' },
  intermediate: { label: 'Intermediate', ko: '중급', desc: 'Engoo 레벨 6 · 일상 시사 기사' },
  advanced: { label: 'Advanced', ko: '고급', desc: 'Engoo 레벨 7–9 · 깊이 있는 기사' },
};

const app = document.getElementById('app');
let data = { updatedAt: null, articles: [] };
let activeRecording = null; // { key, handle, timer }
const player = new Audio();

// ---------- helpers ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Engoo marks titles/quotes with _underscores_; render those as italics.
const rich = (s = '') => esc(s).replace(/_([^_]+)_/g, '<em>$1</em>');
const plain = (s = '') => s.replace(/_([^_]+)_/g, '$1');
// Engoo's originals can be 6000px wide; use their resizing CDN to keep mobile data low.
const img = (url, w) => (url ? `https://transcode-v2.app.engoo.com/image/fetch/f_auto,c_lfill,w_${w},dpr_2/${url}` : '');

function relDate(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  return `${days}일 전`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2600);
}

const byLevel = (level) => data.articles.filter((a) => a.level === level);
const findArticle = (id) => data.articles.find((a) => a.id === id);

function progressOf(article) {
  const p = store.peekProgress(article.id);
  const vocabDone = article.vocab.filter((v) => p.vocab[v.word]).length;
  const answered = article.questions.filter((_, i) => p.answers[i]).length;
  const total = 1 + article.vocab.length + article.questions.length;
  const done = (p.readingDone ? 1 : 0) + vocabDone + answered;
  return { reading: p.readingDone, vocabDone, vocabTotal: article.vocab.length, answered, qTotal: article.questions.length, pct: Math.round((done / total) * 100) };
}

function playUrl(url) {
  if (!url) return;
  player.pause();
  player.src = url;
  player.play().catch(() => toast('오디오를 재생할 수 없어요.'));
}

// ---------- shell ----------
function updateChrome(tab) {
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const badge = document.getElementById('levelBadge');
  const level = store.getLevel();
  badge.hidden = !level;
  if (level) badge.textContent = `${LEVELS[level].label} ▾`;
  const due = store.dueCount();
  const dot = document.getElementById('dueCount');
  dot.hidden = !due;
  dot.textContent = due;
}

function route() {
  stopActiveRecording(true);
  player.pause();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const level = store.getLevel();
  window.scrollTo(0, 0);

  if (!level || parts[0] === 'level') return renderLevelPicker();
  if (parts[0] === 'article' && parts[1]) return renderArticle(parts[1], parts[2] || 'reading');
  if (parts[0] === 'articles') return renderArticles();
  if (parts[0] === 'words') return renderWords(parts[1] || 'study');
  return renderHome();
}

// ---------- level picker ----------
function renderLevelPicker() {
  updateChrome('');
  const current = store.getLevel();
  app.innerHTML = `
    <section class="hero">
      <h1>현재 영어 레벨을 선택하세요</h1>
      <p class="muted">선택한 레벨에 맞춰 Engoo Daily News 기사를 매일 추천해 드려요. 언제든 바꿀 수 있어요.</p>
    </section>
    <div class="level-list">
      ${Object.entries(LEVELS).map(([key, l]) => `
        <button class="level-card ${current === key ? 'selected' : ''}" data-action="set-level" data-level="${key}">
          <span class="level-name">${l.label}</span>
          <span class="level-ko">${l.ko}</span>
          <span class="muted small">${l.desc}</span>
        </button>`).join('')}
    </div>`;
}

// ---------- home ----------
function articleCard(a, { big = false } = {}) {
  const pr = progressOf(a);
  return `
    <a class="card article-card ${big ? 'big' : ''}" href="#/article/${a.id}">
      ${a.image ? `<img src="${esc(img(a.image, big ? 720 : 300))}" alt="" loading="lazy">` : ''}
      <div class="card-body">
        <div class="meta"><span class="chip lv">Lv.${a.contentLevel}</span><span class="muted small">${relDate(a.publishedAt)}</span></div>
        <h3>${rich(a.title)}</h3>
        ${big ? `<p class="muted small clamp">${esc(a.intro)}</p>` : ''}
        <div class="status-row">
          <span class="chip ${pr.reading ? 'ok' : ''}">Reading ${pr.reading ? '완료' : '미완료'}</span>
          <span class="chip ${pr.vocabDone === pr.vocabTotal ? 'ok' : ''}">단어 ${pr.vocabDone}/${pr.vocabTotal}</span>
          <span class="chip ${pr.answered === pr.qTotal ? 'ok' : ''}">Discussion ${pr.answered}/${pr.qTotal}</span>
        </div>
        <div class="bar"><i style="width:${pr.pct}%"></i></div>
      </div>
    </a>`;
}

function renderHome() {
  updateChrome('home');
  const level = store.getLevel();
  const list = byLevel(level);
  const today = list[0];
  const due = store.dueCount();
  app.innerHTML = `
    <section class="hero">
      <p class="muted small">${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
      <h1>오늘의 추천 기사 <span class="chip lv">${LEVELS[level].label}</span></h1>
    </section>
    ${due ? `<a class="notice" href="#/words">🔁 오늘 공부할 단어가 <b>${due}개</b> 있어요 →</a>` : ''}
    ${today ? articleCard(today, { big: true }) : `<p class="empty">아직 기사가 없어요. <code>npm run fetch</code>로 기사를 가져와 주세요.</p>`}
    ${list.length > 1 ? `
      <h2 class="section-title">최근 ${LEVELS[level].label} 기사</h2>
      <div class="grid">${list.slice(1, 5).map((a) => articleCard(a)).join('')}</div>
      <a class="btn ghost block" href="#/articles">기사 더 보기</a>` : ''}
    ${data.updatedAt ? `<p class="muted tiny center">기사 업데이트: ${new Date(data.updatedAt).toLocaleString('ko-KR')} · 출처 Engoo Daily News</p>` : ''}`;
}

function renderArticles() {
  updateChrome('articles');
  const level = store.getLevel();
  app.innerHTML = `
    <h1 class="page-title">기사 목록</h1>
    <div class="seg" role="tablist">
      ${Object.entries(LEVELS).map(([k, l]) => `<button role="tab" class="${k === level ? 'on' : ''}" data-action="set-level" data-level="${k}" data-stay="1">${l.label}</button>`).join('')}
    </div>
    <div class="grid">${byLevel(level).map((a) => articleCard(a)).join('') || '<p class="empty">기사가 없어요.</p>'}</div>`;
}

// ---------- article ----------
function renderArticle(id, tab) {
  updateChrome('articles');
  const a = findArticle(id);
  if (!a) {
    app.innerHTML = `<p class="empty">기사를 찾을 수 없어요. 목록이 업데이트되어 사라졌을 수 있어요.</p><a class="btn block" href="#/">홈으로</a>`;
    return;
  }
  const pr = progressOf(a);
  const tabs = [
    ['reading', `Reading ${pr.reading ? '✓' : ''}`],
    ['vocab', `Vocabulary ${pr.vocabDone}/${pr.vocabTotal}`],
    ['discussion', `Discussion ${pr.answered}/${pr.qTotal}`],
  ];
  app.innerHTML = `
    <a class="back" href="#/">← 홈</a>
    <article class="article-head">
      ${a.image ? `<img src="${esc(img(a.image, 720))}" alt="">` : ''}
      <div class="meta"><span class="chip lv">${LEVELS[a.level].label} · Lv.${a.contentLevel}</span><span class="muted small">${fmtDate(a.publishedAt)}</span>
        <a class="small" href="${esc(a.url)}" target="_blank" rel="noopener">Engoo에서 보기 ↗</a></div>
      <h1>${rich(a.title)}</h1>
    </article>
    <div class="seg sticky" role="tablist">
      ${tabs.map(([k, label]) => `<a role="tab" class="${k === tab ? 'on' : ''}" href="#/article/${a.id}/${k}">${label}</a>`).join('')}
    </div>
    <div id="pane"></div>`;
  const pane = document.getElementById('pane');
  if (tab === 'vocab') renderVocab(pane, a);
  else if (tab === 'discussion') renderDiscussion(pane, a);
  else renderReading(pane, a);
  hydrateRecorders();
}

function renderReading(pane, a) {
  const p = store.peekProgress(a.id);
  pane.innerHTML = `
    <div class="card pad">
      <div class="row between">
        <h2>Reading</h2>
        <span class="chip ${p.readingDone ? 'ok' : ''}">${p.readingDone ? '✓ 완료' : '미완료'}</span>
      </div>
      <p class="muted small">기사를 소리 내어 읽으며 녹음하세요. 녹음을 마치면 Reading이 <b>완료</b>로 표시돼요. 문장을 누르면 원어민 발음을 들을 수 있어요.</p>
    </div>
    ${recorderBlock(`${a.id}:reading`, '읽기 녹음', { sticky: true })}
    <div class="card pad article-text">
      ${a.paragraphs.map((para) => `
        ${para.heading ? `<h3>${rich(para.heading)}</h3>` : ''}
        <p>${para.sentences.map((s) => `<span class="sent" data-action="play" data-src="${esc(s.audio)}">${rich(s.text)}</span>`).join(' ')}</p>`).join('')}
    </div>`;
}

function renderVocab(pane, a) {
  const p = store.peekProgress(a.id);
  pane.innerHTML = `
    <div class="card pad">
      <h2>Vocabulary</h2>
      <p class="muted small">아는 단어인지 체크하세요. <b>모르는 단어</b>는 단어장에 추가되어 5번씩 3차(1주 간격)까지 복습해요.</p>
    </div>
    ${a.vocab.map((v, i) => {
      const mark = p.vocab[v.word];
      return `
      <div class="card pad vocab ${mark ? `marked-${mark}` : ''}">
        <div class="row between wrap">
          <div>
            <button class="word" data-action="play" data-src="${esc(v.audio)}">${esc(v.word)} 🔊</button>
            <span class="muted small">${esc(v.pos)} ${v.pron ? `· /${esc(v.pron)}/` : ''}</span>
          </div>
        </div>
        <p class="def">${esc(v.definition)}</p>
        ${v.ko ? `<p class="ko">${esc(v.ko)}</p>` : ''}
        ${v.examples.map((ex) => `<p class="example" data-action="play" data-src="${esc(ex.audio)}">“${rich(ex.text)}” <span class="muted">🔊</span></p>`).join('')}
        <div class="mark-row">
          <button class="btn ${mark === 'known' ? 'on-known' : 'ghost'}" data-action="mark-word" data-id="${a.id}" data-i="${i}" data-mark="known">✓ 아는 단어</button>
          <button class="btn ${mark === 'unknown' ? 'on-unknown' : 'ghost'}" data-action="mark-word" data-id="${a.id}" data-i="${i}" data-mark="unknown">✗ 모르는 단어</button>
        </div>
      </div>`;
    }).join('')}
    <a class="btn ghost block" href="#/words">내 단어장 보기 →</a>`;
}

function renderDiscussion(pane, a) {
  const p = store.peekProgress(a.id);
  pane.innerHTML = `
    <div class="card pad">
      <h2>Discussion</h2>
      <p class="muted small">Discussion과 Further Discussion에서 고른 질문 3개예요. 각 질문에 영어로 답하며 녹음해 보세요.</p>
    </div>
    ${a.questions.map((q, i) => `
      <div class="card pad question">
        <div class="row between">
          <span class="chip">${esc(q.section)}</span>
          <span class="chip ${p.answers[i] ? 'ok' : ''}">${p.answers[i] ? '✓ 답변 완료' : '미답변'}</span>
        </div>
        <p class="q"><b>Q${i + 1}.</b> ${rich(q.text)}</p>
        ${recorderBlock(`${a.id}:q${i}`, '답변 녹음', { inline: true })}
      </div>`).join('')}
    <details class="card pad">
      <summary>전체 질문 보기</summary>
      <h3>Discussion</h3><ol>${a.discussion.map((q) => `<li>${rich(q)}</li>`).join('')}</ol>
      <h3>Further Discussion</h3><ol>${a.furtherDiscussion.map((q) => `<li>${rich(q)}</li>`).join('')}</ol>
    </details>`;
}

// ---------- recorder widget ----------
function recorderBlock(key, label, { sticky = false, inline = false } = {}) {
  if (!recordingSupported()) return `<div class="card pad warn small">${unsupportedReason()}</div>`;
  return `
    <div class="recorder ${sticky ? 'sticky-rec' : ''} ${inline ? 'inline' : 'card pad'}" data-rec="${esc(key)}">
      <div class="rec-controls">
        <button class="btn rec" data-action="rec-toggle" data-key="${esc(key)}"><span class="rec-dot"></span><span class="rec-label" data-base="${esc(label)}">${label}</span></button>
        <span class="rec-time" hidden>0:00</span>
      </div>
      <div class="rec-saved" hidden></div>
    </div>`;
}

async function hydrateRecorders() {
  for (const el of app.querySelectorAll('[data-rec]')) {
    const rec = await store.getRecording(el.dataset.rec);
    showSaved(el, rec);
  }
}

function showSaved(el, rec) {
  const box = el.querySelector('.rec-saved');
  if (box.dataset.url) URL.revokeObjectURL(box.dataset.url);
  if (!rec) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const url = URL.createObjectURL(rec.blob);
  box.dataset.url = url;
  box.hidden = false;
  box.innerHTML = `
    <audio controls preload="metadata" src="${url}"></audio>
    <div class="row between small muted">
      <span>${fmtDate(rec.createdAt)} 녹음 · ${fmtTime(rec.duration)}</span>
      <span class="row gap">
        <a href="${url}" download="${esc(el.dataset.rec.replace(':', '-'))}.${extensionFor(rec.mime)}">저장</a>
        <button class="link danger" data-action="rec-delete" data-key="${esc(el.dataset.rec)}">삭제</button>
      </span>
    </div>`;
  const label = el.querySelector('.rec-label');
  label.textContent = `다시 ${label.dataset.base}`;
}

function recEl(key) {
  return app.querySelector(`[data-rec="${CSS.escape(key)}"]`);
}

async function toggleRecording(key) {
  if (activeRecording?.key === key) return stopActiveRecording(false);
  stopActiveRecording(true);
  const el = recEl(key);
  try {
    player.pause();
    const handle = await startRecording();
    const btn = el.querySelector('.rec');
    const time = el.querySelector('.rec-time');
    btn.classList.add('recording');
    btn.dataset.prevLabel = btn.querySelector('.rec-label').textContent;
    btn.querySelector('.rec-label').textContent = '녹음 중지';
    time.hidden = false;
    const timer = setInterval(() => (time.textContent = fmtTime((Date.now() - handle.startedAt) / 1000)), 250);
    activeRecording = { key, handle, timer };
  } catch (e) {
    console.warn(e);
    toast(e.name === 'NotAllowedError' ? '마이크 권한을 허용해 주세요.' : '마이크를 사용할 수 없어요.');
  }
}

async function stopActiveRecording(discard) {
  if (!activeRecording) return;
  const { key, handle, timer } = activeRecording;
  activeRecording = null;
  clearInterval(timer);
  const el = recEl(key);
  if (el) {
    const btn = el.querySelector('.rec');
    btn.classList.remove('recording');
    btn.querySelector('.rec-label').textContent = btn.dataset.prevLabel;
    el.querySelector('.rec-time').hidden = true;
  }
  if (discard) return handle.cancel();

  const rec = await handle.stop();
  if (rec.duration < 1 || !rec.blob.size) return toast('녹음이 너무 짧아요. 다시 시도해 주세요.');
  await store.saveRecording(key, rec);
  const [articleId, part] = key.split(':');
  if (part === 'reading') {
    store.markReadingDone(articleId);
    toast('✓ Reading 완료! 녹음이 저장됐어요.');
  } else {
    store.markAnswered(articleId, Number(part.slice(1)), true);
    toast('✓ 답변이 저장됐어요.');
  }
  route();
}

// ---------- words ----------
function stageLabel(w) {
  const done = w.completed.map((c) => `${c.round}차`).join('·');
  if (w.mastered) return { text: '3차 공부 완료', cls: 'ok' };
  if (store.wordStage(w) === 'waiting') {
    const days = Math.ceil((w.dueAt - Date.now()) / 86400000);
    return { text: `${w.round - 1}차 공부 완료 · ${w.round}차 복습 D-${days}`, cls: 'wait' };
  }
  return { text: `${w.round}차 공부 중${done ? ` (${done} 완료)` : ''}`, cls: 'now' };
}

function wordCard(w) {
  const key = store.wordKey(w.word);
  const stage = store.wordStage(w);
  const st = stageLabel(w);
  const checks = w.mastered ? '' : `
    <div class="checks ${stage !== 'due' ? 'disabled' : ''}">
      <span class="small muted">${w.round}차 학습</span>
      ${w.checks.map((c, i) => `<label class="check"><input type="checkbox" ${c ? 'checked' : ''} ${stage !== 'due' ? 'disabled' : ''} data-action="check" data-key="${esc(key)}" data-i="${i}"><span>${i + 1}</span></label>`).join('')}
    </div>`;
  return `
    <div class="card pad word-card">
      <div class="row between wrap">
        <button class="word" data-action="play" data-src="${esc(w.audio)}">${esc(w.word)} 🔊</button>
        <span class="chip ${st.cls}">${st.text}</span>
      </div>
      <p class="def">${esc(w.definition)}</p>
      ${w.ko ? `<p class="ko">${esc(w.ko)}</p>` : ''}
      ${w.example ? `<p class="example" data-action="play" data-src="${esc(w.exampleAudio)}">“${rich(w.example)}” <span class="muted">🔊</span></p>` : ''}
      ${checks}
      <div class="row between tiny muted">
        <span>${findArticle(w.articleId) ? `<a href="#/article/${w.articleId}/vocab">${esc(plain(w.articleTitle))}</a>` : esc(plain(w.articleTitle))}</span>
        <button class="link danger" data-action="remove-word" data-key="${esc(key)}">삭제</button>
      </div>
    </div>`;
}

function renderWords(tab) {
  updateChrome('words');
  const words = store.allWords().sort((a, b) => a.dueAt - b.dueAt);
  const groups = {
    study: words.filter((w) => store.wordStage(w) === 'due'),
    waiting: words.filter((w) => store.wordStage(w) === 'waiting'),
    mastered: words.filter((w) => w.mastered),
  };
  const tabs = [['study', '지금 공부', groups.study.length], ['waiting', '복습 대기', groups.waiting.length], ['mastered', '완료', groups.mastered.length]];
  const list = groups[tab] ?? groups.study;

  let body;
  if (tab === 'study' || !groups[tab]) {
    body = [1, 2, 3].map((r) => {
      const ws = list.filter((w) => w.round === r);
      if (!ws.length) return '';
      return `<h2 class="section-title">${r}차 ${r === 1 ? '단어 공부' : '단어 복습'} <span class="muted small">${ws.length}개</span></h2>${ws.map(wordCard).join('')}`;
    }).join('');
  } else {
    body = list.map(wordCard).join('');
  }

  app.innerHTML = `
    <h1 class="page-title">단어장</h1>
    <p class="muted small">모르는 단어를 5번 공부하고 체크하면 <b>1차 공부 완료</b>! 1주 뒤 2차, 또 1주 뒤 3차 복습이 열려요.</p>
    <div class="seg" role="tablist">
      ${tabs.map(([k, label, n]) => `<a role="tab" class="${k === tab ? 'on' : ''}" href="#/words/${k}">${label} ${n}</a>`).join('')}
    </div>
    ${body || `<p class="empty">${tab === 'study' ? '지금 공부할 단어가 없어요. 기사의 Vocabulary에서 모르는 단어를 체크해 보세요.' : '단어가 없어요.'}</p>`}`;
}

// ---------- events ----------
app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action]');
  if (!t || t.dataset.action === 'check') return;
  const { action } = t.dataset;
  if (action === 'set-level') {
    store.setLevel(t.dataset.level);
    if (t.dataset.stay) return route();
    location.hash = '#/';
    if (location.hash === '#/') route();
  } else if (action === 'play') {
    playUrl(t.dataset.src);
  } else if (action === 'mark-word') {
    const a = findArticle(t.dataset.id);
    const v = a.vocab[Number(t.dataset.i)];
    store.markWord(a, v, t.dataset.mark);
    if (t.dataset.mark === 'unknown') toast(`“${v.word}” 단어장에 추가했어요.`);
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  } else if (action === 'rec-toggle') {
    toggleRecording(t.dataset.key);
  } else if (action === 'rec-delete') {
    if (!confirm('이 녹음을 삭제할까요?')) return;
    await store.deleteRecording(t.dataset.key);
    const [articleId, part] = t.dataset.key.split(':');
    if (part !== 'reading') store.markAnswered(articleId, Number(part.slice(1)), false);
    route();
  } else if (action === 'remove-word') {
    if (!confirm('단어장에서 삭제할까요?')) return;
    store.removeWord(t.dataset.key);
    route();
  }
});

app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.action !== 'check') return;
  const ev = store.toggleCheck(t.dataset.key, Number(t.dataset.i));
  if (ev) {
    toast(ev.completedRound === 3 ? '🎉 3차까지 모두 완료! 완벽하게 외웠어요.' : `✓ ${ev.completedRound}차 공부 완료! 1주 뒤 ${ev.completedRound + 1}차 복습이 열려요.`);
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  } else {
    updateChrome('words');
  }
});

document.getElementById('levelBadge').addEventListener('click', () => (location.hash = '#/level'));
window.addEventListener('hashchange', route);

// ---------- boot ----------
async function boot() {
  app.innerHTML = '<p class="empty">불러오는 중…</p>';
  try {
    const res = await fetch('data/articles.json', { cache: 'no-cache' });
    data = await res.json();
  } catch (e) {
    console.error(e);
    app.innerHTML = '<p class="empty">기사 데이터를 불러오지 못했어요.</p>';
    return;
  }
  route();
}

boot();
