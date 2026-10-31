// EPUB books: ingest (unzip + clean on the device), illustrations, and re-cleaning after app updates.
import { t } from './i18n.js';
import * as db from './db.js';
import { readEpub, openZip } from './epub.js';
import { cleanBook, CLEAN_VERSION } from './clean.js';
import * as fix from './bookfix.js';
import { replaceChapters } from './model.js';

const opts = (pages) => (fix.isThisBook(pages) ? { fixes: fix.FIXES, chapters: fix.CHAPTERS, skip: fix.SKIP } : {});

async function storeClean(pages, { replaceChapterList }) {
  const book = cleanBook(pages, opts(pages));
  const recs = book.pages.map((p) => ({
    page: p.page, href: p.href, source: 'epub', raw: p.raw, images: p.images, chapter: p.chapter,
    blocks: p.blocks, glosses: p.glosses, words: p.words, v: CLEAN_VERSION,
    hasText: p.blocks.length > 0 || p.glosses.length > 0,
  }));
  await db.clear('pages');
  await db.putMany('pages', recs);
  if (replaceChapterList) await replaceChapters(book.chapters.map((c) => ({ startPage: c.startPage, title: c.title })));
  await syncExercises(book.exercises);
  return book;
}

/** Merge generated exercises with stored ones, keeping stats and answers the user already confirmed. */
async function syncExercises(items) {
  const old = await db.all('exercises');
  const key = (e) => `${e.page}|${e.text}`;
  const byKey = new Map(old.map((e) => [key(e), e]));
  const keep = new Set();
  const out = [];
  for (const it of items) {
    const prev = byKey.get(key(it));
    const rec = { ...it, auto: true, created: prev?.created || Date.now(), stats: prev?.stats || { attempts: 0, gapsDone: 0, gapsRight: 0 } };
    if (prev) {
      rec.id = prev.id;
      keep.add(prev.id);
      if (prev.answer) rec.answer = prev.answer;
      (rec.segs || []).forEach((g, i) => {
        const pg = prev.segs?.[i];
        if (g.t === 'gap' && pg?.t === 'gap' && pg.answer && !pg.auto) { g.answer = pg.answer; g.auto = false; }
      });
    }
    out.push(rec);
  }
  for (const o of old) if (o.auto && !keep.has(o.id)) await db.del('exercises', o.id);
  await db.putMany('exercises', out);
}

export async function ingestEpub(file, progress) {
  progress?.(t('EPUB wird gelesen …'), 0.1);
  const buf = new Uint8Array(await file.arrayBuffer());
  const { title, pages } = await readEpub(buf);
  progress?.(t('Text wird bereinigt …'), 0.5);
  await db.kv.set('epub', new Blob([buf], { type: 'application/epub+zip' }));
  await db.kv.del('pdf');
  const book = await storeClean(pages, { replaceChapterList: true });
  const info = {
    format: 'epub', name: file.name, size: file.size, title, numPages: book.pages.length,
    fingerprint: `${file.name}:${file.size}`, loadedAt: Date.now(), tuned: fix.isThisBook(pages), extracted: true,
  };
  await db.kv.set('book', info);
  progress?.(t('Fertig'), 1);
  return { info, book };
}

/** After an app update with better cleaning rules, rebuild page text from the stored EPUB. */
export async function recleanIfNeeded() {
  const info = await db.kv.get('book');
  if (info?.format !== 'epub') return false;
  const any = await db.get('pages', 2);
  if (any && any.v === CLEAN_VERSION) return false;
  const blob = await db.kv.get('epub');
  if (!blob) return false;
  const { pages } = await readEpub(new Uint8Array(await blob.arrayBuffer()));
  await storeClean(pages, { replaceChapterList: false });
  return true;
}

let zipPromise = null;
const urlCache = new Map();
/** Object URL for an illustration inside the stored EPUB. */
export async function imageUrl(path) {
  if (urlCache.has(path)) return urlCache.get(path);
  zipPromise ??= db.kv.get('epub').then(async (b) => openZip(new Uint8Array(await b.arrayBuffer())));
  const zip = await zipPromise;
  const bytes = await zip.read(path);
  const url = URL.createObjectURL(new Blob([bytes], { type: /\.png$/i.test(path) ? 'image/png' : 'image/jpeg' }));
  urlCache.set(path, url);
  return url;
}
