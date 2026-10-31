// Optional AI tutor. Calls the Anthropic Messages API straight from the browser with the
// user's own key (stored in localStorage on this device only). Everything else works without it.
import { h, sheet, toast } from './ui.js';
import * as db from './db.js';
import { settings, apiKey } from './settings.js';
import { listChapters, chapterFor } from './model.js';

const URL_ = 'https://api.anthropic.com/v1/messages';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

async function call({ system, user, schema, effort = 'low', maxTokens = 4000 }) {
  const key = apiKey.get();
  if (!key) throw new Error('Kein API-Schlüssel gesetzt (Mehr → KI-Tutor)');
  const body = {
    model: settings.aiModel || 'claude-opus-5-5',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  const send = async (withFallback) => {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const b = { ...body };
    if (withFallback) { headers['anthropic-beta'] = FALLBACK_BETA; b.fallbacks = 'default'; }
    return fetch(URL_, { method: 'POST', headers, body: JSON.stringify(b) });
  };
  let res = await send(true);
  if (res.status === 400) {
    // some models don't take server-side fallbacks: retry plainly
    const txt = await res.clone().text();
    if (/fallback/i.test(txt)) res = await send(false);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch { /* not JSON */ }
    if (res.status === 401) msg = 'API-Schlüssel ungültig';
    if (res.status === 429) msg = 'Zu viele Anfragen – bitte kurz warten';
    throw new Error(msg);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Die KI hat diese Anfrage abgelehnt.');
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!schema) return text;
  try { return JSON.parse(text); } catch { throw new Error('Antwort der KI war kein gültiges JSON'); }
}

export async function ping() {
  await call({ system: 'Antworte nur mit "ok".', user: 'Test', maxTokens: 20 });
}

// ---------- exercises ----------
export async function checkExercise(ex, given) {
  const isAnswer = ex.type === 'answer';
  const sentence = isAnswer ? ex.q : ex.segs.map((s, i) => (s.t === 'gap' ? `[LÜCKE ${ex.segs.slice(0, i).filter((x) => x.t === 'gap').length + 1}]` : s.v)).join('');
  const n = isAnswer ? 1 : ex.segs.filter((s) => s.t === 'gap').length;
  const r = await call({
    system: 'Du bist ein geduldiger Deutschlehrer für Anfänger (Lehrbuch "Deutsch nach der Naturmethode"). Erklärungen: ein kurzer Satz in einfachem Deutsch.',
    user: isAnswer
      ? `Frage aus einer Übung: "${sentence}"\nAntwort des Lernenden: "${given[0] || ''}"\nGib eine korrekte, einfache Musterantwort als ganzen Satz und eine kurze Erklärung (was am Lernenden-Satz falsch oder richtig ist).`
      : `Lückensatz aus einer Übung: "${sentence}"\nEingaben des Lernenden: ${JSON.stringify(given)}\nGib für jede der ${n} Lücken die richtige Form (nur das fehlende Wort bzw. die Wörter) und eine kurze Erklärung.`,
    schema: {
      type: 'object',
      properties: {
        answers: { type: 'array', items: { type: 'string' } },
        explanations: { type: 'array', items: { type: 'string' } },
      },
      required: ['answers', 'explanations'],
      additionalProperties: false,
    },
  });
  return r;
}

// ---------- explain a sentence ----------
export async function explainSentenceSheet(sentence) {
  const out = h('div', { class: 'ai-out' }, h('span', { class: 'spinner' }), ' KI erklärt …');
  let lang = 'de';
  let data = null;
  const toggle = h('div', { class: 'seg', hidden: true },
    h('button', { class: 'on', onclick: (e) => setLang('de', e) }, 'Deutsch'),
    h('button', { onclick: (e) => setLang('en', e) }, 'English'));
  const setLang = (l, e) => { lang = l; toggle.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); render(); };
  const render = () => { out.textContent = data[lang]; };
  sheet(h('div', {}, h('h3', {}, 'Satz erklärt'), h('p', { class: 'serif', style: { fontSize: '17px' } }, sentence), toggle, h('div', { class: 'card mt' }, out)));
  try {
    data = await call({
      system: 'Du erklärst Deutschlernenden (Niveau A1–A2) die Grammatik eines Satzes. Kurz, klar, ohne Fachjargon wo möglich. Gehe auf Wortstellung, Kasus/Artikel, Verbformen und wichtige Wörter ein.',
      user: `Erkläre diesen Satz: "${sentence}"\nGib die Erklärung einmal in einfachem Deutsch (de) und einmal auf Englisch (en), je höchstens 120 Wörter.`,
      schema: { type: 'object', properties: { de: { type: 'string' }, en: { type: 'string' } }, required: ['de', 'en'], additionalProperties: false },
      effort: 'low',
    });
    toggle.hidden = false;
    render();
  } catch (e) { out.textContent = `Fehler: ${e.message}`; }
}

