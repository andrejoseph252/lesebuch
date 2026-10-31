// Wiederholung: FSRS review session over cards built from your own words and exercise mistakes.
import { h, icon, genderClass, fmtInterval, shuffle, startOfDay } from './ui.js';
import * as db from './db.js';
import { createScheduler } from './fsrs.js';
import { settings } from './settings.js';
import { clozeSpan, listChapters, chapterFor } from './model.js';
import { grade, suggestRating, verdictText, diffChars } from './grade.js';
import { speak, ttsSupported } from './tts.js';
import { logActivity } from './reread.js';

const TYPE_KEY = { cloze: 'cloze', gender: 'gender', plural: 'plural', error: 'error' };
const TYPE_LABEL = { cloze: 'Lückensatz', gender: 'Genus', plural: 'Plural', error: 'Fehlerkarte' };
const RATINGS = [[1, 'Nochmal'], [2, 'Schwer'], [3, 'Gut'], [4, 'Leicht']];

/** Cards to study now: due reviews + today's allowance of new cards, interleaved. */
export async function dueQueue(now = Date.now()) {
  const cards = (await db.all('cards')).filter((c) => settings.cardTypes[TYPE_KEY[c.type]] !== false && !c.suspended);
  const due = cards.filter((c) => c.state !== 'new' && c.due <= now);
  const today = (await db.byIndex('reviewLog', 'ts', IDBKeyRange.lowerBound(startOfDay(now)))).filter((l) => l.wasNew).length;
  const fresh = cards.filter((c) => c.state === 'new').sort((a, b) => a.created - b.created).slice(0, Math.max(0, settings.newPerDay - today));
  return interleave([...due, ...fresh]);
}

/** Shuffle, then avoid two cards of the same type or source in a row where possible. */
function interleave(list) {
  const pool = shuffle([...list]);
  const out = [];
  while (pool.length) {
    const prev = out[out.length - 1];
    let k = pool.findIndex((c) => !prev || (c.type !== prev.type && c.ref !== prev.ref));
    if (k < 0) k = 0;
    out.push(pool.splice(k, 1)[0]);
  }
  return out;
}

export async function renderReview(view) {
  const scheduler = createScheduler({ retention: settings.retention });
  const queue = await dueQueue();
  const chapters = await listChapters();
  const waiting = []; // "Nochmal" cards, back after ~10 minutes
  let done = 0;
  const total = queue.length;

  const bar = h('i');
  const count = h('span', { class: 'small' });
  const stage = h('div');
  view.append(h('div', { class: 'review-top', style: { marginTop: '12px' } },
    h('a', { class: 'iconbtn', href: '#/ueben', 'aria-label': 'Beenden', html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }),
    h('div', { class: 'progress' }, bar), count), stage);

  const next = async () => {
    bar.style.width = `${total ? (done / (total + waiting.length || 1)) * 100 : 100}%`;
    let card = queue.shift();
    if (!card && waiting.length) {
      waiting.sort((a, b) => a.due - b.due);
      if (waiting[0].due <= Date.now()) card = waiting.shift();
      else {
        const w = waiting[0];
        stage.replaceChildren(h('div', { class: 'card center' },
          h('h3', {}, 'Kurze Pause'),
          h('p', { class: 'sub' }, `${waiting.length} Karte(n) kommen in ${fmtInterval(w.due - Date.now())} wieder.`),
          h('div', { class: 'row', style: { justifyContent: 'center' } },
            h('a', { class: 'btn', href: '#/heute' }, 'Fertig für jetzt'),
            h('button', { class: 'btn primary', onclick: () => { queue.push(...waiting.splice(0)); next(); } }, 'Jetzt wiederholen'))));
        return;
      }
    }
    count.textContent = `${done} / ${total}`;
    if (!card) {
      bar.style.width = '100%';
      stage.replaceChildren(h('div', { class: 'card center' },
        h('h3', {}, total ? 'Geschafft!' : 'Nichts fällig'),
        h('p', { class: 'sub' }, total ? `${done} Karten wiederholt.` : 'Tippe beim Lesen auf Wörter und füge sie hinzu – daraus entstehen deine Karten.'),
        h('div', { class: 'row', style: { justifyContent: 'center' } }, h('a', { class: 'btn primary', href: '#/heute' }, 'Zur Übersicht'))));
      return;
    }
    const content = await cardView(card, chapters);
    if (!content) { await db.del('cards', card.id); return next(); } // source was deleted
    stage.replaceChildren(content.el);
    content.focus?.();

    content.onRate = async (rating) => {
      const wasNew = card.state === 'new';
      Object.assign(card, scheduler.next(card, rating));
      await db.put('cards', card);
      await db.put('reviewLog', { ts: Date.now(), cardId: card.id, type: card.type, rating, wasNew });
      await logActivity();
      if (rating === 1) waiting.push(card); else done++;
      next();
    };
    content.preview = scheduler.preview(card);
    content.ready?.();
  };
  next();
}

