// Turn positioned PDF text items into readable blocks. Pure functions (no DOM), testable in Node.
// Item format (see book.js): [str, x, y, width, fontSize] in PDF units, y grows upward.

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Join two lines of a paragraph, undoing hyphenation at the line break. */
export function joinLines(a, b) {
  if (!a) return b;
  if (!b) return a;
  const m = a.match(/(\p{L})[-­]$/u);
  if (m) {
    // "Fenster-" + "bank" -> "Fensterbank"; "Ost-" + "West" keeps the real hyphen
    if (/^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
    return a + b;
  }
  return `${a} ${b}`;
}

function rowsFromItems(items) {
  const sorted = items
    .map(([s, x, y, w, size]) => ({ s, x, y, w, size: size || 10 }))
    .filter((i) => i.s.trim().length)
    .sort((p, q) => q.y - p.y || p.x - q.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - it.y) <= Math.max(2, 0.45 * Math.min(row.size, it.size))) {
      row.items.push(it);
      row.size = Math.max(row.size, it.size);
    } else {
      rows.push({ y: it.y, size: it.size, items: [it] });
    }
  }
  return rows;
}

function segmentText(items) {
  let text = '';
  let prev = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if (gap > 0.15 * it.size && !/\s$/.test(text) && !/^\s/.test(it.s)) text += ' ';
    }
    text += it.s;
    prev = it;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Split each row into column segments (main text vs. side glosses). */
function segmentsFromRows(rows, boundaryX) {
  const segs = [];
  for (const row of rows) {
    const its = row.items.sort((p, q) => p.x - q.x);
    let cur = [its[0]];
    for (let i = 1; i < its.length; i++) {
      const prev = its[i - 1], it = its[i];
      const gap = it.x - (prev.x + prev.w);
      const crosses = boundaryX != null && prev.x < boundaryX && it.x >= boundaryX;
      if (gap > 2.5 * it.size || (crosses && gap > 0.3 * it.size)) {
        segs.push(cur);
        cur = [it];
      } else cur.push(it);
    }
    segs.push(cur);
  }
  return segs.map((its) => {
    const last = its[its.length - 1];
    const size = median(its.map((i) => i.size));
    return {
      text: segmentText(its),
      x: its[0].x,
      xEnd: last.x + last.w,
      y: median(its.map((i) => i.y)),
      size,
    };
  }).filter((s) => s.text);
}

/**
 * Lay out one page.
 * opts: { marginSide: 'right'|'left'|'off', marginThreshold: 0..1 }
 * Returns { blocks: [{ kind: 'p'|'h', big, text, lines: [{text,y,x}], notes: [string] }], lines, size }
 */
