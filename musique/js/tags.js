// Lecture des métadonnées (titre, artiste, album, pochette) directement dans le fichier.
// Formats gérés : MP3 (ID3v2.2/2.3/2.4 + ID3v1), FLAC (Vorbis comments + PICTURE),
// M4A/MP4/AAC (atomes iTunes), OGG/Opus (Vorbis comments). Sinon : nom du fichier.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

const clean = s => (s || '').replace(/\0/g, '').trim();

async function readBytes(file, start, len) {
  const buf = await file.slice(start, start + len).arrayBuffer();
  return new Uint8Array(buf);
}

function syncsafe(b, o) {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u24 = (b, o) => (b[o] << 16) + (b[o + 1] << 8) + b[o + 2];
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function decodeText(enc, bytes) {
  if (!bytes.length) return '';
  switch (enc) {
    case 1: { // UTF-16 avec BOM
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be.decode(bytes.subarray(2));
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16le.decode(bytes.subarray(2));
      return utf16le.decode(bytes);
    }
    case 2: return utf16be.decode(bytes);
    case 3: return utf8.decode(bytes);
    default: return latin1.decode(bytes);
  }
}

// Position de fin d'une chaîne terminée par \0 (ou \0\0 en UTF-16)
function termEnd(bytes, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    return bytes.length;
  }
  for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i;
  return bytes.length;
}

function unsync(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return new Uint8Array(out);
}

