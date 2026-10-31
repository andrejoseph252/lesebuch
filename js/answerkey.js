// Published answer key (js/solutions.js): answers only, matched to exercises by exKey().
// Fills gaps the app doesn't know yet; never overwrites answers the learner confirmed.
import * as db from './db.js';
import { exKey } from './clean.js';
import { SOLUTIONS, SOLUTIONS_VERSION } from './solutions.js';

export async function applyAnswerKey({ force = false } = {}) {
  if (!force && (await db.kv.get('solutionsVersion')) === SOLUTIONS_VERSION) return 0;
  const all = await db.all('exercises');
  const changed = [];
  for (const ex of all) {
    const sol = SOLUTIONS[exKey(ex)];
    if (!sol) continue;
    let touched = false;
    if (ex.type === 'answer') {
      if (!ex.answer && sol.s) { ex.answer = sol.s; ex.answerSrc = 'key'; touched = true; }
    } else if (Array.isArray(sol.a)) {
      const gaps = (ex.segs || []).filter((g) => g.t === 'gap');
      if (gaps.length === sol.a.length) {
        gaps.forEach((g, i) => {
          if (!g.answer && sol.a[i]) { g.answer = sol.a[i]; g.auto = true; g.src = 'key'; touched = true; }
        });
      }
    }
    if (touched) changed.push(ex);
  }
  if (changed.length) await db.putMany('exercises', changed);
  await db.kv.set('solutionsVersion', SOLUTIONS_VERSION);
  return changed.length;
}
