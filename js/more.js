// Mehr: book, chapters, settings, AI key, backup.
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

  view.append(h('h1', {}, 'Mehr'));

  // ---- Buch ----
  view.append(h('h2', {}, 'Buch'),
    h('div', { class: 'list' },
      h('div', { class: 'item' },
        h('div', { class: 'grow' },
          h('div', { class: 'serif ellipsis' }, info ? info.name : 'Kein Buch geladen'),
          h('div', { class: 'small' }, info ? `${info.numPages} Seiten · ${pages} Seiten Text · nur auf diesem Gerät` : 'Die PDF wird nur lokal gespeichert.')),
        h('button', { class: 'btn small', onclick: async () => { if (await pickBook()) rerender(view); } }, info ? 'Ersetzen' : 'Laden')),
      h('button', { class: 'item', onclick: () => chaptersSheet(() => rerender(view)) }, h('span', { class: 'grow' }, 'Kapitel'), h('span', { class: 'small' }, String(chapters)), h('span', { class: 'chev' }, '›')),
      info ? h('button', { class: 'item', onclick: () => detectChaptersSheet(() => rerender(view)) }, h('span', { class: 'grow' }, 'Kapitel automatisch erkennen'), h('span', { class: 'chev' }, '›')) : null,
      h('a', { class: 'item', href: '#/mehr/texte' }, h('span', { class: 'grow' }, 'Lesetexte'), h('span', { class: 'small' }, String(texts)), h('span', { class: 'chev' }, '›')),
      info ? h('button', { class: 'item', onclick: async () => {
        if (!(await confirmSheet('Seitentext neu einlesen?', 'Der Text aller Seiten wird neu aus der PDF gelesen. OCR-Ergebnisse gehen dabei verloren.', { ok: 'Neu einlesen' }))) return;
        await db.clear('pages');
        const bar = h('i'); const lbl = h('p', { class: 'sub' }, '…');
        const s = sheet(h('div', {}, h('h3', {}, 'Neu einlesen'), h('div', { class: 'progress', style: { margin: '16px 0 10px' } }, bar), lbl));
        await extractAll((d, t) => { bar.style.width = `${(d / t) * 100}%`; lbl.textContent = `Seite ${d} von ${t}`; });
        s.close(); toast('Fertig'); rerender(view);
      } }, h('span', { class: 'grow' }, 'Seitentext neu einlesen'), h('span', { class: 'chev' }, '›')) : null));

  // ---- Darstellung ----
  const sizeOut = h('span', { class: 'small' }, `${settings.fontSize}px`);
  const thrOut = h('span', { class: 'small' }, `${Math.round(settings.marginThreshold * 100)} %`);
  view.append(h('h2', {}, 'Darstellung'),
    h('div', { class: 'list' },
      row('Design', seg([['auto', 'Auto'], ['light', 'Hell'], ['dark', 'Dunkel']], settings.theme, (v) => saveSettings({ theme: v }))),
      col(h('div', { class: 'spread' }, h('span', {}, 'Schriftgröße'), sizeOut),
        h('input', { type: 'range', min: 14, max: 28, step: 1, value: settings.fontSize, oninput: (e) => { sizeOut.textContent = `${e.target.value}px`; saveSettings({ fontSize: +e.target.value }); } })),
      row('Randnotizen', seg([['right', 'Rechts'], ['left', 'Links'], ['off', 'Aus']], settings.marginSide, (v) => saveSettings({ marginSide: v })), 'Wo dein Buch die Glossen druckt'),
      col(h('div', { class: 'spread' }, h('span', {}, 'Spaltengrenze'), thrOut),
        h('input', { type: 'range', min: 0.2, max: 0.95, step: 0.01, value: settings.marginThreshold, oninput: (e) => { thrOut.textContent = `${Math.round(e.target.value * 100)} %`; saveSettings({ marginThreshold: +e.target.value }); } }),
        h('div', { class: 'small' }, 'Text, der rechts (bzw. links) dieser Linie beginnt, gilt als Randnotiz. Anteil der Seitenbreite.'))));

  // ---- Wiederholen ----
  const retOut = h('span', { class: 'small' }, `${Math.round(settings.retention * 100)} %`);
  const typeBox = (key, label) => h('label', { class: 'row', style: { minHeight: '36px' } },
    h('input', { type: 'checkbox', checked: settings.cardTypes[key], onchange: (e) => saveSettings({ cardTypes: { ...settings.cardTypes, [key]: e.target.checked } }) }), label);
  view.append(h('h2', {}, 'Wiederholen'),
    h('div', { class: 'list' },
      row('Neue Karten pro Tag', h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 200, value: settings.newPerDay, style: { width: '84px' }, onchange: (e) => saveSettings({ newPerDay: Math.max(0, +e.target.value || 0) }) })),
      col(h('div', { class: 'spread' }, h('span', {}, 'Gewünschte Behaltensquote'), retOut),
        h('input', { type: 'range', min: 0.8, max: 0.97, step: 0.01, value: settings.retention, oninput: (e) => { retOut.textContent = `${Math.round(e.target.value * 100)} %`; saveSettings({ retention: +e.target.value }); } }),
        h('div', { class: 'small' }, 'Höher = öfter wiederholen. 90 % ist ein guter Standard.')),
      col(h('span', {}, 'Kartentypen'),
        typeBox('cloze', 'Lückensätze (aus dem Buch)'), typeBox('gender', 'Genus: der/die/das'), typeBox('plural', 'Plural'), typeBox('error', 'Fehlerkarten aus Übungen')),
      row('Lückensatz zuerst hören', seg([['off', 'Nie'], ['sometimes', 'Manchmal'], ['always', 'Immer']], settings.listenFirst, (v) => saveSettings({ listenFirst: v })))));

  // ---- Vorlesen ----
  if (ttsSupported) {
    const voiceSel = h('select', { onchange: (e) => saveSettings({ ttsVoice: e.target.value }) });
    const fillVoices = () => {
      const vs = germanVoices();
      voiceSel.innerHTML = '';
      voiceSel.append(h('option', { value: '' }, vs.length ? `Automatisch (${vs[0].name})` : 'Keine deutsche Stimme gefunden'));
      vs.forEach((v) => voiceSel.append(h('option', { value: v.voiceURI, selected: v.voiceURI === settings.ttsVoice }, `${v.name} (${v.lang})`)));
    };
    fillVoices();
    speechSynthesis.addEventListener?.('voiceschanged', fillVoices, { once: true });
    const rateOut = h('span', { class: 'small' }, `${settings.ttsRate.toFixed(2)}×`);
    view.append(h('h2', {}, 'Vorlesen'),
      h('div', { class: 'list' },
        col(h('span', {}, 'Stimme'), voiceSel, h('div', { class: 'small' }, 'Auf dem iPhone: Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen → Deutsch, dort eine „Erweitert“-Stimme laden.')),
        col(h('div', { class: 'spread' }, h('span', {}, 'Tempo'), rateOut),
          h('input', { type: 'range', min: 0.5, max: 1.3, step: 0.05, value: settings.ttsRate, oninput: (e) => { rateOut.textContent = `${(+e.target.value).toFixed(2)}×`; saveSettings({ ttsRate: +e.target.value }); } })),
        h('button', { class: 'item', onclick: () => speak('Am Fluss steht ein kleines Haus. Das Haus ist alt, aber es ist schön.') }, h('span', { class: 'grow' }, 'Probe hören'), h('span', { class: 'chev' }, '▶'))));
  }

  // ---- KI ----
  const keyIn = h('input', { type: 'password', value: apiKey.get(), placeholder: 'sk-ant-…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const modelIn = h('input', { type: 'text', value: settings.aiModel, autocapitalize: 'off', spellcheck: 'false' });
  const aiStatus = h('div', { class: 'small' });
  view.append(h('h2', {}, 'KI-Tutor (optional)'),
    h('div', { class: 'list' },
      col(h('span', {}, 'Anthropic API-Schlüssel'), keyIn,
        h('div', { class: 'small' }, 'Der Schlüssel wird nur auf diesem Gerät (localStorage) gespeichert, nie im Repository und nicht in Sicherungen. Anfragen gehen direkt von deinem Browser an api.anthropic.com. Ohne Schlüssel funktioniert alles andere ganz normal.')),
      col(h('span', {}, 'Modell'), modelIn, h('div', { class: 'small' }, 'Standard: claude-opus-5-5. Günstiger: claude-sonnet-5-5 oder claude-haiku-5-5.')),
      col(h('div', { class: 'row' },
        h('button', { class: 'btn primary small', onclick: async () => {
          apiKey.set(keyIn.value); await saveSettings({ aiModel: modelIn.value.trim() || 'claude-opus-5-5' });
          aiStatus.textContent = keyIn.value ? 'Gespeichert. Teste …' : 'Schlüssel entfernt.';
          if (!keyIn.value) return;
          try { const { ping } = await import('./ai.js'); await ping(); aiStatus.textContent = 'Verbindung ok ✓'; } catch (e) { aiStatus.textContent = `Fehler: ${e.message}`; }
        } }, 'Speichern & testen'),
        apiKey.get() ? h('button', { class: 'btn small danger', onclick: () => { apiKey.set(''); keyIn.value = ''; aiStatus.textContent = 'Schlüssel entfernt.'; } }, 'Entfernen') : null), aiStatus)));

  // ---- Daten ----
  const incPages = h('input', { type: 'checkbox' });
  view.append(h('h2', {}, 'Daten'),
    h('div', { class: 'list' },
      h('label', { class: 'setting' }, h('span', { class: 'grow' }, 'Seitentext mitsichern', h('div', { class: 'small' }, 'Größere Datei. OCR-Seiten werden immer gesichert. Die PDF nie.')), incPages),
      h('button', { class: 'item', onclick: () => exportBackup(incPages.checked) }, h('span', { class: 'grow' }, 'Sicherung exportieren (JSON)'), h('span', { class: 'chev' }, '↓')),
      h('button', { class: 'item', onclick: () => importBackup(view) }, h('span', { class: 'grow' }, 'Sicherung importieren'), h('span', { class: 'chev' }, '↑')),
      h('button', { class: 'item', onclick: async () => {
        if (!(await confirmSheet('Alles löschen?', 'Buch, Wörter, Karten, Übungen und Verlauf auf diesem Gerät werden gelöscht. Exportiere vorher eine Sicherung.', { ok: 'Alles löschen', danger: true }))) return;
        await db.wipeAll(); toast('Gelöscht'); location.hash = '#/heute'; location.reload();
      } }, h('span', { class: 'grow', style: { color: 'var(--bad)' } }, 'Alle Daten löschen'))));

  view.append(h('h2', {}, 'Über'),
    h('div', { class: 'card' },
      h('p', { class: 'serif', style: { fontSize: '17px' } }, 'Lesebuch'),
      h('p', { class: 'small' }, `Version ${VERSION}. Alles bleibt auf diesem Gerät: Buch, Wörter, Fortschritt. Kein Konto, kein Server. Für einen Gerätewechsel: Sicherung exportieren und dort importieren, dann die PDF erneut laden.`)));
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
  toast(`Exportiert: ${n('words')} Wörter, ${n('cards')} Karten, ${n('exercises')} Übungen`);
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
      if (!(await confirmSheet('Sicherung importieren?', `${n('words')} Wörter, ${n('cards')} Karten, ${n('exercises')} Übungen, ${n('chapters')} Kapitel. Deine aktuellen Daten (außer Buch und Seitentext) werden ersetzt.`, { ok: 'Importieren' }))) return;
      await db.importData(data);
      const { loadSettings } = await import('./settings.js');
      await loadSettings();
      toast('Import abgeschlossen');
      rerender(view);
    } catch (e) {
      toast(`Import fehlgeschlagen: ${e.message}`, 3500);
    }
  });
  document.body.append(input);
  input.click();
}

