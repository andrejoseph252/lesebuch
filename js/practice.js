// Üben: review entry point + the book's exercises, practised digitally per chapter.
import { t } from './i18n.js';
import { h, $$ } from './ui.js';
import * as db from './db.js';
import { listChapters, chapterTitle, ensureErrorCard } from './model.js';
import { grade, verdictText } from './grade.js';
import { dueQueue } from './review.js';
import { apiKey } from './settings.js';
import { logActivity } from './reread.js';

export async function renderPractice(view, [chapterArg]) {
  if (chapterArg) return renderChapterPractice(view, +chapterArg);
  const [chapters, exercises, queue] = await Promise.all([listChapters(), db.all('exercises'), dueQueue()]);
  view.append(h('h1', {}, t('Üben')));

  view.append(h('div', { class: 'card accent' },
    h('div', { class: 'spread' },
      h('div', {}, h('h3', {}, t('Wiederholen')), h('div', { class: 'sub' }, queue.length ? t('{0} Karten bereit', queue.length) : t('Für heute alles erledigt'))),
      h('a', { class: 'btn primary', href: '#/review', 'aria-disabled': !queue.length }, queue.length ? t('Starten') : t('Ansehen')))));

  view.append(h('h2', {}, t('Übungen nach Kapitel')));
  const byCh = new Map();
  for (const e of exercises) {
    const c = e.chapter ?? 0;
    if (!byCh.has(c)) byCh.set(c, []);
    byCh.get(c).push(e);
  }
  if (!exercises.length) {
    view.append(h('div', { class: 'card sub' }, t('Noch keine Übungen. Lade dein Buch unter Mehr → Buch; die Übungen am Kapitelende werden automatisch übernommen.')));
    return;
  }
  view.append(h('div', { class: 'list' }, chapters.filter((c) => byCh.has(c.num)).map((c) => {
    const items = byCh.get(c.num);
    const done = items.filter((e) => e.stats?.attempts).length;
    const g = items.reduce((a, e) => [a[0] + (e.stats?.gapsRight || 0), a[1] + (e.stats?.gapsDone || 0)], [0, 0]);
    return h('a', { class: 'item', href: `#/ueben/${c.num}` },
      h('div', { class: 'grow' },
        h('div', { class: 'serif' }, `${c.num}. ${chapterTitle(c)}`),
        h('div', { class: 'small' }, t('{0} / {1} geübt', done, items.length) + (g[1] ? ` · ${t('{0} % richtig', Math.round((g[0] / g[1]) * 100))}` : '')),
        h('div', { class: 'progress', style: { marginTop: '6px' } }, h('i', { style: { width: `${(done / items.length) * 100}%` } }))),
      h('span', { class: 'chev' }, '›'));
  })));
}

