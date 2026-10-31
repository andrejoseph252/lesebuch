// Minimal EPUB reader: ZIP central directory + DecompressionStream('deflate-raw').
// No dependencies, works in Safari 16.4+, Chrome and Node 18+.

const dec = new TextDecoder();

export async function openZip(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige EPUB/ZIP-Datei');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  async function read(name) {
    const e = entries.get(name);
    if (!e) throw new Error(`Fehlt im EPUB: ${name}`);
    const lp = e.local;
    const start = lp + 30 + dv.getUint16(lp + 26, true) + dv.getUint16(lp + 28, true);
    const data = bytes.subarray(start, start + e.compSize);
    if (e.method === 0) return data.slice();
    if (e.method !== 8) throw new Error(`Unbekannte Kompression in ${name}`);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return { entries, read, text: async (name) => dec.decode(await read(name)) };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** Body text of an XHTML page, whitespace-normalized. This exact string is what fix offsets refer to. */
export function pageText(html) {
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  return decodeEntities(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const dirOf = (p) => p.replace(/[^/]*$/, '');
const resolve = (base, rel) => {
  const parts = (base + rel).split('/');
  const out = [];
  for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.') out.push(x); }
  return out.join('/');
};

/** Read the spine: [{ href, text, images: [zipPath] }] in reading order (only content pages). */
export async function readEpub(buf) {
  const zip = await openZip(buf);
  const container = await zip.text('META-INF/container.xml');
  const opfPath = container.match(/full-path="([^"]+)"/)[1];
  const opf = await zip.text(opfPath);
  const base = dirOf(opfPath);
  const manifest = new Map();
  for (const tag of opf.match(/<item\b[^>]*>/g) || []) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    const type = tag.match(/\bmedia-type="([^"]+)"/)?.[1];
    if (id && href) manifest.set(id, { href: decodeURIComponent(href), type });
  }
  const title = decodeEntities(opf.match(/<dc:title[^>]*>([^<]*)</)?.[1] || '');
  const pages = [];
  for (const [, idref] of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
    const item = manifest.get(idref);
    if (!item || !/x?html/.test(item.type || item.href)) continue;
    const path = resolve(base, item.href);
    const html = await zip.text(path);
    if (/epub:type="toc"|<nav\b/i.test(html) && !/<p\b/i.test(html)) continue;
    const images = [...html.matchAll(/<img\b[^>]*src="([^"]+)"/gi)].map((m) => resolve(dirOf(path), decodeURIComponent(m[1])));
    pages.push({ href: item.href, text: pageText(html), images });
  }
  return { title, pages, zip };
}