// ---------- card views ----------
async function cardView(card, chapters) {
  if (card.ref.startsWith('w:')) {
    const w = await db.get('words', +card.ref.slice(2));
    if (!w) return null;
    const ch = w.chapter || (w.page ? chapterFor(chapters, w.page)?.num : null);
    if (card.type === 'cloze') return clozeCard(w, ch);
    if (card.type === 'gender') return genderCard(w, ch);
    if (card.type === 'plural') return pluralCard(w, ch);
  }
  if (card.ref.startsWith('ex:')) {
    const ex = await db.get('exercises', +card.ref.slice(3));
    if (!ex) return null;
    return errorCard(ex, card.gap);
  }
  return null;
}

function shell(type, meta) {
  const el = h('div', { class: 'rcard' }, h('div', { class: 'kind' }, h('span', {}, TYPE_LABEL[type]), h('span', {}, meta || '')));
  return el;
}

/** Shared answer flow: typed answer → diff + verdict → rating buttons with a suggested choice. */
function typedFlow(api, el, input, expected, { after } = {}) {
  const res = h('div');
  const btn = h('button', { class: 'btn primary block mt' }, 'Prüfen');
  el.append(res, btn);
  const submit = () => {
    if (api.checked) return;
    api.checked = true;
    if (typeof expected === 'function') expected = expected();
    const g = grade(input.value, expected);
    input.classList.add(g.kind === 'correct' ? 'ok' : g.kind === 'wrong' ? 'bad' : 'near');
    input.readOnly = true;
    const diff = h('div', { class: 'diff' }, diffChars(input.value.trim(), expected).map((d) => (d.op === '=' ? d.s : h(d.op === '+' ? 'ins' : 'del', {}, d.s))));
    res.append(h('div', { class: `verdict ${g.kind === 'correct' ? 'ok' : g.kind === 'wrong' ? 'bad' : 'near'}` },
      h('div', {}, verdictText(g)), g.kind !== 'correct' ? h('div', { class: 'ans' }, expected) : null,
      g.kind !== 'correct' && input.value.trim() ? diff : null));
    after?.(res);
    btn.remove();
    ratings(api, el, suggestRating(g.kind));
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!api.checked) submit(); else api.commit?.(); } });
  api.focus = () => input.focus({ preventScroll: true });
}

function ratings(api, el, pre) {
  const row = h('div', { class: 'ratings' }, RATINGS.map(([r, label]) => h('button', {
    class: r === pre ? 'pre' : '', dataset: { r },
    onclick: () => api.onRate(r),
  }, label, h('small', {}, fmtInterval(api.preview[r].dueMs)))));
  el.append(row);
  api.commit = () => api.onRate(pre);
  row.querySelector('.pre')?.focus({ preventScroll: true });
  const key = (e) => {
    if (!row.isConnected) { removeEventListener('keydown', key); return; }
    if (['1', '2', '3', '4'].includes(e.key)) { removeEventListener('keydown', key); api.onRate(+e.key); }
  };
  addEventListener('keydown', key);
}

