// Paroles : lecture des LRC (synchronisées) ou texte brut, et recherche en ligne (LRCLIB, gratuit, sans clé).

export function parseLyrics(text) {
  if (!text) return null;
  const lines = [];
  let synced = false;
  let offset = 0;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = +off[1] / 1000; continue; }
    if (/^\[(ar|ti|al|by|length|re|ve|au|#):/i.test(raw)) continue;
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    const content = raw.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    if (stamps.length) {
      synced = true;
      for (const m of stamps) lines.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')) - offset, text: content });
    } else if (!synced) {
      lines.push({ t: null, text: raw.trim() });
    }
  }
  if (synced) {
    const out = lines.filter(l => l.t !== null).sort((a, b) => a.t - b.t);
    // retire les lignes vides consécutives
    return { synced: true, lines: out.filter((l, i) => l.text || (out[i - 1] && out[i - 1].text)) };
  }
  const plain = lines.map(l => l.text);
  while (plain.length && !plain[0]) plain.shift();
  while (plain.length && !plain.at(-1)) plain.pop();
  return plain.length ? { synced: false, lines: plain.map(text => ({ t: null, text })) } : null;
}

export function activeIndex(parsed, time) {
  if (!parsed?.synced) return -1;
  const L = parsed.lines;
  let lo = 0, hi = L.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (L[mid].t <= time + 0.25) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const API = 'https://lrclib.net/api';

// Nettoie un titre YouTube : « Ninho - Jefe (Clip officiel) [4K] ft. X » → « Jefe »
export function cleanTitle(t) {
  return (t || '')
    .replace(/\s*[\(\[](?:[^\)\]]*?(?:clip|officiel|official|video|vidéo|audio|lyrics?|paroles|visuali[sz]er|4k|hd|hq|live|prod\.?|music video|explicit|remaster(?:ed)?|version)[^\)\]]*)[\)\]]/gi, '')
    .replace(/\s*(?:ft\.?|feat\.?|featuring|avec)\s+.*$/i, '')
    .replace(/\s*[|｜]\s*.*$/, '')
    .replace(/\s*-\s*(?:clip officiel|official (?:music )?video|audio officiel|lyrics?)\s*$/i, '')
    .replace(/["“”«»]/g, '')
    .replace(/\s+/g, ' ').trim();
}
// « Artiste - Titre » dans le titre : on garde le titre
function titleFor(t) {
  let title = cleanTitle(t.title);
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) title = m[2];
  return title;
}
const mainArtist = a => (a || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').split(/\s*(?:,|&|\bx\b|feat\.?|ft\.?|\bet\b)\s+/i)[0].trim();
const n = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Note de ressemblance d'un résultat : bon titre, bon artiste, bonne durée, paroles synchronisées
function score(x, t, title, artist) {
  if (!x || x.instrumental) return -99;
  let s = x.syncedLyrics ? 3 : x.plainLyrics ? 1 : -99;
  const xt = n(x.trackName), wt = n(title), xa = n(x.artistName), wa = n(artist);
  if (xt === wt) s += 4; else if (xt.includes(wt) || wt.includes(xt)) s += 2; else s -= 3;
  if (wa && (xa.includes(wa) || wa.includes(xa))) s += 3; else if (wa) s -= 2;
  if (t.duration && x.duration) {
    const d = Math.abs(x.duration - t.duration);
    s += d <= 3 ? 3 : d <= 8 ? 1 : d <= 20 ? -1 : -5;
  }
  return s;
}

async function api(path, params) {
  const r = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout?.(8000) });
  if (!r.ok) return null;
  return r.json();
}

// Liste des paroles candidates (pour choisir soi-même quand ce ne sont pas les bonnes)
export async function searchCandidates(t, query) {
  const title = titleFor(t), artist = mainArtist(t.artist);
  const seen = new Set(), out = [];
  const add = list => (Array.isArray(list) ? list : []).forEach(x => { if (x && !seen.has(x.id) && (x.syncedLyrics || x.plainLyrics)) { seen.add(x.id); out.push(x); } });
  try {
    if (query) add(await api('search', { q: query }));
    else {
      if (artist) add(await api('search', { track_name: title, artist_name: artist }));
      add(await api('search', { q: `${artist} ${title}`.trim() }));
      if (out.length < 3) add(await api('search', { q: title }));
    }
  } catch { /* hors ligne */ }
  return out.sort((a, b) => score(b, t, title, artist) - score(a, t, title, artist)).slice(0, 15);
}
export const lyricsOf = x => x?.syncedLyrics || x?.plainLyrics || null;

export async function fetchOnline(t) {
  if (!t.title) return null;
  const title = titleFor(t), artist = mainArtist(t.artist);
  try {
    // 1) recherche exacte (titre + artiste + durée) : la plus fiable
    if (artist) {
      const p = { track_name: title, artist_name: artist };
      if (t.album) p.album_name = t.album;
      if (t.duration) p.duration = Math.round(t.duration);
      const r = await api('get', p).catch(() => null);
      if (r && score(r, t, title, artist) >= 4) return lyricsOf(r);
    }
    // 2) plusieurs recherches, on garde le meilleur résultat… seulement s'il ressemble vraiment
    const list = await searchCandidates(t);
    const best = list[0];
    if (best && score(best, t, title, artist) >= 3) return lyricsOf(best);
    return null;
  } catch {
    return null;
  }
}
