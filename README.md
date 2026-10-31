# Lesebuch

A personal, phone-first reading and practice app for *Deutsch nach der Naturmethode*. It's a static site (plain HTML/CSS/JS, no build step) that runs from GitHub Pages and works offline once it's on your phone.

## What it does

The interface is in **English** by default; switch to German under *More → Display → Language*. The book itself always stays German.


- **Lesen**: the book as a clean, reflowed reading view (serif, adjustable size, dark mode) broken into readable paragraphs (Q&A pairs, dialogue turns with the speaker, short narrative runs), with its illustrations. Whole-page scans in the EPUB open as a zoomable *Originalseite*, and any image can be cropped, moved above or below the text, or hidden via ✎. If the EPUB's copy of a picture is cut off, *Replace image* swaps in your own photo or screenshot of the page (kept on the device only). The margin glosses appear as *Randnotizen* and the *Wörter* boxes as tappable word lists. Tap any word to hear it, see its sentence, open DWDS, Wiktionary or dict.cc, and add it to your list. The app can read pages aloud (sentence highlighted), and you can practise pronunciation with *Nachsprechen*.
- **Üben**: every Übung A/B/C at the end of each chapter, imported automatically as digital exercises with inline gaps and an ä ö ü ß bar. Many answers are filled in from the chapter text. Where an answer is unknown, you mark your own answer ✓/✗ and the answer key builds itself. Every mistake becomes a review card.
- **Wiederholen**: spaced repetition with FSRS v4.5, implemented in `js/fsrs.js` with tests. Card types: cloze sentences from the book (optionally heard first), der/die/das, plural, and error cards from exercises. Typed answers get a character diff and a suggested rating.
- **Heute**: continue reading, cards due, chapters due for rereading (1, 3, 7, 16, 35, 80 days after you tap "Kapitel gelesen ✓"), open exercises, your streak, and a 14-day chart.
- **Wörter**: search, filter by chapter or gender, edit, and see per-word review stats.
- **KI-Tutor (optional, off by default)**: paste your own Anthropic API key under *Mehr → KI-Tutor* to check exercises, explain a sentence (German/English), or generate new reading texts that use only the vocabulary of the chapters you've read so far.

## Your book stays on your device

The book is **never** part of this repository and is never uploaded anywhere. You pick the file on your phone with *Buch laden*. It's stored in your browser's IndexedDB on that device only and cleaned up right there. `*.epub` and `*.pdf` are in `.gitignore`.

The repo only contains the cleaning *rules* and a small table of fixes for this edition (`js/bookfix.js`). The fixes are character positions, chapter titles and single-word OCR corrections, not book text. The API key, if you use one, lives only in that device's `localStorage` and isn't included in backups.

**Backups:** *Mehr → Sicherung exportieren* saves your words, cards, exercise progress, chapters and settings as JSON, without the book. To move to another device, import the JSON there and load the book file again.

## Install on iPhone

1. Open the GitHub Pages URL in Safari.
2. Share → *Zum Home-Bildschirm*.
3. Open it from the home screen, then go to *Heute → Buch laden* and pick `Deutsch-nach-der-Naturmethode.epub` (e.g. from Files/iCloud Drive).
4. For a nicer voice: Settings → Accessibility → Spoken Content → Voices → German → download an "Enhanced" voice, then choose it under *Mehr → Vorlesen*.

## Deploy to GitHub Pages

1. Create a public repository (e.g. `lesebuch`) and push this folder to `main`.
2. On GitHub: **Settings → Pages**.
3. Under *Build and deployment*, set **Source: Deploy from a branch**, then **Branch: `main`**, folder **`/ (root)`**, and click **Save**.
4. After a minute the site is live at `https://<user>.github.io/lesebuch/`.

When you ship changes, bump `VERSION` in `sw.js` so installed copies pick up the new files on the next launch.

## Development

```sh
npm run serve        # python3 -m http.server 8642 → http://localhost:8642
npm test             # FSRS, grading and text-helper unit tests (Node 18+)
```

- `test/mobile.html` previews the app at 390×844 (and 375×667 with `#both`).
- `test/sample.pdf` is a tiny **original** test document (made up by `test/make_sample_pdf.py`) for the PDF fallback path. It has a side column of glosses and a gap-fill exercise.

### Layout

| Path | Purpose |
| --- | --- |
| `js/epub.js`, `js/clean.js`, `js/bookfix.js`, `js/epubbook.js` | EPUB unzip (no dependency), OCR cleanup, edition fixes, ingest |
| `js/book.js`, `js/layout.js`, `js/exercises.js` | PDF fallback: PDF.js, column/margin-note layout, OCR, exercise builder |
| `js/reader.js`, `js/wordsheet.js`, `js/tts.js` | Reader, word sheet, speech |
| `js/illus.js` | Illustration defaults, crop/position editor, scan viewer |
| `js/practice.js`, `js/review.js`, `js/fsrs.js`, `js/grade.js` | Exercises, review session, scheduler, answer grading |
| `js/home.js`, `js/words.js`, `js/more.js`, `js/reread.js` | Other tabs, reread scheduler |
| `js/ai.js` | Optional AI tutor (direct browser call with your own key) |
| `vendor/` | PDF.js 3.11.174 (offline) |
