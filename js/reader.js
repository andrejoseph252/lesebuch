// Lesen: the book reader (text mode + page mode), and the same text view for generated Lesetexte.
import { h, sheet, toast, icon, $, $$, confirmSheet } from './ui.js';
import * as db from './db.js';
import { getDoc, getPage, renderPage, ocrPage, bookInfo } from './book.js';
import { layoutPage, splitSentences, tokenize } from './layout.js';
import { listChapters, chapterFor, chapterTitle, chapterEnd, setChapterStart } from './model.js';
import { settings, saveSettings } from './settings.js';
import { openWordSheet } from './wordsheet.js';
import { speakSequence, stop as stopTts, ttsSupported } from './tts.js';
import { pickBook } from './library.js';
import { markChapterRead } from './reread.js';

const state = { page: null, zoom: 1, renderTask: null, sentences: [], known: new Map() };

export async function knownWords() {
  const map = new Map();
  for (const w of await db.all('words')) {
    map.set(w.lemmaKey, w);
    if (w.form) map.set(w.form.toLowerCase(), w);
  }
  return map;
}

/** Render paragraphs/headings + margin notes into a .page-text element. Returns sentence list. */
export function renderBlocks(container, blocks, known, { chapter } = {}) {
  const sentences = [];
  const sentenceEl = (text) => {
    const sEl = h('span', { class: 's', dataset: { si: sentences.length } });
    for (const t of tokenize(text)) {
      if (t.t === 'w') sEl.append(h('span', { class: `w${known.has(t.v.toLowerCase()) ? ' known' : ''}` }, t.v));
      else sEl.append(t.v);
    }
    sentences.push({ text: text.replace(/＿+/g, '…'), el: sEl });
    return sEl;
  };
  for (const b of blocks) {
    if (b.kind === 'ex') {
      container.append(h('ol', { class: 'ex-list' }, b.items.map((it) => h('li', {},
        sentenceEl(it.type === 'gap' ? it.segs.map((g) => (g.t === 'gap' ? '＿＿＿' : g.v)).join('') : it.q)))));
      if (chapter && !container.querySelector('[data-practice]')) {
        container.append(h('p', {}, h('a', { class: 'btn small', href: `#/ueben/${chapter}`, dataset: { practice: '1' } }, 'Diese Übungen digital üben →')));
      }
      continue;
    }
    if (!b.text && b.notes?.length) {
      container.append(notesEl(b.notes));
      continue;
    }
    const el = h(b.kind === 'h' ? 'div' : 'p', { class: b.kind === 'h' ? `hd${b.big ? ' big' : ''}` : '' });
    for (const s of splitSentences(b.text)) {
      const sEl = h('span', { class: 's', dataset: { si: sentences.length } });
      for (const t of tokenize(s.text)) {
        if (t.t === 'w') {
          const k = known.has(t.v.toLowerCase()) ? ' known' : '';
          sEl.append(h('span', { class: `w${k}` }, t.v));
        } else sEl.append(t.v);
      }
      sentences.push({ text: s.text, el: sEl });
      el.append(sEl, ' ');
    }
    container.append(el);
    if (b.notes?.length) container.append(notesEl(b.notes));
  }
  return sentences;
}

/** Vocabulary list from the book's WÖRTER boxes: tappable words. */
export function wordsEl(words, known) {
  return h('aside', { class: 'notes words-box', 'aria-label': 'Wörter' }, h('span', { class: 'lbl' }, 'Wörter'),
    h('div', { class: 'page-words' }, words.map((w) => h('span', { class: `w${known.has(w.toLowerCase()) ? ' known' : ''}` }, w))));
}

function notesEl(notes) {
  return h('aside', { class: 'notes', 'aria-label': 'Randnotizen' }, h('span', { class: 'lbl' }, 'Randnotizen'), notes.map((n) => h('div', {}, n)));
}

/** Tap handling for words inside a rendered .page-text. */
export function wireWordTaps(container, getCtx) {
  container.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (!w) return;
    $$('.w.sel', container).forEach((x) => x.classList.remove('sel'));
    w.classList.add('sel');
    const sEl = w.closest('.s');
    const si = sEl ? +sEl.dataset.si : -1;
    const sentence = (state.sentences[si]?.text || sEl?.textContent || '').replace(/＿+/g, '…');
    const form = w.textContent;
    openWordSheet({
      form,
      sentence: sentence.trim().replace(/^\d{1,2}[.)]\s+/, ''),
      known: state.known.get(form.toLowerCase()),
      ...getCtx(),
      onReadFrom: ttsSupported ? () => readAloud(si) : null,
      onSaved: async () => {
        state.known = await knownWords();
        $$('.w', container).forEach((x) => x.classList.toggle('known', state.known.has(x.textContent.toLowerCase())));
      },
      onClose: () => w.classList.remove('sel'),
    });
  });
}

