// Cleaning for OCR'd EPUB pages (tuned to the Internet-Archive edition of the book this app is for).
// Pure functions: no DOM, runs in Node for testing. Output is derived at load time on the device;
// the repository only contains rules and position-based fixes, never book text.

export const CLEAN_VERSION = 1;

const FOOTER_RE = /\s*patreon\.com\/\S+\s+for\s+audio\b/i;
const NUMWORDS = ['eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
const ORD = '(?:\\p{Lu}\\p{Ll}+(?:stes|tes|es))';
// "Kapitel Drei (3)", "Kapitel Achtundzwanzig(28", "Zweites (2.) Kapitel", "Erstes Kapitel (1.)", "Sechsundzwanzigstes 177"
const HEADER_RES = [
  /^Kapitel\s+\p{Lu}\p{Ll}+\s*\(?\s*\d{1,2}\s*[.,]?\s*\)?/u,
  new RegExp(`^${ORD}\\s*(?:\\(\\s*\\d{1,2}\\s*[.,]?\\s*\\)?\\s*)?Kapitel(?:\\s*\\(\\s*\\d{1,2}\\s*[.,]?\\s*\\))?`, 'u'),
  new RegExp(`^${ORD}\\s*\\(\\s*\\d{1,2}[.,]?\\)?(?=\\s|$)`, 'u'),
  /^\p{Lu}\p{Ll}+(?:zigstes|zehntes)(?=\s)/u,
  /^Kapitel\s+\p{Lu}\p{Ll}+(?=\s)/u,
];
const HEADER_ANY = /(?:Kapitel\s+\p{Lu}\p{Ll}+\s*\(?\s*\d{1,2}\s*[.,]?\s*\)?|\p{Lu}\p{Ll}+(?:stes|tes)\s*\(\s*\d{1,2}\s*[.,]?\s*\)?\s*Kapitel|\p{Lu}\p{Ll}+(?:stes|tes)\s+Kapitel\s*\(\s*\d{1,2}\s*\.?\s*\)|\p{Lu}\p{Ll}+(?:undzwanzigstes|zehntes)(?=\s+\d|\s*$))/gu;

/** Chapter number from a running header, or null. */
export function headerNum(h) {
  const m = h.match(/\(\s*(\d{1,2})/) || h.match(/\b(\d{1,2})\b/);
  if (m) return +m[1];
  const w = h.match(/Kapitel\s+(\p{L}+)/u)?.[1]?.toLowerCase();
  const i = NUMWORDS.indexOf(w);
  return i >= 0 ? i + 1 : null;
}

/** Strip leading running headers (sometimes two). Returns { text, num }. */
export function stripHeader(text) {
  let num = null;
  for (let k = 0; k < 3; k++) {
    let hit = false;
    for (const re of HEADER_RES) {
      const m = text.match(re);
      if (m) { num ??= headerNum(m[0]); text = text.slice(m[0].length).trimStart(); hit = true; break; }
    }
    if (!hit) break;
  }
  return { text, num };
}

// ---------- fixes ----------
/**
 * Apply position-based fixes to a page's raw text.
 * fix: { g: [[a,b]] gloss, x: [[a,b]] drop, m: [[a,b]] main, mv: [[a,b,at]] move main range, r: [[a,b,'word']] replace }
 * Returns { main: string, glosses: [string] }.
 */
export function splitPage(raw, fix = {}, fileNo = null) {
  const n = raw.length;
  const cls = new Array(n).fill('M');
  const sub = new Array(n).fill(null);
  const f = raw.search(FOOTER_RE);
  if (f >= 0) {
    const fm = raw.slice(f).match(FOOTER_RE)[0];
    for (let i = f; i < f + fm.length; i++) cls[i] = 'X';
    for (let i = f + fm.length; i < n; i++) cls[i] = 'G';
  }
  // Glosses printed in the outer margin of right-hand pages come first in the OCR text and end
  // with the printed page number: "<header> <glosses> 130 <main text>". Everything before it is gloss.
  const lead = fix.lead === undefined ? leadingPageNumber(raw, f < 0 ? n : f, fileNo) : fix.lead;
  if (lead) {
    const [a, b] = lead;
    const hdr = stripHeader(raw.slice(0, a));
    const start = a - hdr.text.length;
    for (let i = start; i < a; i++) cls[i] = 'G';
    for (let i = a; i < b; i++) cls[i] = 'X';
  }
  const mark = (ranges, c) => (ranges || []).forEach(([a, b]) => { for (let i = a; i < b && i < n; i++) cls[i] = c; });
  mark(fix.g, 'G'); mark(fix.w, 'W'); mark(fix.x, 'X'); mark(fix.m, 'M');
  for (const [a, b, w] of fix.r || []) {
    const keep = cls[a] === 'W' || cls[a] === 'G' ? cls[a] : 'M';
    for (let i = a; i < b && i < n; i++) { sub[i] = ''; cls[i] = keep; }
    sub[a] = w;
  }
  let order = [...Array(n).keys()];
  for (const [a, b, at] of fix.mv || []) {
    const moved = order.filter((i) => i >= a && i < b);
    order = order.filter((i) => i < a || i >= b);
    const pos = order.indexOf(order.find((i) => i >= at) ?? n);
    order.splice(pos < 0 ? order.length : pos, 0, ...moved, -1);
    for (let i = a; i < b; i++) cls[i] = 'M';
  }
  let main = '', words = '';
  const glosses = [];
  let run = null;
  for (const i of order) {
    if (i < 0) { main += ' '; continue; }
    const ch = sub[i] ?? raw[i];
    if (cls[i] === 'G') { run = (run ?? '') + ch; continue; }
    if (run !== null) { glosses.push(run); run = null; }
    if (cls[i] === 'M') main += ch;
    else { main += ' '; if (cls[i] === 'W') words += ch; else words += ' '; }
  }
  if (run !== null) glosses.push(run);
  return {
    main: main.replace(/\s+/g, ' ').trim(),
    glosses: glosses.map((g) => g.replace(/\s+/g, ' ').trim()).filter((g) => /\p{L}{2}/u.test(g)),
    words: words.split(/\s+/).map((w) => w.replace(/^[^\p{L}]+|[^\p{L})]+$/gu, '')).filter((w) => /\p{L}{2}/u.test(w) && !/^W[ÖO]RTER$/.test(w)),
  };
}

/** Position [start, end) of a printed page number that closes a leading gloss column, or null. */
export function leadingPageNumber(raw, limit, fileNo) {
  if (fileNo == null) return null;
  const re = /(^|\s)(\d{2,3})(?=\s)/g;
  let m;
  while ((m = re.exec(raw))) {
    const at = m.index + m[1].length;
    if (at > limit * 0.7) break;
    const num = +m[2];
    if (num < fileNo - 12 || num > fileNo + 12) continue;
    const before = raw.slice(Math.max(0, at - 3), at), after = raw.slice(at + m[2].length, at + m[2].length + 12);
    if (/[(=]\s*$/.test(before) || /^\s*[)=.,]|^\s*(Mark|Uhr|Minuten|Jahre|Pfennig|Kilo|Prozent|Tage|Stunden)\b/.test(after)) continue;
    const head = stripHeader(raw.slice(0, at)).text.trim();
    if (!head) return null; // number right after the running header: nothing to split off
    return [at, at + m[2].length];
  }
  return null;
}

// ---------- word repair ----------
// Glued words like "istdie", "Eristsiebenundsechzig", "undals": only split after a short function word,
// and only when the glued form is (nearly) unique in the book while the parts are common.
const GLUE_HEAD = new Set('ist sind hat die der das und von nicht als wie auch aber oder ja nein nur'.split(' '));
const GLUE_ANY = new Set([...GLUE_HEAD, 'er', 'sie', 'es', 'ein', 'eine', 'in', 'zu', 'im', 'am']);
const GLUE_PREP = new Set(['auf', 'in', 'an', 'mit', 'von', 'zu', 'aus', 'bei', 'nach', 'für']);
const GLUE_ART = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'einem', 'einen', 'einer']);
const GLUE_TAIL = new Set(['und', 'hat', 'ist', 'ich', 'ein']);
const GLUE_LEAD = new Set(['du', 'ich', 'man']);
const GLUE_VERB = new Set(['ist', 'sind', 'hat', 'war', 'und']);
const GLUE_PRON = new Set(['es', 'er', 'sie', 'ein', 'eine', 'die', 'der', 'das', 'nicht']);

