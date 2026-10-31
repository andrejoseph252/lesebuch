// Exercise builder for PDF books: pick the lines of a page that are gap-fill sentences.
// (EPUB books get their exercises automatically from the ÜBUNG sections.)
import { t } from './i18n.js';
import { h, sheet, toast } from './ui.js';
import { layoutPage, tokenize, GAP_RE, hasGap } from './layout.js';
import { settings } from './settings.js';
import { exercisesForPage, replacePageExercises } from './model.js';

/** Line text -> segments; existing gap markers become gaps, `made` holds words turned into gaps. */
function toSegs(text, made) {
  const segs = [];
  let last = 0;
  GAP_RE.lastIndex = 0;
  for (const m of text.matchAll(GAP_RE)) {
    if (m.index > last) segs.push(...wordSegs(text.slice(last, m.index), made, last));
    segs.push({ t: 'gap', answer: null });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push(...wordSegs(text.slice(last), made, last));
  // merge adjacent text segments
  return segs.reduce((acc, s) => {
    const p = acc[acc.length - 1];
    if (s.t === 'text' && p?.t === 'text') p.v += s.v; else acc.push({ ...s });
    return acc;
  }, []);
}
function wordSegs(chunk, made, offset) {
  return tokenize(chunk).map((tk) => (tk.t === 'w' && made.has(offset + tk.start)
    ? { t: 'gap', answer: tk.v, made: true }
    : { t: 'text', v: tk.v }));
}

export async function openBuilder(page, rec, ch, onDone) {
  const lines = layoutPage(rec, settings).lines;
  const existing = await exercisesForPage(page);
  const state = lines.map((text) => ({ text, on: hasGap(text) || existing.some((e) => e.text.includes(text)), made: new Set() }));
  const list = h('div');
  const draw = () => {
    list.innerHTML = '';
    state.forEach((st) => {
      const txt = h('div', { class: 'txt' });
      tokenize(st.text).forEach((tk) => {
        if (tk.t !== 'w') { txt.append(tk.v); return; }
        const w = h('span', { class: st.made.has(tk.start) ? 'gapmark' : 'bw' }, tk.v);
        w.addEventListener('click', (e) => {
          if (!st.on) return;
          e.stopPropagation();
          st.made.has(tk.start) ? st.made.delete(tk.start) : st.made.add(tk.start);
          draw();
        });
        txt.append(w);
      });
      list.append(h('div', { class: `builder-line ${st.on ? 'on' : ''}` },
        h('button', { class: 'tick', 'aria-label': t('Auswählen'), onclick: () => { st.on = !st.on; draw(); } }, '✓'), txt));
    });
  };
  draw();
  const s = sheet(h('div', {},
    h('h3', {}, t('Übung erstellen')),
    h('p', { class: 'sub' }, t('Wähle die Übungssätze. In einem gewählten Satz kannst du ein Wort antippen, um es zur Lücke zu machen.')),
    list,
    h('div', { class: 'builder-bar' },
      h('button', { class: 'btn grow', onclick: () => s.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary grow', onclick: async () => {
        // join selected lines that continue onto the next line into one sentence
        const items = [];
        let cur = null;
        state.forEach((st, i) => {
          if (!st.on) { cur = null; return; }
          const segs = toSegs(st.text, st.made);
          if (cur && !/[.!?:]["”]?$/.test(state[i - 1].text)) { cur.segs.push({ t: 'text', v: ' ' }, ...segs); cur.text += ` ${st.text}`; }
          else { cur = { type: 'gap', segs, text: st.text, chapter: ch?.num ?? null, page }; items.push(cur); }
        });
        const usable = items.filter((it) => it.segs.some((g) => g.t === 'gap'));
        await replacePageExercises(page, usable);
        toast(t('{0} Übungssätze gespeichert', usable.length));
        s.close();
        onDone?.();
      } }, t('Speichern')))));
}