export async function renderTexts(view) {
  const texts = (await db.all('texts')).sort((a, b) => b.created - a.created);
  view.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('a', { class: 'btn ghost small', href: '#/mehr' }, '‹ Mehr')),
    h('h1', {}, 'Lesetexte'),
    h('p', { class: 'sub' }, 'Neue Texte auf deinem Niveau, erstellt vom KI-Tutor aus dem Wortschatz deiner bisherigen Kapitel.'));
  if (apiKey.get()) view.append(h('button', { class: 'btn primary block mt', onclick: () => import('./ai.js').then((m) => m.newReadingTextSheet()) }, 'Neuer Lesetext'));
  else view.append(h('div', { class: 'card mt small' }, 'Zum Erstellen brauchst du einen API-Schlüssel (Mehr → KI-Tutor).'));
  if (texts.length) {
    view.append(h('div', { class: 'list mt' }, texts.map((t) => h('a', { class: 'item', href: `#/text/${t.id}` },
      h('div', { class: 'grow' }, h('div', { class: 'serif' }, t.title || 'Lesetext'), h('div', { class: 'small' }, `${new Date(t.created).toLocaleDateString('de-DE')}${t.chapter ? ` · bis Kapitel ${t.chapter}` : ''}`)),
      h('span', { class: 'chev' }, '›')))));
  }
}
