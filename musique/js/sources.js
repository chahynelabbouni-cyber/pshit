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

// Ce qui n'est pas « un vrai son » : compilations, mix, albums entiers, vidéos de plusieurs heures…
const NOT_A_SONG = /\b(mix|mixtape|compil|compilation|playlist|non ?stop|full album|album complet|best of|megamix|mashup|live set|dj set|medley|\d+\s*(h|hr|hrs|hour|hours|heures?)\b|top \d+|\d{2,}\s*(songs|titres|sons|hits)|reaction|tutorial|cover|karaoke|instrumental version|slowed|reverb|8d|sped up|lyrics compilation)\b/i;
// Indices d'une source officielle (chaîne « - Topic » = audio officiel publié par la maison de disques)
function officialScore(v) {
  let s = 0;
  if (/ - Topic$/i.test(v.channel)) s += 4;
  if (/vevo$/i.test(v.channel)) s += 3;
  if (/official|officiel|clip officiel|audio officiel|official audio|official video|official music video/i.test(v.rawTitle)) s += 2;
  if (v.artist && v.channel && v.channel.toLowerCase().includes(v.artist.toLowerCase().slice(0, 6))) s += 1;
  return s;
}

// Requête réseau avec délai maximum et messages clairs en français
export async function fetchT(url, opts = {}, ms = 9000) {
  try { return await fetch(url, { ...opts, signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined }); }
  catch (e) {
    if (navigator.onLine === false) throw new Error('Pas de connexion internet');
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('Connexion trop lente, réessaie');
    throw new Error('Service injoignable pour le moment');
  }
}
// Réponse YouTube : traduit les erreurs (quota, clé…) et retient un quota épuisé jusqu'au lendemain
let ytBlockedUntil = Number(localStorage.getItem('onde.ytBlocked') || 0);
export const ytQuotaOver = () => Date.now() < ytBlockedUntil;
async function ytJson(url) {
  if (ytQuotaOver()) throw Object.assign(new Error('Quota YouTube du jour épuisé : il revient demain matin. En attendant, radios, infos et podcasts marchent.'), { reason: 'quotaExceeded' });
  const r = await fetchT(url);
  const j = await r.json().catch(() => ({}));
  if (r.ok) return j;
  const reason = j.error?.errors?.[0]?.reason || '';
  if (/quota|dailyLimit|rateLimit/i.test(reason)) {
    const d = new Date(); d.setUTCHours(8, 5, 0, 0); if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1);
    ytBlockedUntil = +d; try { localStorage.setItem('onde.ytBlocked', String(ytBlockedUntil)); } catch { /* ignore */ }
  }
  const msg = /quota|dailyLimit|rateLimit/i.test(reason) ? 'Quota YouTube du jour épuisé : il revient demain matin. En attendant, radios, infos et podcasts marchent.'
    : /keyInvalid|badRequest/i.test(reason) || /API key not valid/i.test(j.error?.message || '') ? 'Clé YouTube invalide : vérifie-la dans les Réglages.'
    : /accessNotConfigured|SERVICE_DISABLED/i.test(reason + JSON.stringify(j.error?.details || '')) ? 'Active « YouTube Data API v3 » pour ta clé dans Google Cloud.'
    : /forbidden|ipRefererBlocked|API_KEY_SERVICE_BLOCKED/i.test(reason + JSON.stringify(j.error?.details || '')) ? 'Ta clé YouTube est bloquée : retire ses restrictions dans Google Cloud.'
    : r.status === 404 ? 'Introuvable sur YouTube (playlist privée ?)' : `YouTube indisponible (${r.status})`;
  throw Object.assign(new Error(msg), { reason });
}
// Petit cache des recherches (économise le quota gratuit : 100 unités par recherche)
const ytCache = new Map();

