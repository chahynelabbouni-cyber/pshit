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

export async function fetchOnline(t) {
  if (!t.title) return null;
  const artist = (t.artist || '').split(/\s*(?:,|&|feat\.?|ft\.?|x)\s+/i)[0];
  const pick = r => r && (r.syncedLyrics || r.plainLyrics) ? (r.syncedLyrics || r.plainLyrics) : null;
  try {
    if (artist) {
      const q = new URLSearchParams({ track_name: t.title, artist_name: artist });
      if (t.album) q.set('album_name', t.album);
      if (t.duration) q.set('duration', Math.round(t.duration));
      const r = await fetch(`${API}/get?${q}`);
      if (r.ok) { const v = pick(await r.json()); if (v) return v; }
    }
    const q2 = new URLSearchParams({ q: `${artist} ${t.title}`.trim() });
    const r2 = await fetch(`${API}/search?${q2}`);
    if (!r2.ok) return null;
    const list = await r2.json();
    if (!Array.isArray(list) || !list.length) return null;
    // privilégie une durée proche et des paroles synchronisées
    list.sort((a, b) => score(b) - score(a));
    function score(x) {
      let s = x.syncedLyrics ? 2 : x.plainLyrics ? 1 : -9;
      if (t.duration && x.duration) s -= Math.min(3, Math.abs(x.duration - t.duration) / 5);
      return s;
    }
    return pick(list[0]);
  } catch {
    return null;
  }
}