// ---------- new reading text at the learner's level ----------
async function vocabularyUpTo(chNum) {
  const pages = await db.all('pages');
  const freq = new Map();
  for (const p of pages) {
    if (p.chapter && p.chapter > chNum) continue;
    const text = (p.blocks || []).filter((b) => b.kind === 'p').map((b) => b.text).join(' ');
    for (const w of text.match(/\p{L}{2,}/gu) || []) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 700).map(([w]) => w);
}

export async function newReadingTextSheet() {
  const chapters = await listChapters();
  const last = (await db.kv.get('lastPage')) || 1;
  const cur = chapterFor(chapters, last)?.num || 1;
  const chSel = h('select', {}, chapters.map((c) => h('option', { value: c.num, selected: c.num === cur }, `bis Kapitel ${c.num}`)));
  const topic = h('input', { type: 'text', placeholder: 'Thema (optional), z. B. ein Ausflug', 'data-de': '' });
  const status = h('div', { class: 'small' });
  const go = h('button', { class: 'btn primary block mt' }, 'Text erstellen');
  const s = sheet(h('div', {}, h('h3', {}, 'Neuer Lesetext'),
    h('p', { class: 'sub' }, 'Ein neuer, kurzer Text mit dem Wortschatz deiner bisherigen Kapitel – wie im Buch, nur mehr davon.'),
    h('label', { class: 'field' }, h('span', {}, 'Wortschatz'), chSel), h('label', { class: 'field' }, h('span', {}, 'Thema'), topic), go, status));
  go.addEventListener('click', async () => {
    go.disabled = true;
    status.replaceChildren(h('span', { class: 'spinner' }), ' Text wird geschrieben … (ca. 20–60 s)');
    try {
      const n = +chSel.value;
      const vocab = await vocabularyUpTo(n);
      const mine = (await db.all('words')).map((w) => w.lemma);
      const r = await call({
        system: 'Du schreibst Lesetexte im Stil von "Deutsch nach der Naturmethode": einfache, natürliche Sätze, viele Wiederholungen, Fragen und Antworten im Text, alles aus dem Kontext verständlich. Verwende fast nur Wörter aus der gegebenen Liste (Flexionsformen erlaubt) und nur Grammatik, die mit diesen Wörtern vorkommt. Höchstens 3 neue Wörter, und diese aus dem Kontext klar.',
        user: `Wortschatz (bis Kapitel ${n}):\n${vocab.join(', ')}\n\nWörter, die ich besonders üben will: ${mine.slice(-40).join(', ') || '–'}\n\nThema: ${topic.value.trim() || 'frei, mit den bekannten Personen (Familie Müller usw.)'}\n\nSchreibe einen neuen Originaltext (150–250 Wörter) in 2–4 Absätzen (Absätze durch Leerzeile trennen), einen kurzen Titel und 3 Verständnisfragen auf Deutsch.`,
        schema: {
          type: 'object',
          properties: { title: { type: 'string' }, text: { type: 'string' }, questions: { type: 'array', items: { type: 'string' } } },
          required: ['title', 'text', 'questions'], additionalProperties: false,
        },
        effort: 'medium',
        maxTokens: 8000,
      });
      const id = await db.put('texts', { title: r.title, text: r.text, questions: r.questions.slice(0, 3), chapter: n, created: Date.now(), model: settings.aiModel });
      s.close();
      toast('Lesetext gespeichert');
      location.hash = `#/text/${id}`;
    } catch (e) {
      status.textContent = `Fehler: ${e.message}`;
      go.disabled = false;
    }
  });
}
