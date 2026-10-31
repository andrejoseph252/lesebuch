// IndexedDB wrapper. Everything the app knows lives here, on this device only.

const DB_NAME = 'lesebuch';
const DB_VERSION = 1;
export const STORES = ['kv', 'pages', 'chapters', 'words', 'cards', 'exercises', 'reviewLog', 'texts'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'page' });
      if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('words')) {
        const s = db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
        s.createIndex('lemma', 'lemmaKey');
      }
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'id' });
        s.createIndex('due', 'due');
        s.createIndex('ref', 'ref');
      }
      if (!db.objectStoreNames.contains('exercises')) {
        const s = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
        s.createIndex('page', 'page');
      }
      if (!db.objectStoreNames.contains('reviewLog')) {
        const s = db.createObjectStore('reviewLog', { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function get(name, key) { return wrap((await store(name)).get(key)); }
export async function all(name) { return wrap((await store(name)).getAll()); }
export async function put(name, value, key) {
  const s = await store(name, 'readwrite');
  return wrap(key === undefined ? s.put(value) : s.put(value, key));
}
export async function del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); }
export async function clear(name) { return wrap((await store(name, 'readwrite')).clear()); }
export async function count(name) { return wrap((await store(name)).count()); }
export async function byIndex(name, index, query) { return wrap((await store(name)).index(index).getAll(query)); }
export async function keys(name) { return wrap((await store(name)).getAllKeys()); }

/** Write many records in one transaction. */
export async function putMany(name, values) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const s = tx.objectStore(name);
    for (const v of values) s.put(v);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- key/value helpers ----
export const kv = {
  get: (k) => get('kv', k),
  set: (k, v) => put('kv', v, k),
  del: (k) => del('kv', k),
};

// ---- backup ----
const KV_EXCLUDE = new Set(['pdf', 'epub']);

export async function exportData({ includePages = false } = {}) {
  const out = { app: 'lesebuch', version: 1, exportedAt: new Date().toISOString(), stores: {} };
  for (const name of STORES) {
    if (name === 'kv') {
      const ks = await keys('kv');
      const entries = [];
      for (const k of ks) if (!KV_EXCLUDE.has(k)) entries.push([k, await get('kv', k)]);
      out.stores.kv = entries;
    } else if (name === 'pages') {
      const pages = await all('pages');
      // OCR results are expensive to redo, so they always travel; plain text layers only on request.
      out.stores.pages = includePages ? pages : pages.filter((p) => p.ocr);
    } else {
      out.stores[name] = await all(name);
    }
  }
  return out;
}

export async function importData(data) {
  if (!data || data.app !== 'lesebuch' || !data.stores) throw new Error('Keine Lesebuch-Sicherung');
  for (const name of STORES) {
    const rows = data.stores[name];
    if (!rows) continue;
    if (name === 'kv') {
      for (const [k, v] of rows) if (!KV_EXCLUDE.has(k)) await put('kv', v, k);
    } else if (name === 'pages') {
      await putMany('pages', rows); // merge: keep pages already extracted on this device
    } else {
      await clear(name);
      await putMany(name, rows);
    }
  }
}

export async function wipeAll() {
  for (const name of STORES) await clear(name);
}
