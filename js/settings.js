// User settings: kept in the kv store, mirrored in memory for synchronous reads.
import { kv } from './db.js';

const DEFAULTS = {
  uiLang: 'en',             // en | de — interface only; the book stays German
  theme: 'auto',            // auto | light | dark
  fontSize: 19,             // reader text size in px
  marginSide: 'right',      // right | left | off — where the book's glosses sit
  marginThreshold: 0.68,    // column boundary as a fraction of page width
  newPerDay: 15,
  retention: 0.9,
  cardTypes: { cloze: true, gender: true, plural: true, error: true },
  listenFirst: 'sometimes', // off | sometimes | always
  ttsVoice: '',
  ttsRate: 0.95,
  readOn: true,             // keep reading aloud onto the next page
  aiModel: 'claude-opus-5-5',
};

export const settings = structuredClone(DEFAULTS);
const listeners = new Set();

export async function loadSettings() {
  const saved = (await kv.get('settings')) || {};
  Object.assign(settings, saved, { cardTypes: { ...DEFAULTS.cardTypes, ...(saved.cardTypes || {}) } });
  applySettings();
}

export async function saveSettings(patch = {}) {
  Object.assign(settings, patch);
  await kv.set('settings', structuredClone(settings));
  applySettings();
  listeners.forEach((fn) => fn(settings));
}

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function applySettings() {
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.theme);
  root.style.setProperty('--read-size', `${settings.fontSize}px`);
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute('content', dark ? '#15171a' : '#f6f3ec');
    m.removeAttribute('media');
  });
}

// The API key never leaves this device and is not part of backups.
const KEY = 'lesebuch.anthropicKey';
export const apiKey = {
  get: () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set: (v) => { try { v ? localStorage.setItem(KEY, v.trim()) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};