// ---------- read aloud with sentence highlight ----------
let playerEl = null;
export function readAloud(from = 0) {
  const list = state.sentences.slice(Math.max(0, from));
  if (!list.length) return;
  closePlayer();
  playerEl = h('div', { class: 'player' }, h('span', {}, 'Vorlesen'),
    h('button', { class: 'iconbtn', 'aria-label': 'Stopp', onclick: () => { stopTts(); closePlayer(); } }, icon('stop')));
  document.body.append(playerEl);
  speakSequence(list.map((s) => s.text), {
    onSentence: (i) => {
      $$('.s.speaking').forEach((x) => x.classList.remove('speaking'));
      if (i < 0) { closePlayer(); return; }
      const el = list[i].el;
      el.classList.add('speaking');
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 140) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
  });
}
function closePlayer() {
  playerEl?.remove();
  playerEl = null;
  $$('.s.speaking').forEach((x) => x.classList.remove('speaking'));
}
export function leaveReader() { stopTts(); closePlayer(); }

// ---------- the book reader ----------
export async function renderReader(view, { page } = {}) {
  const info = await bookInfo();
  const isEpub = info?.format === 'epub';
  const doc = info && !isEpub ? await getDoc().catch(() => null) : null;
  if (!info || (!doc && !isEpub)) {
    view.append(h('div', { class: 'empty' },
      h('h1', {}, 'Lesen'),
      h('p', {}, 'Lade dein Buch (EPUB oder PDF). Es wird nur auf diesem Gerät gespeichert und nirgendwohin hochgeladen.'),
      h('button', { class: 'btn primary mt', onclick: async () => { if (await pickBook()) location.hash = '#/lesen'; } }, 'Buch laden')));
    return;
  }
  const numPages = isEpub ? info.numPages : doc.numPages;
  const last = (await db.kv.get('lastPage')) || 1;
  state.page = Math.min(numPages, Math.max(1, page || last));
  state.known = await knownWords();
  let chapters = await listChapters();
  const pageModes = (await db.kv.get('pageModes')) || {};

  const head = h('header', { class: 'reader-head' });
  const body = h('div', {});
  view.append(head, body);
  const onScroll = () => head.classList.toggle('scrolled', scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true });
  view.addEventListener('view:leave', () => removeEventListener('scroll', onScroll), { once: true });

  const go = (n) => {
    n = Math.min(numPages, Math.max(1, n));
    if (n === state.page) return;
    stopTts(); closePlayer();
    state.page = n;
    history.replaceState(null, '', `#/lesen/${n}`);
    draw();
    scrollTo(0, 0);
  };

  // swipe left/right to turn pages (not while zoomed in page mode)
  let t0 = null;
  body.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { t0 = null; return; }
    t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  body.addEventListener('touchend', (e) => {
    if (!t0 || (mode() === 'page' && state.zoom > 1)) return;
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - t0.t < 700) go(state.page + (dx < 0 ? 1 : -1));
    t0 = null;
  });

  const mode = () => pageModes[state.page] || 'text';
  const setMode = async (m) => {
    if (m === 'text') delete pageModes[state.page]; else pageModes[state.page] = m;
    await db.kv.set('pageModes', pageModes);
    draw();
  };

  async function draw() {
    const n = state.page;
    await db.kv.set('lastPage', n);
    const ch = chapterFor(chapters, n);
    const rec = await getPage(n);
    const hasText = !!rec?.hasText;
    const m = isEpub ? 'text' : hasText ? mode() : 'page';

    head.innerHTML = '';
    head.append(
      isEpub ? h('span', { style: { width: '44px', flex: 'none' } }) : h('button', { class: 'iconbtn', 'aria-label': m === 'text' ? 'Originalseite' : 'Textansicht', onclick: () => hasText ? setMode(m === 'text' ? 'page' : 'text') : toast('Diese Seite hat noch keinen Text – nutze „Text erkennen“') }, icon(m === 'text' ? 'page' : 'text')),
      h('div', { class: 'title' },
        h('b', {}, chapterTitle(ch)),
        h('button', { onclick: () => jumpSheet(numPages, chapters, go) }, `S. ${n} / ${numPages}`)),
      h('button', { class: 'iconbtn', 'aria-label': 'Menü', onclick: () => menu(n, ch, rec, numPages) }, icon('more')));

    body.innerHTML = '';
    state.sentences = [];
    if (isEpub) {
      const txt = h('article', { class: 'page-text', lang: 'de' });
      for (const src of rec?.images || []) {
        const img = h('img', { class: 'illus', alt: 'Illustration', loading: 'lazy' });
        txt.append(img);
        import('./epubbook.js').then((m2) => m2.imageUrl(src)).then((u) => { img.src = u; }).catch(() => img.remove());
      }
      if (!hasText) txt.append(h('div', { class: 'card center small' }, 'Diese Seite ist in deinem EPUB leer – sie ist beim Scannen verloren gegangen.'));
      state.sentences = renderBlocks(txt, rec?.blocks || [], state.known, { chapter: ch?.num });
      if (rec?.glosses?.length) txt.append(notesEl(rec.glosses));
      if (rec?.words?.length) txt.append(wordsEl(rec.words, state.known));
      body.append(txt);
      wireWordTaps(txt, () => ({ page: n, chapterNum: ch?.num ?? null }));
    } else if (m === 'text') {
      const L = layoutPage(rec, settings);
      const txt = h('article', { class: 'page-text', lang: 'de' });
      state.sentences = renderBlocks(txt, L.blocks, state.known);
      body.append(txt);
      wireWordTaps(txt, () => ({ page: n, chapterNum: ch?.num ?? null }));
    } else {
      body.append(pageModeBar(), canvasWrap(n));
      if (!hasText) body.append(ocrOffer(n));
    }

    // end of chapter
    if (ch && chapterEnd(chapters, ch, numPages) === n) {
      body.append(h('div', { class: 'chapter-end card' },
        h('p', { class: 'serif', style: { fontSize: '17px', margin: '0 0 10px' } }, `Ende von ${chapterTitle(ch)}`),
        h('button', { class: 'btn primary', onclick: () => markChapterRead(ch).then(async () => { chapters = await listChapters(); }) }, 'Kapitel gelesen ✓')));
    }

    body.append(h('div', { class: 'page-foot' },
      h('button', { class: 'btn', disabled: n <= 1, onclick: () => go(n - 1), 'aria-label': 'Vorige Seite' }, icon('back'), 'Zurück'),
      h('span', { class: 'pn' }, `${n}`),
      h('button', { class: 'btn', disabled: n >= numPages, onclick: () => go(n + 1), 'aria-label': 'Nächste Seite' }, 'Weiter', icon('next'))));
  }

  function pageModeBar() {
    return h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
      h('div', { class: 'seg' }, [1, 1.5, 2].map((z) => h('button', {
        class: state.zoom === z ? 'on' : '', onclick: () => { state.zoom = z; draw(); },
      }, `${String(z).replace('.', ',')}×`))));
  }

  function canvasWrap(n) {
    const wrap = h('div', { class: 'page-canvas-wrap' });
    const canvas = h('canvas', { 'aria-label': `Seite ${n}` });
    wrap.append(canvas);
    requestAnimationFrame(async () => {
      const width = Math.min(view.clientWidth, 680) * state.zoom;
      try {
        state.renderTask?.cancel?.();
        state.renderTask = renderPage(n, canvas, Math.round(width));
        await state.renderTask;
      } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn(e); }
    });
    return wrap;
  }

  function ocrOffer(n) {
    const box = h('div', { class: 'card mt center' },
      h('p', {}, 'Diese Seite hat keine Textebene (Scan).'),
      h('p', { class: 'small' }, 'Texterkennung lädt einmalig ca. 5 MB (tesseract.js) aus dem Netz.'));
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      btn.disabled = true;
      const lbl = h('span', { class: 'small' }, ' 0 %');
      box.append(h('div', { class: 'mt' }, h('span', { class: 'spinner' }), lbl));
      try {
        const rec = await ocrPage(n, (p) => { lbl.textContent = ` ${Math.round(p * 100)} %`; });
        toast(rec.hasText ? 'Text erkannt' : 'Kein Text gefunden');
        if (rec.hasText) await setMode('text');
        else draw();
      } catch (e) {
        console.error(e);
        toast(`OCR fehlgeschlagen: ${e.message}`);
        btn.disabled = false;
      }
    } }, 'Text erkennen (OCR)');
    box.append(btn);
    return box;
  }

  function menu(n, ch, rec, numPages) {
    const isStart = chapters.some((c) => c.startPage === n);
    const item = (label, fn, sub) => h('button', { class: 'item', onclick: () => { s.close(); fn(); } }, h('span', { class: 'grow' }, label, sub ? h('div', { class: 'small' }, sub) : null));
    const s = sheet(h('div', {},
      h('div', { class: 'spread' },
        h('h3', { style: { margin: 0 } }, `Seite ${n}`),
        h('div', { class: 'seg' },
          h('button', { onclick: () => { saveSettings({ fontSize: Math.max(14, settings.fontSize - 1) }); }, 'aria-label': 'Kleiner' }, 'A−'),
          h('button', { onclick: () => { saveSettings({ fontSize: Math.min(28, settings.fontSize + 1) }); }, 'aria-label': 'Größer', style: { fontSize: '17px' } }, 'A+'))),
      h('div', { class: 'list mt' },
        ttsSupported && rec?.hasText ? item('Seite vorlesen', () => { if (mode() !== 'text') setMode('text').then(() => readAloud(0)); else readAloud(0); }) : null,
        rec?.hasText && !isEpub ? item('Übung erstellen', () => import('./exercises.js').then((m) => m.openBuilder(n, rec, ch, () => draw())), 'Lücken-Sätze dieser Seite auswählen') : null,
        isStart
          ? item('Kapitelanfang entfernen', async () => {
            const c = chapters.find((x) => x.startPage === n);
            if (await confirmSheet('Kapitelanfang entfernen?', chapterTitle(c), { ok: 'Entfernen', danger: true })) { await db.del('chapters', c.id); chapters = await listChapters(); draw(); }
          })
          : item('Kapitel beginnt hier', async () => {
            await setChapterStart(n, guessTitle(rec));
            chapters = await listChapters();
            toast(`${chapterTitle(chapterFor(chapters, n))} beginnt auf S. ${n}`);
            draw();
          }),
        ch ? item('Kapitel gelesen ✓', () => markChapterRead(ch).then(async () => { chapters = await listChapters(); }), 'Plant Wiederholungen: 1, 3, 7, 16, 35, 80 Tage') : null,
        isEpub || (rec?.hasText && !rec.ocr) ? null : item(rec?.ocr ? 'Text neu erkennen (OCR)' : 'Text erkennen (OCR)', async () => {
          if (rec?.ocr) await db.put('pages', { ...rec, items: [], hasText: false });
          draw();
        }),
        item('Zu Seite springen', () => jumpSheet(numPages, chapters, go)))));
  }

  draw();
  return { go };
}

