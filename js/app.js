// App shell: routing between tabs, startup.
import { h, $, $$, initKeyboardBar } from './ui.js';
import { loadSettings, settings, onSettings, applySettings } from './settings.js';
import { leaveReader } from './reader.js';

const ROUTES = {
  heute: () => import('./home.js').then((m) => m.renderHome),
  lesen: () => import('./reader.js').then((m) => (v, [p]) => m.renderReader(v, { page: p ? +p : undefined })),
  text: () => import('./reader.js').then((m) => (v, [id]) => m.renderTextReader(v, +id)),
  ueben: () => import('./practice.js').then((m) => m.renderPractice),
  review: () => import('./review.js').then((m) => m.renderReview),
  woerter: () => import('./words.js').then((m) => m.renderWords),
  mehr: () => import('./more.js').then((m) => (v, [sub]) => (sub === 'texte' ? m.renderTexts(v) : m.renderMore(v))),
};
const TAB_OF = { text: 'lesen', review: 'ueben' };

let current = null;
let navSeq = 0;

async function route() {
  const seq = ++navSeq;
  const [name = 'heute', ...args] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const key = ROUTES[name] ? name : 'heute';
  const tab = TAB_OF[key] || key;
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.body.dataset.route = key;

  if (current) current.dispatchEvent(new Event('view:leave'));
  leaveReader();
  const page = h('div', { class: `view view-${key}` });
  try {
    const render = await ROUTES[key]();
    if (seq !== navSeq) return;
    $('#view').replaceChildren(page);
    current = page;
    if (key !== 'lesen' || !args.length) scrollTo(0, 0);
    await render(page, args);
  } catch (e) {
    console.error(e);
    if (seq !== navSeq) return;
    $('#view').replaceChildren(h('div', { class: 'empty' }, h('h1', {}, 'Hoppla'), h('p', {}, e.message)));
  }
}

/** Re-render the current view (e.g. after data changed elsewhere). */
export function refresh() { route(); }

async function start() {
  await loadSettings();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
  initKeyboardBar();
  addEventListener('hashchange', route);
  // tapping the active tab again re-renders it (e.g. Lesen → back to last page)
  $('#tabbar').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
  });
  let lastLayoutKey = layoutKey();
  onSettings(() => {
    // reflow the reader when settings that affect layout change
    const k = layoutKey();
    if (k !== lastLayoutKey && document.body.dataset.route === 'lesen') route();
    lastLayoutKey = k;
  });
  if (!location.hash) history.replaceState(null, '', '#/heute');
  // better cleaning rules shipped with an update: rebuild page text from the stored EPUB first
  await import('./epubbook.js').then((m) => m.recleanIfNeeded()).catch((e) => console.warn('reclean', e));
  route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  navigator.storage?.persist?.();
}
function layoutKey() { return `${settings.marginSide}|${settings.marginThreshold}`; }

start();
