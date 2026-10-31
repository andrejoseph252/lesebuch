// Scheduler + pure-logic tests. Run: node test/fsrs.test.mjs
import assert from 'node:assert/strict';
import { createScheduler, retrievability, intervalFor, DEFAULT_W, FACTOR, DAY_MS, RELEARN_MS } from '../js/fsrs.js';
import { grade } from '../js/grade.js';
import { splitSentences, joinLines, chapterHeading } from '../js/layout.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

console.log('FSRS v4.5');
test('17 default weights, FACTOR = 19/81', () => { assert.equal(DEFAULT_W.length, 17); near(FACTOR, 19 / 81); });
test('R(0, S) = 1', () => near(retrievability(0, 5), 1));
test('R(S, S) = 0.9', () => { near(retrievability(5, 5), 0.9); near(retrievability(42, 42), 0.9); });
test('interval at r = 0.9 equals S', () => { near(intervalFor(7.3, 0.9), 7.3); near(intervalFor(100, 0.9), 100); });
test('higher retention → shorter interval', () => assert.ok(intervalFor(10, 0.95) < intervalFor(10, 0.9)));
test('R(interval(S, r), S) = r', () => near(retrievability(intervalFor(12, 0.85), 12), 0.85));

const f = createScheduler();
const t0 = Date.UTC(2026, 0, 1);

test('new card: S0 = w[g-1], D0 = w4 − (g−3)·w5', () => {
  const p = f.preview(null, t0);
  for (const g of [1, 2, 3, 4]) near(p[g].stability, DEFAULT_W[g - 1]);
  near(p[3].difficulty, DEFAULT_W[4]);
  near(p[1].difficulty, Math.min(10, DEFAULT_W[4] + 2 * DEFAULT_W[5]));
  near(p[4].difficulty, DEFAULT_W[4] - DEFAULT_W[5]);
});
test('new card intervals: Gut 4 days, Leicht 14 days', () => {
  const p = f.preview(null, t0);
  assert.equal(p[3].ivlDays, 4);
  assert.equal(p[4].ivlDays, 14);
  assert.ok(p[2].ivlDays >= 1 && p[2].ivlDays <= p[3].ivlDays);
});
test('Nochmal re-queues in ~10 minutes', () => {
  const c = f.next(null, 1, t0);
  assert.equal(c.due - t0, RELEARN_MS);
  assert.equal(c.state, 'learning');
});
test('success after the full interval grows stability', () => {
  const c1 = f.next(null, 3, t0);
  const c2 = f.next(c1, 3, c1.due);
  assert.ok(c2.stability > c1.stability * 2, `${c2.stability} vs ${c1.stability}`);
  assert.equal(c2.reps, 2);
});
test('Schwer < Gut < Leicht for a review card', () => {
  const c1 = f.next(null, 3, t0);
  const p = f.preview(c1, c1.due);
  assert.ok(p[2].stability < p[3].stability && p[3].stability < p[4].stability);
  assert.ok(p[2].ivlDays <= p[3].ivlDays && p[3].ivlDays < p[4].ivlDays);
});
test('hard penalty and easy bonus match the formula', () => {
  const c = { state: 'review', stability: 10, difficulty: 5, last: t0 };
  const now = t0 + 10 * DAY_MS;
  const R = retrievability(10, 10);
  const w = DEFAULT_W;
  const base = Math.exp(w[8]) * (11 - 5) * Math.pow(10, -w[9]) * (Math.exp(w[10] * (1 - R)) - 1);
  const p = f.preview(c, now);
  near(p[3].stability, 10 * (base + 1));
  near(p[2].stability, 10 * (base * w[15] + 1));
  near(p[4].stability, 10 * (base * w[16] + 1));
});
test('lapse uses the forgetting formula and counts a lapse', () => {
  const c = { state: 'review', stability: 20, difficulty: 6, last: t0, reps: 3, lapses: 0 };
  const now = t0 + 25 * DAY_MS;
  const R = retrievability(25, 20);
  const w = DEFAULT_W;
  const expected = w[11] * Math.pow(6, -w[12]) * (Math.pow(21, w[13]) - 1) * Math.exp(w[14] * (1 - R));
  const n = f.next(c, 1, now);
  near(n.stability, Math.min(expected, 20));
  assert.ok(n.stability < 20);
  assert.equal(n.lapses, 1);
  assert.equal(n.state, 'relearning');
  assert.equal(n.due, now + RELEARN_MS);
});
test('difficulty update with mean reversion, clamped to [1, 10]', () => {
  const w = DEFAULT_W;
  const c = { state: 'review', stability: 5, difficulty: 7, last: t0 };
  const p = f.preview(c, t0 + 5 * DAY_MS);
  near(p[1].difficulty, w[7] * w[4] + (1 - w[7]) * (7 + 2 * w[6]));
  let card = f.next(null, 1, t0);
  for (let i = 0; i < 50; i++) card = f.next(card, 1, card.due);
  assert.ok(card.difficulty <= 10 && card.difficulty > 9);
  card = f.next(null, 4, t0);
  for (let i = 0; i < 50; i++) card = f.next(card, 4, card.due);
  assert.ok(card.difficulty >= 1);
});
test('desired retention changes intervals', () => {
  const strict = createScheduler({ retention: 0.95 });
  const loose = createScheduler({ retention: 0.8 });
  const c = { state: 'review', stability: 30, difficulty: 5, last: t0 };
  const now = t0 + 30 * DAY_MS;
  assert.ok(strict.preview(c, now)[3].ivlDays < loose.preview(c, now)[3].ivlDays);
});
test('intervals are capped', () => {
  const g = createScheduler({ maxInterval: 100 });
  let c = g.next(null, 4, t0);
  for (let i = 0; i < 10; i++) c = g.next(c, 4, c.due);
  assert.ok(c.scheduledDays <= 100);
});

console.log('Answer grading');
test('exact', () => assert.equal(grade('Haus', 'Haus').kind, 'correct'));
test('punctuation & spaces ignored', () => assert.equal(grade(' Haus. ', 'Haus').kind, 'correct'));
test('ae/oe/ue/ss accepted but flagged', () => {
  const r = grade('Aepfel', 'Äpfel'); assert.equal(r.kind, 'correct'); assert.ok(r.translit);
  assert.equal(grade('heisst', 'heißt').kind, 'correct');
});
test('case mismatch = fast richtig', () => assert.equal(grade('haus', 'Haus').kind, 'case'));
test('one typo = near', () => assert.equal(grade('Fensterbnk', 'Fensterbank').kind, 'near'));
test('wrong', () => assert.equal(grade('Tisch', 'Haus').kind, 'wrong'));
test('empty is wrong', () => assert.equal(grade('', 'der').kind, 'wrong'));

console.log('Text helpers');
test('hyphen rejoin', () => { assert.equal(joinLines('Fenster-', 'bank'), 'Fensterbank'); assert.equal(joinLines('Ost-', 'West'), 'Ost-West'); });
test('gaps never end sentences', () => assert.equal(splitSentences('Anna wohnt in d.. Dorf. Er geht.').length, 2));
test('abbreviations', () => assert.equal(splitSentences('Das ist z. B. gut. Ja.').length, 2));
test('chapter headings', () => {
  assert.equal(chapterHeading('Kapitel 3')?.num, 3);
  assert.equal(chapterHeading('KAPITEL ZWÖLF')?.num, 12);
  assert.equal(chapterHeading('Drittes Kapitel')?.num, 3);
  assert.equal(chapterHeading('Kapitel IV')?.num, 4);
  assert.equal(chapterHeading('Im Kapitel 3 haben wir'), null);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
