// Web Speech API: German voice selection, single utterances and sentence-by-sentence reading.
import { settings } from './settings.js';

const synth = window.speechSynthesis;
export const ttsSupported = !!synth && 'SpeechSynthesisUtterance' in window;
let voices = [];

function refreshVoices() {
  voices = (synth?.getVoices() || []).filter((v) => /^de([-_]|$)/i.test(v.lang));
}
if (ttsSupported) {
  refreshVoices();
  synth.addEventListener?.('voiceschanged', refreshVoices);
}

const NOVELTY = /eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|oma|opa|bad news|bells|bubbles|jester|organ|whisper|zarvox|trinoids|cellos|albert|boing/i;
function score(v) {
  let s = 0;
  if (/^de[-_]DE$/i.test(v.lang)) s += 4;
  if (/premium/i.test(v.name)) s += 6;
  if (/enhanced|verbessert|neural|natural/i.test(v.name)) s += 4;
  if (/google/i.test(v.name)) s += 2;
  if (/anna|helena|petra|markus|yannick/i.test(v.name)) s += 1;
  if (NOVELTY.test(v.name)) s -= 10;
  return s;
}

export function germanVoices() {
  refreshVoices();
  return [...voices].sort((a, b) => score(b) - score(a));
}
export function pickVoice() {
  const list = germanVoices();
  return list.find((v) => v.voiceURI === settings.ttsVoice) || list[0] || null;
}

function utter(text, rate) {
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang || 'de-DE';
  u.rate = rate ?? settings.ttsRate;
  return u;
}

let runId = 0;
export function stop() {
  runId++;
  if (ttsSupported) synth.cancel();
}

export function speak(text, { rate } = {}) {
  if (!ttsSupported || !text) return Promise.resolve();
  stop();
  return new Promise((resolve) => {
    const u = utter(text, rate);
    u.onend = u.onerror = () => resolve();
    synth.speak(u);
  });
}

/** Read a list of sentences in order. onSentence(i) fires as each begins; resolves when finished or stopped. */
export function speakSequence(sentences, { onSentence, rate } = {}) {
  if (!ttsSupported || !sentences.length) return Promise.resolve();
  stop();
  const my = runId;
  return new Promise((resolve) => {
    let i = 0;
    const nextOne = () => {
      if (my !== runId || i >= sentences.length) { onSentence?.(-1); resolve(); return; }
      const idx = i++;
      const u = utter(sentences[idx], rate);
      u.onstart = () => onSentence?.(idx);
      u.onend = () => nextOne();
      u.onerror = (e) => { if (e.error === 'interrupted' || e.error === 'canceled') { onSentence?.(-1); resolve(); } else nextOne(); };
      synth.speak(u);
    };
    nextOne();
  });
}

// ---------- shadowing (speech recognition) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const srSupported = !!SR;

/** Listen once in German. onPartial(text) for interim results. Resolves with the final transcript. */
export function listen({ onPartial } = {}) {
  return new Promise((resolve, reject) => {
    const rec = new SR();
    rec.lang = 'de-DE';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    let text = '';
    rec.onresult = (e) => {
      text = [...e.results].map((r) => r[0].transcript).join(' ');
      onPartial?.(text);
    };
    rec.onerror = (e) => (e.error === 'no-speech' ? resolve('') : reject(new Error(e.error)));
    rec.onend = () => resolve(text);
    rec.start();
    listen.current = rec;
  });
}
listen.stop = () => listen.current?.stop();

/** Word-by-word match of a spoken transcript against the target sentence. */
export function matchWords(target, spoken) {
  const clean = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  const words = target.split(/\s+/).filter(Boolean);
  const t = words.map((w) => clean(w)[0] || '');
  const s = clean(spoken);
  // LCS alignment so one missed word does not shift everything after it
  const m = t.length, n = s.length;
  const L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    L[i][j] = t[i] && t[i] === s[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const hit = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (t[i] && t[i] === s[j]) { hit[i] = true; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const scored = t.filter(Boolean).length;
  return { words: words.map((w, k) => ({ w, hit: hit[k] || !t[k] })), score: scored ? hit.filter(Boolean).length / scored : 0 };
}
