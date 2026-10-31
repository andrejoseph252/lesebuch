// Wörter: your word list — search, filter, edit, per-word card stats.
import { h, genderClass } from './ui.js';
import * as db from './db.js';
import { listChapters, chapterFor } from './model.js';
import { openWordSheet } from './wordsheet.js';

export async function renderWords(view) {
  const [words, chapters, cards] = await Promise.all([db.all('words'), listChapters(), db.all('cards')]);
  const chOf = (w) => w.chapter ?? (w.page ? chapterFor(chapters, w.page)?.num : null);
  const cardsOf = new Map();
  for (const c of cards) { if (!cardsOf.has(c.ref)) cardsOf.set(c.ref, []); cardsOf.get(c.ref).push(c); }
  const f = { q: '', ch: '', g: '' };
  try { Object.assign(f, JSON.parse(localStorage.getItem('lesebuch.wordFilter') || '{}'), { q: '' }); } catch { /* storage blocked */ }

  view.append(h('h1', {}, 'Wörter'));
  const search = h('input', { type: 'search', placeholder: `${words.length} Wörter durchsuchen`, 'data-de': '', autocapitalize: 'off', value: f.q });
  const chSel = h('select', {}, h('option', { value: '' }, 'Alle Kapitel'), chapters.map((c) => h('option', { value: c.num, selected: String(f.ch) === String(c.num) }, `Kapitel ${c.num}`)));
  const chips = h('div', { class: 'chips' }, [['', 'Alle'], ['der', 'der'], ['die', 'die'], ['das', 'das'], ['-', 'ohne']].map(([v, l]) =>
    h('button', { class: `chip ${f.g === v ? 'on' : ''} ${genderClass(v)}`, dataset: { g: v } }, l)));
  const list = h('div', { class: 'list mt' });
  view.append(search, h('div', { class: 'row mt' }, h('div', { class: 'grow' }, chSel)), h('div', { class: 'mt' }, chips), list);

  const save = () => { try { localStorage.setItem('lesebuch.wordFilter', JSON.stringify({ ch: f.ch, g: f.g })); } catch { /* ignore */ } };
  const draw = () => {
    const q = f.q.trim().toLowerCase();
    const shown = words
      .filter((w) => !q || w.lemmaKey.includes(q) || (w.meaning || '').toLowerCase().includes(q) || (w.form || '').toLowerCase().includes(q))
      .filter((w) => !f.ch || String(chOf(w)) === String(f.ch))
      .filter((w) => !f.g || (f.g === '-' ? !['der', 'die', 'das'].includes(w.article) : w.article === f.g))
      .sort((a, b) => a.lemmaKey.localeCompare(b.lemmaKey, 'de'));
    list.innerHTML = '';
    if (!shown.length) {
      list.append(h('div', { class: 'item small' }, words.length ? 'Keine Treffer.' : 'Noch keine Wörter. Tippe beim Lesen auf ein Wort und wähle „Zu Wörtern hinzufügen“.'));
      return;
    }
    for (const w of shown) {
      const cs = cardsOf.get(`w:${w.id}`) || [];
      const learned = cs.filter((c) => c.state === 'review');
      const stab = learned.length ? Math.min(...learned.map((c) => c.stability)) : 0;
      list.append(h('button', { class: 'item word-row', onclick: () => openWordSheet({ word: w, onSaved: () => { view.innerHTML = ''; renderWords(view); } }) },
        h('div', { class: 'grow' },
          h('div', { class: 'lemma' }, w.article ? h('span', { class: `art ${genderClass(w.article)}` }, `${w.article} `) : null, w.lemma,
            w.plural ? h('span', { class: 'small' }, ` · ${w.plural}`) : null),
          h('div', { class: 'meta ellipsis' }, [w.meaning, chOf(w) ? `Kap. ${chOf(w)}` : null].filter(Boolean).join(' · '))),
        h('span', { class: 'badge' }, !cs.length ? '–' : !learned.length ? 'neu' : stab >= 21 ? 'sicher' : `${Math.round(stab)} T`)));
    }
  };
  search.addEventListener('input', () => { f.q = search.value; draw(); });
  chSel.addEventListener('change', () => { f.ch = chSel.value; save(); draw(); });
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    f.g = b.dataset.g;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    save(); draw();
  });
  draw();
}
