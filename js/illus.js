// Illustrations: per-image display mode, crop and position. Defaults per edition, edits per device.
import { h, sheet, toast } from './ui.js';
import * as db from './db.js';
import { imageUrl } from './epubbook.js';

// What the EPUB calls "images" are a mix of real drawings, whole-page scans and blank slivers.
// mode: inline (in the text) | page (collapsed "Originalseite" card) | hidden. crop: [x, y, w, h] as fractions.
const DEFAULTS = {
  'image_0002_00.jpeg': { mode: 'inline' },
  'image_0003_00.jpeg': { mode: 'inline' },
  'image_0027_00.jpeg': { mode: 'hidden' },
  'image_0028_00.jpeg': { mode: 'inline' },
  'image_0028_01.jpeg': { mode: 'inline', crop: [0, 0.34, 1, 0.27] },
  'image_0034_00.jpeg': { mode: 'hidden' },
  'image_0049_00.jpeg': { mode: 'hidden' },
  'image_0088_00.jpeg': { mode: 'page' },
  'image_0122_00.jpeg': { mode: 'hidden' },
  'image_0165_00.jpeg': { mode: 'inline' },
  'image_0168_00.jpeg': { mode: 'hidden' },
  'image_0180_00.jpeg': { mode: 'hidden' },
};

const base = (path) => path.split('/').pop();

function guess(path, w, h) {
  const d = DEFAULTS[base(path)];
  if (d) return d;
  if (w && h && w > 1000 && h > 1800) return { mode: 'page' };          // whole scanned page
  if (w && h && (w / h > 3.5 || h / w > 3.5)) return { mode: 'hidden' }; // slivers
  return { mode: 'inline' };
}

let edits = null;
async function loadEdits() { edits ??= (await db.kv.get('imageEdits')) || {}; return edits; }
export async function getSetting(path, natural) {
  const e = (await loadEdits())[base(path)];
  return { pos: 'top', ...guess(path, natural?.w, natural?.h), ...(e || {}) };
}
async function saveSetting(path, value) {
  const all = await loadEdits();
  if (value) all[base(path)] = value; else delete all[base(path)];
  await db.kv.set('imageEdits', all);
}

const natCache = new Map();
async function natural(url) {
  if (natCache.has(url)) return natCache.get(url);
  const img = new Image();
  img.src = url;
  await img.decode();
  const n = { w: img.naturalWidth, h: img.naturalHeight, img };
  natCache.set(url, n);
  return n;
}

const cropCache = new Map();
async function croppedUrl(url, crop) {
  if (!crop) return url;
  const key = `${url}|${crop.join(',')}`;
  if (cropCache.has(key)) return cropCache.get(key);
  const { w, h, img } = await natural(url);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(crop[2] * w));
  c.height = Math.max(1, Math.round(crop[3] * h));
  c.getContext('2d').drawImage(img, crop[0] * w, crop[1] * h, c.width, c.height, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const out = URL.createObjectURL(blob);
  cropCache.set(key, out);
  return out;
}

/**
 * Render a page's images into two slots (above / below the text).
 * onChange re-renders the page after an edit.
 */
export async function renderIllustrations(paths, top, bottom, onChange) {
  let hidden = 0;
  for (const path of paths) {
    const url = await imageUrl(path).catch(() => null);
    if (!url) continue;
    const nat = await natural(url);
    const s = await getSetting(path, nat);
    if (s.mode === 'hidden') { hidden++; continue; }
    const slot = s.pos === 'bottom' ? bottom : top;
    if (s.mode === 'page') {
      slot.append(h('button', { class: 'scan-card', onclick: () => viewer(url, path, onChange) },
        h('img', { src: url, alt: '' }),
        h('span', {}, h('b', {}, 'Originalseite (Scan)'), h('span', { class: 'small' }, 'Antippen zum Ansehen und Zoomen'))));
    } else {
      const fig = h('figure', { class: 'illus-fig' },
        h('img', { class: 'illus', src: await croppedUrl(url, s.crop), alt: 'Illustration', onclick: () => viewer(url, path, onChange) }),
        h('button', { class: 'illus-edit', 'aria-label': 'Bild bearbeiten', onclick: () => editor(url, path, onChange) }, '✎'));
      slot.append(fig);
    }
  }
  if (hidden) {
    bottom.append(h('p', { class: 'center' }, h('button', { class: 'btn ghost small', onclick: () => hiddenList(paths, onChange) }, `${hidden} ausgeblendete${hidden === 1 ? 's Bild' : ' Bilder'}`)));
  }
}

async function hiddenList(paths, onChange) {
  const items = [];
  for (const p of paths) {
    const url = await imageUrl(p);
    const s = await getSetting(p, await natural(url));
    if (s.mode === 'hidden') items.push([p, url]);
  }
  const sh = sheet(h('div', {}, h('h3', {}, 'Ausgeblendete Bilder'),
    h('div', { class: 'row wrap' }, items.map(([p, url]) => h('button', { class: 'scan-card', onclick: () => { sh.close(); editor(url, p, onChange); } },
      h('img', { src: url, alt: '' }), h('span', {}, h('b', {}, 'Bearbeiten')))))));
}

