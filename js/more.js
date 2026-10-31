// Mehr: book, chapters, settings, AI key, backup.
import { t, locale } from './i18n.js';
import { h, toast, confirmSheet, sheet } from './ui.js';
import * as db from './db.js';
import { bookInfo, extractAll } from './book.js';
import { pickBook, chaptersSheet, detectChaptersSheet } from './library.js';
import { settings, saveSettings, apiKey } from './settings.js';
import { germanVoices, speak, ttsSupported } from './tts.js';

const VERSION = '1.0.0';

function seg(options, value, onPick) {
  const el = h('div', { class: 'seg' }, options.map(([v, label]) => h('button', {
    type: 'button', class: v === value ? 'on' : '',
    onclick: () => { el.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', options[i][0] === v)); onPick(v); },
  }, label)));
  return el;
}
const row = (label, control, sub) => h('div', { class: 'setting' }, h('label', {}, label, sub ? h('div', { class: 'small' }, sub) : null), control);
const col = (...kids) => h('div', { class: 'setting col' }, ...kids);

export async function renderMore(view) {
  const info = await bookInfo();
  const pages = await db.count('pages');
  const chapters = await db.count('chapters');
  const texts = await db.count('texts');

  view.append(h('h1', {}, t('Mehr')));

  // ---- Buch ----
  view.append(h('h2', {}, t('Buch')),
    h('div', { class: 'list' },
      h('div', { class: 'item' },
        h('div', { class: 'grow' },
          h('div', { class: 'serif ellipsis' }, info ? info.name : t('Kein Buch geladen')),
          h('div', { class: 'small' }, info ? t('{0} Seiten · {1} Seiten Text · nur auf diesem Gerät', info.numPages, pages) : t('Die PDF wird nur lokal gespeichert.'))),
        h('button', { class: 'btn small', onclick: async () => { if (await pickBook()) rerender(view); } }, info ? t('Ersetzen') : t('Laden'))),
      h('button', { class: 'item', onclick: () => chaptersSheet(() => rerender(view)) }, h('span', { class: 'grow' }, t('Kapitel')), h('span', { class: 'small' }, String(chapters)), h('span', { class: 'chev' }, '›')),
      info ? h('button', { class: 'item', onclick: () => detectChaptersSheet(() => rerender(view)) }, h('span', { class: 'grow' }, t('Kapitel automatisch erkennen')), h('span', { class: 'chev' }, '›')) : null,
      h('a', { class: 'item', href: '#/mehr/texte' }, h('span', { class: 'grow' }, t('Lesetexte')), h('span', { class: 'small' }, String(texts)), h('span', { class: 'chev' }, '›')),
      info ? h('button', { class: 'item', onclick: async () => {
        if (!(await confirmSheet('Seitentext neu einlesen?', t('Der Text aller Seiten wird neu aus der PDF gelesen. OCR-Ergebnisse gehen dabei verloren.'), { ok: t('Neu einlesen') }))) return;
        await db.clear('pages');
        const bar = h('i'); const lbl = h('p', { class: 'sub' }, '…');
        const s = sheet(h('div', {}, h('h3', {}, t('Neu einlesen')), h('div', { class: 'progress', style: { margin: '16px 0 10px' } }, bar), lbl));
        await extractAll((d, total) => { bar.style.width = `${(d / total) * 100}%`; lbl.textContent = t('Seite {0} von {1}', d, total); });
        s.close(); toast('Fertig'); rerender(view);
      } }, h('span', { class: 'grow' }, t('Seitentext neu einlesen')), h('span', { class: 'chev' }, '›')) : null));

  // ---- Darstellung ----
  const sizeOut = h('span', { class: 'small' }, `${settings.fontSize}px`);
  const thrOut = h('span', { class: 'small' }, `${Math.round(settings.marginThreshold * 100)} %`);
  view.append(h('h2', {}, t('Darstellung')),
    h('div', { class: 'list' },
      row(t('Sprache'), seg([['en', 'English'], ['de', 'Deutsch']], settings.uiLang, (v) => saveSettings({ uiLang: v }).then(() => rerender(view))), t('Sprache der App (das Buch bleibt Deutsch)')),
      row(t('Design'), seg([['auto', t('Auto')], ['light', t('Hell')], ['dark', t('Dunkel')]], settings.theme, (v) => saveSettings({ theme: v }))),
      col(h('div', { class: 'spread' }, h('span', {}, t('Schriftgröße')), sizeOut),
        h('input', { type: 'range', min: 14, max: 28, step: 1, value: settings.fontSize, oninput: (e) => { sizeOut.textContent = `${e.target.value}px`; saveSettings({ fontSize: +e.target.value }); } })),
      row(t('Randnotizen'), seg([['right', t('Rechts')], ['left', t('Links')], ['off', t('Aus')]], settings.marginSide, (v) => saveSettings({ marginSide: v })), t('Wo dein Buch die Glossen druckt')),
      col(h('div', { class: 'spread' }, h('span', {}, t('Spaltengrenze')), thrOut),
        h('input', { type: 'range', min: 0.2, max: 0.95, step: 0.01, value: settings.marginThreshold, oninput: (e) => { thrOut.textContent = `${Math.round(e.target.value * 100)} %`; saveSettings({ marginThreshold: +e.target.value }); } }),
        h('div', { class: 'small' }, t('Text, der rechts (bzw. links) dieser Linie beginnt, gilt als Randnotiz. Anteil der Seitenbreite.')))));

  // ---- Wiederholen ----
  const retOut = h('span', { class: 'small' }, `${Math.round(settings.retention * 100)} %`);
  const typeBox = (key, label) => h('label', { class: 'row', style: { minHeight: '36px' } },
    h('input', { type: 'checkbox', checked: settings.cardTypes[key], onchange: (e) => saveSettings({ cardTypes: { ...settings.cardTypes, [key]: e.target.checked } }) }), label);
  view.append(h('h2', {}, t('Wiederholen')),
    h('div', { class: 'list' },
      row(t('Neue Karten pro Tag'), h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 200, value: settings.newPerDay, style: { width: '84px' }, onchange: (e) => saveSettings({ newPerDay: Math.max(0, +e.target.value || 0) }) })),
      col(h('div', { class: 'spread' }, h('span', {}, t('Gewünschte Behaltensquote')), retOut),
        h('input', { type: 'range', min: 0.8, max: 0.97, step: 0.01, value: settings.retention, oninput: (e) => { retOut.textContent = `${Math.round(e.target.value * 100)} %`; saveSettings({ retention: +e.target.value }); } }),
        h('div', { class: 'small' }, t('Höher = öfter wiederholen. 90 % ist ein guter Standard.'))),
      col(h('span', {}, t('Kartentypen')),
        typeBox('cloze', t('Lückensätze (aus dem Buch)')), typeBox('gender', t('Genus: der/die/das')), typeBox('plural', t('Plural')), typeBox('error', t('Fehlerkarten aus Übungen'))),
      row(t('Lückensatz zuerst hören'), seg([['off', t('Nie')], ['sometimes', t('Manchmal')], ['always', t('Immer')]], settings.listenFirst, (v) => saveSettings({ listenFirst: v })))));

  // ---- Vorlesen ----
  if (ttsSupported) {
    const voiceSel = h('select', { onchange: (e) => saveSettings({ ttsVoice: e.target.value }) });
    const fillVoices = () => {
      const vs = germanVoices();
      voiceSel.innerHTML = '';
      voiceSel.append(h('option', { value: '' }, vs.length ? t('Automatisch ({0})', vs[0].name) : t('Keine deutsche Stimme gefunden')));
      vs.forEach((v) => voiceSel.append(h('option', { value: v.voiceURI, selected: v.voiceURI === settings.ttsVoice }, `${v.name} (${v.lang})`)));
    };
    fillVoices();
    speechSynthesis.addEventListener?.('voiceschanged', fillVoices, { once: true });
    const rateOut = h('span', { class: 'small' }, `${settings.ttsRate.toFixed(2)}×`);
    view.append(h('h2', {}, t('Vorlesen')),
      h('div', { class: 'list' },
        col(h('span', {}, t('Stimme')), voiceSel, h('div', { class: 'small' }, t('Auf dem iPhone: Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen → Deutsch, dort eine „Erweitert“-Stimme laden.'))),
        col(h('div', { class: 'spread' }, h('span', {}, t('Tempo')), rateOut),
          h('input', { type: 'range', min: 0.5, max: 1.3, step: 0.05, value: settings.ttsRate, oninput: (e) => { rateOut.textContent = `${(+e.target.value).toFixed(2)}×`; saveSettings({ ttsRate: +e.target.value }); } })),
        h('label', { class: 'setting' }, h('span', { class: 'grow' }, t('Nach der Seite weiterlesen'), h('div', { class: 'small' }, t('Beim Vorlesen automatisch zur nächsten Seite blättern'))),
          h('input', { type: 'checkbox', checked: settings.readOn, onchange: (e) => saveSettings({ readOn: e.target.checked }) })),
        h('button', { class: 'item', onclick: () => speak('Am Fluss steht ein kleines Haus. Das Haus ist alt, aber es ist schön.') }, h('span', { class: 'grow' }, t('Probe hören')), h('span', { class: 'chev' }, '▶'))));
  }

  // ---- KI ----
  const keyIn = h('input', { type: 'password', value: apiKey.get(), placeholder: 'sk-ant-…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const modelIn = h('input', { type: 'text', value: settings.aiModel, autocapitalize: 'off', spellcheck: 'false' });
  const aiStatus = h('div', { class: 'small' });
  view.append(h('h2', {}, t('KI-Tutor (optional)')),
    h('div', { class: 'list' },
      col(h('span', {}, t('Anthropic API-Schlüssel')), keyIn,
        h('div', { class: 'small' }, t('Der Schlüssel wird nur auf diesem Gerät (localStorage) gespeichert, nie im Repository und nicht in Sicherungen. Anfragen gehen direkt von deinem Browser an api.anthropic.com. Ohne Schlüssel funktioniert alles andere ganz normal.'))),
      col(h('span', {}, t('Modell')), modelIn, h('div', { class: 'small' }, t('Standard: claude-opus-5-5. Günstiger: claude-sonnet-5-5 oder claude-haiku-5-5.'))),
      col(h('div', { class: 'row' },
        h('button', { class: 'btn primary small', onclick: async () => {
          apiKey.set(keyIn.value); await saveSettings({ aiModel: modelIn.value.trim() || 'claude-opus-5-5' });
          aiStatus.textContent = keyIn.value ? t('Gespeichert. Teste …') : t('Schlüssel entfernt.');
          if (!keyIn.value) return;
          try { const { ping } = await import('./ai.js'); await ping(); aiStatus.textContent = t('Verbindung ok ✓'); } catch (e) { aiStatus.textContent = t('Fehler: {0}', e.message); }
        } }, t('Speichern & testen')),
        apiKey.get() ? h('button', { class: 'btn small danger', onclick: () => { apiKey.set(''); keyIn.value = ''; aiStatus.textContent = t('Schlüssel entfernt.'); } }, t('Entfernen')) : null), aiStatus)));

  // ---- Daten ----
  const incPages = h('input', { type: 'checkbox' });
  view.append(h('h2', {}, t('Daten')),
    h('div', { class: 'list' },
      h('label', { class: 'setting' }, h('span', { class: 'grow' }, t('Seitentext mitsichern'), h('div', { class: 'small' }, t('Größere Datei. OCR-Seiten werden immer gesichert. Die PDF nie.'))), incPages),
      h('button', { class: 'item', onclick: () => exportBackup(incPages.checked) }, h('span', { class: 'grow' }, t('Sicherung exportieren (JSON)')), h('span', { class: 'chev' }, '↓')),
      h('button', { class: 'item', onclick: () => importBackup(view) }, h('span', { class: 'grow' }, t('Sicherung importieren')), h('span', { class: 'chev' }, '↑')),
      h('button', { class: 'item', onclick: async () => {
        if (!(await confirmSheet('Alles löschen?', t('Buch, Wörter, Karten, Übungen und Verlauf auf diesem Gerät werden gelöscht. Exportiere vorher eine Sicherung.'), { ok: t('Alles löschen'), danger: true }))) return;
        await db.wipeAll(); toast('Gelöscht'); location.hash = '#/heute'; location.reload();
      } }, h('span', { class: 'grow', style: { color: 'var(--bad)' } }, t('Alle Daten löschen')))));

  view.append(h('h2', {}, t('Über')),
    h('div', { class: 'card' },
      h('p', { class: 'serif', style: { fontSize: '17px' } }, 'Lesebuch'),
      h('p', { class: 'small' }, t('Version {0}. Alles bleibt auf diesem Gerät: Buch, Wörter, Fortschritt. Kein Konto, kein Server. Für einen Gerätewechsel: Sicherung exportieren und dort importieren, dann die PDF erneut laden.', VERSION))));
}

function rerender(view) {
  view.innerHTML = '';
  renderMore(view);
}

async function exportBackup(includePages) {
  const data = await db.exportData({ includePages });
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `lesebuch-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  const n = (k) => data.stores[k]?.length || 0;
  toast(t('Exportiert: {0} Wörter, {1} Karten, {2} Übungen', n('words'), n('cards'), n('exercises')));
}

function importBackup(view) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const n = (k) => data.stores?.[k]?.length || 0;
      if (!(await confirmSheet('Sicherung importieren?', t('{0} Wörter, {1} Karten, {2} Übungen, {3} Kapitel. Deine aktuellen Daten (außer Buch und Seitentext) werden ersetzt.', n('words'), n('cards'), n('exercises'), n('chapters')), { ok: t('Importieren') }))) return;
      await db.importData(data);
      const { loadSettings } = await import('./settings.js');
      await loadSettings();
      toast('Import abgeschlossen');
      rerender(view);
    } catch (e) {
      toast(t('Import fehlgeschlagen: {0}', e.message), 3500);
    }
  });
  document.body.append(input);
  input.click();
}

export async function renderTexts(view) {
  const texts = (await db.all('texts')).sort((a, b) => b.created - a.created);
  view.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('a', { class: 'btn ghost small', href: '#/mehr' }, t('‹ Mehr'))),
    h('h1', {}, t('Lesetexte')),
    h('p', { class: 'sub' }, t('Neue Texte auf deinem Niveau, erstellt vom KI-Tutor aus dem Wortschatz deiner bisherigen Kapitel.')));
  if (apiKey.get()) view.append(h('button', { class: 'btn primary block mt', onclick: () => import('./ai.js').then((m) => m.newReadingTextSheet()) }, t('Neuer Lesetext')));
  else view.append(h('div', { class: 'card mt small' }, t('Zum Erstellen brauchst du einen API-Schlüssel (Mehr → KI-Tutor).')));
  if (texts.length) {
    view.append(h('div', { class: 'list mt' }, texts.map((x) => h('a', { class: 'item', href: `#/text/${x.id}` },
      h('div', { class: 'grow' }, h('div', { class: 'serif' }, x.title || t('Lesetext')), h('div', { class: 'small' }, `${new Date(x.created).toLocaleDateString(locale())}${x.chapter ? ` · ${t('bis Kapitel {0}', x.chapter)}` : ''}`)),
      h('span', { class: 'chev' }, '›')))));
  }
}
