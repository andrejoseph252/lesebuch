// Heute: what to do today — continue reading, reviews, rereads, open exercises, streak, 14-day chart.
import { t, locale } from './i18n.js';
import { h, dayKey, DAY, startOfDay, fmtDue } from './ui.js';
import * as db from './db.js';
import { bookInfo } from './book.js';
import { listChapters, chapterFor, chapterTitle } from './model.js';
import { dueQueue } from './review.js';
import { dueRereads, REREAD_DAYS } from './reread.js';
import { pickBook } from './library.js';
import { apiKey } from './settings.js';

export async function renderHome(view) {
  const info = await bookInfo();
  const greeting = (() => { const hr = new Date().getHours(); return hr < 11 ? t('Guten Morgen') : hr < 18 ? t('Guten Tag') : t('Guten Abend'); })();
  view.append(h('p', { class: 'sub', style: { margin: '18px 0 0' } }, new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })), h('h1', { style: { marginTop: '2px' } }, greeting));

  if (!info) {
    view.append(h('div', { class: 'card accent' },
      h('h3', {}, t('Willkommen im Lesebuch')),
      h('p', { class: 'sub' }, t('Lade dein Buch (EPUB oder PDF). Es bleibt nur auf diesem Gerät – nichts wird hochgeladen.')),
      h('button', { class: 'btn primary', onclick: async () => { if (await pickBook()) { view.innerHTML = ''; renderHome(view); } } }, t('Buch laden'))));
    return;
  }

  const [chapters, queue, lastPage, logs, exercises, activity] = await Promise.all([
    listChapters(), dueQueue(), db.kv.get('lastPage'), db.byIndex('reviewLog', 'ts', IDBKeyRange.lowerBound(startOfDay() - 13 * DAY)),
    db.all('exercises'), db.kv.get('activityDays'),
  ]);
  const page = lastPage || 1;
  const ch = chapterFor(chapters, page);

  // continue reading
  view.append(h('a', { class: 'card', href: `#/lesen/${page}`, style: { display: 'block', textDecoration: 'none', color: 'inherit' } },
    h('div', { class: 'small' }, t('Weiterlesen')),
    h('h3', { style: { margin: '4px 0 2px' } }, chapterTitle(ch)),
    h('div', { class: 'sub' }, ch ? t('Kapitel {0} · Seite {1}', ch.num, page) : t('Seite {0}', page))));

  // reviews
  view.append(h('div', { class: 'card' },
    h('div', { class: 'spread' },
      h('div', {}, h('div', { class: 'small' }, t('Wiederholen')), h('h3', { style: { margin: '4px 0 0' } }, queue.length ? t('{0} Karten fällig', queue.length) : t('Alles erledigt'))),
      queue.length ? h('a', { class: 'btn primary', href: '#/review' }, t('Starten')) : null)));

  // rereads
  const rereads = dueRereads(chapters);
  if (rereads.length) {
    view.append(h('h2', {}, t('Nochmal lesen')), h('div', { class: 'list' }, rereads.map((c) => h('a', { class: 'item', href: `#/lesen/${c.startPage}` },
      h('div', { class: 'grow' }, h('div', { class: 'serif' }, `${c.num}. ${chapterTitle(c)}`),
        h('div', { class: 'small' }, t('Wiederholung {0} von {1} · fällig {2}', c.reread.step + 1, REREAD_DAYS.length, fmtDue(c.reread.due)))),
      h('span', { class: 'chev' }, '›')))));
  }

  // exercises not done yet, in chapters already read
  const readUpTo = ch?.num || 0;
  const open = chapters.filter((c) => c.num <= readUpTo)
    .map((c) => ({ c, n: exercises.filter((e) => e.chapter === c.num && !e.stats?.attempts).length }))
    .filter((x) => x.n > 0);
  if (open.length) {
    view.append(h('h2', {}, t('Offene Übungen')), h('div', { class: 'list' }, open.slice(0, 4).map(({ c, n }) => h('a', { class: 'item', href: `#/ueben/${c.num}` },
      h('div', { class: 'grow' }, h('div', { class: 'serif' }, `${c.num}. ${chapterTitle(c)}`), h('div', { class: 'small' }, t('{0} Übungen offen', n))),
      h('span', { class: 'chev' }, '›')))));
  }

  // streak + chart
  const days = new Set([...(activity || []), ...logs.map((l) => dayKey(l.ts))]);
  let streak = 0;
  for (let d = days.has(dayKey()) ? 0 : 1; days.has(dayKey(Date.now() - d * DAY)); d++) streak++;
  const counts = Array.from({ length: 14 }, (_, i) => logs.filter((l) => dayKey(l.ts) === dayKey(Date.now() - (13 - i) * DAY)).length);
  const total14 = counts.reduce((a, b) => a + b, 0);
  view.append(h('h2', {}, t('Fortschritt')),
    h('div', { class: 'stat-grid' },
      h('div', { class: 'stat' }, h('b', {}, String(streak)), h('span', {}, streak === 1 ? t('Tag in Folge') : t('Tage in Folge'))),
      h('div', { class: 'stat' }, h('b', {}, String(total14)), h('span', {}, t('Karten in 14 T'))),
      h('div', { class: 'stat' }, h('b', {}, String(await db.count('words'))), h('span', {}, t('Wörter')))),
    h('div', { class: 'card mt' }, h('div', { class: 'small', style: { marginBottom: '6px' } }, t('Wiederholungen pro Tag')), chart(counts)));

  if (apiKey.get()) {
    view.append(h('div', { class: 'card mt' },
      h('div', { class: 'spread' },
        h('div', {}, h('h3', { style: { margin: 0 } }, t('Neuer Lesetext')), h('div', { class: 'sub' }, t('Ein neuer Text mit dem Wortschatz bis Kapitel {0}', readUpTo || 1))),
        h('button', { class: 'btn', onclick: () => import('./ai.js').then((m) => m.newReadingTextSheet()) }, t('Erstellen')))));
  }
}

function chart(counts) {
  const W = 320, H = 96, pad = 14, bw = (W - 2) / counts.length;
  const max = Math.max(4, ...counts);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('Wiederholungen der letzten 14 Tage: {0}', counts.join(', ')));
  counts.forEach((c, i) => {
    const bh = c ? Math.max(3, ((H - pad - 4) * c) / max) : 2;
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', 1 + i * bw + bw * 0.18);
    r.setAttribute('y', H - pad - bh);
    r.setAttribute('width', bw * 0.64);
    r.setAttribute('height', bh);
    r.setAttribute('rx', 2);
    if (!c) r.setAttribute('class', 'zero');
    const tip = document.createElementNS(ns, 'title');
    tip.textContent = `${new Date(Date.now() - (13 - i) * DAY).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric' })}: ${c}`;
    r.append(tip);
    svg.append(r);
  });
  [[0, t('vor 13 T')], [counts.length - 1, t('heute')]].forEach(([i, l]) => {
    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', i ? W - 2 : 2);
    lbl.setAttribute('y', H - 2);
    lbl.setAttribute('text-anchor', i ? 'end' : 'start');
    lbl.textContent = l;
    svg.append(lbl);
  });
  return svg;
}