function clozeCard(w, ch) {
  const api = {};
  const el = shell('cloze', ch ? `Kapitel ${ch}` : '');
  const span = clozeSpan(w);
  const s = w.sentence;
  const input = h('input', { class: 'gap-in', 'data-de': '', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', style: { width: `${Math.max(4, span.answer.length * 0.75 + 2)}em` } });
  const sentence = h('div', { class: 'ex-sentence' }, s.slice(0, span.start), input, s.slice(span.end));
  const hint = w.meaning ? h('div', { class: 'hint' }, w.meaning) : null;
  const listen = ttsSupported && (settings.listenFirst === 'always' || (settings.listenFirst === 'sometimes' && Math.random() < 0.3));
  const speakBtn = ttsSupported ? h('button', { class: 'btn small', onclick: () => speak(s) }, icon('speaker'), 'Satz hören') : null;
  const body = h('div', {}, sentence, hint);
  typedFlow(api, body, input, span.answer, { after: (res) => speakBtn && res.append(h('div', { class: 'row mt' }, speakBtn)) });
  if (listen) {
    // listening variant: hear the sentence before seeing it
    const focus = api.focus;
    const gate = h('div', { class: 'center', style: { padding: '24px 0' } },
      h('p', { class: 'sub' }, 'Erst hören, dann lesen'),
      h('button', { class: 'btn', onclick: () => speak(s) }, icon('speaker'), 'Nochmal hören'),
      h('div', { class: 'mt' }, h('button', { class: 'btn primary', onclick: () => { gate.replaceWith(body); focus(); } }, 'Text zeigen')));
    el.append(gate);
    api.focus = () => {};
    api.ready = () => speak(s);
  } else el.append(body);
  api.el = el;
  return api;
}

function genderCard(w, ch) {
  const api = {};
  const el = shell('gender', ch ? `Kapitel ${ch}` : '');
  el.append(h('div', { class: 'lemma' }, w.lemma));
  const btns = h('div', { class: 'gender-btns' }, ['der', 'die', 'das'].map((a) => h('button', { class: genderClass(a), dataset: { a } }, a)));
  el.append(btns);
  const pick = (a) => {
    if (api.checked) return;
    api.checked = true;
    const right = a === w.article;
    btns.querySelectorAll('button').forEach((b) => {
      if (b.dataset.a === a) b.classList.add('picked', right ? 'right' : 'wrong');
      if (b.dataset.a === w.article) b.classList.add('answer');
    });
    el.append(h('div', { class: `verdict ${right ? 'ok' : 'bad'}` },
      h('div', { class: 'ans' }, h('span', { class: `art ${genderClass(w.article)}` }, w.article), ` ${w.lemma}`, w.plural ? h('span', { class: 'small' }, ` · Plural: ${w.plural}`) : null)));
    if (ttsSupported) speak(`${w.article} ${w.lemma}`);
    ratings(api, el, right ? 3 : 1);
  };
  btns.addEventListener('click', (e) => { const a = e.target.closest('button')?.dataset.a; if (a) pick(a); });
  api.focus = () => {};
  const key = (e) => { if (!el.isConnected) return removeEventListener('keydown', key); const m = { j: 'der', k: 'die', l: 'das' }[e.key]; if (m && !api.checked) pick(m); };
  addEventListener('keydown', key);
  api.el = el;
  return api;
}

function pluralCard(w, ch) {
  const api = {};
  const el = shell('plural', ch ? `Kapitel ${ch}` : '');
  el.append(h('div', { class: 'lemma' }, w.article ? h('span', { class: `art ${genderClass(w.article)}` }, `${w.article} `) : null, w.lemma));
  const input = h('input', { 'data-de': '', placeholder: 'Plural (z. B. die Häuser)', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
  el.append(h('label', { class: 'field' }, h('span', {}, 'Wie heisst der Plural?'), input));
  // accept the plural with or without its article
  const full = w.plural.trim();
  const bare = full.replace(/^die\s+/i, '');
  typedFlow(api, el, input, () => (/^die\s/i.test(input.value.trim()) ? full : bare));
  api.el = el;
  return api;
}

function errorCard(ex, gapKey) {
  const api = {};
  const el = shell('error', `Übung · S. ${ex.page}`);
  if (gapKey === 'q' || ex.type === 'answer') {
    el.append(h('div', { class: 'ex-sentence', style: { lineHeight: 1.5 } }, ex.q));
    const ta = h('textarea', { 'data-de': '', rows: 2 });
    el.append(ta);
    const show = h('button', { class: 'btn primary block mt' }, 'Antwort zeigen');
    el.append(show);
    show.addEventListener('click', () => {
      show.remove();
      el.append(h('div', { class: 'verdict near' }, h('div', {}, 'Gespeicherte Antwort'), h('div', { class: 'ans' }, ex.answer || '–')));
      ratings(api, el, 3);
    });
    api.focus = () => ta.focus({ preventScroll: true });
  } else {
    const target = ex.segs[gapKey];
    const input = h('input', { class: 'gap-in', 'data-de': '', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
    el.append(h('div', { class: 'ex-sentence' }, ex.segs.map((s, k) => (s.t === 'text' ? s.v : k === +gapKey ? input : h('span', { class: 'gapmark' }, s.answer || '…')))));
    if (target?.answer) typedFlow(api, el, input, target.answer, { after: (res) => target.explanation && res.append(h('p', { class: 'small' }, target.explanation)) });
    else {
      const show = h('button', { class: 'btn primary block mt' }, 'Prüfen');
      el.append(show);
      show.addEventListener('click', () => { show.remove(); el.append(h('div', { class: 'verdict near' }, 'Noch keine Lösung gespeichert – selbst bewerten.')); ratings(api, el, 3); });
      api.focus = () => input.focus({ preventScroll: true });
    }
  }
  api.el = el;
  return api;
}