/** Build a word-frequency table from the whole book (used to split OCR-merged words). */
export function vocabulary(texts) {
  const freq = new Map();
  for (const t of texts) for (const w of t.match(/\p{L}+/gu) || []) {
    const k = w.toLowerCase();
    freq.set(k, (freq.get(k) || 0) + 1);
  }
  return freq;
}

function splitMerged(word, freq) {
  const lw = word.toLowerCase();
  if (lw.length < 4) return null;
  if ((freq.get(lw) || 0) > 1 || lw.length < 5) {
    for (let i = 2; i < lw.length - 1; i++) {
      const a = lw.slice(0, i), rest = lw.slice(i);
      if (GLUE_VERB.has(a) && GLUE_PRON.has(rest)) return `${word.slice(0, i)} ${word.slice(i)}`;
      // "zuessen": zu + a very common infinitive (never a real word)
      if (a === 'zu' && rest.endsWith('en') && (freq.get(rest) || 0) >= 5 && !(freq.get(lw) > 5)) return `${word.slice(0, i)} ${word.slice(i)}`;
    }
    return null;
  }
  const common = (s) => (freq.get(s) || 0) >= 5 || GLUE_ANY.has(s);
  for (let i = 2; i < lw.length - 1; i++) {
    const a = lw.slice(0, i), rest = lw.slice(i);
    // "istes": verb + pronoun
    if (GLUE_VERB.has(a) && GLUE_PRON.has(rest)) return `${word.slice(0, i)} ${word.slice(i)}`;
    // "istdie", "undals": function word + common word
    if (GLUE_HEAD.has(a) && common(rest)) return `${word.slice(0, i)} ${word.slice(i)}`;
    // "altist": common word + function word
    if (common(a) && a.length >= 3 && GLUE_HEAD.has(rest) && (freq.get(a) || 0) >= 5) return `${word.slice(0, i)} ${word.slice(i)}`;
    // "gutund", "Sollich", "verschüttethat": known word + und/hat/ist/ich
    if (GLUE_TAIL.has(rest) && (freq.get(a) || 0) >= 2 && a.length >= 3) return `${word.slice(0, i)} ${word.slice(i)}`;
    // "Aufden", "inder": preposition + article
    if (GLUE_PREP.has(a) && GLUE_ART.has(rest)) return `${word.slice(0, i)} ${word.slice(i)}`;
    // "zubesuchen": zu + infinitive
    if (a === 'zu' && rest.endsWith('en') && (freq.get(rest) || 0) >= 5) return `${word.slice(0, i)} ${word.slice(i)}`;
    // "Erkostet", "Wirhaben": capitalised pronoun + known word
    if (/^(Er|Wir|Sie|Es)$/.test(word.slice(0, i)) && (freq.get(rest) || 0) >= 2 && rest.length >= 4) return `${word.slice(0, i)} ${word.slice(i)}`;
    // "Dukennst", "manein": du/ich/man + known word
    if (GLUE_LEAD.has(a) && (freq.get(rest) || 0) >= 2 && rest.length >= 3) return `${word.slice(0, i)} ${word.slice(i)}`;
    // "Eristsiebenundsechzig": pronoun + function word + common word
    if (GLUE_ANY.has(a)) {
      for (let j = 2; j < rest.length - 1; j++) {
        const b = rest.slice(0, j), c = rest.slice(j);
        if (GLUE_HEAD.has(b) && common(c)) return `${word.slice(0, i)} ${word.slice(i, i + j)} ${word.slice(i + j)}`;
      }
    }
  }
  return null;
}

