// Service worker: app shell + vendor files cached for offline use.
// Bump VERSION when shipping changes so clients pick up the new shell.
const VERSION = 'lesebuch-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/ai.js',
  'js/book.js',
  'js/bookfix.js',
  'js/clean.js',
  'js/db.js',
  'js/epub.js',
  'js/epubbook.js',
  'js/exercises.js',
  'js/fsrs.js',
  'js/grade.js',
  'js/home.js',
  'js/illus.js',
  'js/layout.js',
  'js/library.js',
  'js/model.js',
  'js/more.js',
  'js/practice.js',
  'js/reader.js',
  'js/reread.js',
  'js/review.js',
  'js/settings.js',
  'js/tts.js',
  'js/ui.js',
  'js/words.js',
  'js/wordsheet.js',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
];
const RUNTIME = 'lesebuch-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.anthropic.com') return; // never cache AI calls

  if (url.origin === location.origin) {
    // stale-while-revalidate: instant from cache, refreshed in the background
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const isShell = req.mode === 'navigate' && /\/(index\.html)?$/.test(url.pathname);
      const key = isShell ? 'index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') cache.put(key, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(fresh); return cached; }
      return (await fresh) || (await caches.match(key, { ignoreSearch: true })) || new Response('Offline', { status: 503 });
    })());
    return;
  }

  // Google Fonts and the OCR library: cache on first use
  if (/fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
  }
});