/** Recherche YouTube. songsOnly (par défaut) : uniquement de vrais morceaux (1 à 8 min, pas de compil), sources officielles d'abord. */
export async function ytSearch(key, q, max = 20, { songsOnly = true } = {}) {
  const ck = [q.trim().toLowerCase(), max, songsOnly].join('|');
  const hit = ytCache.get(ck);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.v;
  const p = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', videoCategoryId: '10', maxResults: Math.min(50, songsOnly ? max * 2 + 10 : max), q, key, regionCode: 'FR', relevanceLanguage: 'fr' });
  const j = await ytJson(`${YT_API}/search?${p}`);
  const v = await ytSearchRank(key, j, max, songsOnly);
  ytCache.set(ck, { at: Date.now(), v });
  if (ytCache.size > 60) ytCache.delete(ytCache.keys().next().value);
  return v;
}
async function ytSearchRank(key, j, max, songsOnly) {
  const ids = j.items.map(i => i.id.videoId).filter(Boolean);
  const all = await ytVideos(key, ids, j.items);
  if (!songsOnly) return all.slice(0, max);
  const songs = all.filter(v => !NOT_A_SONG.test(v.rawTitle) && (!v.duration || (v.duration >= 60 && v.duration <= 480)));
  // tri stable : sources officielles d'abord, en gardant l'ordre de pertinence de YouTube
  const ranked = songs.map((v, i) => ({ v, k: officialScore(v) * 3 - i * 0.15 })).sort((a, b) => b.k - a.k).map(x => x.v);
  // un même titre une seule fois (clip + audio + lyrics…)
  const seen = new Set();
  const uniq = ranked.filter(v => { const k = (v.artist + '|' + v.title).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9|]/g, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  return (uniq.length ? uniq : all).slice(0, max);
}

export async function ytVideos(key, ids, snippets = []) {
  if (!ids.length) return [];
  const p = new URLSearchParams({ part: 'contentDetails,snippet', id: ids.join(','), key });
  const j = await ytJson(`${YT_API}/videos?${p}`);
  const map = new Map(j.items.map(v => [v.id, v]));
  return ids.map(id => {
    const v = map.get(id) || snippets.find(s => s.id?.videoId === id);
    if (!v) return null;
    const sn = v.snippet;
    const { artist, title } = cleanYouTubeTitle(sn.title, sn.channelTitle);
    return {
      ytId: id, title, artist, rawTitle: sn.title || '', channel: sn.channelTitle || '',
      duration: isoDuration(v.contentDetails?.duration),
      thumb: sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }).filter(Boolean);
}

export async function ytPlaylist(key, listId) {
  let ids = [], token = '', name = 'Playlist YouTube';
  try {
    const pj = await ytJson(`${YT_API}/playlists?${new URLSearchParams({ part: 'snippet', id: listId, key })}`);
    if (pj.items?.[0]) name = pj.items[0].snippet.title;
  } catch { /* nom par défaut */ }
  do {
    const p = new URLSearchParams({ part: 'contentDetails', playlistId: listId, maxResults: 50, key });
    if (token) p.set('pageToken', token);
    const j = await ytJson(`${YT_API}/playlistItems?${p}`);
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
    const r = await fetchT(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
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

// N'accepte que des adresses https valides (les annuaires de radios sont publics)
export function safeHttps(u) { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } }

export class YouTubeElement extends EventTarget {
  // Deux lecteurs YouTube officiels : l'un joue, l'autre a déjà chargé le son suivant (changement rapide).
  // Règles YouTube respectées : pas de lecture cachée, pas de relance forcée quand YouTube se met en pause.
  constructor(host) {
    super();
    this.host = host;
    this.slots = [0, 1].map(() => ({ el: null, player: null, videoId: null, ready: null, failed: false }));
    this.a = 0;                 // lecteur actif
    this.videoId = null;
    this._paused = true;
    this._vol = 1;
    this._dur = 0;
    this._tick = 0;
    this.errorCode = null;
    this.src = '';
  }
  get player() { return this.slots[this.a].player; }
  get paused() { return this._paused; }
  get currentTime() { try { return this.player?.getCurrentTime?.() || 0; } catch { return 0; } }
  set currentTime(t) { try { this.player?.seekTo(t, true); } catch { /* ignore */ } }
  get duration() { try { return this.player?.getDuration?.() || this._dur; } catch { return this._dur; } }
  get readyState() { return this.player ? 4 : 0; }
  get playbackRate() { return 1; }
  get volume() { return this._vol; }
  set volume(v) { this._vol = v; try { this.player?.setVolume(Math.round(v * 100)); } catch { /* ignore */ } }
  fire(t) { this.dispatchEvent(new Event(t)); }

  showActive() {
    this.slots.forEach((s, i) => { if (s.el) s.el.classList.toggle('yt-standby', i !== this.a); });
  }

  // Crée le lecteur d'un emplacement une seule fois, même si plusieurs demandes arrivent en même temps
  ensure(i, id, autoplay, start = 0) {
    const s = this.slots[i];
    if (s.ready) return s.ready.then(() => false);
    s.ready = (async () => {
      const YT = await loadYT();
      if (!this.host.querySelector('.yt-slot')) this.host.innerHTML = '';
      s.el = document.createElement('div');
      s.el.className = 'yt-slot';
      const div = document.createElement('div');
      s.el.appendChild(div);
      this.host.appendChild(s.el);
      s.videoId = id;
      const ready = new Promise(resolve => {
        s.player = new YT.Player(div, {
          videoId: id,
          width: '100%', height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, iv_load_policy: 3, autoplay: autoplay ? 1 : 0, start: Math.floor(start) || undefined, origin: location.origin },
          events: {
            onReady: () => resolve(),
            onStateChange: e => this.onState(e.data, i),
            onError: e => {
              if (i === this.a) { this.errorCode = e.data; clearInterval(this._tick); this._paused = true; this.fire('error'); }
              else { s.videoId = null; s.failed = true; } // le son préparé est illisible : on ne le réutilisera pas
            },
          },
        });
      });
      await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('YouTube ne répond pas')), 15000))]);
      this.showActive();
    })();
    s.ready.catch(() => { s.ready = null; s.player = null; s.el?.remove(); s.el = null; });
    return s.ready.then(() => true);
  }

  async load(id, duration = 0, autoplay = false, start = 0) {
    this.videoId = id;
    this.src = 'yt:' + id;
    this._dur = duration;
    this.errorCode = null;
    const standby = this.slots[1 - this.a];
    // Le son demandé est déjà prêt dans le second lecteur : on bascule dessus
    let usable = standby.player && standby.videoId === id && !standby.failed;
    try { usable = usable && standby.player.getPlayerState?.() !== undefined; } catch { usable = false; }
    if (usable) {
      try { this.player?.pauseVideo(); } catch { /* ignore */ }
      this.a = 1 - this.a;
      this.showActive();
      try { standby.player.setVolume(Math.round(this._vol * 100)); if (start) standby.player.seekTo(start, true); } catch { /* ignore */ }
      if (autoplay) standby.player.playVideo();
      return;
    }
    const s = this.slots[this.a];
    if (await this.ensure(this.a, id, autoplay, start)) return;
    s.videoId = id; s.failed = false;
    const o = { videoId: id, startSeconds: Math.floor(start) || 0 };
    autoplay ? s.player.loadVideoById(o) : s.player.cueVideoById(o);
  }

  // Prépare le son suivant dans le second lecteur, sans le lire (« cue » : simple chargement)
  async preload(id) {
    const i = 1 - this.a;
    const s = this.slots[i];
    if (s.videoId === id && s.player && !s.failed) return;
    try {
      const created = await this.ensure(i, id, false);
      if (i === this.a) return; // la lecture a changé entre-temps
      s.videoId = id; s.failed = false;
      if (!created) s.player.cueVideoById(id);
    } catch { /* tant pis, chargement normal au moment voulu */ }
  }

  onState(st, i) {
    if (i !== this.a) return; // le lecteur en attente ne joue jamais
    // -1 non démarré, 0 fini, 1 lecture, 2 pause, 3 chargement, 5 prêt
    if (st === 1) {
      if (this._paused) { this._paused = false; this.fire('play'); }
      this.fire('loadedmetadata');
      this.fire('durationchange');
      clearInterval(this._tick);
      this._tick = setInterval(() => this.fire('timeupdate'), 400);
    } else if (st === 2 || st === 0 || st === 5 || st === -1) {
      clearInterval(this._tick);
      if (!this._paused) { this._paused = true; this.fire('pause'); }
      if (st === 0) this.fire('ended');
    }
  }

  async play() {
    if (!this.player) return;
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
      const r = await fetchT(base + path, {}, 6000);
      if (r.ok) return await r.json();
    } catch (e) { err = e; }
  }
  throw new Error(navigator.onLine === false ? 'Pas de connexion internet' : 'Radios indisponibles pour le moment, réessaie');
}