export function repairText(text, freq) {
  return text
    .replace(/(\p{Ll}{2,})\.(\p{Lu}\p{Ll})/gu, '$1. $2')       // "Glieder.Welches" -> "Glieder. Welches"
    .replace(/(^|\s)(Ist|Hat|Sind)\. (?=\p{Lu})/gu, '$1$2 ')  // "Ist.Hans" -> "Ist Hans"
    .replace(/(\p{L})[‘'](?=\s\p{Lu})/gu, '$1')              // "Herr‘ Müller"
    .replace(/(\p{Ll})(\p{Lu}\p{Ll}+)/gu, (m, a, b) => `${a} ${b}`) // "vonFrau", "IstHans" -> split at case change
    .replace(/(\p{Ll}),(?=\p{L})/gu, '$1, ')                // "Ja,für" -> "Ja, für"
    .replace(/\p{L}{5,}/gu, (w) => splitMerged(w, freq) || w)
    .replace(/(\p{Ll}{2,})- (\p{Ll}{2,})/gu, '$1$2')         // line-break hyphen "Deutsch- land"
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- sections & exercises ----------
const GAPCH = '-–—=+_~»«„“';
const isGapToken = (t) => {
  const core = t.replace(/^[,.;:]+|[,.;:?!]+$/g, '');
  return core.length > 0 && [...core].every((c) => GAPCH.includes(c) || c === ',' || c === '.') && /[-–—=+_~]/.test(core);
};

/** Turn an Übung A sentence into segments: [{t:'text', v}, {t:'gap'}]. */
export function gapSegments(sentence) {
  const s = sentence
    .replace(/(\p{L})-(?=\s*[.,;:?!]|\s+[-–—=+]|\s*$)/gu, '$1 -')  // "fünf- ." -> "fünf - ."
    .replace(/(^|\s)([-–—=+]+)['’]?(?=\p{L})/gu, '$1$2 ')           // "-'von" -> "- von"
    .replace(/([-–—=+])\s*,\s*(?=[-–—=+])/g, '$1 , ');
  const segs = [];
  const push = (v) => {
    const last = segs[segs.length - 1];
    if (last?.t === 'text') last.v += v; else segs.push({ t: 'text', v });
  };
  for (const tok of s.split(/(\s+)/)) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) { push(' '); continue; }
    if (isGapToken(tok)) {
      // a gap token may carry trailing punctuation, e.g. "-.." or "-,"
      const pre = tok.match(/^[,.;:]*/)[0];
      const post = (tok.match(/[,.;:?!]+$/) || [''])[0].replace(/^\.\.$/, '.');
      const groups = tok.slice(pre.length, tok.length - (tok.match(/[,.;:?!]+$/) || [''])[0].length).split(',').filter(Boolean);
      if (pre) push(pre);
      groups.forEach((_, i) => { if (i) push(', '); segs.push({ t: 'gap', answer: null }); });
      if (post) push(post);
    } else push(tok);
  }
  // tidy spaces around punctuation inside text segments
  for (const g of segs) if (g.t === 'text') g.v = g.v.replace(/\s+([,.;:?!])/g, '$1').replace(/\s{2,}/g, ' ');
  return segs;
}

/** Remove answer lines / noise from an Übung B question. */
export function cleanQuestion(q) {
  const qm = q.lastIndexOf('?');
  if (qm >= 0) q = q.slice(0, qm + 1);
  const toks = q.split(/\s+/).filter((t) => !isGapToken(t) && !/^[«»„“"'+=~.,;:|\]\[]+$/.test(t));
  while (toks.length && !/\p{L}{2}/u.test(toks[0])) toks.shift();
  return toks.join(' ')
    .replace(/[-–—=+»«„“]+$/g, '').replace(/\s+([,.;:?!])/g, '$1').trim();
}

const SECTION_RE = /(?<!\p{L})(?:ÜBUNG|UBUNG|ÜBUNGEN)\s+([A-D])(?!\p{L})\s*/gu;
const WORDS_RE = /(?<!\p{L})W[ÖO]RTER\s*:\s*/u;
const TITLE_RE = /(?:^|(?<=[.!?”"]\s))((?:(?:[A-ZÄÖÜ]{2,}|UND|DER|DIE|DAS|IM|AM|IN|AUF)\s+)*[A-ZÄÖÜ]{3,})(?=\s+["„“”»]?\p{Lu}\p{Ll})/u;
const LOWER = new Set(['und', 'der', 'die', 'das', 'im', 'am', 'in', 'auf', 'an', 'zum', 'zur', 'mit', 'von', 'beim', 'ein', 'eine', 'des', 'dem', 'den']);
export function titleCase(s) {
  return s.toLowerCase().split(/\s+/).map((w, i) => (i && LOWER.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

const SENT_END = /([.!?])(?:["”“»]?)(?=\s*["„“”»]?\s*(?:\p{Lu}|[-–—=+]{1,}\s)|\s*$)/gu;
export function sentences(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(SENT_END)) {
    const end = m.index + m[0].length;
    const s = text.slice(last, end).trim();
    if (s) out.push(s);
    last = end;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Clean the whole book. pages: [{ href, text, images }] in spine order.
 * Returns { pages: [{ page, href, images, chapter, blocks, glosses, words, raw }], chapters, exercises }
 */
export function cleanBook(pages, { fixes = {}, chapters: chapterTable = null, skip = [] } = {}) {
  const content = pages.filter((p) => !skip.includes(p.href));
  const split = content.map((p) => {
    const fx = fixes[p.href];
    const ok = !fx || fx.len === undefined || fx.len === p.text.length;
    const fileNo = +(p.href.match(/(\d+)\.x?html?$/)?.[1] ?? NaN);
    return splitPage(p.text, ok ? fx : {}, Number.isFinite(fileNo) ? fileNo : null);
  });
  const freq = vocabulary(split.map((s) => s.main));
  const out = [];
  const exercises = [];
  let chapter = 0;
  let section = 'text';
  let carry = null; // unfinished exercise sentence carried to the next page
  const startOf = new Map((chapterTable || []).map(([href, title], i) => [href, { num: i + 1, title }]));

  content.forEach((p, idx) => {
    const page = idx + 1;
    let { main, glosses } = split[idx];
    const words = [...split[idx].words];
    const hdr = stripHeader(main);
    main = hdr.text;
    const tableStart = startOf.get(p.href);
    const newChapter = tableStart ? tableStart.num : (hdr.num && hdr.num > chapter ? hdr.num : null);
    if (newChapter) { chapter = newChapter; section = 'text'; carry = null; }

    // page numbers glued next to header/footer
    main = main.replace(/^\d{1,3}\s+(?=\S)/, '').replace(/\s+\d{1,3}$/, '');
    glosses = glosses
      .map((g) => g.replace(HEADER_ANY, ' ').replace(/(^|\s)\d{1,3}(?=\s*$)/, ' ').replace(/^\s*\d{1,3}\s+/, '').replace(/\s+/g, ' ').trim())
      .filter((g) => /\p{L}{2}/u.test(g));
    glosses = glosses.filter((g) => {
      const m = g.match(WORDS_RE);
      if (!m) return true;
      words.push(...g.slice(m.index + m[0].length).split(/\s+/).filter((w) => /\p{L}/u.test(w)));
      const before = g.slice(0, m.index).trim();
      return before ? (glosses.push(before), false) : false;
    });

    // split main into sections at ÜBUNG markers and WÖRTER lists
    const blocks = [];
    let rest = repairText(main, freq);
    const wm = rest.match(WORDS_RE);
    if (wm) {
      // a WÖRTER list inside the main column runs to the end unless a fix says otherwise
      words.push(...rest.slice(wm.index + wm[0].length).split(/\s+/).filter((w) => /\p{L}/u.test(w)));
      rest = rest.slice(0, wm.index).trim();
    }
    const parts = [];
    let lastIdx = 0, cur = section;
    for (const m of rest.matchAll(SECTION_RE)) {
      parts.push({ sec: cur, text: rest.slice(lastIdx, m.index) });
      cur = m[1];
      parts.push({ marker: m[1] });
      lastIdx = m.index + m[0].length;
    }
    parts.push({ sec: cur, text: rest.slice(lastIdx) });
    section = cur;

    for (const part of parts) {
      if (part.marker) { blocks.push({ kind: 'h', text: `Übung ${part.marker}` }); carry = null; continue; }
      let t = part.text.trim();
      if (!t) continue;
      if (part.sec === 'text') {
        const tm = t.match(TITLE_RE);
        if (tm && tm.index < 3) {
          blocks.push({ kind: 'h', big: true, text: titleCase(tm[1]) });
          t = t.slice(tm.index + tm[0].length).trim();
        } else if (tm) {
          blocks.push({ kind: 'p', text: t.slice(0, tm.index).trim() });
          blocks.push({ kind: 'h', big: true, text: titleCase(tm[1]) });
          t = t.slice(tm.index + tm[0].length).trim();
        }
        if (t) blocks.push({ kind: 'p', text: t });
      } else {
        t = t.replace(/([?!])(?=[^\s"”“»)])/g, '$1 ')
          .replace(/\s‚(?=\s*\p{L})/gu, ', ')          // low single quote used as comma
          .replace(/\s„\s*(?=\p{Lu})/gu, '. ')        // low double quote used as full stop
          .replace(/\s„(?=,)/g, '')
          .replace(/,,+/g, ',');
        if (carry) t = `${carry.text} ${t}`;
        const ss = sentences(t);
        const items = [];
        ss.forEach((s, i) => {
          const last = i === ss.length - 1 && !/[.!?]["”]?$/.test(s);
          if (last) { carry = { text: s, page: carry && i === 0 ? carry.page : page }; return; }
          const itemPage = i === 0 && carry ? carry.page : page;
          if (i === 0) carry = null;
          const item = part.sec === 'A' || (part.sec !== 'B' && /(^|\s)[-–—=+]/.test(s))
            ? { type: 'gap', segs: gapSegments(s) }
            : { type: 'answer', q: cleanQuestion(s) };
          if (item.type === 'gap' && !item.segs.some((g) => g.t === 'gap')) return;
          if (item.type === 'answer' && (!/\p{L}{2}.*\?/u.test(item.q) || /\.{3,}/.test(item.q) || (item.q.match(/\p{L}{2,}/gu) || []).length < 3 || /^Beispiel/.test(item.q))) return;
          item.text = item.type === 'gap' ? item.segs.map((g) => (g.t === 'gap' ? '…' : g.v)).join('') : item.q;
          items.push(item);
          exercises.push({ ...item, chapter, page: itemPage, sec: part.sec });
        });
        if (items.length) blocks.push({ kind: 'ex', sec: part.sec, items });
      }
    }
    out.push({ page, href: p.href, images: p.images, chapter, blocks, glosses, words, raw: p.text });
  });

  // chapters: from the table if given, else from first page of each detected chapter number
  const chapters = [];
  for (const pg of out) {
    if (pg.chapter && !chapters.some((c) => c.num === pg.chapter)) {
      const t = startOf.get(pg.href)?.title || pg.blocks.find((b) => b.kind === 'h' && b.big)?.text || '';
      chapters.push({ num: pg.chapter, startPage: pg.page, title: t });
    }
  }
  autoAnswers(exercises, out);
  return { pages: out, chapters, exercises };
}

const FUNCTION_LC = new Set('ihr ihre ihren sein seine seinen er sie es der die das den dem des ein eine einen wir'.split(' '));

/** Fill gap answers that can be read straight off the chapter text (exercise sentences echo the reading). */
export function autoAnswers(exercises, pages) {
  const byChapter = new Map();
  for (const p of pages) {
    const t = p.blocks.filter((b) => b.kind === 'p').map((b) => b.text).join(' ');
    byChapter.set(p.chapter, `${byChapter.get(p.chapter) || ''} ${t}`);
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const ex of exercises) {
    if (ex.type !== 'gap') continue;
    // search this chapter first, then all earlier chapters
    const corpus = [byChapter.get(ex.chapter) || '', ...[...byChapter.entries()].filter(([c]) => c < ex.chapter).map(([, t]) => t)].join(' ')
      .replace(/\s*\(\d{1,4}[.,]?\)/g, '');
    // match clause by clause so a paraphrased half does not block the other
    const clauses = [];
    let curr = [];
    for (const s of ex.segs) {
      if (s.t === 'text' && /[;]/.test(s.v)) {
        const [a, ...b] = s.v.split(';');
        curr.push({ t: 'text', v: `${a};` });
        clauses.push(curr);
        curr = [{ t: 'text', v: b.join(';') }];
      } else curr.push(s);
    }
    clauses.push(curr);
    for (const cl of clauses) {
      const gaps = cl.filter((s) => s.t === 'gap');
      if (!gaps.length) continue;
      const words = cl.map((s) => (s.t === 'gap' ? '(\\p{L}+)' : esc(s.v.trim()).replace(/\s+/g, '\\s+'))).filter(Boolean);
      const literal = cl.filter((s) => s.t === 'text').map((s) => s.v).join(' ').match(/\p{L}+/gu) || [];
      const need = gaps.length > 1 ? gaps.length * 2 + 2 : clauses.length > 1 ? 4 : 3;
      if (literal.length < need) continue; // too little context to be sure
      const re = new RegExp(`(?:^|[^\\p{L}])${words.join('\\s*')}(?=[^\\p{L}]|$)`, 'gu');
      const found = new Set();
      let caps = null;
      for (const m of corpus.matchAll(re)) { found.add(m.slice(1).join('|')); caps = m.slice(1); if (found.size > 1) break; }
      // a sentence-initial gap must not be answered by a word found mid-sentence
      if (found.size === 1 && cl === clauses[0] && cl[0] === gaps[0] && /^\p{Ll}/u.test(caps[0])) continue;
      if (found.size === 1) {
        gaps.forEach((g, i) => {
          // a capitalised hit for a mid-sentence gap came from a sentence start in the text: lower-case it
          const first = cl.findIndex((x) => x === g) === 0 && cl === clauses[0];
          g.answer = !first && /^\p{Lu}\p{Ll}+$/u.test(caps[i]) && FUNCTION_LC.has(caps[i].toLowerCase()) ? caps[i].toLowerCase() : caps[i];
          g.auto = true;
        });
      }
    }
    ex.text = ex.segs.map((g) => (g.t === 'gap' ? '…' : g.v)).join('');
  }
}
