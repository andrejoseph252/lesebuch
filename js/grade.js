import { t } from './i18n.js';
// Forgiving answer comparison + character diff. Pure functions.

const PUNCT = /[.,;:!?"'„“”‚‘’»«()\[\]…]/g;
export const norm = (s) => String(s ?? '').replace(PUNCT, '').replace(/\s+/g, ' ').trim();
const translit = (s) => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss');

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * kind: 'correct' | 'case' (fast richtig) | 'near' (one slip) | 'wrong'
 * translit: the answer used ae/oe/ue/ss for ä/ö/ü/ß.
 */
export function grade(input, expected) {
  const a = norm(input), e = norm(expected);
  if (!a) return { kind: 'wrong', translit: false };
  if (a === e) return { kind: 'correct', translit: false };
  const ta = translit(a), te = translit(e);
  if (ta === te) return { kind: 'correct', translit: true };
  if (a.toLowerCase() === e.toLowerCase() || ta.toLowerCase() === te.toLowerCase()) {
    return { kind: 'case', translit: ta !== a && a.toLowerCase() !== e.toLowerCase() };
  }
  const d = levenshtein(ta.toLowerCase(), te.toLowerCase());
  if ((e.length >= 4 && d <= 1) || (e.length >= 9 && d <= 2)) return { kind: 'near', translit: false };
  return { kind: 'wrong', translit: false };
}

/** Rating to preselect after a typed answer: correct → Gut, near-miss → Schwer, wrong → Nochmal. */
export function suggestRating(kind) {
  return kind === 'correct' ? 3 : kind === 'case' || kind === 'near' ? 2 : 1;
}

export function verdictText(r) {
  if (r.kind === 'correct') return r.translit ? t('Richtig – achte auf ä/ö/ü/ß') : t('Richtig');
  if (r.kind === 'case') return t('Fast richtig – Groß-/Kleinschreibung');
  if (r.kind === 'near') return t('Fast richtig');
  return t('Leider falsch');
}

/** Character-level diff: [{ op: '=', '-', '+', s }] turning `a` (typed) into `b` (expected). */
export function diffChars(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  const m = a.length, n = b.length;
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out = [];
  const push = (op, ch) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.s += ch; else out.push({ op, s: ch });
  };
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { push('=', a[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push('-', a[i++]);
    else push('+', b[j++]);
  }
  while (i < m) push('-', a[i++]);
  while (j < n) push('+', b[j++]);
  return out;
}
