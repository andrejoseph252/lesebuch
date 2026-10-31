// Bottom sheet for a tapped word: pronounce, context sentence, dictionaries, add/edit in the word list.
import { t } from './i18n.js';
import { h, sheet, toast, icon, genderClass, confirmSheet, fmtDue, esc } from './ui.js';
import * as db from './db.js';
import { findWord, saveWord, deleteWord, clozeSpan } from './model.js';
import { speak, ttsSupported, srSupported, listen, matchWords, stop as stopTts } from './tts.js';
import { apiKey } from './settings.js';

const ARTICLES = ['der', 'die', 'das', '–'];
const CASE_ARTICLE = { der: 'der', die: 'die', das: 'das' };

function guessArticle(sentence, form) {
  const m = sentence.match(new RegExp(`\\b(der|die|das|ein|eine)\\s+(?:\\p{L}+\\s+)?${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu'));
  if (!m) return '';
  const a = m[1].toLowerCase();
  return CASE_ARTICLE[a] || (a === 'eine' ? 'die' : '');
}

function sentenceWithMark(sentence, form) {
  const span = clozeSpan({ sentence, form });
  if (!span) return h('span', {}, sentence);
  return h('span', {}, sentence.slice(0, span.start), h('mark', { style: { background: 'var(--accent-soft)', color: 'inherit', borderRadius: '3px', padding: '0 2px' } }, span.answer), sentence.slice(span.end));
}

function shadowBlock(sentence) {
  if (!srSupported) return null;
  const out = h('div', { class: 'match-words', style: { marginTop: '10px' } });
  const btn = h('button', { class: 'btn small', type: 'button' }, icon('mic'), t('Nachsprechen'));
  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) { listen.stop(); return; }
    busy = true;
    stopTts();
    btn.lastChild.textContent = t('Stopp');
    out.innerHTML = t('<span class="small">Sprich jetzt …</span>');
    try {
      const spoken = await listen({ onPartial: (txt) => { out.innerHTML = `<span class="small">${esc(txt)}</span>`; } });
      const r = matchWords(sentence, spoken);
      out.innerHTML = '';
      r.words.forEach((x, i) => out.append(i ? ' ' : '', h('span', { class: x.hit ? 'hit' : 'miss' }, x.w)));
      out.append(h('div', { class: 'small' }, t('{0} % erkannt', Math.round(r.score * 100)) + (spoken ? ` · „${spoken}“` : '')));
    } catch (e) {
      out.innerHTML = t('<span class=\'small\'>Mikrofon nicht verfügbar ({0})</span>', esc(e.message));
    }
    busy = false;
    btn.lastChild.textContent = t('Nachsprechen');
  });
  return h('div', {}, btn, out);
}

/**
 * ctx: { form, sentence, page, chapterNum, textId, onReadFrom, onSaved }
 * or   { word } to edit an existing entry (Wörter tab).
 */
export async function openWordSheet(ctx) {
  const existing = ctx.word || ctx.known || (await findWord(ctx.form)) || (ctx.form && (await findWord(ctx.form.toLowerCase())));
  const form = ctx.form || existing?.form || existing?.lemma || '';
  const sentence = ctx.sentence ?? existing?.sentence ?? '';
  const isStart = sentence.trim().indexOf(form) === 0;
  const looksNoun = /^\p{Lu}/u.test(form) && !isStart;
  const w = existing || {
    lemma: looksNoun ? form : form.toLowerCase(),
    form,
    article: looksNoun ? guessArticle(sentence, form) : '',
    plural: '',
    meaning: '',
    sentence,
    page: ctx.page ?? null,
    chapter: ctx.chapterNum ?? null,
    textId: ctx.textId ?? null,
  };

  const q = encodeURIComponent((w.lemma || form).trim());
  const links = h('div', { class: 'row wrap', style: { gap: '6px', margin: '12px 0 4px' } },
    h('a', { class: 'btn small', href: `https://www.dwds.de/wb/${q}`, target: '_blank', rel: 'noopener' }, 'DWDS'),
    h('a', { class: 'btn small', href: `https://de.wiktionary.org/wiki/${q}`, target: '_blank', rel: 'noopener' }, 'Wiktionary'),
    h('a', { class: 'btn small', href: `https://www.dict.cc/?s=${q}`, target: '_blank', rel: 'noopener' }, 'dict.cc'));

  // --- form ---
  const lemmaIn = h('input', { type: 'text', value: w.lemma, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'data-de': '' });
  const pluralIn = h('input', { type: 'text', value: w.plural || '', placeholder: t('z. B. die Häuser'), autocapitalize: 'off', autocomplete: 'off', 'data-de': '' });
  const meaningIn = h('input', { type: 'text', value: w.meaning || '', placeholder: 'optional', autocomplete: 'off', 'data-de': '' });
  const sentenceIn = h('textarea', { rows: 3, 'data-de': '' }, w.sentence || '');
  let article = w.article || '';
  const artSeg = h('div', { class: 'seg full' }, ARTICLES.map((a) => h('button', {
    type: 'button', class: `${(article || '–') === a ? 'on ' : ''}${genderClass(a)}`, dataset: { a },
    onclick: (e) => {
      article = a === '–' ? '' : a;
      artSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.a === (article || '–')));
      e.preventDefault();
    },
  }, a)));
  const where = [w.chapter ? t('Kapitel {0}', w.chapter) : null, w.page ? t('S. {0}', w.page) : null, w.textId ? t('Lesetext') : null].filter(Boolean).join(' · ');

  const formEl = h('form', { class: 'mt', onsubmit: async (e) => {
    e.preventDefault();
    const lemma = lemmaIn.value.trim();
    if (!lemma) { lemmaIn.focus(); return; }
    const rec = await saveWord({ ...w, lemma, article, plural: pluralIn.value.trim(), meaning: meaningIn.value.trim(), sentence: sentenceIn.value.trim() });
    toast(existing ? t('Gespeichert') : t('„{0}“ hinzugefügt', lemma));
    s.close();
    ctx.onSaved?.(rec);
  } },
    h('label', { class: 'field' }, h('span', {}, t('Grundform')), lemmaIn),
    h('div', { class: 'field' }, h('span', {}, t('Artikel')), artSeg),
    h('label', { class: 'field' }, h('span', {}, t('Plural')), pluralIn),
    h('label', { class: 'field' }, h('span', {}, t('Bedeutung / Notiz')), meaningIn),
    h('label', { class: 'field' }, h('span', {}, t('Satz')), sentenceIn),
    where ? h('p', { class: 'small' }, where) : null,
    h('div', { class: 'row' },
      existing ? h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (await confirmSheet(t('Wort löschen?'), t('„{0}“ und seine Karten werden entfernt.', existing.lemma), { ok: t('Löschen'), danger: true })) {
          await deleteWord(existing.id);
          toast(t('Gelöscht'));
          s.close();
          ctx.onSaved?.(null);
        }
      } }, t('Löschen')) : null,
      h('button', { type: 'submit', class: 'btn primary grow' }, existing ? t('Speichern') : t('Zu Wörtern hinzufügen'))));

  const sentenceBlock = sentence ? h('div', { class: 'card', style: { marginTop: '12px' } },
    h('div', { class: 'serif', style: { fontSize: '17px', lineHeight: '1.55' } }, sentenceWithMark(sentence, form)),
    h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '10px' } },
      ttsSupported ? h('button', { class: 'btn small', type: 'button', onclick: () => speak(sentence) }, icon('speaker'), t('Satz')) : null,
      ctx.onReadFrom ? h('button', { class: 'btn small', type: 'button', onclick: () => { s.close(); ctx.onReadFrom(); } }, t('▶ Ab hier vorlesen')) : null,
      apiKey.get() ? h('button', { class: 'btn small', type: 'button', onclick: () => import('./ai.js').then((m) => m.explainSentenceSheet(sentence)) }, t('Satz erklären')) : null),
    shadowBlock(sentence)) : null;

  const stats = existing ? await statsBlock(existing.id) : null;

  const content = h('div', {},
    h('div', { class: 'spread' },
      h('h3', { class: genderClass(w.article), style: { margin: 0 } }, w.article && existing ? h('span', { class: 'art' }, `${w.article} `) : null, existing ? w.lemma : form),
      ttsSupported ? h('button', { class: 'iconbtn', type: 'button', 'aria-label': t('Aussprechen'), onclick: () => speak(w.article && existing ? `${w.article} ${w.lemma}` : form) }, icon('speaker')) : null),
    existing && !ctx.word ? h('p', { class: 'small', style: { margin: '4px 0 0' } }, t('Schon in deiner Wortliste')) : null,
    sentenceBlock,
    links,
    stats,
    formEl);
  const s = sheet(content, { onClose: () => { stopTts(); ctx.onClose?.(); } });
  return s;
}

const TYPE_NAMES = { cloze: 'Lückensatz', gender: 'Genus', plural: 'Plural' };
async function statsBlock(wordId) {
  const cards = await db.byIndex('cards', 'ref', `w:${wordId}`);
  if (!cards.length) return null;
  return h('div', { class: 'list', style: { marginTop: '12px' } }, cards.map((c) => h('div', { class: 'item', style: { minHeight: '44px', padding: '9px 14px' } },
    h('span', { class: 'grow' }, t(TYPE_NAMES[c.type] || c.type)),
    h('span', { class: 'small' }, c.state === 'new' ? t('neu') : t('fällig {0} · S {1} T · {2}× · {3} Fehler', fmtDue(c.due), c.stability.toFixed(1), c.reps, c.lapses)))));
}