export function layoutPage(rec, opts = {}) {
  const { marginSide = 'right', marginThreshold = 0.68 } = opts;
  const W = rec.w || 600, H = rec.h || 800;
  const boundaryX = marginSide === 'off' ? null : marginThreshold * W;
  const segs = segmentsFromRows(rowsFromItems(rec.items || []), boundaryX);

  const main = [], margin = [];
  for (const s of segs) {
    // bare page numbers near top/bottom edge
    if (/^[-–—\s]*\d{1,4}[-–—\s]*$/.test(s.text) && (s.y < H * 0.09 || s.y > H * 0.91)) continue;
    const isMargin = marginSide === 'right' ? s.x >= boundaryX
      : marginSide === 'left' ? s.xEnd <= boundaryX : false;
    (isMargin ? margin : main).push(s);
  }
  main.sort((a, b) => b.y - a.y || a.x - b.x);
  margin.sort((a, b) => b.y - a.y || a.x - b.x);

  const bodySize = median(main.map((l) => l.size)) || 10;
  const leftX = median(main.filter((l) => Math.abs(l.size - bodySize) < 0.5).map((l) => l.x)) || 0;
  const gaps = [];
  for (let i = 1; i < main.length; i++) {
    const g = main[i - 1].y - main[i].y;
    if (g > 0 && g < 3 * bodySize) gaps.push(g);
  }
  const lineGap = median(gaps) || bodySize * 1.3;
  const fullWidth = median(main.map((l) => l.xEnd - l.x)) || W * 0.6;

  // ---- paragraphs ----
  const blocks = [];
  let cur = null;
  const isHead = (l) => l.size > bodySize * 1.15;
  for (let i = 0; i < main.length; i++) {
    const l = main[i], prev = main[i - 1];
    let brk = !cur;
    if (prev && cur) {
      const gap = prev.y - l.y;
      const sizeChange = Math.abs(l.size - prev.size) > 0.15 * bodySize;
      const indented = l.x > leftX + 0.8 * bodySize && l.x < leftX + 6 * bodySize;
      const prevShortEnd = (prev.xEnd - prev.x) < fullWidth * 0.75 && /[.!?:“”"»«)]$/.test(prev.text) && !/^\p{Ll}/u.test(l.text);
      const listItem = /^(\d{1,2}|[a-h])[.)]\s/.test(l.text);
      brk = gap > lineGap * 1.45 || sizeChange || indented || prevShortEnd || listItem || isHead(l) !== isHead(prev);
    }
    if (brk) {
      cur = { kind: isHead(l) ? 'h' : 'p', big: l.size > bodySize * 1.4, text: '', lines: [], notes: [], top: l.y + l.size, bottom: l.y };
      blocks.push(cur);
    }
    cur.text = joinLines(cur.text, l.text);
    cur.lines.push({ text: l.text, y: l.y, x: l.x });
    cur.bottom = l.y;
  }

  // ---- margin notes: merge close lines, attach to the block beside them ----
  const notes = [];
  for (const m of margin) {
    const last = notes[notes.length - 1];
    if (last && last.bottom - m.y < m.size * 2.2 && /[,;:(\-\u00AD–]$/.test(last.text)) {
      last.text = joinLines(last.text, m.text);
      last.bottom = m.y;
    } else notes.push({ text: m.text, top: m.y + m.size, bottom: m.y });
  }
  for (const n of notes) {
    if (!blocks.length) {
      blocks.push({ kind: 'p', text: '', lines: [], notes: [], top: n.top, bottom: n.bottom });
    }
    let target = blocks.find((b) => n.top >= b.bottom - bodySize * 0.6 && n.top <= b.top + bodySize * 0.6);
    if (!target) target = [...blocks].reverse().find((b) => b.top >= n.top) || blocks[0];
    target.notes.push(n.text);
  }

  const lines = blocks.flatMap((b) => b.lines.map((l) => l.text));
  return { blocks, lines, size: bodySize };
}

// ---- sentences & tokens ----

const ABBR = new Set(['z', 'b', 'd', 'h', 'u', 'a', 's', 'nr', 'dr', 'hr', 'fr', 'st', 'usw', 'bzw', 'ca', 'vgl', 'evtl', 'ggf', 'etc', 'bzw', 'inkl', 'str', 'tel', 'mio', 'jh']);

/** Split text into sentences: [{ text, start, end }]. Gap markers (.., …, ___) never end a sentence. */
export function splitSentences(text) {
  const out = [];
  let start = 0;
  const re = /([.!?]+)(["“”»«)’']*)(\s+)/g;
  let m;
  while ((m = re.exec(text))) {
    const punct = m[1];
    if (/^\.{2,}$/.test(punct)) continue;
    const before = text.slice(start, m.index);
    const lastWord = (before.match(/([\p{L}\d]+)$/u) || [])[1] || '';
    if (punct === '.' && (ABBR.has(lastWord.toLowerCase()) || /^\d+$/.test(lastWord) && before.trim() === lastWord)) continue;
    const next = text.slice(re.lastIndex, re.lastIndex + 2);
    if (punct === '.' && /^\p{Ll}/u.test(next)) continue;
    const end = m.index + punct.length + m[2].length;
    out.push({ text: text.slice(start, end), start, end });
    start = re.lastIndex;
  }
  if (start < text.length && text.slice(start).trim()) out.push({ text: text.slice(start).trimEnd(), start, end: text.trimEnd().length });
  return out;
}

const WORD_RE = /[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*/gu;

/** Tokens: [{ t: 'w'|'x', v, start }] — words and the stuff between them. */
export function tokenize(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (m.index > last) out.push({ t: 'x', v: text.slice(last, m.index), start: last });
    out.push({ t: 'w', v: m[0], start: m.index });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'x', v: text.slice(last), start: last });
  return out;
}

// Gap markers used by exercises: …, ..(.), __+ . A letter stem right before it stays visible text.
export const GAP_RE = /…+|\.{2,}|_{2,}/g;
export function hasGap(text) { GAP_RE.lastIndex = 0; return GAP_RE.test(text); }

/** Chapter heading detection for auto-detect. Returns a title or null. */
const NUM_WORDS = ['eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf',
  'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig'];
const ORDINALS = ['erstes', 'zweites', 'drittes', 'viertes', 'fünftes', 'sechstes', 'siebtes', 'achtes', 'neuntes', 'zehntes',
  'elftes', 'zwölftes', 'dreizehntes', 'vierzehntes', 'fünfzehntes', 'sechzehntes', 'siebzehntes', 'achtzehntes', 'neunzehntes', 'zwanzigstes'];
export function chapterHeading(line) {
  const s = line.trim();
  let m = s.match(new RegExp(`^(kapitel|lektion)\\s+(\\d{1,3}|[ivxlc]{1,7}|${NUM_WORDS.join('|')})\\b`, 'iu'));
  if (m) {
    const num = /^\d+$/.test(m[2]) ? +m[2] : NUM_WORDS.indexOf(m[2].toLowerCase()) + 1 || romanToInt(m[2]);
    return { num, title: s };
  }
  m = s.match(new RegExp(`^(${ORDINALS.join('|')})\\s+(kapitel|lektion)\\b`, 'iu'));
  if (m) return { num: ORDINALS.indexOf(m[1].toLowerCase()) + 1, title: s };
  return null;
}
function romanToInt(r) {
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let n = 0;
  const s = r.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]], b = v[s[i + 1]] || 0;
    n += a < b ? -a : a;
  }
  return n || null;
}