function guessTitle(rec) {
  const L = layoutPage(rec || { items: [] }, settings);
  const first = L.blocks.find((b) => b.text);
  return first && first.kind === 'h' ? first.text.slice(0, 80) : '';
}

function jumpSheet(numPages, chapters, go) {
  const input = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: numPages, placeholder: `1 – ${numPages}` });
  const s = sheet(h('div', {},
    h('h3', {}, 'Springe zu'),
    h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); const v = +input.value; if (v) { s.close(); go(v); } } },
      h('div', { class: 'grow' }, input), h('button', { class: 'btn primary', type: 'submit' }, 'Los')),
    chapters.length ? h('div', { class: 'list mt' }, chapters.map((c) => h('button', { class: 'item', onclick: () => { s.close(); go(c.startPage); } },
      h('span', { class: 'grow serif' }, chapterTitle(c)), h('span', { class: 'small' }, `S. ${c.startPage}`)))) : null));
}

// ---------- generated reading texts ----------
export async function renderTextReader(view, id) {
  const t = await db.get('texts', id);
  if (!t) { view.append(h('div', { class: 'empty' }, h('p', {}, 'Text nicht gefunden.'))); return; }
  state.known = await knownWords();
  const head = h('header', { class: 'reader-head' },
    h('a', { class: 'iconbtn', href: '#/mehr/texte', 'aria-label': 'Zurück' }, icon('back')),
    h('div', { class: 'title' }, h('b', {}, t.title || 'Lesetext'), h('span', { class: 'small' }, t.chapter ? `bis Kapitel ${t.chapter}` : '')),
    ttsSupported ? h('button', { class: 'iconbtn', 'aria-label': 'Vorlesen', onclick: () => readAloud(0) }, icon('speaker')) : h('span', { style: { width: '44px' } }));
  const txt = h('article', { class: 'page-text', lang: 'de' });
  const blocks = String(t.text).split(/\n\s*\n/).map((p) => ({ kind: 'p', text: p.replace(/\s+/g, ' ').trim(), lines: [], notes: [] })).filter((b) => b.text);
  blocks.unshift({ kind: 'h', big: true, text: t.title || 'Lesetext', lines: [], notes: [] });
  state.sentences = renderBlocks(txt, blocks, state.known);
  wireWordTaps(txt, () => ({ page: null, chapterNum: t.chapter ?? null, textId: t.id }));
  view.append(head, txt);
  if (t.questions?.length) {
    view.append(h('div', { class: 'page-text' },
      h('div', { class: 'hd' }, 'Fragen zum Text'),
      h('ol', { style: { paddingLeft: '1.2em' } }, t.questions.map((q) => h('li', { style: { marginBottom: '.5em' } }, q)))));
  }
}
