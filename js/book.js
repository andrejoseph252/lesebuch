// The book: PDF storage (IndexedDB only), PDF.js loading, text extraction, rendering, OCR.
import * as db from './db.js';

const VENDOR = new URL('../vendor/', import.meta.url).href;
let pdfjsPromise = null;
let docPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Konnte ${src} nicht laden`));
    document.head.append(s);
  });
}

export function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = loadScript(VENDOR + 'pdf.min.js').then(() => {
      const lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.js';
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function bookInfo() { return db.kv.get('book'); }

/** Open the stored PDF (cached). Resolves to null when no book is loaded. */
export function getDoc() {
  if (!docPromise) {
    docPromise = (async () => {
      const info = await db.kv.get('book');
      if (info?.format === 'epub') return null;
      const blob = await db.kv.get('pdf');
      if (!blob) return null;
      const lib = await pdfjs();
      return lib.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
        standardFontDataUrl: VENDOR + 'standard_fonts/',
        cMapUrl: VENDOR + 'cmaps/',
        cMapPacked: true,
        isEvalSupported: false,
      }).promise;
    })().catch((e) => { docPromise = null; throw e; });
  }
  return docPromise;
}

/**
 * Store a newly picked PDF. Returns { info, sameBook }.
 * If it is a different book than before, cached page text is dropped.
 */
export async function storeBook(file) {
  const lib = await pdfjs();
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data: buf.slice(), isEvalSupported: false }).promise;
  const fingerprint = doc.fingerprints?.[0] || `${file.name}:${file.size}`;
  const prev = await bookInfo();
  const sameBook = prev?.fingerprint === fingerprint;
  const info = { name: file.name, size: file.size, numPages: doc.numPages, fingerprint, loadedAt: Date.now() };
  await doc.destroy();
  if (!sameBook) await db.clear('pages');
  await db.kv.set('pdf', new Blob([buf], { type: 'application/pdf' }));
  await db.kv.del('epub');
  await db.kv.set('book', { ...info, format: 'pdf' });
  docPromise = null;
  return { info, sameBook };
}

function compactItems(content) {
  const out = [];
  for (const it of content.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
    out.push([it.str, +e.toFixed(1), +f.toFixed(1), +(it.width || 0).toFixed(1), +size.toFixed(1)]);
  }
  return out;
}

/** Extract text for every page not yet cached. progress(done, total). */
export async function extractAll(progress) {
  const doc = await getDoc();
  if (!doc) throw new Error('Kein Buch geladen');
  const have = new Set(await db.keys('pages'));
  const total = doc.numPages;
  let done = 0;
  const batch = [];
  for (let n = 1; n <= total; n++) {
    if (!have.has(n)) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = compactItems(content);
      const chars = items.reduce((s, i) => s + i[0].trim().length, 0);
      batch.push({ page: n, w: vp.width, h: vp.height, items, hasText: chars >= 8 });
      page.cleanup();
      if (batch.length >= 20) await db.putMany('pages', batch.splice(0));
    }
    done++;
    progress?.(done, total);
  }
  if (batch.length) await db.putMany('pages', batch);
  const info = await bookInfo();
  await db.kv.set('book', { ...info, extracted: true });
}

export async function getPage(n) { return db.get('pages', n); }

/** Render page n into canvas so it is cssWidth wide. Caps pixel area for iOS. */
export async function renderPage(n, canvas, cssWidth) {
  const doc = await getDoc();
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  let scale = (cssWidth / base.width) * dpr;
  const maxPixels = 14e6; // stay under Safari's ~16.7M canvas limit
  const area = base.width * base.height * scale * scale;
  if (area > maxPixels) scale *= Math.sqrt(maxPixels / area);
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${(cssWidth * base.height) / base.width}px`;
  const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
  await task.promise;
  return task;
}

// ---- OCR (tesseract.js, loaded from CDN only when asked) ----
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

export async function ocrPage(n, progress) {
  if (!window.Tesseract) await loadScript(TESSERACT);
  const doc = await getDoc();
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = 2.5;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  const { data } = await window.Tesseract.recognize(canvas, 'deu', {
    logger: (m) => { if (m.status === 'recognizing text') progress?.(m.progress); },
  });
  // Turn OCR words back into the same item format as the PDF text layer (PDF units, y up).
  const items = [];
  for (const line of data.lines || []) {
    // one baseline and size per OCR line, so words of a line regroup cleanly
    const lb = line.bbox;
    const baseY = line.baseline?.y0 ?? lb.y1;
    const size = Math.max(6, (line.rowAttributes?.row_height ?? lb.y1 - lb.y0) / scale * 0.8);
    const y = +(base.height - baseY / scale).toFixed(1);
    for (const w of line.words || []) {
      if (!w.text?.trim() || w.confidence < 30) continue;
      const { x0, x1 } = w.bbox;
      items.push([w.text, +(x0 / scale).toFixed(1), y, +((x1 - x0) / scale).toFixed(1), +size.toFixed(1)]);
    }
  }
  const rec = { page: n, w: base.width, h: base.height, items, hasText: items.length > 0, ocr: true };
  await db.put('pages', rec);
  return rec;
}
