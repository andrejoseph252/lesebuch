// FSRS v4.5 spaced-repetition scheduler. No dependencies; runs in the browser and in Node.
// Ratings: 1 = Nochmal (again), 2 = Schwer (hard), 3 = Gut (good), 4 = Leicht (easy).

export const DEFAULT_W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];
export const DECAY = -0.5;
export const FACTOR = 19 / 81;
export const DAY_MS = 86400000;
export const RELEARN_MS = 10 * 60000; // "Nochmal" comes back ~10 minutes later

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Probability of recall after t days for a memory of stability S. */
export function retrievability(t, S) {
  return Math.pow(1 + (FACTOR * t) / S, DECAY);
}

/** Days until recall probability falls to r. Equals S when r = 0.9. */
export function intervalFor(S, r = 0.9) {
  return (S / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
}

export function createScheduler({ w = DEFAULT_W, retention = 0.9, maxInterval = 36500 } = {}) {
  const initS = (g) => Math.max(0.1, w[g - 1]);
  const initD = (g) => clamp(w[4] - (g - 3) * w[5], 1, 10);

  function nextD(D, g) {
    const d = D - w[6] * (g - 3);
    return clamp(w[7] * initD(3) + (1 - w[7]) * d, 1, 10); // mean reversion toward D0(Gut)
  }
  function recallS(D, S, R, g) {
    const hard = g === 2 ? w[15] : 1;
    const easy = g === 4 ? w[16] : 1;
    return S * (Math.exp(w[8]) * (11 - D) * Math.pow(S, -w[9]) * (Math.exp(w[10] * (1 - R)) - 1) * hard * easy + 1);
  }
  function lapseS(D, S, R) {
    const s = w[11] * Math.pow(D, -w[12]) * (Math.pow(S + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
    return Math.min(s, S); // forgetting never makes a memory more stable
  }
  const days = (S) => clamp(Math.round(intervalFor(S, retention)), 1, maxInterval);

  /** All four outcomes for a card at time `now`. */
  function preview(card, now = Date.now()) {
    const isNew = !card || !card.state || card.state === 'new';
    const out = {};
    for (const g of [1, 2, 3, 4]) {
      let S, D;
      if (isNew) {
        S = initS(g);
        D = initD(g);
      } else {
        const t = Math.max(0, (now - card.last) / DAY_MS);
        const R = retrievability(t, card.stability);
        D = nextD(card.difficulty, g);
        S = g === 1 ? lapseS(card.difficulty, card.stability, R) : recallS(card.difficulty, card.stability, R, g);
      }
      out[g] = { stability: S, difficulty: D, ivlDays: g === 1 ? 0 : days(S) };
    }
    // keep the buttons in order: Schwer ≤ Gut < Leicht
    out[3].ivlDays = Math.max(out[3].ivlDays, out[2].ivlDays);
    out[4].ivlDays = Math.min(maxInterval, Math.max(out[4].ivlDays, out[3].ivlDays + 1));
    for (const g of [1, 2, 3, 4]) {
      out[g].dueMs = g === 1 ? RELEARN_MS : out[g].ivlDays * DAY_MS;
    }
    return out;
  }

  /** Apply a rating and return the updated scheduling fields. */
  function next(card, g, now = Date.now()) {
    const p = preview(card, now)[g];
    const prevState = card?.state || 'new';
    return {
      stability: p.stability,
      difficulty: p.difficulty,
      due: now + p.dueMs,
      last: now,
      reps: (card?.reps || 0) + 1,
      lapses: (card?.lapses || 0) + (g === 1 && prevState === 'review' ? 1 : 0),
      state: g === 1 ? (prevState === 'new' || prevState === 'learning' ? 'learning' : 'relearning') : 'review',
      scheduledDays: g === 1 ? 0 : p.ivlDays,
    };
  }

  return { preview, next, retrievability, intervalFor: (S) => intervalFor(S, retention), w };
}