function mapStation(s) {
  // L'app est en https : un flux « http:// » serait bloqué par le navigateur.
  // La plupart des serveurs de radio acceptent aussi https, on bascule donc automatiquement.
  const raw = s.url_resolved || s.url || '';
  return {
    radioId: s.stationuuid, title: s.name.trim(), artist: [s.country, (s.tags || '').split(',').slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    url: raw.replace(/^http:\/\//i, 'https://'), thumb: safeHttps(s.favicon),
    secure: raw.startsWith('https'),
  };
}
// Les flux déjà en https passent en premier
const bySecure = (a, b) => (b.secure ? 1 : 0) - (a.secure ? 1 : 0);

export async function radioByTag(tag, limit = 40) {
  const p = new URLSearchParams({ tag, order: 'clickcount', reverse: 'true', hidebroken: 'true', limit: limit * 2 });
  const list = await rb(`/json/stations/search?${p}`);
  return dedupe(list.map(mapStation)).slice(0, limit);
}

export async function radioSearch(name, limit = 30) {
  const p = new URLSearchParams({ name, order: 'votes', reverse: 'true', hidebroken: 'true', limit: limit * 2 });
  const list = await rb(`/json/stations/search?${p}`);
  return dedupe(list.map(mapStation).sort(bySecure)).slice(0, limit);
}

export async function radioTop(country = 'FR', limit = 30) {
  const p = new URLSearchParams({ countrycode: country, order: 'votes', reverse: 'true', hidebroken: 'true', limit: limit * 2 });
  const list = await rb(`/json/stations/search?${p}`);
  return dedupe(list.map(mapStation)).slice(0, limit);
}

// Grandes radios françaises : on récupère leur flux à jour dans l'annuaire
export const FR_STATIONS = ['Skyrock', 'NRJ', 'Fun Radio', 'Mouv', 'Générations', 'Radio FG', 'RTL2', 'Virgin Radio', 'Europe 2', 'Chérie FM', 'Nostalgie', 'RFM', 'Rire et Chansons', 'Nova', 'FIP', 'France Inter', 'franceinfo', 'RTL', 'Europe 1', 'RMC', 'Contact FM', 'Hit West', 'Voltage', 'OKLM'];
export async function radioByName(name) {
  const p = new URLSearchParams({ name, countrycode: 'FR', order: 'votes', reverse: 'true', hidebroken: 'true', limit: 8 });
  let list = await rb(`/json/stations/search?${p}`);
  if (!list.length) list = await rb(`/json/stations/search?${new URLSearchParams({ name, order: 'votes', reverse: 'true', hidebroken: 'true', limit: 8 })}`);
  const n = name.toLowerCase();
  list.sort((a, b) => (a.name.toLowerCase().startsWith(n) ? 0 : 1) - (b.name.toLowerCase().startsWith(n) ? 0 : 1));
  return list.length ? mapStation(list[0]) : null;
}

// ---------------------------------------------------------------------
// Podcasts (annuaire Apple Podcasts, public et sans clé)
// ---------------------------------------------------------------------
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = '__pc' + Math.random().toString(36).slice(2);
    const sc = document.createElement('script');
    const done = () => { delete window[cb]; sc.remove(); clearTimeout(to); };
    const to = setTimeout(() => { done(); reject(new Error('Podcasts indisponibles (connexion ?)')); }, 12000);
    window[cb] = data => { done(); resolve(data); };
    sc.onerror = () => { done(); reject(new Error('Podcasts indisponibles (connexion ?)')); };
    sc.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(sc);
  });
}