async function renderChapterPractice(view, chNum) {
  const chapters = await listChapters();
  const ch = chapters.find((c) => c.num === chNum);
  const items = (await db.all('exercises')).filter((e) => e.chapter === chNum).sort((a, b) => a.page - b.page || a.id - b.id);
  // start with items not yet practised, then the ones with mistakes
  const order = [...items.filter((e) => !e.stats?.attempts), ...items.filter((e) => e.stats?.attempts && e.stats.gapsRight < e.stats.gapsDone), ...items.filter((e) => e.stats?.attempts && e.stats.gapsRight >= e.stats.gapsDone)];
  let i = 0;
  let sessionRight = 0, sessionTotal = 0;
  const top = h('div', { class: 'review-top' },
    h('a', { class: 'iconbtn', href: '#/ueben', 'aria-label': t('Zurück'), html: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>' }),
    h('div', { class: 'progress' }, h('i')),
    h('span', { class: 'small' }));
  const stage = h('div');
  view.append(h('h1', { style: { fontSize: '22px', marginTop: '8px' } }, `${chNum}. ${chapterTitle(ch)}`), top, stage);

  const next = () => {
    if (i >= order.length) return finish();
    $$('i', top)[0].style.width = `${(i / order.length) * 100}%`;
    top.lastChild.textContent = `${i + 1} / ${order.length}`;
    stage.replaceChildren(itemView(order[i], () => { i++; next(); }));
    stage.querySelector('input, textarea')?.focus({ preventScroll: true });
  };
  const finish = () => {
    $$('i', top)[0].style.width = '100%';
    stage.replaceChildren(h('div', { class: 'card center' },
      h('h3', {}, t('Kapitel geschafft')),
      h('p', { class: 'sub' }, sessionTotal ? t('{0} von {1} Lücken richtig.', sessionRight, sessionTotal) : t('Alle Übungen durchgesehen.')),
      h('p', { class: 'small' }, t('Fehler kommen als Karten in der Wiederholung zurück.')),
      h('div', { class: 'row mt', style: { justifyContent: 'center' } },
        h('a', { class: 'btn', href: '#/ueben' }, t('Übersicht')),
        h('a', { class: 'btn primary', href: '#/review' }, t('Wiederholen')))));
  };

  function itemView(ex, done) {
    const card = h('div', { class: 'rcard' }, h('div', { class: 'kind' }, h('span', {}, ex.sec ? t('Übung {0}', ex.sec) : t('Übung')), h('span', {}, t('S. {0}', ex.page))));
    const feedback = h('div');
    const actions = h('div', { class: 'row mt' });
    let inputs = [];
    card.append(ex.type === 'answer' ? answerBody(ex) : gapBody(ex), feedback, actions);

    function gapBody(e) {
      const p = h('div', { class: 'ex-sentence' });
      e.segs.forEach((s, k) => {
        if (s.t === 'text') p.append(s.v);
        else {
          const inp = h('input', { class: 'gap-in', 'data-de': '', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', dataset: { k } });
          inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); check(); } });
          inputs.push(inp);
          p.append(inp);
        }
      });
      return p;
    }
    function answerBody(e) {
      const ta = h('textarea', { 'data-de': '', rows: 2, placeholder: t('Antworte mit einem ganzen Satz …'), autocapitalize: 'sentences' });
      inputs = [ta];
      return h('div', {}, h('div', { class: 'ex-sentence', style: { lineHeight: 1.5, marginBottom: '12px' } }, e.q), ta);
    }

    const checkBtn = h('button', { class: 'btn primary grow', onclick: () => check() }, t('Prüfen'));
    actions.append(h('button', { class: 'btn', onclick: done }, t('Überspringen')), checkBtn);
    if (apiKey.get()) actions.prepend(h('button', { class: 'btn', onclick: () => aiCheck() }, t('Mit KI prüfen')));

    async function aiCheck() {
      const { checkExercise } = await import('./ai.js');
      feedback.replaceChildren(h('p', { class: 'small' }, h('span', { class: 'spinner' }), t(' KI prüft …')));
      try {
        const r = await checkExercise(ex, inputs.map((x) => x.value));
        if (ex.type === 'answer') {
          if (r.answers?.[0]) ex.answer = r.answers[0];
          ex.explanation = r.explanations?.[0];
        } else {
          gapIdx().forEach((si, k) => {
            if (r.answers?.[k]) { ex.segs[si].answer = r.answers[k]; ex.segs[si].auto = false; ex.segs[si].ai = true; }
            if (r.explanations?.[k]) ex.segs[si].explanation = r.explanations[k];
          });
        }
        await db.put('exercises', ex);
        check();
      } catch (e) { feedback.replaceChildren(h('p', { class: 'small' }, t('KI-Fehler: {0}', e.message))); }
    }

    const gapIdx = () => ex.segs.map((s, k) => (s.t === 'gap' ? k : -1)).filter((k) => k >= 0);

    function check() {
      checkBtn.disabled = true;
      feedback.innerHTML = '';
      const results = [];
      if (ex.type === 'answer') {
        const given = inputs[0].value.trim();
        results.push({ key: 'q', given, expected: ex.answer || null, explanation: ex.explanation });
      } else {
        gapIdx().forEach((si, k) => results.push({ key: si, input: inputs[k], given: inputs[k].value.trim(), expected: ex.segs[si].answer || null, auto: ex.segs[si].auto, explanation: ex.segs[si].explanation }));
      }
      let pending = 0;
      for (const r of results) {
        if (r.expected && ex.type !== 'answer') {
          r.g = grade(r.given, r.expected);
          r.ok = r.g.kind === 'correct' || r.g.kind === 'case';
          r.input?.classList.add(r.g.kind === 'correct' ? 'ok' : r.ok || r.g.kind === 'near' ? 'near' : 'bad');
          if (!r.ok) feedback.append(h('div', { class: `verdict ${r.g.kind === 'near' ? 'near' : 'bad'}` },
            h('div', {}, verdictText(r.g), r.auto ? t(' (Lösung aus dem Buchtext)') : ''),
            h('div', { class: 'ans' }, r.expected),
            r.explanation ? h('div', { class: 'small' }, r.explanation) : null,
            h('button', { class: 'btn small mt', onclick: (e) => { r.ok = true; r.override = true; e.target.closest('.verdict').className = 'verdict ok'; e.target.replaceWith(h('span', { class: 'small' }, t('Als richtig gewertet ✓'))); } }, t('Meine Antwort war auch richtig'))));
          else if (r.g.kind !== 'correct' || r.g.translit) feedback.append(h('div', { class: 'verdict near' }, verdictText(r.g), ' – ', h('span', { class: 'ans' }, r.expected)));
        } else {
          // unknown answer (or free answer): self-mark, which builds the answer key
          pending++;
          const fix = h('div', { hidden: true },
            h('input', { 'data-de': '', placeholder: t('Richtige Form'), autocapitalize: 'off', style: { marginTop: '8px' } }));
          const box = h('div', { class: 'verdict near' },
            h('div', {}, ex.type === 'answer' ? t('Selbst prüfen') : t('Lösung noch unbekannt – selbst prüfen:')),
            r.expected ? h('div', {}, t('Gespeicherte Antwort: '), h('span', { class: 'ans' }, r.expected)) : null,
            r.explanation ? h('div', { class: 'small' }, r.explanation) : null,
            h('div', { class: 'ans' }, r.given || '(leer)'),
            h('div', { class: 'row mt' },
              h('button', { class: 'btn small', onclick: () => { r.ok = true; if (!r.expected && r.given) r.newAnswer = r.given; box.className = 'verdict ok'; box.lastChild.replaceWith(h('span', {}, t('Richtig ✓'))); resolve(); } }, t('✓ Richtig')),
              h('button', { class: 'btn small', onclick: () => { r.ok = false; fix.hidden = false; fix.querySelector('input').focus(); box.className = 'verdict bad'; } }, t('✗ Falsch'))),
            fix);
          fix.querySelector('input').addEventListener('change', (e) => { r.newAnswer = e.target.value.trim(); });
          fix.append(h('button', { class: 'btn small mt', onclick: () => { r.newAnswer = fix.querySelector('input').value.trim(); fix.lastChild.remove(); resolve(); } }, t('Speichern')));
          feedback.append(box);
          const resolve = () => { pending--; if (!pending) finishItem(); };
        }
      }
      if (!pending) finishItem();

      async function finishItem() {
        const right = results.filter((r) => r.ok).length;
        sessionRight += right; sessionTotal += results.length;
        ex.stats = { attempts: (ex.stats?.attempts || 0) + 1, gapsDone: (ex.stats?.gapsDone || 0) + results.length, gapsRight: (ex.stats?.gapsRight || 0) + right, last: Date.now() };
        for (const r of results) {
          const ans = r.override ? r.given : r.newAnswer;
          if (ans) {
            if (ex.type === 'answer') ex.answer = ans;
            else { ex.segs[r.key].answer = ans; ex.segs[r.key].auto = false; }
          }
          if (!r.ok) await ensureErrorCard(ex.id, r.key);
        }
        await db.put('exercises', ex);
        await logActivity();
        feedback.append(h('div', { class: `verdict ${right === results.length ? 'ok' : 'bad'}`, style: { marginTop: '10px' } },
          right === results.length ? t('Alles richtig') : t('{0} von {1} richtig – Fehler kommen in die Wiederholung', right, results.length)));
        actions.replaceChildren(h('button', { class: 'btn primary grow', onclick: done }, t('Weiter')));
        actions.querySelector('button').focus();
      }
    }
    return card;
  }

  if (!order.length) stage.append(h('p', { class: 'sub' }, t('Keine Übungen in diesem Kapitel.')));
  else next();
}
