// Sources en ligne, légales, jouables sans import :
//  - YouTube via le lecteur officiel intégré (IFrame Player API) + recherche (YouTube Data API, clé gratuite)
//  - Radios du monde entier via Radio Browser (annuaire libre, sans clé)

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
export function parseYouTubeUrl(text) {
  const s = (text || '').trim();
  let m = s.match(/[?&]list=([\w-]{10,})/);
  const list = m ? m[1] : null;
  m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  const video = m ? m[1] : null;
  if (!video && !list) return null;
  return { video, list };
}

// « Artiste - Titre (Official Video) » → { artist, title }
export function cleanYouTubeTitle(raw, channel = '') {
  let t = (raw || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  t = t.replace(/\s*[([](?:official|clip|video|audio|lyrics?|paroles|visualizer|hd|hq|4k|music video|clip officiel|vid[eé]o officielle|audio officiel)[^)\]]*[)\]]/gi, '');
  t = t.replace(/\s*\|\s*.*$/, '').trim();
  const artistCh = channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const parts = t.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: artistCh, title: t };
}

function isoDuration(d) {
  const m = (d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// ---------------------------------------------------------------------
// YouTube : recherche (Data API v3, clé gratuite de l'utilisateur)
// ---------------------------------------------------------------------
const YT_API = 'https://www.googleapis.com/youtube/v3';

export async function ytSearch(key, q, max = 20) {
  const p = new URLSearchParams({ part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: max, q, key, regionCode: 'FR', relevanceLanguage: 'fr' });
  const r = await fetch(`${YT_API}/search?${p}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Recherche YouTube impossible');
  const ids = j.items.map(i => i.id.videoId).filter(Boolean);
  return ytVideos(key, ids, j.items);
}

export async function ytVideos(key, ids, snippets = []) {
  if (!ids.length) return [];
  const p = new URLSearchParams({ part: 'contentDetails,snippet', id: ids.join(','), key });
  const r = await fetch(`${YT_API}/videos?${p}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'YouTube indisponible');
  const map = new Map(j.items.map(v => [v.id, v]));
  return ids.map(id => {
    const v = map.get(id) || snippets.find(s => s.id?.videoId === id);
    if (!v) return null;
    const sn = v.snippet;
    const { artist, title } = cleanYouTubeTitle(sn.title, sn.channelTitle);
    return {
      ytId: id, title, artist,
      duration: isoDuration(v.contentDetails?.duration),
      thumb: sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }).filter(Boolean);
}

export async function ytPlaylist(key, listId) {
  let ids = [], token = '', name = 'Playlist YouTube';
  try {
    const pr = await fetch(`${YT_API}/playlists?${new URLSearchParams({ part: 'snippet', id: listId, key })}`);
    const pj = await pr.json();
    if (pj.items?.[0]) name = pj.items[0].snippet.title;
  } catch { /* nom par défaut */ }
  do {
    const p = new URLSearchParams({ part: 'contentDetails', playlistId: listId, maxResults: 50, key });
    if (token) p.set('pageToken', token);
    const r = await fetch(`${YT_API}/playlistItems?${p}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'Playlist introuvable (elle doit être publique ou non répertoriée)');
    ids.push(...j.items.map(i => i.contentDetails.videoId));
    token = j.nextPageToken;
  } while (token && ids.length < 500);
  const out = [];
  for (let i = 0; i < ids.length; i += 50) out.push(...await ytVideos(key, ids.slice(i, i + 50)));
  return { name, tracks: out };
}

// Titre d'une vidéo sans clé (oEmbed public)
export async function ytInfoNoKey(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
    if (r.ok) {
      const j = await r.json();
      const { artist, title } = cleanYouTubeTitle(j.title, j.author_name);
      return { ytId: id, title, artist, duration: 0, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
    }
  } catch { /* hors ligne ou bloqué */ }
  return { ytId: id, title: 'Vidéo YouTube', artist: 'YouTube', duration: 0, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
}

// ---------------------------------------------------------------------
// YouTube : lecteur officiel, présenté comme un <audio> pour le moteur
// ---------------------------------------------------------------------
let apiReady;
function loadYT() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiReady = null; reject(new Error('YouTube injoignable (connexion ?)')); };
    document.head.appendChild(s);
  });
  return apiReady;
}

export class YouTubeElement extends EventTarget {
  constructor(host) {
    super();
    this.host = host;           // conteneur visible (le lecteur YouTube doit rester visible)
    this.player = null;
    this.videoId = null;
    this._paused = true;
    this._vol = 1;
    this._dur = 0;
    this._tick = 0;
    this.src = '';
  }
  get paused() { return this._paused; }
  get currentTime() { try { return this.player?.getCurrentTime?.() || 0; } catch { return 0; } }
  set currentTime(t) { try { this.player?.seekTo(t, true); } catch { /* ignore */ } }
  get duration() { try { return this.player?.getDuration?.() || this._dur; } catch { return this._dur; } }
  get readyState() { return this.player ? 4 : 0; }
  get volume() { return this._vol; }
  set volume(v) { this._vol = v; try { this.player?.setVolume(Math.round(v * 100)); } catch { /* ignore */ } }
  fire(t) { this.dispatchEvent(new Event(t)); }

  async load(id, duration = 0) {
    this.videoId = id;
    this.src = 'yt:' + id;
    this._dur = duration;
    const YT = await loadYT();
    if (this.player) { this.player.cueVideoById(id); return; }
    await new Promise(resolve => {
      const div = document.createElement('div');
      this.host.innerHTML = '';
      this.host.appendChild(div);
      this.player = new YT.Player(div, {
        videoId: id,
        width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, iv_load_policy: 3, origin: location.origin },
        events: {
          onReady: () => resolve(),
          onStateChange: e => this.onState(e.data),
          onError: () => this.fire('error'),
        },
      });
    });
  }

  onState(s) {
    // -1 non démarré, 0 fini, 1 lecture, 2 pause, 3 chargement, 5 prêt
    if (s === 1) {
      if (this._paused) { this._paused = false; this.fire('play'); }
      this.fire('loadedmetadata');
      clearInterval(this._tick);
      this._tick = setInterval(() => this.fire('timeupdate'), 400);
    } else if (s === 2 || s === 0 || s === 5 || s === -1) {
      clearInterval(this._tick);
      if (!this._paused) { this._paused = true; this.fire('pause'); }
      if (s === 0) this.fire('ended');
    }
  }

  async play() {
    if (!this.player) return;
    this._wantPlay = true;
    this.player.playVideo();
  }
  pause() { try { this.player?.pauseVideo(); } catch { /* ignore */ } }
  removeAttribute() { this.pause(); }
}

// ---------------------------------------------------------------------
// Radios (Radio Browser : annuaire communautaire libre, sans clé)
// ---------------------------------------------------------------------
const RB = ['https://de1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://nl1.api.radio-browser.info'];

async function rb(path) {
  let err;
  for (const base of RB) {
    try {
      const r = await fetch(base + path);
      if (r.ok) return await r.json();
    } catch (e) { err = e; }
  }
  throw err || new Error('Radios indisponibles');
}

function mapStation(s) {
  return {
    radioId: s.stationuuid, title: s.name.trim(), artist: [s.country, (s.tags || '').split(',').slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    url: s.url_resolved || s.url, thumb: s.favicon && s.favicon.startsWith('https') ? s.favicon : '',
  };
}

export async function radioByTag(tag, limit = 40) {
  const p = new URLSearchParams({ tag, order: 'clickcount', reverse: 'true', hidebroken: 'true', limit: limit * 2, is_https: 'true' });
  const list = await rb(`/json/stations/search?${p}`);
  return dedupe(list.filter(s => (s.url_resolved || s.url || '').startsWith('https')).map(mapStation)).slice(0, limit);
}

export async function radioSearch(name, limit = 30) {
  const p = new URLSearchParams({ name, order: 'clickcount', reverse: 'true', hidebroken: 'true', limit: limit * 2 });
  const list = await rb(`/json/stations/search?${p}`);
  return dedupe(list.filter(s => (s.url_resolved || s.url || '').startsWith('https')).map(mapStation)).slice(0, limit);
}

export async function radioTop(country = 'FR', limit = 30) {
  const p = new URLSearchParams({ countrycode: country, order: 'clickcount', reverse: 'true', hidebroken: 'true', limit: limit * 2 });
  const list = await rb(`/json/stations/search?${p}`);
  return dedupe(list.filter(s => (s.url_resolved || s.url || '').startsWith('https')).map(mapStation)).slice(0, limit);
}

function dedupe(a) {
  const seen = new Set();
  return a.filter(x => { const k = x.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

export const RADIO_GENRES = [
  ['rap francais', 'Rap FR'], ['hip-hop', 'Hip-Hop'], ['rnb', 'RnB'], ['afrobeats', 'Afro'], ['pop', 'Pop'],
  ['dance', 'Dance'], ['electronic', 'Électro'], ['house', 'House'], ['reggaeton', 'Reggaeton'], ['lofi', 'Lo-fi'],
  ['jazz', 'Jazz'], ['soul', 'Soul'], ['rock', 'Rock'], ['classical', 'Classique'], ['chill', 'Chill'], ['raï', 'Raï'],
];
