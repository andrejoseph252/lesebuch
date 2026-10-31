import { t } from './i18n.js';
// Small DOM helpers shared by all views.

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Open a bottom sheet. Returns { el, close, closed } where closed is a promise. */
export function sheet(content, { onClose } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grabber' }), content);
  document.body.append(backdrop, panel);
  let done;
  const closed = new Promise((r) => (done = r));
  const close = () => {
    if (!panel.isConnected) return;
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => { panel.remove(); backdrop.remove(); }, 260);
    onClose?.();
    done();
  };
  backdrop.addEventListener('click', close);
  // drag-down to dismiss from the grabber area
  let y0 = null;
  panel.addEventListener('touchstart', (e) => { if (panel.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0 && panel.scrollTop <= 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    panel.style.transform = '';
    y0 = null;
    if (dy > 110) close();
  });
  requestAnimationFrame(() => { backdrop.classList.add('open'); panel.classList.add('open'); });
  return { el: panel, close, closed };
}

/** Promise-based confirm without native dialogs. */
export function confirmSheet(title, text, { ok = t('OK'), danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet(h('div', {},
      h('h3', {}, title),
      text ? h('p', { class: 'sub' }, text) : null,
      h('div', { class: 'row mt' },
        h('button', { class: 'btn grow', onclick: () => { answered = true; s.close(); resolve(false); } }, t('Abbrechen')),
        h('button', { class: `btn grow ${danger ? 'danger' : 'primary'}`, onclick: () => { answered = true; s.close(); resolve(true); } }, ok)),
    ), { onClose: () => { if (!answered) resolve(false); } });
  });
}

// ---- dates ----
export const DAY = 86400000;
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function startOfDay(ts = Date.now()) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function fmtInterval(ms) {
  const m = ms / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  const hrs = m / 60;
  if (hrs < 24) return t('{0} Std', Math.round(hrs));
  const d = hrs / 24;
  if (d < 31) return t('{0} T', Math.round(d));
  if (d < 365) return t('{0} Mon', Math.round(d / 30.4));
  return t('{0} J', (d / 365).toFixed(1));
}
export function fmtDue(ts) {
  const days = Math.round((startOfDay(ts) - startOfDay()) / DAY);
  if (days <= 0) return t('heute');
  if (days === 1) return t('morgen');
  return t('in {0} Tagen', days);
}

// ---- German umlaut bar above the keyboard ----
let lastInput = null;
export function initKeyboardBar() {
  const bar = $('#kbbar');
  const place = () => {
    const vv = window.visualViewport;
    if (!vv) { bar.style.bottom = '0px'; return; }
    const offset = window.innerHeight - (vv.height + vv.offsetTop);
    bar.style.bottom = `${Math.max(0, offset)}px`;
  };
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.matches?.('input[data-de], textarea[data-de]')) {
      lastInput = el;
      bar.hidden = false;
      place();
    }
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (!a?.matches?.('input[data-de], textarea[data-de]')) bar.hidden = true;
    }, 120);
  });
  window.visualViewport?.addEventListener('resize', place);
  window.visualViewport?.addEventListener('scroll', place);
  // pointerdown + preventDefault keeps focus (and the keyboard) on the input
  bar.addEventListener('pointerdown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const ch = e.target.dataset?.ch;
    if (!ch || !lastInput) return;
    const i = lastInput;
    const s = i.selectionStart ?? i.value.length, en = i.selectionEnd ?? i.value.length;
    i.value = i.value.slice(0, s) + ch + i.value.slice(en);
    i.setSelectionRange(s + ch.length, s + ch.length);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.focus();
  });
}

export function genderClass(article) {
  return article === 'der' ? 'g-der' : article === 'die' ? 'g-die' : article === 'das' ? 'g-das' : '';
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const icons = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none"/></svg>',
  page: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 10h14M5 14h14M5 18h9"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
export function icon(name) { return h('span', { html: icons[name], style: { display: 'contents' } }); }
