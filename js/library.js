// Loading the book and managing its chapters.
import { h, sheet, toast, confirmSheet } from './ui.js';
import * as db from './db.js';
import { storeBook, extractAll, bookInfo } from './book.js';
import { listChapters, replaceChapters } from './model.js';
import { chapterHeading, layoutPage } from './layout.js';
import { settings } from './settings.js';

/** Open the file picker and load the chosen PDF. Resolves true when a book was loaded. */
export function pickBook() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.epub,.pdf,application/epub+zip,application/pdf', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? await loadBook(file) : false);
    });
    document.body.append(input);
    input.click();
  });
}

export async function loadBook(file) {
  if (/\.epub$/i.test(file.name) || file.type === 'application/epub+zip') return loadEpub(file);
  const prev = await bookInfo();
  const bar = h('i');
  const label = h('p', { class: 'sub' }, 'Buch wird gespeichert …');
  const s = sheet(h('div', {},
    h('h3', {}, 'Buch laden'),
    h('p', { class: 'small' }, 'Das Buch bleibt nur auf diesem Gerät.'),
    h('div', { class: 'progress', style: { margin: '18px 0 10px' } }, bar),
    label));
  try {
    const { info, sameBook } = await storeBook(file);
    if (prev && !sameBook) toast('Neues Buch – Seitentexte werden neu erstellt');
    label.textContent = 'Text wird erkannt …';
    await extractAll((done, total) => {
      bar.style.width = `${(done / total) * 100}%`;
      label.textContent = `Seite ${done} von ${total}`;
    });
    s.close();
    toast(`„${info.name}“ geladen · ${info.numPages} Seiten`);
    if (!(await db.count('chapters'))) setTimeout(() => detectChaptersSheet(), 400);
    return true;
  } catch (e) {
    console.error(e);
    label.textContent = `Fehler: ${e.message}`;
    return false;
  }
}

async function loadEpub(file) {
  const bar = h('i');
  const label = h('p', { class: 'sub' }, 'Buch wird gelesen …');
  const s = sheet(h('div', {},
    h('h3', {}, 'Buch laden'),
    h('p', { class: 'small' }, 'Das Buch bleibt nur auf diesem Gerät.'),
    h('div', { class: 'progress', style: { margin: '18px 0 10px' } }, bar),
    label));
  try {
    const { ingestEpub } = await import('./epubbook.js');
    const { info, book } = await ingestEpub(file, (msg, f) => { label.textContent = msg; bar.style.width = `${f * 100}%`; });
    s.close();
    toast(`„${info.title || info.name}“ geladen · ${book.chapters.length} Kapitel · ${book.exercises.length} Übungen`, 3200);
    return true;
  } catch (e) {
    console.error(e);
    label.textContent = `Fehler: ${e.message}`;
    return false;
  }
}

/** Scan cached page text for chapter headings and let the user confirm the list. */
export async function detectChaptersSheet(onDone) {
  const pages = (await db.all('pages')).sort((a, b) => a.page - b.page);
  const found = [];
  for (const p of pages) {
    const { blocks } = layoutPage(p, settings);
    // only look at the first few lines of a page: headings sit at the top
    const firstLines = blocks.flatMap((b) => b.lines.map((l) => l.text)).slice(0, 5);
    for (const line of firstLines) {
      const hit = chapterHeading(line);
      if (hit) {
        if (!found.some((f) => f.num === hit.num && hit.num)) found.push({ startPage: p.page, title: hit.title.slice(0, 80), on: true, num: hit.num });
        break;
      }
    }
  }
  const list = h('div', { class: 'list' });
  const draw = () => {
    list.innerHTML = '';
    if (!found.length) list.append(h('div', { class: 'item small' }, 'Keine Kapitelüberschriften gefunden. Setze Kapitel im Leser mit „Kapitel beginnt hier“.'));
    for (const f of found) {
      const title = h('input', { type: 'text', value: f.title, oninput: (e) => { f.title = e.target.value; } });
      list.append(h('div', { class: 'item', style: { gap: '10px' } },
        h('input', { type: 'checkbox', checked: f.on, onchange: (e) => { f.on = e.target.checked; } }),
        h('div', { class: 'grow' }, title),
        h('span', { class: 'small', style: { flex: 'none' } }, `S. ${f.startPage}`)));
    }
  };
  draw();
  const s = sheet(h('div', {},
    h('h3', {}, 'Kapitel erkennen'),
    h('p', { class: 'sub' }, found.length ? `${found.length} Kapitel gefunden. Prüfen, bearbeiten, übernehmen.` : ''),
    list,
    h('div', { class: 'row mt' },
      h('button', { class: 'btn grow', onclick: () => s.close() }, 'Abbrechen'),
      found.length ? h('button', { class: 'btn primary grow', onclick: async () => {
        const chosen = found.filter((f) => f.on).map((f) => ({ startPage: f.startPage, title: f.title.trim() }));
        if ((await db.count('chapters')) && !(await confirmSheet('Kapitelliste ersetzen?', 'Bestehende Kapitel werden durch diese Liste ersetzt. Wiederholungsdaten bleiben bei gleicher Startseite erhalten.', { ok: 'Ersetzen' }))) return;
        await replaceChapters(chosen);
        toast(`${chosen.length} Kapitel übernommen`);
        s.close();
        onDone?.();
      } }, 'Übernehmen') : null)));
}

/** List of chapters with rename / delete. */
export async function chaptersSheet(onChange) {
  const body = h('div', {});
  const s = sheet(h('div', {},
    h('div', { class: 'spread' }, h('h3', {}, 'Kapitel'), h('button', { class: 'btn small', onclick: () => { s.close(); detectChaptersSheet(onChange); } }, 'Auto-erkennen')),
    body));
  const draw = async () => {
    const list = await listChapters();
    body.innerHTML = '';
    if (!list.length) { body.append(h('p', { class: 'sub' }, 'Noch keine Kapitel. Öffne eine Seite im Leser und wähle „Kapitel beginnt hier“, oder nutze Auto-erkennen.')); return; }
    body.append(h('div', { class: 'list mt' }, list.map((c) => {
      const title = h('input', { type: 'text', value: c.title || '', placeholder: `Kapitel ${c.num}` });
      title.addEventListener('change', async () => { await db.put('chapters', { id: c.id, startPage: c.startPage, created: c.created, reread: c.reread, title: title.value.trim() }); onChange?.(); });
      return h('div', { class: 'item' },
        h('span', { class: 'small', style: { width: '3.2em', flex: 'none' } }, `S. ${c.startPage}`),
        h('div', { class: 'grow' }, title),
        h('button', { class: 'iconbtn', 'aria-label': 'Löschen', onclick: async () => {
          if (await confirmSheet('Kapitel entfernen?', `${c.title || `Kapitel ${c.num}`} (ab S. ${c.startPage})`, { ok: 'Entfernen', danger: true })) {
            await db.del('chapters', c.id); draw(); onChange?.();
          }
        } }, '×'));
    })));
  };
  draw();
  return s;
}