async function parseID3v2(file, head) {
  const ver = head[3];
  const flags = head[5];
  const size = syncsafe(head, 6);
  let b = await readBytes(file, 10, size);
  if ((flags & 0x80) && ver < 4) b = unsync(b);
  let p = 0;
  if (flags & 0x40) { // en-tête étendu
    p = ver === 4 ? syncsafe(b, 0) : u32(b, 0) + 4;
  }
  const t = {};
  const ids = ver === 2
    ? { TT2: 'title', TP1: 'artist', TP2: 'albumArtist', TAL: 'album', TRK: 'track', TYE: 'year', TCO: 'genre', PIC: 'pic' }
    : { TIT2: 'title', TPE1: 'artist', TPE2: 'albumArtist', TALB: 'album', TRCK: 'track', TYER: 'year', TDRC: 'year', TCON: 'genre', APIC: 'pic' };
  const idLen = ver === 2 ? 3 : 4;
  const hdLen = ver === 2 ? 6 : 10;
  while (p + hdLen < b.length) {
    const id = latin1.decode(b.subarray(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize = ver === 2 ? u24(b, p + 3) : ver === 4 ? syncsafe(b, p + 4) : u32(b, p + 4);
    const fflags = ver === 2 ? 0 : b[p + 9];
    let data = b.subarray(p + hdLen, p + hdLen + fsize);
    p += hdLen + fsize;
    if (fsize <= 0) continue;
    const key = ids[id];
    if (!key) continue;
    if (ver === 4 && (fflags & 0x02)) data = unsync(data);
    if (ver === 4 && (fflags & 0x01)) data = data.subarray(4); // longueur de données
    const enc = data[0];
    if (key === 'pic') {
      if (t.picture) continue;
      let q = 1, mime;
      if (ver === 2) {
        const fmt = latin1.decode(data.subarray(1, 4)).toLowerCase();
        mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
        q = 4;
      } else {
        const e = termEnd(data, 1, 0);
        mime = latin1.decode(data.subarray(1, e)) || 'image/jpeg';
        q = e + 1;
      }
      q += 1; // type d'image
      const de = termEnd(data, q, enc);
      q = de + (enc === 1 || enc === 2 ? 2 : 1);
      if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase().replace('jpg', 'jpeg');
      t.picture = new Blob([data.slice(q)], { type: mime });
    } else {
      const s = clean(decodeText(enc, data.subarray(1)).split('\0')[0]);
      if (s && !t[key]) t[key] = s;
    }
  }
  return t;
}

async function parseID3v1(file) {
  if (file.size < 128) return {};
  const b = await readBytes(file, file.size - 128, 128);
  if (latin1.decode(b.subarray(0, 3)) !== 'TAG') return {};
  const s = (a, z) => clean(latin1.decode(b.subarray(a, z)));
  return { title: s(3, 33), artist: s(33, 63), album: s(63, 93), year: s(93, 97) };
}

function applyVorbis(t, key, val) {
  key = key.toUpperCase();
  const map = { TITLE: 'title', ARTIST: 'artist', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist', ALBUM: 'album', TRACKNUMBER: 'track', DATE: 'year', GENRE: 'genre' };
  if (map[key] && !t[map[key]]) t[map[key]] = clean(val);
  if (key === 'METADATA_BLOCK_PICTURE' && !t.picture) {
    try {
      const bin = Uint8Array.from(atob(val), c => c.charCodeAt(0));
      t.picture = parsePictureBlock(bin);
    } catch { /* ignore */ }
  }
}

function parseVorbisComments(b, o, t) {
  const vlen = u32le(b, o); o += 4 + vlen;
  const n = u32le(b, o); o += 4;
  for (let i = 0; i < n && o < b.length; i++) {
    const len = u32le(b, o); o += 4;
    const s = utf8.decode(b.subarray(o, o + len)); o += len;
    const eq = s.indexOf('=');
    if (eq > 0) applyVorbis(t, s.slice(0, eq), s.slice(eq + 1));
  }
}

function parsePictureBlock(b) {
  let o = 4;
  const ml = u32(b, o); o += 4;
  const mime = latin1.decode(b.subarray(o, o + ml)); o += ml;
  const dl = u32(b, o); o += 4 + dl;
  o += 16;
  const len = u32(b, o); o += 4;
  return new Blob([b.slice(o, o + len)], { type: mime || 'image/jpeg' });
}

async function parseFLAC(file) {
  const t = {};
  let pos = 4;
  for (let guard = 0; guard < 64; guard++) {
    const h = await readBytes(file, pos, 4);
    if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = u24(h, 1);
    pos += 4;
    if (type === 4 || (type === 6 && !t.picture)) {
      const b = await readBytes(file, pos, len);
      if (type === 4) parseVorbisComments(b, 0, t);
      else t.picture = parsePictureBlock(b);
    }
    pos += len;
    if (last) break;
  }
  return t;
}

async function parseOgg(file) {
  // Cherche le paquet de commentaires dans les 256 premiers Ko
  const b = await readBytes(file, 0, Math.min(file.size, 262144));
  const t = {};
  const s = latin1.decode(b);
  let i = s.indexOf('\x03vorbis');
  let off = 7;
  if (i < 0) { i = s.indexOf('OpusTags'); off = 8; }
  if (i < 0) return t;
  // Retire les en-têtes de page Ogg pouvant couper le paquet
  try { parseVorbisComments(stripOggPages(b, i + off), 0, t); } catch { /* ignore */ }
  return t;
}

function stripOggPages(b, start) {
  const out = [];
  let i = start;
  while (i < b.length) {
    if (b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53 && i + 27 < b.length) {
      const segs = b[i + 26];
      i += 27 + segs;
      continue;
    }
    out.push(b[i]); i++;
  }
  return new Uint8Array(out);
}

async function parseMP4(file) {
  const t = {};
  const names = { '\xa9nam': 'title', '\xa9ART': 'artist', aART: 'albumArtist', '\xa9alb': 'album', '\xa9day': 'year', '\xa9gen': 'genre' };
  async function walk(start, end, depth) {
    let pos = start;
    while (pos + 8 <= end && depth < 8) {
      const h = await readBytes(file, pos, 16);
      let size = u32(h, 0);
      const type = latin1.decode(h.subarray(4, 8));
      let hdr = 8;
      if (size === 1) { size = u32(h, 8) * 4294967296 + u32(h, 12); hdr = 16; }
      if (size === 0) size = end - pos;
      if (size < 8) break;
      if (['moov', 'udta', 'ilst', 'trak', 'mdia'].includes(type)) {
        await walk(pos + hdr, pos + size, depth + 1);
      } else if (type === 'meta') {
        await walk(pos + hdr + 4, pos + size, depth + 1);
      } else if (names[type] || type === 'covr' || type === 'trkn') {
        const b = await readBytes(file, pos + hdr, Math.min(size - hdr, 8 * 1024 * 1024));
        // atome "data" : taille(4) "data"(4) type(4) locale(4) valeur
        if (latin1.decode(b.subarray(4, 8)) === 'data') {
          const dt = u32(b, 8) & 0xffffff;
          const val = b.subarray(16, u32(b, 0));
          if (type === 'covr') { if (!t.picture) t.picture = new Blob([val.slice()], { type: dt === 14 ? 'image/png' : 'image/jpeg' }); }
          else if (type === 'trkn') { t.track = String((val[2] << 8) + val[3]); }
          else t[names[type]] = clean(utf8.decode(val));
        }
      }
      pos += size;
    }
  }
  await walk(0, file.size, 0);
  return t;
}

function fromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}[\s.\-]+/, '').trim();
  const m = base.split(/\s+-\s+/);
  if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
  return { title: base };
}

export async function readTags(file) {
  let t = {};
  try {
    const head = await readBytes(file, 0, 12);
    const magic = latin1.decode(head.subarray(0, 4));
    if (magic.startsWith('ID3')) {
      t = await parseID3v2(file, head);
      const v1 = await parseID3v1(file);
      for (const k in v1) if (!t[k] && v1[k]) t[k] = v1[k];
    } else if (magic === 'fLaC') t = await parseFLAC(file);
    else if (magic === 'OggS') t = await parseOgg(file);
    else if (latin1.decode(head.subarray(4, 8)) === 'ftyp') t = await parseMP4(file);
    else t = await parseID3v1(file);
  } catch (e) {
    console.warn('Tags illisibles', file.name, e);
  }
  const fb = fromFilename(file.name || 'Sans titre');
  if (!t.title) { t.title = fb.title; if (!t.artist && fb.artist) t.artist = fb.artist; }
  if (t.track) t.track = parseInt(t.track, 10) || 0;
  if (t.year) t.year = String(t.year).slice(0, 4);
  return t;
}