/** Full-screen viewer with zoom; the original scan, uncropped. */
function viewer(url, path, onChange) {
  let zoom = 1;
  const img = h('img', { src: url, alt: 'Originalseite' });
  const wrap = h('div', { class: 'viewer-scroll' }, img);
  const setZoom = (z) => { zoom = z; img.style.width = `${z * 100}%`; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.z === z)); };
  const seg = h('div', { class: 'seg' }, [1, 2, 3].map((z) => h('button', { dataset: { z }, onclick: () => setZoom(z) }, `${z}×`)));
  const close = () => { el.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-label': 'Bild' },
    h('div', { class: 'viewer-bar' },
      h('button', { class: 'btn small', onclick: close }, 'Schliessen'), seg,
      h('button', { class: 'btn small', onclick: () => { close(); editor(url, path, onChange); } }, 'Bearbeiten')),
    wrap);
  img.addEventListener('dblclick', () => setZoom(zoom === 1 ? 2 : 1));
  document.addEventListener('keydown', esc);
  document.body.append(el);
  setZoom(1);
}

/** Crop + mode + position editor. */
async function editor(url, path, onChange) {
  const nat = await natural(url);
  const cur = await getSetting(path, nat);
  let mode = cur.mode, pos = cur.pos;
  let crop = cur.crop ? [...cur.crop] : [0, 0, 1, 1];

  const img = h('img', { src: url, alt: '', draggable: 'false' });
  const box = h('div', { class: 'crop-box' }, ['nw', 'ne', 'sw', 'se'].map((k) => h('span', { class: `crop-h ${k}`, dataset: { k } })));
  const stage = h('div', { class: 'crop-stage' }, img, box);
  const place = () => {
    Object.assign(box.style, { left: `${crop[0] * 100}%`, top: `${crop[1] * 100}%`, width: `${crop[2] * 100}%`, height: `${crop[3] * 100}%` });
  };
  place();

  // drag: corners resize, inside moves
  let drag = null;
  const MIN = 0.04;
  stage.addEventListener('pointerdown', (e) => {
    const r = stage.getBoundingClientRect();
    const k = e.target.dataset?.k || (e.target === box ? 'move' : null);
    if (!k) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drag = { k, x: e.clientX, y: e.clientY, r, start: [...crop] };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.r.width, dy = (e.clientY - drag.y) / drag.r.height;
    let [x, y, w, hh] = drag.start;
    if (drag.k === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx)); y = Math.min(1 - hh, Math.max(0, y + dy));
    } else {
      if (drag.k.includes('w')) { const nx = Math.min(x + w - MIN, Math.max(0, x + dx)); w += x - nx; x = nx; }
      if (drag.k.includes('e')) w = Math.min(1 - x, Math.max(MIN, w + dx));
      if (drag.k.includes('n')) { const ny = Math.min(y + hh - MIN, Math.max(0, y + dy)); hh += y - ny; y = ny; }
      if (drag.k.includes('s')) hh = Math.min(1 - y, Math.max(MIN, hh + dy));
    }
    crop = [x, y, w, hh];
    place();
  });
  const end = () => { drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  const segOf = (opts, val, set) => {
    const el = h('div', { class: 'seg full' }, opts.map(([v, l]) => h('button', { class: v === val ? 'on' : '', onclick: () => { set(v); el.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', opts[i][0] === v)); posRow.hidden = mode !== 'inline'; stage.parentElement.hidden = mode !== 'inline'; } }, l)));
    return el;
  };
  const modeSeg = segOf([['inline', 'Im Text'], ['page', 'Originalseite'], ['hidden', 'Ausblenden']], mode, (v) => { mode = v; });
  const posRow = h('div', { class: 'field' }, h('span', {}, 'Position'), segOf([['top', 'Über dem Text'], ['bottom', 'Unter dem Text']], pos, (v) => { pos = v; }));
  posRow.hidden = mode !== 'inline';

  const s = sheet(h('div', {},
    h('h3', {}, 'Bild bearbeiten'),
    h('div', { class: 'field' }, h('span', {}, 'Anzeige'), modeSeg),
    posRow,
    h('div', { class: 'field', hidden: mode !== 'inline' }, h('span', {}, 'Zuschneiden – Ecken ziehen, Rahmen verschieben'), stage,
      h('div', { class: 'row mt' }, h('button', { class: 'btn small', onclick: () => { crop = [0, 0, 1, 1]; place(); } }, 'Ganzes Bild'))),
    h('div', { class: 'row mt' },
      h('button', { class: 'btn', onclick: async () => { await saveSetting(path, null); s.close(); toast('Zurückgesetzt'); onChange?.(); } }, 'Standard'),
      h('button', { class: 'btn primary grow', onclick: async () => {
        const full = crop[0] < 0.005 && crop[1] < 0.005 && crop[2] > 0.99 && crop[3] > 0.99;
        await saveSetting(path, { mode, pos, crop: full ? null : crop.map((v) => +v.toFixed(4)) });
        s.close();
        toast('Bild gespeichert');
        onChange?.();
      } }, 'Speichern'))));
}
