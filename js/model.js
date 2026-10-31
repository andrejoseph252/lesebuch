// Domain helpers on top of the stores: chapters, words, cards, exercises.
import { t } from './i18n.js';
import * as db from './db.js';

// ---------- chapters ----------
export async function listChapters() {
  const chs = await db.all('chapters');
  chs.sort((a, b) => a.startPage - b.startPage);
  chs.forEach((c, i) => { c.num = i + 1; });
  return chs;
}
export function chapterFor(chs, page) {
  let found = null;
  for (const c of chs) if (c.startPage <= page) found = c;
  return found;
}
export function chapterTitle(c) {
  if (!c) return t('Vor Kapitel 1');
  return c.title || t('Kapitel {0}', c.num);
}
/** Last page of a chapter (page before the next chapter starts). */
export function chapterEnd(chs, c, numPages) {
  const i = chs.indexOf(c);
  return i >= 0 && chs[i + 1] ? chs[i + 1].startPage - 1 : numPages;
}
export async function setChapterStart(page, title = '') {
  const chs = await listChapters();
  const existing = chs.find((c) => c.startPage === page);
  if (existing) return existing;
  const id = await db.put('chapters', { startPage: page, title, created: Date.now() });
  return db.get('chapters', id);
}
export async function replaceChapters(list) {
  // keep reread history for chapters whose start page survives
  const old = await db.all('chapters');
  await db.clear('chapters');
  for (const c of list) {
    const prev = old.find((o) => o.startPage === c.startPage);
    const rec = { created: Date.now(), ...(prev || {}), ...c };
    delete rec.num;
    if (rec.id == null) delete rec.id;
    await db.put('chapters', rec);
  }
}

// ---------- words ----------
export const lemmaKey = (s) => String(s || '').trim().toLowerCase();

export async function findWord(lemma) {
  const hits = await db.byIndex('words', 'lemma', lemmaKey(lemma));
  return hits[0] || null;
}

export async function saveWord(word) {
  const rec = { ...word, lemma: word.lemma.trim(), lemmaKey: lemmaKey(word.lemma), updated: Date.now() };
  if (!rec.created) rec.created = Date.now();
  if (rec.id == null) delete rec.id;
  const id = await db.put('words', rec);
  rec.id = id;
  await syncWordCards(rec);
  return rec;
}

export async function deleteWord(id) {
  await db.del('words', id);
  for (const c of await db.byIndex('cards', 'ref', `w:${id}`)) await db.del('cards', c.id);
}

/** Where the target word sits inside its sentence, or null. */
export function clozeSpan(word) {
  const s = word.sentence || '';
  for (const cand of [word.form, word.lemma].filter(Boolean)) {
    const re = new RegExp(`(^|[^\\p{L}])(${cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}])`, 'u');
    const m = s.match(re) || s.match(new RegExp(re.source, 'iu'));
    if (m) {
      const start = m.index + m[1].length;
      return { start, end: start + m[2].length, answer: m[2] };
    }
  }
  return null;
}

function newCard(id, type, ref, extra = {}) {
  const now = Date.now();
  return { id, type, ref, created: now, state: 'new', due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, last: 0, ...extra };
}

export async function syncWordCards(word) {
  const want = new Map();
  if (clozeSpan(word)) want.set(`cloze:${word.id}`, 'cloze');
  if (['der', 'die', 'das'].includes(word.article)) want.set(`gender:${word.id}`, 'gender');
  if (word.plural?.trim()) want.set(`plural:${word.id}`, 'plural');
  const have = await db.byIndex('cards', 'ref', `w:${word.id}`);
  for (const c of have) if (!want.has(c.id)) await db.del('cards', c.id);
  for (const [id, type] of want) {
    if (!have.some((c) => c.id === id)) await db.put('cards', newCard(id, type, `w:${word.id}`));
  }
}

// ---------- exercises ----------
// Exercise item: { id, page, text, segs: [{t:'text', v} | {t:'gap', answer, explanation, made}], stats }

export async function exercisesForPage(page) { return db.byIndex('exercises', 'page', page); }

export async function replacePageExercises(page, items) {
  const old = await exercisesForPage(page);
  const keep = new Set();
  for (const it of items) {
    const prev = old.find((o) => o.text === it.text);
    if (prev) {
      // keep id, stats and answers already learned for the same sentence
      it.id = prev.id;
      it.stats = prev.stats;
      it.segs.forEach((g, i) => {
        const pg = prev.segs[i];
        if (g.t === 'gap' && pg?.t === 'gap' && !g.answer && pg.answer) { g.answer = pg.answer; g.explanation = pg.explanation; }
      });
      keep.add(prev.id);
    }
    const id = await db.put('exercises', { stats: { attempts: 0, gapsDone: 0, gapsRight: 0 }, created: Date.now(), ...it, page });
    keep.add(id);
  }
  for (const o of old) {
    if (keep.has(o.id)) continue;
    await db.del('exercises', o.id);
    for (const c of await db.byIndex('cards', 'ref', `ex:${o.id}`)) await db.del('cards', c.id);
  }
}

/** A wrong answer becomes (or refreshes) an error card for that gap. */
export async function ensureErrorCard(exId, gapIndex) {
  const id = `err:${exId}:${gapIndex}`;
  const existing = await db.get('cards', id);
  if (existing) {
    if (existing.state === 'review' && existing.due > Date.now()) {
      existing.due = Date.now();
      await db.put('cards', existing);
    }
    return existing;
  }
  const c = newCard(id, 'error', `ex:${exId}`, { gap: gapIndex });
  await db.put('cards', c);
  return c;
}

export function gapIndexes(ex) {
  return ex.segs.map((s, i) => (s.t === 'gap' ? i : -1)).filter((i) => i >= 0);
}