export async function podcastSearch(term, limit = 25) {
  const p = new URLSearchParams({ term, media: 'podcast', entity: 'podcast', country: 'FR', limit });
  const j = await jsonp(`https://itunes.apple.com/search?${p}`);
  return (j.results || []).map(r => ({ id: r.collectionId, name: r.collectionName, author: r.artistName, art: r.artworkUrl600 || r.artworkUrl100, genre: r.primaryGenreName }));
}

export async function podcastEpisodes(id, limit = 60) {
  const p = new URLSearchParams({ id, entity: 'podcastEpisode', country: 'FR', limit });
  const j = await jsonp(`https://itunes.apple.com/lookup?${p}`);
  const res = j.results || [];
  const show = res.find(r => r.kind === 'podcast' || r.wrapperType === 'track' && !r.episodeUrl) || {};
  const eps = res.filter(r => r.episodeUrl).map(r => ({
    podcastId: r.trackId, title: r.trackName, artist: show.collectionName || r.collectionName || '',
    url: r.episodeUrl.replace(/^http:\/\//i, 'https://'), duration: Math.round((r.trackTimeMillis || 0) / 1000),
    thumb: r.artworkUrl600 || r.artworkUrl160 || show.artworkUrl600 || '', date: r.releaseDate,
  }));
  return { name: show.collectionName || 'Podcast', author: show.artistName || '', art: show.artworkUrl600 || '', episodes: eps };
}

// Module Infos : radios d'info en direct, flash info et une sélection de podcasts informatifs
export const NEWS_STATIONS = ['franceinfo', 'France Inter', 'RFI', 'Europe 1', 'RTL', 'RMC', 'BFM Business', 'France Culture'];
export const NEWS_FLASH = [
  { label: 'Le journal franceinfo', q: 'franceinfo journal' },
  { label: 'Le journal de 8h · France Inter', q: 'journal de 8h france inter' },
  { label: 'RFI Journal', q: 'RFI journal français facile' },
];
export const FEATURED_PODCASTS = [
  { name: 'LEGEND', desc: 'Les histoires incroyables de Guillaume Pley', q: 'LEGEND Guillaume Pley' },
  { name: 'Hondelatte raconte', desc: 'Faits divers et grandes histoires', q: 'Hondelatte raconte' },
  { name: 'Affaires sensibles', desc: 'Les grandes affaires d\'hier et d\'aujourd\'hui', q: 'Affaires sensibles France Inter' },
  { name: 'Transfert', desc: 'Des histoires vraies racontées par ceux qui les ont vécues', q: 'Transfert Slate' },
  { name: 'Les Pieds sur terre', desc: 'Reportages et témoignages', q: 'Les Pieds sur terre France Culture' },
  { name: 'Génération Do It Yourself', desc: 'Entrepreneurs et parcours inspirants', q: 'Génération Do It Yourself' },
  { name: 'L\'Heure du Crime', desc: 'Les plus grandes affaires criminelles', q: 'L\'heure du crime RTL' },
  { name: 'Méta de choc', desc: 'Curiosité, sciences et esprit critique', q: 'Méta de choc' },
];
// Podcasts par catégories. « q » = recherche précise d'une émission, « more » = recherche pour voir plus.
export const PODCAST_CATEGORIES = [
  { id: 'infos', name: 'Infos & actu', more: 'actualité', items: [
    { name: 'L\'Heure du Monde', desc: 'L\'actu décryptée par Le Monde', q: 'L\'Heure du Monde' },
    { name: 'Code source', desc: 'Une histoire d\'actu racontée chaque jour', q: 'Code source Le Parisien' },
  ] },
  { id: 'vraies', name: 'Histoires vraies & faits divers', more: 'faits divers', items: [
    { name: 'Hondelatte raconte', desc: 'Faits divers et grandes histoires', q: 'Hondelatte raconte' },
    { name: 'Affaires sensibles', desc: 'Les grandes affaires d\'hier et d\'aujourd\'hui', q: 'Affaires sensibles France Inter' },
    { name: 'L\'Heure du Crime', desc: 'Les plus grandes affaires criminelles', q: 'L\'heure du crime RTL' },
    { name: 'Transfert', desc: 'Des histoires vraies racontées par ceux qui les ont vécues', q: 'Transfert Slate' },
    { name: 'Les Pieds sur terre', desc: 'Reportages et témoignages', q: 'Les Pieds sur terre France Culture' },
  ] },
  { id: 'horreur', name: 'Horreur & paranormal', more: 'horreur paranormal', items: [], search: ['histoires horreur', 'paranormal', 'creepypasta'] },
  { id: 'parcours', name: 'Interviews & parcours', more: 'interview parcours', items: [
    { name: 'LEGEND', desc: 'Les histoires incroyables de Guillaume Pley', q: 'LEGEND Guillaume Pley' },
    { name: 'Génération Do It Yourself', desc: 'Entrepreneurs et parcours inspirants', q: 'Génération Do It Yourself' },
    { name: 'Le Gratin', desc: 'Les secrets de ceux qui réussissent', q: 'Le Gratin Pauline Laigneau' },
  ] },
  { id: 'savoir', name: 'Sciences & histoire', more: 'histoire sciences', items: [
    { name: 'Méta de choc', desc: 'Curiosité, sciences et esprit critique', q: 'Méta de choc' },
    { name: 'La Méthode scientifique', desc: 'La science expliquée', q: 'La Méthode scientifique France Culture' },
    { name: 'Le Cours de l\'histoire', desc: 'Les grands moments de l\'Histoire', q: 'Le Cours de l\'histoire France Culture' },
  ] },
  { id: 'humour', name: 'Humour', more: 'humour', items: [
    { name: 'Les Grosses Têtes', desc: 'L\'émission culte de RTL', q: 'Les Grosses Têtes RTL' },
    { name: 'Floodcast', desc: 'Discussions sans filtre entre potes', q: 'Floodcast' },
  ] },
];

// SponsorBlock : base collaborative des passages sponsorisés / hors sujet dans les vidéos YouTube
export async function sponsorSegments(videoId) {
  const cats = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'music_offtopic', 'preview'];
  const p = new URLSearchParams({ videoID: videoId, categories: JSON.stringify(cats) });
  try {
    const r = await fetchT(`https://sponsor.ajay.app/api/skipSegments?${p}`);
    if (!r.ok) return [];
    const j = await r.json();
    return j.filter(x => x.actionType !== 'mute' && x.actionType !== 'full').map(x => ({ start: x.segment[0], end: x.segment[1], cat: x.category }));
  } catch { return []; }
}

export async function findShow(q) {
  const r = await podcastSearch(q, 3);
  return r[0] || null;
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
