import { db } from './db.js?v=13';
import { readTags } from './tags.js?v=13';
import { Player, isIOS } from './player.js?v=13';
import { parseLyrics, activeIndex, fetchOnline } from './lyrics.js?v=13';
import * as AI from './ai.js?v=13';
import * as Voice from './voice.js?v=13';
import * as Src from './sources.js?v=13';

const BRAND = 'Maison Chahyn';

// ======================================================================
// État
// ======================================================================
const S = {
  tracks: new Map(),
  playlists: new Map(),
  covers: new Map(),       // coverId -> objectURL
  colors: loadJSON('onde.colors', {}),
  settings: Object.assign({ name: 'Chahyn', crossfade: 4, visualizer: !isIOS, libFilter: 'all', libSort: 'recent', onlineLyrics: true, apiKey: '', voiceReply: true, ytKey: '', searchSrc: 'yt', skipAds: true, eq: 'normal', volume: 1, voiceName: '', voiceRate: 1.04 }, loadJSON('onde.settings', {})),
  mixes: {},
  chat: loadJSON('onde.chat', []),
  version: 0,
  cache: {},
  lists: {},
  route: null,
  navCount: 0,
  scroll: {},
  searchQ: '',
};

function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* plein */ } }
const saveSettings = () => saveJSON('onde.settings', S.settings);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, cls = '') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function fmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtTotal(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
function plural(n, w) { return `${n} ${w}${n > 1 ? 's' : ''}`; }
function fmtSize(b) {
  if (b > 1e9) return (b / 1e9).toFixed(2).replace('.', ',') + ' Go';
  return Math.round(b / 1e6) + ' Mo';
}
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ======================================================================
// Bibliothèque : albums, artistes, etc.
// ======================================================================
const albumKey = t => t.album ? norm(t.albumArtist || t.artist || '') + '|' + norm(t.album) : null;
const artistOf = t => t.artist || 'Artiste inconnu';

function memo(name, fn) {
  const c = S.cache[name];
  if (c && c.v === S.version) return c.val;
  const val = fn();
  S.cache[name] = { v: S.version, val };
  return val;
}
const allTracks = () => memo('all', () => [...S.tracks.values()].filter(t => t.source !== 'radio' && t.source !== 'podcast' && (!t.source || t.saved)));
const savedRadios = () => memo('radios', () => [...S.tracks.values()].filter(t => t.source === 'radio' && t.saved).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)));

const albums = () => memo('albums', () => {
  const m = new Map();
  for (const t of allTracks()) {
    const k = albumKey(t);
    if (!k) continue;
    let a = m.get(k);
    if (!a) m.set(k, a = { key: k, title: t.album, artist: t.albumArtist || artistOf(t), tracks: [], coverId: null, year: '', addedAt: 0, lastPlayed: 0 });
    a.tracks.push(t);
    if (!a.coverId && t.coverId) a.coverId = t.coverId;
    if (t.year && !a.year) a.year = t.year;
    a.addedAt = Math.max(a.addedAt, t.addedAt);
    a.lastPlayed = Math.max(a.lastPlayed, t.lastPlayed || 0);
  }
  for (const a of m.values()) a.tracks.sort((x, y) => (x.track || 999) - (y.track || 999) || collator.compare(x.title, y.title));
  return m;
});

const artists = () => memo('artists', () => {
  const m = new Map();
  const add = (name, t) => {
    let a = m.get(name);
    if (!a) m.set(name, a = { name, tracks: [], coverId: null, plays: 0, addedAt: 0 });
    if (a.tracks.includes(t)) return;
    a.tracks.push(t);
    if (!a.coverId && t.coverId) a.coverId = t.coverId;
    a.plays += t.plays || 0;
    a.addedAt = Math.max(a.addedAt, t.addedAt);
  };
  for (const t of allTracks()) {
    add(artistOf(t), t);
    if (t.albumArtist && t.albumArtist !== t.artist) add(t.albumArtist, t);
  }
  return m;
});

const liked = () => memo('liked', () => allTracks().filter(t => t.liked).sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0)));

function bump() { S.version++; }

// ======================================================================
// Pochettes & couleurs
// ======================================================================
function coverURL(coverId) { return coverId ? S.covers.get(coverId) : null; }

function placeholderHue(seed) { return hash(seed || 'x') % 360; }

function cover(obj, cls = '') {
  // obj: { coverId, seed, kind }
  const url = coverURL(obj.coverId);
  if (url) return `<div class="cv ${cls}"><img src="${url}" alt="" loading="lazy" decoding="async"></div>`;
  const h = placeholderHue(obj.seed);
  const ic = obj.kind === 'artist' ? 'user' : obj.kind === 'playlist' ? 'note' : obj.kind === 'album' ? 'album' : 'note';
  return `<div class="cv ph ${cls}" style="--h:${h}">${icon(ic)}</div>`;
}
const trackCover = (t, cls) => cover({ coverId: t.coverId, seed: t.album || t.artist || t.title }, cls);

function playlistCover(p, cls = '') {
  const ids = [];
  for (const id of p.trackIds) {
    const t = S.tracks.get(id);
    if (t?.coverId && !ids.includes(t.coverId)) ids.push(t.coverId);
    if (ids.length === 4) break;
  }
  if (ids.length >= 4) return `<div class="cv mosaic ${cls}">${ids.map(c => `<img src="${coverURL(c)}" alt="" loading="lazy">`).join('')}</div>`;
  if (ids.length) return cover({ coverId: ids[0] }, cls);
  return cover({ seed: p.name, kind: 'playlist' }, cls);
}
const likedCover = (cls = '') => `<div class="cv liked-cv ${cls}">${icon('heart-f')}</div>`;

function colorFor(coverId, seed) {
  if (coverId && S.colors[coverId]) return S.colors[coverId];
  if (!coverId) return `hsl(${placeholderHue(seed)} 45% 32%)`;
  return '#3a3550';
}

async function computeColor(coverId) {
  if (!coverId || S.colors[coverId]) return S.colors[coverId];
  const url = coverURL(coverId);
  if (!url) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 20;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 20, 20);
    const d = g.getImageData(0, 0, 20, 20).data;
    let r = 0, gr = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const sat = max ? (max - min) / max : 0;
      const lum = (max + min) / 510;
      const weight = 0.15 + sat * sat * 3 * (lum > 0.08 && lum < 0.92 ? 1 : 0.2);
      r += R * weight; gr += G * weight; b += B * weight; w += weight;
    }
    r /= w; gr /= w; b /= w;
    // passage en HSL pour garder une teinte lisible sur fond sombre
    const [h, s, l] = rgbToHsl(r, gr, b);
    const col = `hsl(${Math.round(h)} ${Math.round(Math.min(70, s * 100 + 10))}% ${Math.round(Math.max(24, Math.min(40, l * 100)))}%)`;
    S.colors[coverId] = col;
    saveJSON('onde.colors', S.colors);
    return col;
  } catch { return null; }
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
async function tint(el, coverId, seed, prop = '--tint') {
  el.style.setProperty(prop, colorFor(coverId, seed));
  if (coverId && !S.colors[coverId]) {
    const c = await computeColor(coverId);
    if (c) el.style.setProperty(prop, c);
  }
}

// ======================================================================
// Lecteur
// ======================================================================
const player = new Player(id => S.tracks.get(id), async t => coverURL(t.coverId), $('#ytbox .yt-host'));
player.crossfade = S.settings.crossfade;
setTimeout(() => {
  player.setEQ(EQ_PRESETS[S.settings.eq] || EQ_PRESETS.normal);
  if (S.settings.volume < 1) player.setVolume(S.settings.volume);
  Voice.setVoicePrefs({ name: S.settings.voiceName, rate: S.settings.voiceRate });
});
player.visualizer = S.settings.visualizer;

player.addEventListener('played', async e => {
  const t = e.detail;
  t.plays = (t.plays || 0) + 1;
  t.lastPlayed = Date.now();
  bump();
  await db.put('tracks', t);
});
let listen = { id: null, max: 0 };
player.addEventListener('track', () => { setTimeout(placeYT, 30); setTimeout(placeYT, 520); np.classList.toggle('live', player.current?.source === 'radio');
  if (listen.id && listen.id !== player.currentId && listen.max > 0.02) {
    AI.logListen(listen.id, { skipped: listen.max < 0.35, ratio: Math.min(1, listen.max) });
    S.mixes.moment = null;
  }
  listen = { id: player.currentId, max: 0 };
  updateNowPlaying(); markPlaying();
  const t = player.current;
  if (t && S.lyr?.id !== t.id) loadLyrics(t);
});
player.addEventListener('time', () => {
  if (player.currentId === listen.id && player.duration) listen.max = Math.max(listen.max, player.time / player.duration);
  syncLyrics();
});
player.addEventListener('state', () => { updatePlayState(); player.updatePosition(); });
player.addEventListener('time', updateTime);
player.addEventListener('modes', updateModes);
player.addEventListener('queue', () => { if (S.queueOpen) renderQueue(); });
player.addEventListener('sleep', updateSleep);
player.addEventListener('error', () => {
  const src = player.current?.source;
  toast(src === 'radio' ? 'Cette radio ne répond pas, essaie-en une autre' : src === 'podcast' ? 'Épisode indisponible' : src === 'yt' ? 'Vidéo YouTube indisponible ici' : 'Impossible de lire ce fichier');
});

function playIds(ids, i = 0, opts = {}) {
  if (S.miniGone) { S.miniGone = false; mini.classList.remove('gone'); }
  player.playList(ids, i, opts);
  setTimeout(() => { updateNowPlaying(); placeYT(); }, 60);
}

// Une sélection YouTube devient une vraie playlist : carte dans le chat, et enregistrée si on l'a demandé
async function ytMix(name, tracks, n) {
  const key = 'chat-yt' + Date.now();
  S.mixes[key] = { key, name, desc: 'Composée par le Concierge', emoji: '✦', tracks };
  S.lastMix = S.mixes[key];
  playIds(tracks.map(t => t.id), 0, { context: { label: name, route: '#/mix/' + key } });
  if (/\b(playlist|cree|creer|fais|faire|compose|prepare|garde|enregistre)\b/.test(n)) {
    for (const t of tracks) { t.saved = true; await db.put('tracks', t); }
    await saveMixAsPlaylist(S.mixes[key]);
    return `Ta playlist « ${name} » est prête : ${plural(tracks.length, 'titre')}, enregistrée dans ta bibliothèque. Je la lance.`;
  }
  return `Je lance « ${name} » : ${plural(tracks.length, 'titre')}.`;
}

// ======================================================================
// Mini-lecteur & lecteur plein écran
// ======================================================================
const mini = $('#mini');
const np = $('#np');
const seek = $('.np-seek input');
let seeking = false;

function setMarquee(box, text) {
  const span = box.querySelector('span');
  span.textContent = text;
  box.classList.remove('run');
  box.style.removeProperty('--dist');
  requestAnimationFrame(() => {
    const over = span.scrollWidth - box.clientWidth;
    if (over > 4) {
      box.style.setProperty('--dist', `-${over + 24}px`);
      box.style.setProperty('--dur', `${Math.max(6, over / 18)}s`);
      box.classList.add('run');
    }
  });
}

// Glisser le mini-lecteur vers le bas : arrête la musique et range la barre
function dismissMini() {
  player.pause();
  S.miniGone = true;
  mini.style.transition = '';
  mini.classList.add('gone');
  document.body.classList.remove('has-mini');
  ytbox.classList.remove('on');
  setTimeout(() => { if (S.miniGone) mini.hidden = true; }, 350);
}
player.addEventListener('state', () => {
  if (S.miniGone && player.playing) { S.miniGone = false; mini.classList.remove('gone'); updateNowPlaying(); placeYT(); }
});

function updateNowPlaying() {
  const t = player.current;
  mini.hidden = !t || !!S.miniGone;
  document.body.classList.toggle('has-mini', !!t && !S.miniGone);
  if (!t) { if (S.npOpen) closeNP(); return; }
  const seed = t.album || t.artist || t.title;
  // mini
  const mc = $('.mini-cover', mini);
  mc.innerHTML = trackCover(t);
  mini.classList.remove('swap'); void mini.offsetWidth; mini.classList.add('swap');
  setMarquee($('.mini-title', mini), t.title);
  $('.mini-artist', mini).textContent = artistOf(t);
  tint(mini, t.coverId, seed);
  // plein écran
  const nc = $('.np-cover', np);
  nc.innerHTML = trackCover(t);
  const track = $('.np-cover-track', np);
  if (S.swipeDir) {
    track.classList.remove('in-left', 'in-right'); void track.offsetWidth;
    track.classList.add(S.swipeDir > 0 ? 'in-right' : 'in-left');
    S.swipeDir = 0;
  }
  setMarquee($('.np-title', np), t.title);
  $('.np-artist', np).textContent = artistOf(t);
  $('.np-ctx b', np).textContent = player.context?.label || t.album || 'Ta bibliothèque';
  tint(np, t.coverId, seed);
  const bgi = $('.np-bg-img', np);
  const cu = coverURL(t.coverId);
  bgi.style.backgroundImage = cu ? `url("${cu}")` : 'none';
  bgi.classList.remove('fade'); void bgi.offsetWidth; bgi.classList.add('fade');
  $('.lyr-head', np).innerHTML = `${trackCover(t, 'xs2')}<div><b>${esc(t.title)}</b><small>${esc(artistOf(t))}</small></div>`;
  updateLike();
  updateTime();
  updatePlayState();
}

function updateLike() {
  const t = player.current;
  const on = !!t?.liked;
  for (const b of [$('.mini-like'), $('.np-like')]) {
    b.classList.toggle('on', on);
    b.querySelector('use').setAttribute('href', on ? '#i-heart-f' : '#i-heart');
  }
}

function updatePlayState() {
  const p = player.playing;
  document.body.classList.toggle('is-playing', p);
  for (const b of [$('.mini-play'), ...$$('.np-play')]) b.querySelector('use').setAttribute('href', p ? '#i-pause' : '#i-play');
  np.classList.toggle('paused', !p);
  $$('.hero-play').forEach(b => {
    const mine = b.dataset.list && S.lists[b.dataset.list]?.ids.includes(player.currentId) && S.lists[b.dataset.list]?.label === player.context?.label;
    b.querySelector('use').setAttribute('href', mine && p ? '#i-pause' : '#i-play');
  });
  if (p && S.npOpen) startViz();
}

function updateTime() {
  const d = player.duration, c = player.time;
  $('.mini-bar i').style.transform = `scaleX(${d ? c / d : 0})`;
  if (!S.npOpen) return;
  if (!seeking) {
    seek.value = d ? Math.round(c / d * 1000) : 0;
    $('.t-cur').textContent = fmt(c);
  }
  seek.style.setProperty('--p', `${seek.value / 10}%`);
  $('.t-dur').textContent = fmt(d);
}

function updateModes() {
  $('.np-shuffle').classList.toggle('on', player.shuffle);
  const r = $('.np-repeat');
  r.classList.toggle('on', player.repeat !== 'off');
  r.classList.toggle('one', player.repeat === 'one');
}

function updateSleep() {
  const b = $('.np-sleep');
  const on = player.sleepAt || player.sleepEndOfTrack;
  b.classList.toggle('on', !!on);
  clearInterval(S.sleepTick);
  const paint = () => {
    if (player.sleepEndOfTrack) b.querySelector('em').textContent = 'fin';
    else if (player.sleepAt) b.querySelector('em').textContent = Math.max(0, Math.ceil((player.sleepAt - Date.now()) / 60000)) + ' min';
    else b.querySelector('em').textContent = '';
  };
  paint();
  if (player.sleepAt) S.sleepTick = setInterval(paint, 15000);
}

function markPlaying() {
  const id = player.currentId;
  $$('[data-tid]').forEach(r => r.classList.toggle('playing', r.dataset.tid === id));
}

// --- ouverture/fermeture avec gestion du bouton retour Android ---
const overlays = [];
let ignorePop = 0;
function pushOverlay(name, close) {
  overlays.push({ name, close });
  history.pushState({ overlay: name }, '');
}
function popOverlay() {
  return new Promise(res => {
    const o = overlays.pop();
    if (!o) return res();
    o.close();
    ignorePop++;
    const done = () => { window.removeEventListener('popstate', done); res(); };
    window.addEventListener('popstate', done);
    history.back();
  });
}
async function closeAllOverlays() { while (overlays.length) await popOverlay(); }
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop--; return; }
  const o = overlays.pop();
  if (o) o.close();
});

function openNP() {
  if (!player.current || S.npOpen) return;
  S.npOpen = true;
  np.classList.add('open');
  np.setAttribute('aria-hidden', 'false');
  updateTime();
  updateModes();
  updateSleep();
  pushOverlay('np', () => { S.npOpen = false; np.classList.remove('open'); np.style.transform = ''; np.setAttribute('aria-hidden', 'true'); stopViz(); placeYT(); });
  setTimeout(placeYT, 520);
  if (player.playing) startViz();
}
const closeNP = () => { if (S.npOpen) popOverlay(); };

// Gestes : mini-lecteur
gesture(mini, {
  tap: e => {
    if (e.target.closest('.mini-play')) return player.toggle();
    if (e.target.closest('.mini-like')) return toggleLike(player.current);
    openNP();
  },
  end: (dx, dy) => {
    mini.style.transform = ''; mini.style.opacity = '';
    if (dy > 45 && Math.abs(dy) > Math.abs(dx)) return dismissMini();
    if (dy < -40 && Math.abs(dy) > Math.abs(dx)) return openNP();
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? player.next() : player.prev(); }
  },
  move: (dx, dy) => {
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) { mini.style.transition = 'none'; mini.style.transform = `translateY(${dy}px)`; mini.style.opacity = Math.max(0.2, 1 - dy / 120); $('.mini-in', mini).style.transform = ''; return; }
    $('.mini-in', mini).style.transform = Math.abs(dx) > Math.abs(dy) ? `translateX(${dx * 0.4}px)` : '';
  },
  reset: () => { $('.mini-in', mini).style.transform = ''; mini.style.transform = ''; mini.style.opacity = ''; mini.style.transition = ''; },
});

// Gestes : lecteur plein écran (glisser vers le bas pour fermer, gauche/droite sur la pochette)
gesture($('.np-head', np), {
  move: (dx, dy) => { if (dy > 0) { np.style.transition = 'none'; np.style.transform = `translateY(${dy}px)`; } },
  end: (dx, dy) => { np.style.transition = ''; np.style.transform = ''; if (dy > 110) closeNP(); },
  reset: () => { np.style.transition = ''; np.style.transform = ''; },
});
gesture($('.np-art', np), {
  move: (dx, dy) => {
    const tr = $('.np-cover-track');
    if (Math.abs(dx) > Math.abs(dy)) { tr.style.transition = 'none'; tr.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`; np.style.transform = ''; ytbox.classList.add('moving'); }
    else if (dy > 0) ytbox.classList.add('moving');
    else if (dy > 0) { np.style.transition = 'none'; np.style.transform = `translateY(${dy}px)`; }
  },
  end: (dx, dy) => {
    const tr = $('.np-cover-track');
    tr.style.transition = ''; tr.style.transform = '';
    np.style.transition = ''; np.style.transform = '';
    setTimeout(placeYT, 480);
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
      S.swipeDir = dx < 0 ? 1 : -1;
      dx < 0 ? player.next() : player.prev();
    } else if (dy > 120) closeNP();
  },
  reset: () => { const tr = $('.np-cover-track'); tr.style.transition = ''; tr.style.transform = ''; np.style.transform = ''; np.style.transition = ''; setTimeout(placeYT, 300); },
});

function gesture(el, { tap, move, end, reset }) {
  let sx, sy, dx, dy, active = false, moved = false;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('input')) return;
    active = true; moved = false; sx = e.clientX; sy = e.clientY; dx = dy = 0;
  });
  window.addEventListener('pointermove', e => {
    if (!active) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) > 8) moved = true;
    if (moved && move) move(dx, dy);
  }, { passive: true });
  const up = e => {
    if (!active) return;
    active = false;
    if (!moved) { reset?.(); tap?.(e); return; }
    end?.(dx, dy);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', () => { if (active) { active = false; reset?.(); } });
}

np.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'np-close') return closeNP();
  if (b.dataset.act === 'np-more') return trackSheet(player.current, { fromNP: true });
  if (b.classList.contains('np-play')) return player.toggle();
  if (b.classList.contains('np-next')) { S.swipeDir = 1; return player.next(); }
  if (b.classList.contains('np-prev')) { S.swipeDir = -1; return player.prev(); }
  if (b.classList.contains('np-shuffle')) { player.toggleShuffle(); return toast(player.shuffle ? 'Lecture aléatoire activée' : 'Lecture aléatoire désactivée'); }
  if (b.classList.contains('np-repeat')) { player.cycleRepeat(); return toast({ off: 'Répétition désactivée', all: 'Répéter la file', one: 'Répéter ce titre' }[player.repeat]); }
  if (b.classList.contains('np-like')) return toggleLike(player.current);
  if (b.classList.contains('np-queue')) return queueSheet();
  if (b.classList.contains('np-sleep')) return sleepSheet();
  if (b.classList.contains('np-fwd')) return podSkip(30);
  if (b.classList.contains('np-back')) return podSkip(-15);
  if (b.classList.contains('np-voice')) return startVoice();
  if (b.classList.contains('np-artist')) { const n = artistOf(player.current); S.pendingFwd = true; return closeAllOverlays().then(() => goto('#/artist/' + encodeURIComponent(n))); }
});
seek.addEventListener('input', () => {
  seeking = true;
  seek.style.setProperty('--p', `${seek.value / 10}%`);
  $('.t-cur').textContent = fmt(seek.value / 1000 * player.duration);
});
seek.addEventListener('change', () => { player.seek(seek.value / 1000 * player.duration); seeking = false; });

// --- Visualiseur ---
let vizRaf = 0;
function startViz() {
  if (vizRaf || !S.settings.visualizer || !player.analyser) return;
  const cv = $('.np-viz');
  const g = cv.getContext('2d');
  const data = new Uint8Array(player.analyser.frequencyBinCount);
  const coverEl = $('.np-cover');
  let smooth = 0;
  const draw = () => {
    vizRaf = requestAnimationFrame(draw);
    const dpr = devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    player.analyser.getByteFrequencyData(data);
    const bass = (data[1] + data[2] + data[3] + data[4]) / 1020;
    smooth = smooth * 0.75 + bass * 0.25;
    coverEl.style.setProperty('--beat', (1 + smooth * 0.045).toFixed(4));
    // anneau de barres autour de la pochette
    const n = 64, cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) * 0.36;
    g.lineCap = 'round';
    g.lineWidth = Math.max(2, r * 0.025);
    for (let i = 0; i < n; i++) {
      const v = data[Math.floor(i * 0.9) + 2] / 255;
      const len = 6 + v * v * r * 0.3;
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      g.strokeStyle = `rgba(236,210,157,${0.15 + v * 0.6})`;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6));
      g.lineTo(cx + Math.cos(a) * (r + 6 + len), cy + Math.sin(a) * (r + 6 + len));
      g.stroke();
    }
    if (!player.playing) stopViz();
  };
  draw();
}
function stopViz() {
  cancelAnimationFrame(vizRaf); vizRaf = 0;
  const cv = $('.np-viz');
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  $('.np-cover').style.setProperty('--beat', 1);
}

// ======================================================================
// Feuilles d'actions (bottom sheets) & toasts
// ======================================================================
const sheet = $('#sheet');
let sheetHandlers = {};
function openSheet(html, handlers = {}, { onOpen } = {}) {
  const body = $('.sheet-body', sheet);
  const wasOpen = !sheet.hidden;
  body.innerHTML = html;
  sheetHandlers = handlers;
  if (!wasOpen) {
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    pushOverlay('sheet', () => {
      sheet.classList.remove('open');
      S.queueOpen = false;
      setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 320);
    });
  }
  onOpen?.(body);
}
const closeSheet = () => (!sheet.hidden && overlays.at(-1)?.name === 'sheet') ? popOverlay() : Promise.resolve();
$('.sheet-scrim').addEventListener('click', closeSheet);
gesture($('.sheet-grip'), {
  move: (dx, dy) => { if (dy > 0) $('.sheet-panel').style.transform = `translateY(${dy}px)`; },
  end: (dx, dy) => { $('.sheet-panel').style.transform = ''; if (dy > 80) closeSheet(); },
  reset: () => { $('.sheet-panel').style.transform = ''; },
});
sheet.addEventListener('click', e => {
  const b = e.target.closest('[data-sa]');
  if (!b) return;
  const fn = sheetHandlers[b.dataset.sa];
  if (fn) fn(b, e);
});

function sheetItems(items) {
  return items.filter(Boolean).map(it =>
    `<button class="sheet-item ${it.danger ? 'danger' : ''}" data-sa="${it.id}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
}

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ======================================================================
// Actions sur les morceaux / playlists
// ======================================================================
async function toggleLike(t) {
  if (!t) return;
  t.liked = !t.liked;
  if (t.liked && t.source) t.saved = true;
  t.likedAt = t.liked ? Date.now() : 0;
  bump();
  await db.put('tracks', t);
  if (t.id === player.currentId) {
    updateLike();
    const b = $('.np-like');
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  }
  $$(`[data-tid="${t.id}"] .like-mark`).forEach(el => el.classList.toggle('on', t.liked));
  toast(t.liked ? 'Ajouté à Titres likés' : 'Retiré de Titres likés');
  if (S.route?.name === 'liked') render(true);
}

function trackSheet(t, { listKey, fromNP } = {}) {
  if (!t) return;
  const ctx = listKey && S.lists[listKey];
  const inPlaylist = ctx?.playlistId;
  const head = `<div class="sheet-head">${trackCover(t, 'sm')}<div><b>${esc(t.title)}</b><small>${esc(artistOf(t))}${t.album ? ' · ' + esc(t.album) : ''}</small></div></div>`;
  openSheet(head + sheetItems([
    fromNP && { id: 'sound', icon: 'gear', label: 'Son, volume et égaliseur' },
    { id: 'like', icon: t.liked ? 'heart-f' : 'heart', label: t.liked ? 'Retirer des Titres likés' : 'Ajouter aux Titres likés' },
    !fromNP && { id: 'next', icon: 'next-up', label: 'Lire ensuite' },
    !fromNP && { id: 'queue', icon: 'queue', label: 'Ajouter à la file d\'attente' },
    { id: 'pl', icon: 'list-add', label: 'Ajouter à une playlist' },
    inPlaylist && { id: 'unpl', icon: 'close', label: 'Retirer de cette playlist' },
    t.album && { id: 'album', icon: 'album', label: 'Voir l\'album' },
    (!t.source || t.saved) && !['radio', 'podcast'].includes(t.source) && { id: 'artist', icon: 'user', label: 'Voir l\'artiste' },
    !['radio', 'podcast'].includes(t.source) && { id: 'lyrics', icon: 'mic', label: t.lyrics ? 'Voir / modifier les paroles' : 'Ajouter les paroles' },
    t.source === 'podcast' && podPrefs[showKey(t)] && { id: 'podreset', icon: 'refresh', label: 'Ne plus sauter automatiquement le début / la fin' },
    t.source && !t.saved && { id: 'save', icon: 'plus', label: t.source === 'radio' ? 'Ajouter à mes radios' : t.source === 'podcast' ? 'Garder cet épisode' : 'Ajouter à ma bibliothèque' },
    { id: 'edit', icon: 'edit', label: 'Modifier les infos' },
    t.source && t.saved && { id: 'unsave', icon: 'close', label: t.source === 'radio' ? 'Retirer de mes radios' : 'Retirer de ma bibliothèque', danger: true },
    !t.source && { id: 'del', icon: 'trash', label: 'Supprimer du téléphone', danger: true },
  ]), {
    like: () => { toggleLike(t); closeSheet(); },
    sound: () => soundSheet(),
    next: () => { player.addNext(t.id); toast('Sera lu ensuite'); closeSheet(); },
    queue: () => { player.addToQueue(t.id); toast('Ajouté à la file d\'attente'); closeSheet(); },
    pl: () => playlistPicker([t.id]),
    unpl: async () => {
      const p = S.playlists.get(inPlaylist);
      const i = p.trackIds.indexOf(t.id);
      if (i >= 0) p.trackIds.splice(i, 1);
      await db.put('playlists', p); bump();
      await closeSheet(); render(true); toast('Retiré de la playlist');
    },
    album: async () => { await closeAllOverlays(); goto('#/album/' + encodeURIComponent(albumKey(t))); },
    artist: async () => { await closeAllOverlays(); goto('#/artist/' + encodeURIComponent(artistOf(t))); },
    edit: () => editSheet(t),
    lyrics: () => lyricsSheet(t),
    podreset: () => { delete podPrefs[showKey(t)]; savePodPrefs(); closeSheet(); toast('Réglages anti-pub effacés pour cette émission'); },
    save: async () => { t.saved = true; await db.put('tracks', t); bump(); await closeSheet(); toast('Ajouté'); render(true); },
    unsave: async () => { t.saved = false; t.liked = false; await db.put('tracks', t); bump(); await closeSheet(); toast('Retiré'); render(true); },
    del: () => confirmSheet(`Supprimer « ${t.title} » ?`, 'Le fichier sera effacé de l\'application.', 'Supprimer', async () => {
      await deleteTracks([t.id]);
      toast('Titre supprimé');
    }),
  });
}

function editSheet(t) {
  openSheet(`<h3 class="sheet-title">Modifier les infos</h3>
    <form class="form" data-form="edit">
      <label>Titre<input name="title" value="${esc(t.title)}" required></label>
      <label>Artiste<input name="artist" value="${esc(t.artist || '')}"></label>
      <label>Album<input name="album" value="${esc(t.album || '')}"></label>
      <button class="btn primary" type="submit">Enregistrer</button>
    </form>`, {}, {
    onOpen: body => $('form', body).addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      t.title = f.get('title').trim() || t.title;
      t.artist = f.get('artist').trim();
      t.album = f.get('album').trim();
      await db.put('tracks', t); bump();
      await closeSheet();
      if (t.id === player.currentId) updateNowPlaying();
      render(true);
      toast('Infos mises à jour');
    }),
  });
}

function confirmSheet(title, text, label, fn) {
  openSheet(`<h3 class="sheet-title">${esc(title)}</h3><p class="sheet-text">${esc(text)}</p>
    <div class="sheet-row"><button class="btn ghost" data-sa="no">Annuler</button><button class="btn danger" data-sa="yes">${esc(label)}</button></div>`, {
    no: closeSheet,
    yes: async () => { await closeSheet(); await fn(); },
  });
}

function playlistPicker(ids) {
  const pls = [...S.playlists.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  openSheet(`<h3 class="sheet-title">Ajouter à une playlist</h3>
    <button class="sheet-item" data-sa="new">${icon('plus')}<span>Nouvelle playlist</span></button>
    ${pls.map(p => `<button class="sheet-item pl" data-sa="add" data-id="${p.id}">${playlistCover(p, 'xs')}<span>${esc(p.name)}<small>${plural(p.trackIds.length, 'titre')}</small></span></button>`).join('')}`, {
    new: () => newPlaylistSheet(ids),
    add: async b => {
      const p = S.playlists.get(b.dataset.id);
      const add = ids.filter(id => !p.trackIds.includes(id));
      p.trackIds.push(...add);
      for (const id of add) { const x = S.tracks.get(id); if (x?.source && !x.saved) { x.saved = true; await db.put('tracks', x); } }
      p.updatedAt = Date.now();
      await db.put('playlists', p); bump();
      await closeSheet();
      toast(add.length ? `Ajouté à ${p.name}` : 'Déjà dans la playlist');
      if (S.route?.name === 'playlist' || S.route?.name === 'library' || S.route?.name === 'home') render(true);
    },
  });
}

function newPlaylistSheet(ids = [], rename) {
  openSheet(`<h3 class="sheet-title">${rename ? 'Renommer la playlist' : 'Donne un nom à ta playlist'}</h3>
    <form class="form" data-form="pl">
      <input name="name" class="big-input" value="${esc(rename?.name || '')}" placeholder="Ma playlist n° ${S.playlists.size + 1}" maxlength="80">
      <button class="btn primary" type="submit">${rename ? 'Renommer' : 'Créer'}</button>
    </form>`, {}, {
    onOpen: body => {
      const inp = $('input', body);
      setTimeout(() => inp.focus(), 250);
      $('form', body).addEventListener('submit', async e => {
        e.preventDefault();
        const name = inp.value.trim() || inp.placeholder;
        if (rename) {
          rename.name = name; rename.updatedAt = Date.now();
          await db.put('playlists', rename); bump();
          await closeSheet(); render(true);
          return;
        }
        const p = { id: uid(), name, trackIds: [...ids], createdAt: Date.now(), updatedAt: Date.now() };
        S.lastPlaylistId = p.id;
        S.playlists.set(p.id, p);
        await db.put('playlists', p); bump();
        await closeSheet();
        toast(`Playlist « ${name} » créée`);
        goto('#/playlist/' + p.id);
      });
    },
  });
}

function addTracksSheet(p) {
  const draw = q => {
    const nq = norm(q);
    const list = allTracks().filter(t => !nq || norm(`${t.title} ${t.artist} ${t.album}`).includes(nq))
      .sort((a, b) => collator.compare(a.title, b.title)).slice(0, 300);
    return list.map(t => {
      const inPl = p.trackIds.includes(t.id);
      return `<div class="row compact">${trackCover(t)}<div class="row-meta"><b>${esc(t.title)}</b><small>${esc(artistOf(t))}</small></div>
        <button class="ib add-btn ${inPl ? 'on' : ''}" data-sa="toggle" data-id="${t.id}">${icon(inPl ? 'heart-f' : 'plus')}</button></div>`;
    }).join('') || '<p class="sheet-text">Aucun résultat</p>';
  };
  openSheet(`<h3 class="sheet-title">Ajouter à « ${esc(p.name)} »</h3>
    <div class="search-box sm">${icon('search')}<input type="search" placeholder="Chercher un titre"></div>
    <div class="add-list">${draw('')}</div>`, {
    toggle: async b => {
      const id = b.dataset.id;
      const i = p.trackIds.indexOf(id);
      if (i >= 0) p.trackIds.splice(i, 1); else p.trackIds.push(id);
      p.updatedAt = Date.now();
      await db.put('playlists', p); bump();
      const on = i < 0;
      b.classList.toggle('on', on);
      b.innerHTML = icon(on ? 'heart-f' : 'plus');
      S.needRender = true;
    },
  }, {
    onOpen: body => $('input', body).addEventListener('input', e => { $('.add-list', body).innerHTML = draw(e.target.value); }),
  });
}

function queueSheet() {
  S.queueOpen = true;
  openSheet('<div class="queue"></div>', {
    jump: b => player.jump(+b.dataset.i),
    rm: (b, e) => { e.stopPropagation(); player.removeAt(+b.dataset.i); },
    clear: () => { player.queue.splice(player.index + 1); player.emit('queue'); },
  });
  renderQueue();
}
function renderQueue() {
  const box = $('.sheet .queue');
  if (!box) return;
  const cur = player.current;
  const up = player.queue.slice(player.index + 1);
  const row = (t, i) => `<div class="row compact" data-sa="jump" data-i="${i}" data-tid="${t.id}">${trackCover(t)}<div class="row-meta"><b>${esc(t.title)}</b><small>${esc(artistOf(t))}</small></div>
    <button class="ib sm" data-sa="rm" data-i="${i}" aria-label="Retirer">${icon('close')}</button></div>`;
  box.innerHTML = `<h3 class="sheet-title">File d'attente</h3>
    ${cur ? `<h4 class="sub">En cours de lecture</h4><div class="row compact playing">${trackCover(cur)}<div class="row-meta"><b>${esc(cur.title)}</b><small>${esc(artistOf(cur))}</small></div><span class="eq"><i></i><i></i><i></i></span></div>` : ''}
    <div class="sub-row"><h4 class="sub">À suivre ${player.context?.label ? '· ' + esc(player.context.label) : ''}</h4>${up.length ? '<button class="link" data-sa="clear">Vider</button>' : ''}</div>
    ${up.length ? up.slice(0, 200).map((id, k) => { const t = S.tracks.get(id); return t ? row(t, player.index + 1 + k) : ''; }).join('') : '<p class="sheet-text">Rien à suivre.' + (player.repeat === 'all' ? ' La file recommencera au début.' : '') + '</p>'}`;
}

function sleepSheet() {
  const on = player.sleepAt || player.sleepEndOfTrack;
  openSheet(`<h3 class="sheet-title">Minuteur de sommeil</h3>
    ${[5, 15, 30, 45, 60, 90].map(m => `<button class="sheet-item" data-sa="set" data-m="${m}">${icon('timer')}<span>${m} minutes</span></button>`).join('')}
    <button class="sheet-item" data-sa="set" data-m="end">${icon('timer')}<span>Fin du titre</span></button>
    ${on ? `<button class="sheet-item danger" data-sa="set" data-m="0">${icon('close')}<span>Désactiver le minuteur</span></button>` : ''}`, {
    set: b => {
      const m = b.dataset.m === 'end' ? 'end' : +b.dataset.m;
      player.setSleep(m);
      closeSheet();
      toast(m === 0 ? 'Minuteur désactivé' : m === 'end' ? 'Arrêt à la fin du titre' : `Arrêt dans ${m} minutes`);
    },
  });
}

function playlistSheet(p) {
  openSheet(`<div class="sheet-head">${playlistCover(p, 'sm')}<div><b>${esc(p.name)}</b><small>${plural(p.trackIds.length, 'titre')}</small></div></div>` + sheetItems([
    { id: 'add', icon: 'plus', label: 'Ajouter des titres' },
    { id: 'queue', icon: 'queue', label: 'Ajouter à la file d\'attente' },
    { id: 'ren', icon: 'edit', label: 'Renommer' },
    { id: 'del', icon: 'trash', label: 'Supprimer la playlist', danger: true },
  ]), {
    add: () => addTracksSheet(p),
    queue: () => { p.trackIds.forEach(id => player.addToQueue(id)); closeSheet(); toast('Ajouté à la file d\'attente'); },
    ren: () => newPlaylistSheet([], p),
    del: () => confirmSheet(`Supprimer « ${p.name} » ?`, 'Les titres resteront dans ta bibliothèque.', 'Supprimer', async () => {
      S.playlists.delete(p.id);
      await db.del('playlists', p.id); bump();
      toast('Playlist supprimée');
      goto('#/library', true);
    }),
  });
}

async function deleteTracks(ids) {
  const set = new Set(ids);
  const coverIds = new Set();
  for (const id of ids) {
    const t = S.tracks.get(id);
    if (t?.coverId) coverIds.add(t.coverId);
    S.tracks.delete(id);
    await db.del('tracks', id);
    await db.del('audio', id);
  }
  for (const p of S.playlists.values()) {
    const before = p.trackIds.length;
    p.trackIds = p.trackIds.filter(id => !set.has(id));
    if (p.trackIds.length !== before) await db.put('playlists', p);
  }
  const used = new Set(allTracksRaw().map(t => t.coverId));
  for (const c of coverIds) if (!used.has(c)) {
    await db.del('covers', c);
    URL.revokeObjectURL(S.covers.get(c));
    S.covers.delete(c);
  }
  bump();
  player.purge(ids);
  if (!player.current) updateNowPlaying();
  render(true);
}
const allTracksRaw = () => [...S.tracks.values()];

// ======================================================================
// Import des fichiers
// ======================================================================
const AUDIO_EXT = /\.(mp3|m4a|aac|mp4|flac|ogg|oga|opus|wav|weba|webm|alac|aiff?)$/i;

function audioDuration(file) {
  return new Promise(res => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = d => { clearTimeout(to); URL.revokeObjectURL(url); a.removeAttribute('src'); res(isFinite(d) ? d : 0); };
    const to = setTimeout(() => done(0), 8000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(-1);
    a.src = url;
  });
}

async function importFiles(fileList) {
  const lrcs = [...fileList].filter(f => /\.(lrc|txt)$/i.test(f.name));
  const files = [...fileList].filter(f => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
  if (!files.length && lrcs.length) { const n = await attachLyricsFiles(lrcs); toast(n ? `Paroles ajoutées à ${plural(n, 'titre')}` : 'Aucun titre correspondant à ces paroles'); return; }
  if (!files.length) { toast('Aucun fichier audio trouvé'); return; }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const known = new Set(allTracksRaw().map(t => t.name + '|' + t.size));
  const prog = showProgress(files.length);
  let added = 0, skipped = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    prog.update(i, f.name);
    if (known.has(f.name + '|' + f.size)) { skipped++; continue; }
    try {
      const tags = await readTags(f);
      const duration = await audioDuration(f);
      if (duration < 0) { failed++; continue; }
      const id = uid();
      let coverId = null, coverBlob = null;
      if (tags.picture && tags.picture.size > 100) {
        coverId = 'c' + hash(tags.album ? norm((tags.albumArtist || tags.artist || '') + '|' + tags.album) : id).toString(36);
        if (!S.covers.has(coverId)) {
          coverBlob = tags.picture;
          S.covers.set(coverId, URL.createObjectURL(coverBlob));
        }
      }
      const t = {
        lyrics: tags.lyrics || '',
        id, name: f.name, size: f.size, type: f.type || '',
        title: tags.title, artist: tags.artist || '', albumArtist: tags.albumArtist || '',
        album: tags.album || '', track: tags.track || 0, year: tags.year || '', genre: tags.genre || '',
        duration, coverId, addedAt: Date.now() + i, plays: 0, lastPlayed: 0, liked: false,
      };
      const blob = new Blob([f], { type: f.type || 'audio/mpeg' });
      await db.addTrack(t, blob, coverBlob);
      S.tracks.set(id, t);
      known.add(f.name + '|' + f.size);
      added++;
      if (added % 10 === 0) { bump(); render(true); }
    } catch (e) {
      console.error(e);
      failed++;
      if (e?.name === 'QuotaExceededError') { toast('Plus d\'espace disponible'); break; }
    }
  }
  prog.done();
  if (lrcs.length) await attachLyricsFiles(lrcs);
  queueAnalysis();
  S.mixes = {};
  bump();
  render(true);
  const parts = [`${plural(added, 'titre')} ajouté${added > 1 ? 's' : ''}`];
  if (skipped) parts.push(`${skipped} déjà présent${skipped > 1 ? 's' : ''}`);
  if (failed) parts.push(`${failed} illisible${failed > 1 ? 's' : ''}`);
  toast(parts.join(' · '));
}

function showProgress(total) {
  const el = document.createElement('div');
  el.className = 'import-prog';
  el.innerHTML = `<div class="ip-card"><div class="ip-spin"><span class="eq big"><i></i><i></i><i></i><i></i></span></div><b>Import de ta musique…</b><small></small><div class="ip-bar"><i></i></div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return {
    update(i, name) {
      $('small', el).textContent = `${i + 1} / ${total} · ${name}`;
      $('.ip-bar i', el).style.transform = `scaleX(${(i + 1) / total})`;
    },
    done() { el.classList.remove('show'); setTimeout(() => el.remove(), 400); },
  };
}

$('#pick-files').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
$('#pick-folder').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
function importSheet() {
  openSheet(`<h3 class="sheet-title">Importer de la musique</h3>
    <p class="sheet-text">Choisis des fichiers audio sur ton téléphone (MP3, M4A, FLAC, OGG, WAV…). Ils sont copiés dans l'application et restent disponibles hors connexion.</p>
    ${sheetItems([
      { id: 'files', icon: 'note', label: 'Choisir des fichiers' },
      'webkitdirectory' in document.createElement('input') && !isIOS && { id: 'folder', icon: 'folder', label: 'Choisir un dossier entier' },
    ])}`, {
    files: () => { closeSheet(); $('#pick-files').click(); },
    folder: () => { closeSheet(); $('#pick-folder').click(); },
  });
}

// Glisser-déposer (sur ordinateur)
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });

// ======================================================================
// Paroles synchronisées
// ======================================================================
async function loadLyrics(t) {
  S.lyr = { id: t.id, parsed: parseLyrics(t.lyrics), idx: -2 };
  if (t.source === 'radio' || t.source === 'podcast') { S.lyr = { id: t.id, parsed: null }; renderLyrics(); return; }
  const stale = !t.lyricsChecked || Date.now() - t.lyricsChecked > 7 * 864e5;
  if (!S.lyr.parsed && S.settings.onlineLyrics && stale && navigator.onLine !== false) {
    S.lyr.loading = true;
    renderLyrics();
    const txt = await fetchOnline(t);
    t.lyricsChecked = Date.now();
    if (txt) { t.lyrics = txt; t.lyricsSource = 'LRCLIB'; }
    await db.put('tracks', t);
    if (player.currentId !== t.id) return;
    S.lyr = { id: t.id, parsed: parseLyrics(t.lyrics), idx: -2 };
  }
  renderLyrics();
}

function renderLyrics() {
  const L = S.lyr;
  const box = $('.lyr-lines', np);
  const btn = $('.np-lyr-btn', np);
  const has = !!L?.parsed;
  btn.classList.toggle('has', has);
  np.classList.toggle('has-lyrics', has);
  $('.np-line', np).textContent = '';
  if (!L) return;
  if (L.loading) { box.innerHTML = '<div class="lyr-msg"><span class="dots"><i></i><i></i><i></i></span>Recherche des paroles…</div>'; return; }
  if (!has) {
    box.innerHTML = `<div class="lyr-msg">Pas de paroles pour ce titre.<br><button class="btn ghost sm" data-lyr="edit">Ajouter les paroles</button></div>`;
    return;
  }
  box.classList.toggle('plain', !L.parsed.synced);
  box.innerHTML = L.parsed.lines.map((l, i) => l.text
    ? `<p data-i="${i}" ${l.t != null ? `data-t="${l.t}"` : ''}>${esc(l.text)}</p>`
    : `<p class="gap" data-i="${i}" ${l.t != null ? `data-t="${l.t}"` : ''}><span class="dots"><i></i><i></i><i></i></span></p>`).join('')
    + `<div class="lyr-src">${L.parsed.synced ? 'Paroles synchronisées' : 'Paroles'}${player.current?.lyricsSource ? ' · ' + esc(player.current.lyricsSource) : ''}</div>`;
  L.idx = -2;
  syncLyrics(true);
}

function syncLyrics(force) {
  const L = S.lyr;
  if (!L?.parsed?.synced || L.id !== player.currentId) return;
  const i = activeIndex(L.parsed, player.time);
  if (i === L.idx && !force) return;
  L.idx = i;
  const line = L.parsed.lines[i]?.text || '';
  const nl = $('.np-line', np);
  if (nl.textContent !== line) { nl.classList.remove('in'); void nl.offsetWidth; nl.textContent = line; nl.classList.add('in'); }
  if (!S.lyrOpen) return;
  const ps = $$('.lyr-lines p', np);
  ps.forEach((p, k) => { p.classList.toggle('on', k === i); p.classList.toggle('past', k < i); });
  const cur = ps[i];
  const sc = $('.lyr-scroll', np);
  if (cur && !S.lyrTouch) sc.scrollTo({ top: cur.offsetTop - sc.clientHeight * 0.36, behavior: force ? 'auto' : 'smooth' });
}

function openLyrics() {
  if (S.lyrOpen) return;
  S.lyrOpen = true;
  np.classList.add('lyr-open');
  pushOverlay('lyr', () => { S.lyrOpen = false; np.classList.remove('lyr-open'); setTimeout(placeYT, 500); });
  placeYT();
  if (S.lyr) { S.lyr.idx = -2; syncLyrics(true); }
}
np.addEventListener('click', e => {
  const p = e.target.closest('.lyr-lines p[data-t]');
  if (p) { player.seek(+p.dataset.t); if (!player.playing) player.play(); return; }
  if (e.target.closest('[data-lyr="edit"]')) return lyricsSheet(player.current);
  if (e.target.closest('[data-lyr="close"]')) return popOverlay();
  if (e.target.closest('.np-lyr-btn, .np-line')) return openLyrics();
}, true);
{
  const sc = $('.lyr-scroll', np);
  let tt;
  sc.addEventListener('touchstart', () => { S.lyrTouch = true; clearTimeout(tt); }, { passive: true });
  sc.addEventListener('touchend', () => { tt = setTimeout(() => { S.lyrTouch = false; }, 2500); }, { passive: true });
}

function lyricsSheet(t) {
  if (!t) return;
  openSheet(`<h3 class="sheet-title">Paroles · ${esc(t.title)}</h3>
    <p class="sheet-text">Colle les paroles (texte simple ou format LRC synchronisé <code>[01:23.45] ligne</code>).</p>
    <form class="form" data-form="lyr">
      <textarea name="lyr" rows="10" placeholder="Paroles…">${esc(t.lyrics || '')}</textarea>
      <div class="sheet-row">
        <button type="button" class="btn ghost" data-sa="web">${icon('search')} En ligne</button>
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>`, {
    web: async b => {
      b.disabled = true; b.textContent = 'Recherche…';
      const txt = await fetchOnline(t);
      b.disabled = false; b.innerHTML = `${icon('search')} En ligne`;
      if (txt) { $('.sheet textarea').value = txt; toast('Paroles trouvées'); } else toast('Aucune parole trouvée');
    },
  }, {
    onOpen: body => $('form', body).addEventListener('submit', async e => {
      e.preventDefault();
      t.lyrics = e.target.lyr.value.trim();
      t.lyricsSource = t.lyrics ? 'ajoutées par toi' : '';
      t.lyricsChecked = Date.now();
      await db.put('tracks', t);
      await closeSheet();
      if (t.id === player.currentId) loadLyrics(t);
      toast(t.lyrics ? 'Paroles enregistrées' : 'Paroles supprimées');
    }),
  });
}

async function attachLyricsFiles(files) {
  const byBase = new Map();
  for (const t of allTracksRaw()) byBase.set(norm((t.name || '').replace(/\.[^.]+$/, '')), t);
  let n = 0;
  for (const f of files) {
    const t = byBase.get(norm(f.name.replace(/\.[^.]+$/, '')));
    if (!t) continue;
    t.lyrics = (await f.text()).trim();
    t.lyricsSource = 'fichier .lrc';
    await db.put('tracks', t);
    n++;
    if (t.id === player.currentId) loadLyrics(t);
  }
  return n;
}

// ======================================================================
// Analyse audio en arrière-plan (pour le Concierge)
// ======================================================================
const anaQ = [];
let analyzing = false;
function queueAnalysis() {
  for (const t of allTracksRaw()) if (!t.source && !t.features && !t.featuresFailed && !anaQ.includes(t)) anaQ.push(t);
  runAnalysis();
}
async function runAnalysis() {
  if (analyzing) return;
  analyzing = true;
  let changed = 0;
  while (anaQ.length) {
    const t = anaQ.shift();
    if (!S.tracks.has(t.id)) continue;
    try {
      const blob = await db.get('audio', t.id);
      const f = blob && await AI.analyzeBlob(blob, t.type);
      if (f) t.features = f; else t.featuresFailed = 1;
    } catch { t.featuresFailed = 1; }
    if (S.tracks.has(t.id)) await db.put('tracks', t);
    changed++;
    await new Promise(r => setTimeout(r, player.playing ? 400 : 60));
  }
  analyzing = false;
  if (changed) { S.mixes = {}; bump(); if (S.route?.name === 'home' || S.route?.name === 'settings') render(true); }
}

// ======================================================================
// Mixes personnalisés
// ======================================================================
const HOME_MIXES = ['moment', 'ecole', 'sport', 'chill', 'soiree', 'favoris', 'decouverte', 'nuit'];
function getMix(key) {
  if (!S.mixes[key]) S.mixes[key] = AI.buildMix(allTracks(), key);
  return S.mixes[key];
}
function mixCover(m, cls = '') {
  const ids = [];
  for (const t of m.tracks) { if (t.coverId && !ids.includes(t.coverId)) ids.push(t.coverId); if (ids.length === 4) break; }
  const art = ids.length >= 4 ? `<div class="mix-mosaic">${ids.map(c => `<img src="${coverURL(c)}" alt="" loading="lazy">`).join('')}</div>`
    : ids.length ? `<img class="mix-one" src="${coverURL(ids[0])}" alt="" loading="lazy">` : '';
  return `<div class="cv mix-cv ${cls}" style="--h:${placeholderHue(m.key)}">${art}<div class="mix-shade"></div><span class="mix-emoji">${m.emoji}</span><span class="mix-label">${esc(m.name)}</span></div>`;
}
function mixCard(m) {
  const key = registerList('mix:' + m.key, m.tracks.map(t => t.id), m.name, { route: '#/mix/' + m.key });
  return card('#/mix/' + encodeURIComponent(m.key), mixCover(m), m.name, m.desc, { play: key });
}
function viewMix(key) {
  if (!S.mixes[key] && key.startsWith('chat-')) renderChat();
  const m = S.mixes[key] || (AI.MOODS[key] ? getMix(key) : null);
  if (!m) return notFound();
  const c = m.tracks.find(t => t.coverId)?.coverId;
  return collectionView({
    kind: 'mix', title: m.name, sub: `<span class="gold">✦ Composé par le Concierge</span> · ${esc(m.desc)}`,
    coverHtml: mixCover(m), ids: m.tracks.map(t => t.id), listKey: 'mix:' + m.key, label: m.name,
    color: colorFor(c, m.name),
    actions: `${AI.MOODS[key] ? `<button class="ib" data-act="mix-regen" data-key="${esc(key)}" aria-label="Régénérer">${icon('refresh')}</button>` : ''}<button class="ib" data-act="mix-save" data-key="${esc(key)}" aria-label="Enregistrer en playlist">${icon('list-add')}</button>`,
    emptyMsg: 'Pas encore assez de titres pour ce mix.',
  });
}
async function saveMixAsPlaylist(m) {
  if (!m?.tracks.length) return;
  const p = { id: uid(), name: m.name, trackIds: m.tracks.map(t => t.id), createdAt: Date.now(), updatedAt: Date.now() };
  S.playlists.set(p.id, p);
  S.lastPlaylistId = p.id;
  await db.put('playlists', p); bump();
  toast(`Playlist « ${m.name} » enregistrée`);
  return p;
}

// ======================================================================
// Le Concierge (chat IA)
// ======================================================================
const AI_SUGGEST = ['Mets du rap', 'Mets Skyrock', 'Mets les infos', 'Mets de la musique classique', 'Lance LEGEND', 'Une playlist pour l\'école', 'Motivation sport 45 min', 'Un truc chill pour ce soir', 'Mon mix du moment', 'Fais-moi redécouvrir des sons', 'Lance mes incontournables'];

function viewAI() {
  const has = true; // le Concierge marche aussi sans bibliothèque (radios, YouTube, commandes)
  return `<div class="ai">
    <header class="ai-head">
      <div class="ai-orb"><i></i><i></i><i></i></div>
      <div><h1>Le Concierge</h1><small>${S.settings.apiKey ? 'Propulsé par Claude' : 'IA personnelle · hors ligne'} · apprend de tes écoutes</small></div>
      <button class="ib sm" data-act="ai-clear" aria-label="Nouvelle conversation">${icon('refresh')}</button>
    </header>
    <div class="ai-log" id="ai-log">${renderChat()}</div>
    <div class="ai-foot">
    ${has ? `<div class="ai-suggest">${AI_SUGGEST.map(x => `<button class="chip" data-act="ai-send" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
    <form class="ai-input" id="ai-form"><input id="ai-q" placeholder="${has ? 'Écris ou parle au Concierge…' : 'Importe ta musique pour commencer'}" autocomplete="off" enterkeyhint="send" ${has ? '' : 'disabled'}>${has ? `<button type="button" class="ai-mic" data-act="voice" aria-label="Parler au Concierge">${icon('mic')}</button>` : ''}<button class="ai-send" aria-label="Envoyer">${icon('send')}</button></form>
    </div>
  </div>`;
}

function renderChat() {
  const name = S.settings.name;
  const intro = `<div class="msg bot"><p>Bienvenue dans ta Maison${name ? ', ' + esc(name) : ''}. Je connais toute ta musique et j'apprends ce que tu écoutes, et quand. Dis-moi ce que tu fais (l'école, le sport, une soirée, dormir…) et je te compose la playlist parfaite.</p></div>`;
  return intro + S.chat.map((m, i) => {
    if (m.role === 'user') return `<div class="msg me"><p>${esc(m.text)}</p></div>`;
    let mixHtml = '';
    if (m.mix) {
      const key = 'chat-' + i;
      if (!S.mixes[key]) S.mixes[key] = { key, name: m.mix.name, desc: m.mix.desc, emoji: '✦', tracks: m.mix.ids.map(id => S.tracks.get(id)).filter(Boolean) };
      const mx = S.mixes[key];
      const dur = mx.tracks.reduce((s, t) => s + t.duration, 0);
      mixHtml = `<a class="msg-mix" href="#/mix/${key}">${mixCover(mx)}<div><b>${esc(mx.name)}</b><small>${plural(mx.tracks.length, 'titre')} · ${fmtTotal(dur)}</small>
        <span class="msg-actions"><button class="btn primary sm" data-act="ai-play" data-key="${key}">${icon('play')} Lire</button><button class="btn ghost sm" data-act="mix-save" data-key="${key}">${icon('list-add')} Garder</button></span></div></a>`;
    }
    return `<div class="msg bot"><p>${esc(m.text)}</p>${mixHtml}</div>`;
  }).join('');
}

function afterAI(view) {
  const form = $('#ai-form', view);
  form.addEventListener('submit', e => { e.preventDefault(); const q = $('#ai-q', view); const v = q.value.trim(); if (v) { q.value = ''; aiSend(v); } });
  const log = $('#ai-log', view);
  requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });
  return log;
}

async function aiSend(text, { navigate = true } = {}) {
  if (S.aiBusy || !text) return null;
  const tracks = allTracks();
  if (navigate && S.route?.name !== 'ai') { S.pendingFwd = true; goto('#/ai'); await new Promise(r => setTimeout(r, 60)); }
  S.chat.push({ role: 'user', text });
  // Avec une clé Claude : le Concierge-agent pilote toute l'app. Sinon : compréhension locale.
  let quick = null;
  if (S.settings.apiKey) {
    S.aiBusy = true; document.body.classList.add('ai-busy');
    $('#ai-log')?.insertAdjacentHTML('beforeend', `<div class="msg me"><p>${esc(text)}</p></div><div class="msg bot typing"><span class="dots"><i></i><i></i><i></i></span></div>`);
    main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
    try {
      const hist = S.chat.slice(0, -1).slice(-8).map(m => ({ role: m.role, content: m.text || '…' }));
      quick = await AI.runAgent(S.settings.apiKey, text, { tracks, chat: hist, context: agentContext(), exec: agentExec });
    } catch (e) {
      console.warn(e);
      toast('Claude indisponible, je passe en mode local');
    }
    S.aiBusy = false; document.body.classList.remove('ai-busy');
  }
  if (!quick) { try { quick = await smartCommand(text); } catch (e) { console.warn(e); } }
  if (!quick && !tracks.length) quick = 'Ta bibliothèque est vide pour l\'instant. Demande-moi une radio (« mets Skyrock »), ajoute ta clé YouTube dans les Réglages pour que je trouve n\'importe quel son, ou importe tes fichiers.';
  if (quick) {
    const lm = S.lastMix; S.lastMix = null;
    S.chat.push({ role: 'assistant', text: quick, mix: lm ? { name: lm.name, desc: lm.desc, ids: lm.tracks.map(t => t.id) } : null });
    saveJSON('onde.chat', S.chat);
    if (S.route?.name === 'ai') { $('#ai-log').innerHTML = renderChat(); main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' }); }
    return { reply: quick };
  }
  S.aiBusy = true;
  document.body.classList.add('ai-busy');
  const log = $('#ai-log');
  log?.insertAdjacentHTML('beforeend', `<div class="msg me"><p>${esc(text)}</p></div><div class="msg bot typing"><span class="dots"><i></i><i></i><i></i></span></div>`);
  main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
  let res;
  const t0 = Date.now();
  try {
    if (S.settings.apiKey) {
      const hist = S.chat.slice(0, -1).map(m => ({ role: m.role, content: m.role === 'assistant' && m.mix ? `${m.text} [playlist « ${m.mix.name} », ${m.mix.ids.length} titres]` : m.text }));
      res = await AI.askClaude(S.settings.apiKey, text, tracks, hist);
    }
  } catch (e) {
    console.warn(e);
    toast('Claude indisponible, je passe en mode hors ligne');
  }
  if (!res) {
    if (!AI.hasIntent(text, tracks)) {
      res = { reply: 'Je n\'ai pas compris. Tu peux me dire par exemple : « mets du rap », « fais-moi une playlist pour la salle », « supprime cette playlist », « pause », « mets Skyrock ».' };
    }
  }
  if (!res) {
    const u = AI.understand(text, tracks);
    const m = u.mix;
    const dur = m.tracks.reduce((s, t) => s + t.duration, 0);
    const lines = {
      ecole: 'Concentration maximale : des sons réguliers et pas trop intenses pour bosser.',
      sport: 'On envoie de l\'énergie, avec une montée en puissance.',
      chill: 'Tout en douceur, pour souffler.',
      soiree: 'Ambiance garantie, ça monte petit à petit.',
      matin: 'De quoi te réveiller en douceur.',
      nuit: 'Doux et apaisant, ça descend tranquillement.',
      trajet: 'Tes sons préférés pour la route.',
      decouverte: 'Des titres que tu as un peu oubliés.',
      favoris: 'Tes incontournables, ceux que tu écoutes le plus.',
      moment: 'Basé sur ce que tu écoutes d\'habitude à cette heure-ci.',
    };
    res = { reply: m.tracks.length ? `« ${m.name} » : ${plural(m.tracks.length, 'titre')}, ${fmtTotal(dur)}. ${lines[u.mood] || ''}` : 'Je n\'ai pas trouvé de titres qui collent, essaie autre chose.', mix: m.tracks.length ? m : null, play: u.play };
  }
  await new Promise(r => setTimeout(r, Math.max(0, 700 - (Date.now() - t0))));
  S.chat.push({ role: 'assistant', text: res.reply, mix: res.mix ? { name: res.mix.name, desc: res.mix.desc, ids: res.mix.tracks.map(t => t.id) } : null });
  S.chat = S.chat.slice(-40);
  saveJSON('onde.chat', S.chat);
  S.aiBusy = false;
  document.body.classList.remove('ai-busy');
  if (S.route?.name === 'ai') {
    $('#ai-log').innerHTML = renderChat();
    main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
  }
  if ((res.play || !navigate) && res.mix) {
    const key = 'chat-' + (S.chat.length - 1);
    const mx = S.mixes[key] || res.mix;
    playIds(mx.tracks.map(t => t.id), 0, { context: { label: mx.name, route: '#/mix/' + key } });
  }
  return res;
}


// ======================================================================
// Compréhension des demandes (texte et voix)
// ======================================================================
const GENRES = [
  ['classique', /\b(classique|classical|mozart|beethoven|chopin|bach|piano classique|orchestre|symphonie|opera)\b/, 'classical', 'musique classique'],
  ['jazz', /\bjazz\b/, 'jazz', 'jazz'],
  ['rap fr', /\b(rap fr|rap francais|rap)\b/, 'rap francais', 'rap français'],
  ['hip-hop', /\b(hip hop|hiphop|hip-hop|us rap)\b/, 'hip-hop', 'hip hop'],
  ['drill', /\bdrill\b/, 'drill', 'drill'],
  ['rnb', /\b(rnb|r n b|r&b|r and b)\b/, 'rnb', 'rnb'],
  ['afro', /\b(afro|afrobeat|afrobeats|amapiano)\b/, 'afrobeats', 'afrobeats'],
  ['rai', /\b(rai)\b/, 'raï', 'raï'],
  ['kompa', /\b(kompa|zouk)\b/, 'zouk', 'kompa zouk'],
  ['reggaeton', /\b(reggaeton|latino|latin)\b/, 'reggaeton', 'reggaeton'],
  ['reggae', /\breggae\b/, 'reggae', 'reggae'],
  ['rock', /\brock\b/, 'rock', 'rock'],
  ['metal', /\bmetal\b/, 'metal', 'metal'],
  ['pop', /\bpop\b/, 'pop', 'pop'],
  ['lofi', /\b(lofi|lo fi|lo-fi)\b/, 'lofi', 'lofi'],
  ['electro', /\b(electro|electronique|techno|edm)\b/, 'electronic', 'electro'],
  ['house', /\bhouse\b/, 'house', 'house music'],
  ['soul', /\b(soul|funk|motown)\b/, 'soul', 'soul funk'],
  ['kpop', /\b(kpop|k pop)\b/, 'k-pop', 'kpop'],
  ['annees 80', /\b(annees 80|80s|eighties)\b/, '80s', 'années 80'],
  ['annees 90', /\b(annees 90|90s)\b/, '90s', 'années 90'],
  ['chanson francaise', /\b(chanson francaise|variete)\b/, 'chanson francaise', 'chanson française'],
];
const MOOD_RADIO = { ecole: ['lofi', 'lofi hip hop pour étudier'], sport: ['edm', 'rap motivation muscu son'], chill: ['chill', 'chill music'], soiree: ['dance', 'musique soirée'], nuit: ['ambient', 'musique douce pour dormir'], matin: ['pop', 'musique bonne humeur'], trajet: ['hits', 'hits du moment'] };

function cleanAsk(text) {
  let n = norm(text).replace(/[.!?,;:"«»]/g, ' ').replace(/['’`-]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^((hey|ok|okay|dis|allez|bon|alors|euh|concierge|maison)\s+)+/, '');
  n = n.replace(/\b(s il te plait|s il vous plait|stp|svp|merci|please)\b/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^(est ce que |est ce qu )?(tu peux|tu pourrais|peux tu|pourrais tu|tu veux bien|je veux|je voudrais|j aimerais|j ai envie d ecouter|j ai envie de|j ai envie d|vas y|fais moi|on ecoute|on met)\s+/, '');
  return n.trim();
}

function fmtDur(sec) { return sec >= 60 ? `${Math.floor(sec / 60)} min ${String(Math.round(sec % 60)).padStart(2, '0')}` : `${Math.round(sec)} s`; }

async function smartCommand(text) {
  const n = cleanAsk(text);
  const words = n.split(' ').filter(Boolean).length;
  const cur = player.current;
  S.cmdPaused = false;
  S.lastMix = null;
  if (!n) return null;

  // --- gestion : supprimer / annuler / renommer / retirer / ajouter
  const mg = await manageCommand(n);
  if (mg) return mg;

  // --- minuteur
  let m = n.match(/(?:arrete|coupe|stop|eteins|pause).*?(?:dans|d ici|apres)\s*(\d+)\s*(min|minute|h|heure)/);
  if (m) { const mins = m[2].startsWith('h') ? +m[1] * 60 : +m[1]; player.setSleep(mins); return `D'accord, j'arrête la musique dans ${mins} minutes.`; }
  if (/(a la fin (du|de ce) (titre|son|morceau))/.test(n) && /(arrete|stop|coupe)/.test(n)) { player.setSleep('end'); return 'J\'arrête à la fin de ce titre.'; }

  // --- contrôles de lecture
  if (words <= 7) {
    if (/\b(pause|stop|stoppe|arrete|arreter|coupe|silence|tais toi|chut)\b/.test(n) && !/\b(pas|plus de pub)\b/.test(n)) { player.pause(); S.cmdPaused = true; return 'Pause.'; }
    if (/^(reprends?|reprendre|relance|relancer|remets?|remettre|continue|continuer|play|lecture|joue|vas y|go|allez|resume)( la musique| le son| la lecture| le morceau| le titre)?$/.test(n)) { if (!cur) return 'Il n\'y a rien en cours. Dis-moi quoi écouter.'; player.play(); return 'C\'est reparti.'; }
    if (/(recommence|depuis le debut|au debut|reprends au debut)/.test(n)) { player.seek(0); player.play(); return 'Je reprends depuis le début.'; }
    if (/\b(suivant|suivante|next|skip|zappe|zapper)\b|passe (a la suivante|au suivant|le son|la musique|ce son|cette musique|le titre|ce titre)|change (de )?(son|musique|titre|chanson|morceau)|une autre|j aime pas|nul$/.test(n)) { if (!cur) return 'Rien en cours.'; S.voiceNext = true; player.next(); return 'Titre suivant.'; }
    if (/\b(precedent|precedente|d avant)\b|reviens (en arriere|au precedent|a la precedente)|remets la (derniere|precedente)/.test(n)) { player.prev(); return 'Titre précédent.'; }
    m = n.match(/(avance|saute|passe|va)\s+(de\s+)?(\d+)\s*(s|sec|secondes?|min|minutes?)/);
    if (m && cur) { const sec = +m[3] * (m[4].startsWith('m') ? 60 : 1); player.seek(player.time + sec); return `J'avance de ${fmtDur(sec)}.`; }
    m = n.match(/(recule|reviens|retourne)\s+(de\s+)?(\d+)\s*(s|sec|secondes?|min|minutes?)/);
    if (m && cur) { const sec = +m[3] * (m[4].startsWith('m') ? 60 : 1); player.seek(player.time - sec); return `Je recule de ${fmtDur(sec)}.`; }
    m = n.match(/(volume|son)\s+(a\s+)?(\d+)/);
    if (m) { if (isIOS) return 'Sur iPhone, utilise les boutons de volume du téléphone.'; const v = player.setVolume(+m[3] / 100); return `Volume à ${Math.round(v * 100)} %.`; }
    if (/(monte|augmente|plus fort|hausse|monter) ?(le )?(son|volume)?|^plus fort$/.test(n) && !/\b(sport|energie)\b/.test(n)) { if (isIOS) return 'Sur iPhone, utilise les boutons de volume du téléphone.'; const v = player.setVolume((player.base ?? 1) + 0.2); return `Volume à ${Math.round(v * 100)} %.`; }
    if (/(baisse|diminue|moins fort|plus bas|baisser) ?(le )?(son|volume)?/.test(n)) { if (isIOS) return 'Sur iPhone, utilise les boutons de volume du téléphone.'; const v = player.setVolume((player.base ?? 1) - 0.25); return `Volume à ${Math.round(v * 100)} %.`; }
    if (/\b(aleatoire|shuffle|melange|melanger)\b/.test(n)) { player.toggleShuffle(); return player.shuffle ? 'Lecture aléatoire activée.' : 'Lecture aléatoire désactivée.'; }
    if (/(en boucle|repete|repeter|boucle)/.test(n)) { player.repeat = /(arrete|plus|stop|desactive)/.test(n) ? 'off' : 'one'; player.emit('modes'); return player.repeat === 'one' ? 'Je répète ce titre.' : 'Répétition désactivée.'; }
    if (cur && /(j aime|like|liker|coeur|favori|kiffe|ajoute (le |ce |aux? )?(titre |son )?(aux? )?(likes?|favoris|coups? de coeur))/.test(n) && !/(playlist|mix|pas)/.test(n)) { if (!cur.liked) toggleLike(cur); return `« ${cur.title} » est dans tes titres likés.`; }
    if (cur && /(c est quoi|c quoi|quel est|qu est ce que c est|qui chante|comment (ca |il )?s appelle|c est qui|quelle (musique|chanson|radio|emission))/.test(n)) return cur.source === 'radio' ? `Tu écoutes ${cur.title} en direct.` : `C'est « ${cur.title} »${cur.artist ? ' de ' + cur.artist : ''}.`;
    if (cur && /\bparoles?\b/.test(n)) { openNP(); setTimeout(openLyrics, 450); return 'Voici les paroles.'; }
    if (/\b(file d attente|a suivre|apres)\b/.test(n) && /(quoi|qu est|c est)/.test(n)) { const nx = S.tracks.get(player.queue[player.index + 1]); return nx ? `Ensuite : « ${nx.title} »${nx.artist ? ' de ' + nx.artist : ''}.` : 'Rien à suivre pour l\'instant.'; }
  }

  // --- verbe d'action « mets / joue / lance … »
  const vm = n.match(/^(?:mets?|mais|met|lance|lancer|joue|jouer|ecoute|ecouter|passe|play|trouve|cherche|chercher|trouve moi|cherche moi)\s+(?:moi\s+)?(.+)$/);
  const ask = vm ? vm[1].trim() : n;

  // --- infos
  if (/\b(infos?|informations?|actu|actus|actualites?|journal|flash)\b/.test(ask) && !/podcast/.test(ask)) {
    const i = /inter/.test(ask) ? 1 : /rfi/.test(ask) ? 2 : 0;
    const live = /(direct|en continu|radio)/.test(ask);
    if (live) return await playRadioByName(i === 1 ? 'France Inter' : i === 2 ? 'RFI' : 'franceinfo') || null;
    return await playNewsFlash(i) || null;
  }

  // --- radios par nom
  const stations = [...Src.FR_STATIONS, ...Src.NEWS_STATIONS];
  const st = stations.filter(x => new RegExp(`\\b${norm(x).replace(/[^a-z0-9 ]/g, '.')}\\b`).test(ask)).sort((a, b) => b.length - a.length)[0];
  if (st) return await playRadioByName(st) || null;

  // --- podcasts (sélection) par nom, ou « podcast … »
  const allPods = Src.PODCAST_CATEGORIES.flatMap(c => c.items);
  const pod = allPods.find(p => ask.includes(norm(p.name).replace(/['’]/g, ' ')));
  if (pod || /\bpodcast\b/.test(ask)) {
    const q = pod ? pod.q : ask.replace(/\b(le |un |des |du )?(dernier |nouveau )?(episode |podcast )+(de |d )?/g, '').trim();
    const cat = !pod && Src.PODCAST_CATEGORIES.find(c => new RegExp(c.id === 'horreur' ? 'horreur|peur|paranormal' : c.id === 'vraies' ? 'faits? divers|crime|histoire vraie' : c.id === 'humour' ? 'humour|drole|rire' : c.id === 'savoir' ? 'science|histoire' : c.id === 'parcours' ? 'interview|parcours|entrepreneur' : 'infos?|actu').test(ask));
    try {
      const show = await Src.findShow(cat ? (cat.items[0]?.q || cat.more) : (q || ask));
      if (!show) return `Je n'ai pas trouvé ce podcast.`;
      const p = await Src.podcastEpisodes(show.id, 3);
      if (!p.episodes.length) return `Pas d'épisode disponible pour ${show.name}.`;
      const t = remoteTrack(p.episodes[0], 'podcast');
      playIds(p.episodes.map(e => remoteTrack(e, 'podcast').id), 0, { context: { label: show.name } });
      return `Je lance le dernier épisode de ${show.name} : « ${t.title} ».`;
    } catch (e) { return 'Les podcasts sont indisponibles pour le moment.'; }
  }

  // --- genres musicaux
  const g = GENRES.find(([, re]) => re.test(ask));
  if (g && (vm || /\b(musique|du|de la|son|sons|playlist|radio)\b/.test(n) || words <= 3)) {
    const [label, , tag, ytq] = g;
    const lib = allTracks().filter(t => t.genre && norm(t.genre).includes(norm(label).split(' ')[0]));
    if (lib.length >= 5 && !/radio/.test(ask)) { playIds(lib.map(t => t.id), 0, { context: { label: label }, shuffle: true }); return `Je lance ${plural(lib.length, 'titre')} ${label} de ta bibliothèque.`; }
    if (S.settings.ytKey && !/radio/.test(ask)) {
      try {
        const res = await Src.ytSearch(S.settings.ytKey, ytq, 20);
        if (res.length) return await ytMix(label.charAt(0).toUpperCase() + label.slice(1), res.map(x => remoteTrack(x, 'yt')), n);
      } catch { /* on tente la radio */ }
    }
    try {
      const list = await Src.radioByTag(tag, 10);
      if (list.length) { const ts = list.map(x => remoteTrack(x, 'radio')); playIds([ts[0].id], 0, { context: { label: 'Radio ' + label } }); return `Je lance une radio ${label} : ${ts[0].title}.`; }
    } catch { /* rien */ }
    return `Je n'ai rien trouvé en ${label} pour l'instant.`;
  }

  // --- ambiances quand la bibliothèque est petite : on passe par la radio / YouTube
  if (allTracks().length < 8) {
    const mood = [['ecole', /ecole|cours|devoir|revis|travail|bosser|focus|concentr|etud/], ['sport', /sport|muscu|salle|courir|running|cardio|motiv/], ['nuit', /dormir|dodo|sommeil|nuit/], ['chill', /chill|calme|detente|relax|tranquille|pluie/], ['soiree', /soiree|fete|danser|ambiance|apero/], ['matin', /matin|reveil/], ['trajet', /trajet|voiture|route/]].find(([, re]) => re.test(ask));
    if (mood) {
      const [tag, ytq] = MOOD_RADIO[mood[0]];
      if (S.settings.ytKey) {
        try { const res = await Src.ytSearch(S.settings.ytKey, ytq, 25); if (res.length) return await ytMix(AI.MOODS[mood[0]]?.label || ytq, res.map(x => remoteTrack(x, 'yt')), n); } catch { /* radio */ }
      }
      try { const list = await Src.radioByTag(tag, 5); if (list.length) { const t = remoteTrack(list[0], 'radio'); playIds([t.id], 0, { context: { label: 'Radio' } }); return `Pour ça, je te mets la radio ${t.title}.`; } } catch { /* rien */ }
    }
  }

  // --- « joue X » : bibliothèque, puis YouTube, puis radios, puis podcasts
  if (vm && ask && !/(pour|ambiance|truc|quelque chose|style|mix|playlist|genre)/.test(ask)) {
    const local = quickCommand('joue ' + ask);
    if (local) return local;
    if (S.settings.ytKey) {
      try {
        const res = await Src.ytSearch(S.settings.ytKey, text.replace(/^.*?\b(mets?|mais|lance|joue|ecoute|passe|play|trouve|cherche)\s+(moi\s+)?/i, ''), 12);
        if (res.length) { const ts = res.map(x => remoteTrack(x, 'yt')); playIds(ts.map(t => t.id), 0, { context: { label: 'YouTube' } }); return `Je lance « ${ts[0].title} »${ts[0].artist ? ' de ' + ts[0].artist : ''} sur YouTube.`; }
      } catch { /* suite */ }
    }
    try {
      const r = await Src.radioSearch(ask, 3);
      if (r.length && norm(r[0].title).includes(ask.split(' ')[0])) { const t = remoteTrack(r[0], 'radio'); playIds([t.id], 0, { context: { label: 'Radio' } }); return `Je lance la radio ${t.title}.`; }
    } catch { /* suite */ }
    if (!S.settings.ytKey) return `Je n'ai pas « ${ask} » dans ta bibliothèque. Pour que je le trouve sur YouTube, il faut que ta clé YouTube marche (Réglages).`;
    return `Je n'ai rien trouvé pour « ${ask} ».`;
  }
  return null;
}

// ======================================================================
// Outils du Concierge-agent (Claude)
// ======================================================================
function agentContext() {
  const t = player.current;
  const pls = [...S.playlists.values()].map(p => `« ${p.name} » (${p.trackIds.length})`).join(', ') || 'aucune';
  return [
    t ? `En cours : « ${t.title} »${t.artist ? ' de ' + t.artist : ''} (${t.source || 'fichier'}), ${player.playing ? 'en lecture' : 'en pause'}.` : 'Rien en cours.',
    `Volume ${Math.round((player.base ?? 1) * 100)} %. Égaliseur ${S.settings.eq}.`,
    `Playlists : ${pls}. Titres likés : ${liked().length}.`,
    `YouTube ${S.settings.ytKey ? 'disponible' : 'non configuré'}. Prénom : ${S.settings.name || 'inconnu'}.`,
  ].join(' ');
}

async function agentExec(name, a) {
  const cur = player.current;
  switch (name) {
    case 'play': {
      const q = a.query || '';
      if (a.source === 'radio') return await playRadioByName(q) || (await (async () => { const r = await Src.radioSearch(q, 3); if (!r.length) return 'Aucune radio trouvée'; const t = remoteTrack(r[0], 'radio'); playIds([t.id], 0, { context: { label: 'Radio' } }); return `Radio ${t.title} lancée`; })());
      if (a.source === 'podcast') return await smartCommand(`mets le podcast ${q}`) || 'Podcast introuvable';
      if (a.source === 'youtube') {
        if (!S.settings.ytKey) return 'YouTube non configuré';
        const res = await Src.ytSearch(S.settings.ytKey, q, 15);
        if (!res.length) return 'Rien trouvé sur YouTube';
        const ts = res.map(x => remoteTrack(x, 'yt'));
        playIds(ts.map(t => t.id), 0, { context: { label: q } });
        return `Lancé : « ${ts[0].title} » de ${ts[0].artist} (+${ts.length - 1} à suivre)`;
      }
      if (a.source === 'library') return quickCommand('joue ' + norm(q)) || 'Pas dans la bibliothèque';
      return await smartCommand(`mets ${q}`) || 'Rien trouvé';
    }
    case 'control': {
      const m = { pause: 'pause', resume: 'reprends', next: 'suivant', previous: 'precedent', restart: 'recommence', like: 'j aime ce son' }[a.action];
      if (m) return await smartCommand(m) || 'OK';
      if (a.action === 'shuffle_on' || a.action === 'shuffle_off') { if (player.shuffle !== (a.action === 'shuffle_on')) player.toggleShuffle(); return 'OK'; }
      if (a.action === 'repeat_one' || a.action === 'repeat_off') { player.repeat = a.action === 'repeat_one' ? 'one' : 'off'; player.emit('modes'); return 'OK'; }
      if (a.action === 'open_player') { openNP(); return 'Lecteur ouvert'; }
      if (a.action === 'show_lyrics') { if (!cur) return 'Rien en cours'; openNP(); setTimeout(openLyrics, 450); return S.lyr?.parsed ? 'Paroles affichées' : 'Pas de paroles trouvées pour ce titre'; }
      if (a.action === 'show_queue') { openNP(); setTimeout(queueSheet, 450); return 'File affichée'; }
      return 'Action inconnue';
    }
    case 'set_volume': return isIOS ? 'Volume non réglable sur iPhone' : `Volume ${Math.round(player.setVolume(a.percent / 100) * 100)} %`;
    case 'set_equalizer': S.settings.eq = a.preset; saveSettings(); player.setEQ(EQ_PRESETS[a.preset]); if (player.kind === 'local') player.ensureAudioGraph(); return `Égaliseur ${EQ_NAMES[a.preset]}`;
    case 'seek': if (!cur) return 'Rien en cours'; player.seek(player.time + a.seconds); return 'OK';
    case 'sleep_timer': player.setSleep(a.minutes > 0 ? a.minutes : 0); return a.minutes > 0 ? `Arrêt dans ${a.minutes} min` : 'Minuteur annulé';
    case 'play_news': {
      const i = a.station === 'inter' ? 1 : a.station === 'rfi' ? 2 : 0;
      if (a.live) return await playRadioByName(['franceinfo', 'France Inter', 'RFI'][i]) || 'Radio indisponible';
      return await playNewsFlash(i) || 'Journal indisponible';
    }
    case 'make_playlist': {
      const tracks = allTracks();
      const ids = [...new Set((a.track_numbers || []).map(n => tracks[n - 1]?.id).filter(Boolean))];
      if (!ids.length) return 'Aucun titre valide';
      const key = 'chat-ag' + Date.now();
      S.mixes[key] = { key, name: a.name || 'Sélection du Concierge', desc: 'Composée par le Concierge', emoji: '✦', tracks: ids.map(id => S.tracks.get(id)) };
      if (a.save) await saveMixAsPlaylist(S.mixes[key]);
      if (a.play) playIds(ids, 0, { context: { label: S.mixes[key].name, route: '#/mix/' + key } });
      return `Playlist « ${S.mixes[key].name} » : ${ids.length} titres${a.save ? ', enregistrée' : ''}${a.play ? ', lancée' : ''}`;
    }
    case 'queue_add': {
      let t = allTracks().find(x => norm(`${x.title} ${x.artist}`).includes(norm(a.query)));
      if (!t && S.settings.ytKey) { const r = await Src.ytSearch(S.settings.ytKey, a.query, 1); if (r[0]) t = remoteTrack(r[0], 'yt'); }
      if (!t) return 'Introuvable';
      a.next ? player.addNext(t.id) : player.addToQueue(t.id);
      return `« ${t.title} » ajouté ${a.next ? 'en prochain' : 'à la file'}`;
    }
    case 'add_current_to_playlist': {
      if (!cur) return 'Rien en cours';
      let p = [...S.playlists.values()].find(x => norm(x.name) === norm(a.playlist));
      if (!p) { p = { id: uid(), name: a.playlist, trackIds: [], createdAt: Date.now(), updatedAt: Date.now() }; S.playlists.set(p.id, p); }
      if (!p.trackIds.includes(cur.id)) p.trackIds.push(cur.id);
      if (cur.source && !cur.saved) { cur.saved = true; await db.put('tracks', cur); }
      p.updatedAt = Date.now(); await db.put('playlists', p); bump();
      return `Ajouté à « ${p.name} »`;
    }
    case 'now_playing': {
      const nx = player.queue.slice(player.index + 1, player.index + 6).map(id => S.tracks.get(id)).filter(Boolean).map(t => `${t.title} — ${t.artist || ''}`);
      return { current: cur ? { title: cur.title, artist: cur.artist, source: cur.source || 'fichier', playing: player.playing, position: Math.round(player.time), duration: Math.round(player.duration || 0) } : null, next: nx, volume: Math.round((player.base ?? 1) * 100) };
    }
    case 'navigate': { await closeAllOverlays(); S.pendingFwd = true; goto({ home: '#/', search: '#/search', library: '#/library', concierge: '#/ai', settings: '#/settings', liked: '#/liked' }[a.screen] || '#/'); return 'OK'; }
  }
  return 'Outil inconnu';
}

// Playlist visée : nommée dans la phrase, sinon celle qu'on vient de créer, sinon celle qui joue, sinon celle affichée
function targetPlaylist(n) {
  const pls = [...S.playlists.values()].sort((a, b) => norm(b.name).length - norm(a.name).length);
  const key = x => norm(x).replace(/[^a-z0-9]+/g, ' ').trim();
  const nk = ' ' + key(n) + ' ';
  const named = pls.find(p => key(p.name).length > 2 && nk.includes(' ' + key(p.name) + ' '));
  if (named) return named;
  if (S.lastPlaylistId && S.playlists.has(S.lastPlaylistId)) return S.playlists.get(S.lastPlaylistId);
  const playing = pls.find(p => p.name === player.context?.label);
  if (playing) return playing;
  if (S.route?.name === 'playlist') return S.playlists.get(S.route.arg) || null;
  return null;
}

async function manageCommand(n) {
  const cur = player.current;
  // annuler la dernière suppression
  if (/^(annule|annuler|reviens en arriere|remets la|recupere la)\b/.test(n) && S.deletedPlaylist) {
    const p = S.deletedPlaylist; S.deletedPlaylist = null;
    S.playlists.set(p.id, p); await db.put('playlists', p); bump(); render(true);
    return `C'est annulé, la playlist « ${p.name} » est de retour.`;
  }
  const del = /\b(supprime|supprimer|efface|effacer|retire|enleve|vire|degage|jette|delete)\b/.test(n);
  // retirer le son en cours des likes
  if (del && cur && /\b(likes?|favoris|coups? de coeur|titres likes)\b/.test(n)) {
    if (cur.liked) await toggleLike(cur);
    return `« ${cur.title} » retiré de tes titres likés.`;
  }
  // retirer le son en cours d'une playlist
  if (del && cur && /\b(ce son|ce titre|cette musique|ce morceau|la musique|le son|ca)\b/.test(n) && /playlist/.test(n)) {
    const p = targetPlaylist(n);
    if (!p) return 'De quelle playlist ? Dis-moi son nom.';
    const i = p.trackIds.indexOf(cur.id);
    if (i < 0) return `« ${cur.title} » n'est pas dans « ${p.name} ».`;
    p.trackIds.splice(i, 1); p.updatedAt = Date.now(); await db.put('playlists', p); bump(); render(true);
    return `« ${cur.title} » retiré de « ${p.name} ».`;
  }
  // supprimer une playlist
  if (del && /\bplaylists?\b/.test(n)) {
    const p = targetPlaylist(n);
    if (!p) return S.playlists.size ? 'Quelle playlist ? Dis-moi son nom.' : 'Tu n\'as aucune playlist.';
    S.playlists.delete(p.id); await db.del('playlists', p.id); bump();
    S.deletedPlaylist = p; if (S.lastPlaylistId === p.id) S.lastPlaylistId = null;
    if (S.route?.name === 'playlist' && S.route.arg === p.id) goto('#/library', true); else render(true);
    return `Playlist « ${p.name} » supprimée. Dis « annule » si tu changes d'avis.`;
  }
  // supprimer le son en cours de la bibliothèque
  if (del && cur && /\b(ce son|ce titre|cette musique|ce morceau)\b/.test(n) && /(bibliotheque|telephone|ma musique)/.test(n)) {
    if (cur.source) { cur.saved = false; cur.liked = false; await db.put('tracks', cur); bump(); render(true); return `« ${cur.title} » retiré de ta bibliothèque.`; }
    await deleteTracks([cur.id]); return 'Titre supprimé.';
  }
  // vider la file d'attente
  if (/(vide|efface|nettoie|supprime) (la )?file/.test(n)) { player.queue.splice(player.index + 1); player.emit('queue'); return 'File d\'attente vidée.'; }
  // renommer une playlist
  let m = n.match(/renomm\w* (?:la playlist |ma playlist |cette playlist )?(.*?)\s*(?:en|par|comme) (.+)$/);
  if (m) {
    const p = m[1] ? targetPlaylist(m[1]) : targetPlaylist(n);
    if (!p) return 'Quelle playlist veux-tu renommer ?';
    const name = m[2].replace(/^(la |le )/, '').trim();
    const old = p.name;
    p.name = name.charAt(0).toUpperCase() + name.slice(1); p.updatedAt = Date.now(); await db.put('playlists', p); bump(); render(true);
    return `« ${old} » s'appelle maintenant « ${p.name} ».`;
  }
  // ajouter le son en cours à une playlist
  m = n.match(/(?:ajoute|mets|met|range|sauvegarde|garde) (?:ce son|ca|ce titre|cette musique|ce morceau|la musique|le son)(?: (?:dans|a|sur) (?:la |ma )?(?:playlist )?(.+))?$/);
  if (m && cur) {
    const name = (m[1] || '').replace(/^(playlist )/, '').trim();
    if (!name || /^(mes )?(likes?|favoris)$/.test(name)) { if (!cur.liked) await toggleLike(cur); return `« ${cur.title} » ajouté à tes titres likés.`; }
    if (/^(la )?file/.test(name)) { player.addToQueue(cur.id); return 'Ajouté à la file.'; }
    let p = [...S.playlists.values()].find(x => norm(x.name) === name) || [...S.playlists.values()].find(x => norm(x.name).includes(name));
    if (!p) { p = { id: uid(), name: name.charAt(0).toUpperCase() + name.slice(1), trackIds: [], createdAt: Date.now(), updatedAt: Date.now() }; S.playlists.set(p.id, p); }
    if (!p.trackIds.includes(cur.id)) p.trackIds.push(cur.id);
    if (cur.source && !cur.saved) { cur.saved = true; await db.put('tracks', cur); }
    p.updatedAt = Date.now(); S.lastPlaylistId = p.id; await db.put('playlists', p); bump(); render(true);
    return `« ${cur.title} » ajouté à « ${p.name} ».`;
  }
  // créer une playlist vide nommée
  m = n.match(/^(?:cree|creer|fais|nouvelle) (?:moi )?(?:une )?(?:nouvelle )?playlist (?:nommee|appelee|qui s appelle) (.+)$/);
  if (m) {
    const p = { id: uid(), name: m[1].charAt(0).toUpperCase() + m[1].slice(1), trackIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    S.playlists.set(p.id, p); S.lastPlaylistId = p.id; await db.put('playlists', p); bump(); render(true);
    return `Playlist « ${p.name} » créée. Dis « ajoute ce son à ${p.name} » pendant l'écoute pour la remplir.`;
  }
  return null;
}
// ======================================================================
// Commandes directes (texte ou voix)
// ======================================================================
function quickCommand(text) {
  const n = norm(text).replace(/[.!?,]/g, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  const words = n.split(' ').length;
  const cur = player.current;
  if (words <= 4) {
    if (/^(pause|stop|arrete|coupe|silence|tais)/.test(n)) { player.pause(); return 'Pause.'; }
    if (/^(reprends|reprend|play|relance|continue|remets|lecture)$/.test(n)) { player.play(); return 'C\'est reparti.'; }
    if (/(suivant|suivante|next|passe|skip|zappe|change)/.test(n)) { player.next(); return 'Titre suivant.'; }
    if (/(precedent|precedente|reviens|d avant)/.test(n)) { player.prev(); return 'Titre précédent.'; }
    if (/(aleatoire|shuffle|melange)/.test(n)) { player.toggleShuffle(); return player.shuffle ? 'Lecture aléatoire activée.' : 'Lecture aléatoire désactivée.'; }
    if (/(en boucle|repete|boucle)/.test(n)) { player.repeat = 'one'; player.emit('modes'); return 'Je répète ce titre.'; }
  }
  if (cur && words <= 7 && /(j aime|like|coeur|favori|kiffe)/.test(n) && !/playlist|mix/.test(n)) {
    if (!cur.liked) toggleLike(cur);
    return `« ${cur.title} » est dans tes titres likés.`;
  }
  if (cur && /(c est quoi|quel est|qu est ce que|qui chante|c quoi).*(titre|son|musique|chanson|ca)|qui chante/.test(n)) return `C'est « ${cur.title} » de ${artistOf(cur)}.`;
  if (cur && /paroles/.test(n) && words <= 6) { openNP(); setTimeout(openLyrics, 450); return 'Voici les paroles.'; }
  const sl = n.match(/(?:minuteur|arrete|stop|coupe).*?(\d+)\s*(?:min|minute)/);
  if (sl) { player.setSleep(+sl[1]); return `D'accord, j'arrête la musique dans ${sl[1]} minutes.`; }
  const m = n.match(/^(?:joue|jouer|mets|met|mais|lance|ecoute|ecouter|play)\s+(?:moi\s+)?(.+)$/);
  if (!m) return null;
  const q0 = m[1].trim();
  let q = m[1].replace(/^(la |le |les |l |du |des |un |une )/, '').replace(/^(chanson|titre|son|musique|morceau|album|playlist|artiste)\s+/, '').replace(/^(de |d )/, '').trim();
  if (!q || /(pour|ambiance|truc|quelque chose|style|mix|playlist|genre)/.test(q)) return null;
  const ctx = label => ({ context: { label } });
  if (/titres? likes?|favoris|coups? de coeur/.test(q) && liked().length) { playIds(liked().map(t => t.id), 0, ctx('Titres likés')); return 'Je lance tes titres likés.'; }
  const pl = [...S.playlists.values()].find(p => norm(p.name) === q || norm(p.name) === q0) || [...S.playlists.values()].find(p => norm(p.name).length > 2 && q.includes(norm(p.name)));
  if (pl && pl.trackIds.length) { playIds(pl.trackIds.filter(id => S.tracks.has(id)), 0, ctx(pl.name)); return `Je lance ta playlist « ${pl.name} ».`; }
  const tracks = allTracks();
  const eq = x => x === q || x === q0;
  const exact = tracks.find(t => eq(norm(t.title))) || tracks.find(t => norm(`${t.title} ${t.artist}`) === q.replace(/ de /, ' '));
  if (exact) { playIds([exact.id, ...tracks.filter(t => t.artist === exact.artist && t.id !== exact.id).map(t => t.id)], 0, ctx(exact.title)); return `Voici « ${exact.title} » de ${artistOf(exact)}.`; }
  const al = [...albums().values()].find(a => eq(norm(a.title)) || (norm(a.title).length > 3 && q0.includes(norm(a.title))));
  if (al) { playIds(al.tracks.map(t => t.id), 0, ctx(al.title)); return `Je lance l'album « ${al.title} » de ${al.artist}.`; }
  const ar = [...artists().values()].sort((a, b) => b.name.length - a.name.length).find(a => eq(norm(a.name)) || (norm(a.name).length > 2 && q0.includes(norm(a.name))));
  if (ar) { playIds(ar.tracks.map(t => t.id), 0, { context: { label: ar.name }, shuffle: true }); return `Je lance ${ar.name}.`; }
  const part = tracks.find(t => norm(t.title).length > 3 && (q.includes(norm(t.title)) || norm(t.title).includes(q)));
  if (part) { playIds([part.id], 0, ctx(part.title)); return `Voici « ${part.title} » de ${artistOf(part)}.`; }
  return null;
}

// ======================================================================
// Mode vocal
// ======================================================================
const vbox = $('#voice');
async function startVoice({ navigate = false } = {}) {
  if (!Voice.canListen) {
    toast('La commande vocale n\'est pas disponible sur ce navigateur (essaie Chrome ou Safari à jour)');
    return;
  }
  if (S.voiceOn) { Voice.stopListening(); return; }
  S.voiceOn = true;
  Voice.stopSpeaking();
  const said = $('.v-said', vbox), ans = $('.v-answer', vbox);
  said.textContent = ''; ans.textContent = '';
  vbox.className = 'voice listening';
  vbox.hidden = false;
  requestAnimationFrame(() => vbox.classList.add('open'));
  // Pendant que tu parles, la musique se met en pause (meilleure écoute), puis reprend
  S.voiceWasPlaying = player.playing;
  S.voiceTrack = player.currentId;
  if (player.playing) player.pause();
  let text = '';
  try {
    text = await Voice.listen({ onPartial: t => { said.textContent = t; } });
  } catch (e) {
    ans.textContent = e.message === 'not-allowed' || e.message === 'service-not-allowed'
      ? 'Autorise le micro pour cette app dans les réglages du navigateur.'
      : e.message === 'network' ? 'La reconnaissance vocale a besoin d\'internet.' : 'Je n\'ai pas pu t\'écouter.';
  }
  if (!S.voiceOn) return;
  if (text) {
    said.textContent = text;
    vbox.classList.replace('listening', 'thinking');
    const res = await aiSend(text, { navigate });
    const reply = res?.reply || 'Je n\'ai pas compris. Essaie par exemple « mets du rap », « mets Skyrock », « pause » ou « suivant ».';
    ans.textContent = reply;
    vbox.classList.replace('thinking', 'speaking');
    const changed = player.currentId !== S.voiceTrack || player.playing;
    if (changed) player.duck(true);
    if (S.settings.voiceReply) await Voice.speak(reply); else await new Promise(r => setTimeout(r, 1400));
    // On relance la musique si la commande ne l'a pas changée ni mise en pause
    if (!changed && S.voiceWasPlaying && !S.cmdPaused) player.play();
  } else {
    if (!ans.textContent) ans.textContent = 'Je n\'ai rien entendu.';
    await new Promise(r => setTimeout(r, 1300));
  }
  closeVoice();
}
function closeVoice() {
  if (!S.voiceOn) return;
  S.voiceOn = false;
  Voice.stopListening();
  Voice.stopSpeaking();
  player.duck(false);
  if (S.voiceWasPlaying && !player.playing && !S.cmdPaused && player.currentId === S.voiceTrack) player.play();
  S.voiceWasPlaying = false;
  vbox.classList.remove('open');
  setTimeout(() => { if (!S.voiceOn) vbox.hidden = true; }, 350);
}
$('.v-close', vbox).addEventListener('click', closeVoice);
$('.v-orb', vbox).addEventListener('click', () => Voice.stopListening());



// ======================================================================
// Anti-pub : YouTube (SponsorBlock) et podcasts (début / fin appris)
// ======================================================================
const podPrefs = loadJSON('onde.podprefs', {});
const savePodPrefs = () => saveJSON('onde.podprefs', podPrefs);
const showKey = t => norm(t?.artist || '');
let sbSegs = null, sbFor = null, podLearn = null, autoStartDone = null;

player.addEventListener('track', async () => {
  const t = player.current;
  np.classList.toggle('pod', t?.source === 'podcast');
  sbSegs = null; sbFor = t?.id; podLearn = null;
  if (!t) return;
  if (t.source === 'yt' && S.settings.skipAds) {
    const segs = await Src.sponsorSegments(t.ytId);
    if (sbFor === t.id) sbSegs = segs.map(x => ({ ...x, done: false }));
  }
  if (t.source === 'podcast' && S.settings.skipAds) {
    const pr = podPrefs[showKey(t)];
    if (pr?.start && autoStartDone !== t.id) {
      autoStartDone = t.id;
      const go = () => { if (player.currentId === t.id && player.time < pr.start - 3) { player.seek(pr.start); toast(`Début de l'émission sauté (${fmt(pr.start)})`); } };
      setTimeout(go, 900);
    }
  }
});

player.addEventListener('time', () => {
  const t = player.current;
  if (!t || !S.settings.skipAds) return;
  const now = player.time, d = player.duration;
  if (sbSegs && t.source === 'yt') {
    for (const sg of sbSegs) {
      if (!sg.done && now >= sg.start && now < sg.end - 0.6) {
        sg.done = true;
        player.seek(sg.end);
        toast({ sponsor: 'Pub sautée', selfpromo: 'Autopromo sautée', interaction: 'Passage hors sujet sauté', intro: 'Intro sautée', outro: 'Fin sautée', music_offtopic: 'Passage hors sujet sauté', preview: 'Aperçu sauté' }[sg.cat] || 'Passage sauté');
        break;
      }
    }
  }
  if (t.source === 'podcast' && d && isFinite(d)) {
    const pr = podPrefs[showKey(t)];
    if (pr?.end && d - now <= pr.end && d - now > 1 && !t._endSkipped) { t._endSkipped = true; toast('Fin de l\'émission (pubs) sautée'); player.next(true); }
  }
});

// Apprentissage : quand tu sautes la pub du début, je retiens où l'émission commence vraiment
function podSkip(sec) {
  const t = player.current;
  if (!t) return;
  const before = player.time;
  player.seek(before + sec);
  if (t.source !== 'podcast') return;
  if (before < 400) {
    clearTimeout(podLearn?.timer);
    podLearn = { id: t.id, timer: setTimeout(() => {
      if (player.currentId !== t.id || !player.playing) return;
      const pos = Math.round(player.time - 8);
      if (pos > 20 && pos < 480) {
        const k = showKey(t);
        podPrefs[k] = { ...(podPrefs[k] || {}), start: pos };
        savePodPrefs();
        toast(`C'est noté : pour « ${t.artist} », je sauterai directement à ${fmt(pos)}`);
      }
    }, 9000) };
  }
}
// Passer au suivant près de la fin d'un épisode = je retiens la durée des pubs de fin
player.addEventListener('queue', () => {
  const prevId = S._lastPodId;
  S._lastPodId = player.currentId;
  if (!prevId || prevId === player.currentId) return;
  const t = S.tracks.get(prevId);
  if (t?.source !== 'podcast' || !S._lastPodPos) return;
  const rem = (t.duration || 0) - S._lastPodPos;
  if (rem > 25 && rem < 420 && S._lastPodPos > t.duration * 0.6 && !t._endSkipped) {
    const k = showKey(t);
    podPrefs[k] = { ...(podPrefs[k] || {}), end: Math.round(rem - 5) };
    savePodPrefs();
    toast(`C'est noté : je couperai les ${fmt(rem)} de fin de « ${t.artist} »`);
  }
});
player.addEventListener('time', () => { if (player.current?.source === 'podcast') S._lastPodPos = player.time; });

// ======================================================================
// Son : volume et égaliseur
// ======================================================================
const EQ_PRESETS = { normal: [0, 0, 0], basses: [6, 0, 1], basses2: [10, -1, 2], voix: [-3, 4, 2], aigus: [-1, 0, 5], soiree: [6, -2, 4], douce: [2, -1, -4] };
const EQ_NAMES = { normal: 'Normal', basses: 'Basses +', basses2: 'Basses ++', voix: 'Voix (podcasts)', aigus: 'Aigus +', soiree: 'Soirée', douce: 'Douce' };
function soundSheet() {
  const cur = S.settings.eq || 'normal';
  openSheet(`<h3 class="sheet-title">Son</h3>
    ${isIOS ? '<p class="sheet-text">Sur iPhone, le volume se règle avec les boutons du téléphone.</p>' : `<div class="vol-row">${icon('timer')}<input type="range" class="range" id="vol" min="5" max="100" step="1" value="${Math.round((player.base ?? 1) * 100)}"><b id="vol-v">${Math.round((player.base ?? 1) * 100)} %</b></div>`}
    <h4 class="sub">Égaliseur</h4>
    <div class="eq-presets">${Object.keys(EQ_PRESETS).map(k => `<button class="chip ${k === cur ? 'on' : ''}" data-sa="eq" data-k="${k}">${EQ_NAMES[k]}</button>`).join('')}</div>
    <p class="sheet-text">${isIOS ? 'L\'égaliseur n\'est pas disponible sur iPhone.' : 'L\'égaliseur s\'applique à tes musiques importées. YouTube et les radios utilisent leur propre son.'}</p>`, {
    eq: b => {
      S.settings.eq = b.dataset.k; saveSettings();
      player.setEQ(EQ_PRESETS[b.dataset.k]);
      if (player.kind === 'local' && EQ_PRESETS[b.dataset.k].some(Boolean)) player.ensureAudioGraph();
      $$('.eq-presets .chip').forEach(c => c.classList.toggle('on', c === b));
      toast(`Égaliseur : ${EQ_NAMES[b.dataset.k]}`);
    },
  }, {
    onOpen: body => {
      const v = $('#vol', body);
      if (!v) return;
      v.style.setProperty('--p', `${v.value}%`);
      v.addEventListener('input', () => { const x = player.setVolume(v.value / 100); S.settings.volume = x; saveSettings(); $('#vol-v', body).textContent = Math.round(x * 100) + ' %'; v.style.setProperty('--p', `${v.value}%`); });
    },
  });
}
// ======================================================================
// Sources en ligne : YouTube (lecteur officiel) & radios
// ======================================================================
const ytbox = $('#ytbox');
// La vidéo YouTube prend exactement la place de la pochette : dans le lecteur, dans les paroles ou dans le mini-lecteur
function placeYT() {
  const on = player.kind === 'yt' && !!player.current && !S.miniGone;
  ytbox.classList.toggle('on', on);
  ytbox.classList.toggle('over', !!S.npOpen);
  mini.classList.toggle('yt', on);
  np.classList.toggle('yt-on', on && S.npOpen && !S.lyrOpen);
  if (!on) return;
  let r, inNp = false;
  if (S.npOpen && S.lyrOpen) r = $('.lyr-head .cv', np)?.getBoundingClientRect();
  else if (S.npOpen) {
    // zone carrée de la pochette, calculée sans tenir compte des animations en cours
    const a = $('.np-art', np).getBoundingClientRect();
    const size = Math.min(a.width, window.innerHeight * 0.52);
    r = { left: a.left + (a.width - size) / 2, top: a.top + (a.height - size) / 2, width: size, height: size };
    inNp = true;
  } else r = $('.mini-cover', mini)?.getBoundingClientRect();
  if (!r) return;
  ytbox.classList.add('moving');
  Object.assign(ytbox.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: inNp ? '8px' : '5px' });
  ytbox.classList.toggle('in-np', inNp);
  requestAnimationFrame(() => requestAnimationFrame(() => ytbox.classList.remove('moving')));
}
window.addEventListener('resize', () => placeYT());
$('.yt-shield', ytbox).addEventListener('click', () => { if (!S.npOpen) openNP(); else player.toggle(); });

function remoteTrack(item, source) {
  const id = source === 'yt' ? 'yt-' + item.ytId : source === 'podcast' ? 'pc-' + item.podcastId : 'rd-' + item.radioId;
  let t = S.tracks.get(id);
  if (t) return t;
  const coverId = item.thumb ? 'u:' + item.thumb : null;
  if (coverId) S.covers.set(coverId, item.thumb);
  t = {
    id, source, title: item.title || 'Sans titre', artist: item.artist || '', album: '', albumArtist: '', genre: source === 'radio' ? 'Radio' : '',
    duration: item.duration || (source === 'radio' ? 0 : 0), coverId, thumb: item.thumb || '',
    ytId: item.ytId, url: item.url, addedAt: Date.now(), plays: 0, lastPlayed: 0, liked: false, saved: false, lyrics: '',
  };
  S.tracks.set(id, t);
  return t;
}

function onlineRow(t, i, listKey) {
  const live = t.source === 'radio';
  return `<div class="row ${t.id === player.currentId ? 'playing' : ''}" data-tid="${t.id}" data-i="${i}" data-list="${listKey}" style="--d:${Math.min(i, 14) * 22}ms">
    ${trackCover(t, live ? 'radio-cv' : 'wide')}
    <div class="row-meta"><b><span class="eq"><i></i><i></i><i></i></span>${esc(t.title)}</b><small>${live ? '<span class="live-dot">EN DIRECT</span> ' : t.source === 'podcast' ? '<span class="src-pc">PODCAST</span> ' : '<span class="src-yt">YouTube</span> '}${esc(t.artist)}${t.duration ? ' · ' + fmt(t.duration) : ''}</small></div>
    <button class="ib sm more" aria-label="Options">${icon('more')}</button>
  </div>`;
}

let searchSeq = 0;
async function onlineSearch(q) {
  const box = $('#results');
  if (!box) return;
  const seq = ++searchSeq;
  const src = S.settings.searchSrc;
  const show = html => { if (seq === searchSeq && $('#results')) $('#results').innerHTML = html; };
  q = (q || '').trim();
  try {
    if (src === 'radio') {
      if (!q) {
        show(`${radioFavs()}<h2 class="sec-title">Radios françaises</h2><div class="fr-radios">${Src.FR_STATIONS.map((n, i) => `<button class="fr-radio" data-act="radio-name" data-name="${esc(n)}" style="--h:${placeholderHue(n)};--d:${i * 20}ms">${esc(n)}</button>`).join('')}</div><h2 class="sec-title">Genres</h2><div class="browse">${Src.RADIO_GENRES.map(([tag, l], i) => `<button class="browse-tile" data-act="radio-tag" data-tag="${esc(tag)}" data-label="${esc(l)}" style="--h:${placeholderHue(tag)};--d:${i * 25}ms"><b>${esc(l)}</b>${icon('radio')}</button>`).join('')}</div>
          <h2 class="sec-title">Les plus écoutées en France</h2><div class="list" id="top-radios"><div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div></div>`);
        const top = await Src.radioTop('FR', 25);
        if (seq !== searchSeq) return;
        const ts = top.map(x => remoteTrack(x, 'radio'));
        const key = registerList('radios-top', ts.map(t => t.id), 'Radios');
        $('#top-radios').innerHTML = ts.map((t, i) => onlineRow(t, i, key)).join('');
        return;
      }
      show('<div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div>');
      const res = await Src.radioSearch(q);
      const ts = res.map(x => remoteTrack(x, 'radio'));
      const key = registerList('radios-q', ts.map(t => t.id), 'Radios');
      return show(ts.length ? `<div class="list">${ts.map((t, i) => onlineRow(t, i, key)).join('')}</div>` : `<div class="no-res"><b>Aucune radio trouvée</b></div>`);
    }
    if (src === 'info') {
      if (S.pendingShow) { const q2 = S.pendingShow; S.pendingShow = null; return openFeatured(q2); }
      show(newsModule(true));
      return fillPodcastRows();
    }
    // YouTube
    const link = Src.parseYouTubeUrl(q);
    if (link?.list && S.settings.ytKey) {
      show('<div class="online-loading"><span class="dots"><i></i><i></i><i></i></span><p>Import de la playlist…</p></div>');
      const pl = await Src.ytPlaylist(S.settings.ytKey, link.list);
      const ts = pl.tracks.map(x => { const t = remoteTrack(x, 'yt'); t.saved = true; db.put('tracks', t); return t; });
      const p = { id: uid(), name: pl.name, trackIds: ts.map(t => t.id), createdAt: Date.now(), updatedAt: Date.now() };
      S.playlists.set(p.id, p); await db.put('playlists', p); bump();
      toast(`Playlist « ${pl.name} » importée : ${plural(ts.length, 'titre')}`);
      S.pendingFwd = true; return goto('#/playlist/' + p.id);
    }
    if (link?.video) {
      const info = S.settings.ytKey ? (await Src.ytVideos(S.settings.ytKey, [link.video]))[0] : await Src.ytInfoNoKey(link.video);
      const t = remoteTrack(info || { ytId: link.video, title: 'Vidéo YouTube' }, 'yt');
      const key = registerList('yt-link', [t.id], t.title);
      show(`<div class="list">${onlineRow(t, 0, key)}</div>${link.list ? '<p class="hint">Ajoute ta clé YouTube dans les Réglages pour importer la playlist entière.</p>' : ''}`);
      playIds([t.id], 0, { context: { label: 'YouTube' } });
      return;
    }
    if (!S.settings.ytKey) {
      return show(`<div class="yt-nokey">${icon('search')}<b>Recherche YouTube</b>
        <p>Pour chercher n'importe quel son, ajoute ta clé YouTube gratuite (5 min, une seule fois).</p>
        <button class="btn primary" data-act="yt-key">Ajouter ma clé</button>
        <p class="hint">Déjà possible sans clé : colle un lien YouTube (partager → copier le lien) dans la barre de recherche.</p></div>
        ${savedOnline()}`);
    }
    if (!q) return show(savedOnline() || `<div class="no-res"><b>Cherche un artiste ou un titre</b><p>Tout YouTube est là.</p></div>`);
    show('<div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div>');
    const res = await Src.ytSearch(S.settings.ytKey, q);
    const ts = res.map(x => remoteTrack(x, 'yt'));
    const key = registerList('yt-q', ts.map(t => t.id), `YouTube « ${q} »`);
    show(ts.length ? `<div class="list">${ts.map((t, i) => onlineRow(t, i, key)).join('')}</div>` : `<div class="no-res"><b>Aucun résultat</b></div>`);
  } catch (e) {
    show(`<div class="no-res"><b>Impossible de charger</b><p>${esc(e.message || 'Vérifie ta connexion.')}</p></div>`);
  }
}

function savedOnline() {
  const ts = allTracks().filter(t => t.source === 'yt').sort((a, b) => (b.lastPlayed || b.addedAt) - (a.lastPlayed || a.addedAt)).slice(0, 30);
  if (!ts.length) return '';
  const key = registerList('yt-saved', ts.map(t => t.id), 'YouTube');
  return `<h2 class="sec-title">Tes sons YouTube</h2><div class="list">${ts.map((t, i) => onlineRow(t, i, key)).join('')}</div>`;
}
function radioFavs() {
  const ts = savedRadios();
  if (!ts.length) return '';
  const key = registerList('radios-fav', ts.map(t => t.id), 'Mes radios');
  return `<h2 class="sec-title">Mes radios</h2><div class="list">${ts.map((t, i) => onlineRow(t, i, key)).join('')}</div>`;
}

async function playRadioByName(name, btn) {
  btn?.classList.add('loading');
  try {
    const st = await Src.radioByName(name);
    if (!st) return toast(`${name} introuvable`);
    const t = remoteTrack(st, 'radio');
    playIds([t.id], 0, { context: { label: 'Radio' } });
    toast(`${t.title} en direct`);
    return `Je lance ${t.title} en direct.`;
  } catch (e) { toast(e.message || 'Radios indisponibles'); }
  finally { btn?.classList.remove('loading'); }
}

// ---------- Module Infos ----------
function newsModule(full) {
  const flash = Src.NEWS_FLASH.map((f, i) => `<button class="flash ${i ? 'alt' : ''}" data-act="news-flash" data-i="${i}">${icon('play')}<span><b>${esc(f.label)}</b><small>Dernière édition</small></span></button>`).join('');
  const stations = Src.NEWS_STATIONS.map((n, i) => `<button class="station news" data-act="radio-name" data-name="${esc(n)}" style="--h:${placeholderHue(n)};--d:${i * 25}ms"><span class="st-wave"><i></i><i></i><i></i></span><b>${esc(n)}</b><small>En direct</small></button>`);
  const feat = Src.FEATURED_PODCASTS.map((p, i) => `<button class="feat" data-act="feat-pc" data-q="${esc(p.q)}" style="--h:${placeholderHue(p.name)};--d:${i * 30}ms"><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></button>`);
  const cats = full ? Src.PODCAST_CATEGORIES.map(c => {
    const items = c.items.map((p, i) => `<button class="feat" data-act="feat-pc" data-q="${esc(p.q)}" style="--h:${placeholderHue(p.name)};--d:${i * 30}ms"><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></button>`);
    const more = `<button class="feat more" data-act="pc-more" data-q="${esc(c.more)}" data-name="${esc(c.name)}"><b>Plus de ${esc(c.name.toLowerCase())}</b>${icon('next-up')}</button>`;
    return `<section class="shelf"><div class="shelf-head"><h2>${esc(c.name)}</h2></div><div class="shelf-row" ${c.search ? `data-fill="${esc(c.search.join('|'))}"` : ''}>${items.join('')}${c.search ? '<div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div>' : ''}${more}</div></section>`;
  }).join('') : shelf('Podcasts à écouter', feat);
  return `<section class="shelf news-mod"><div class="shelf-head"><h2>${icon('radio')} Les infos</h2></div>
      <div class="flash-row">${flash}</div></section>
    ${shelf('Infos en direct', stations)}
    ${full ? podcastFavs() : ''}
    ${cats}`;
}

// Remplit les catégories sans sélection fixe (ex. horreur) avec les émissions les plus populaires
async function fillPodcastRows() {
  for (const row of $$('[data-fill]')) {
    const terms = row.dataset.fill.split('|');
    row.removeAttribute('data-fill');
    const seen = new Set(), out = [];
    for (const term of terms) {
      try { for (const p of await Src.podcastSearch(term, 8)) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); } } catch { /* hors ligne */ }
    }
    row.querySelector('.online-loading')?.remove();
    row.insertAdjacentHTML('afterbegin', out.slice(0, 12).map((p, i) => `<button class="feat art" data-act="pc-show" data-id="${p.id}" style="--d:${i * 30}ms">${p.art ? `<img src="${esc(p.art)}" alt="" loading="lazy">` : ''}<b>${esc(p.name)}</b><small>${esc(p.author)}</small></button>`).join(''));
  }
}

async function morePodcasts(q, name) {
  $('#results').innerHTML = '<div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div>';
  try {
    const res = await Src.podcastSearch(q, 30);
    $('#results').innerHTML = `<button class="link back-link" data-act="src" data-src="info">${icon('back')} Les infos</button><h2 class="sec-title">${esc(name)}</h2>` +
      (res.length ? `<div class="pc-grid">${res.map((p, i) => `<button class="pc-card" data-act="pc-show" data-id="${p.id}" style="--d:${Math.min(i, 12) * 30}ms"><img src="${esc(p.art)}" alt="" loading="lazy"><b>${esc(p.name)}</b><small>${esc(p.author)}</small></button>`).join('')}</div>` : '<div class="no-res"><b>Rien trouvé</b></div>');
  } catch (e) { $('#results').innerHTML = `<div class="no-res"><b>Podcasts indisponibles</b><p>${esc(e.message)}</p></div>`; }
}

async function playNewsFlash(i, btn) {
  const f = Src.NEWS_FLASH[i];
  btn?.classList.add('loading');
  try {
    const show = await Src.findShow(f.q);
    if (!show) throw new Error('Flash info introuvable');
    const p = await Src.podcastEpisodes(show.id, 3);
    if (!p.episodes.length) throw new Error('Pas d\'édition disponible');
    const t = remoteTrack(p.episodes[0], 'podcast');
    playIds([t.id], 0, { context: { label: f.label } });
    toast(`${f.label} · ${t.title}`);
    return `Voici ${f.label}.`;
  } catch (e) { toast(e.message || 'Infos indisponibles'); return null; }
  finally { btn?.classList.remove('loading'); }
}

async function openFeatured(q) {
  $('#results').innerHTML = '<div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div>';
  try {
    const show = await Src.findShow(q);
    if (!show) throw new Error('Podcast introuvable');
    await showPodcast(show.id);
    $('#results')?.insertAdjacentHTML('afterbegin', `<button class="link back-link" data-act="src" data-src="info">${icon('back')} Les infos</button>`);
  } catch (e) {
    $('#results').innerHTML = `<div class="no-res"><b>Indisponible</b><p>${esc(e.message)}</p></div>`;
  }
}

function podcastFavs() {
  const ts = [...S.tracks.values()].filter(t => t.source === 'podcast' && t.saved).sort((a, b) => (b.lastPlayed || b.addedAt) - (a.lastPlayed || a.addedAt));
  if (!ts.length) return '';
  const key = registerList('pc-saved', ts.map(t => t.id), 'Mes épisodes');
  return `<h2 class="sec-title">Mes épisodes</h2><div class="list">${ts.map((t, i) => onlineRow(t, i, key)).join('')}</div>`;
}

async function showPodcast(id) {
  const seq = ++searchSeq;
  $('#results').innerHTML = '<div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div>';
  try {
    const p = await Src.podcastEpisodes(id);
    if (seq !== searchSeq) return;
    const ts = p.episodes.map(x => remoteTrack(x, 'podcast'));
    const key = registerList('pc-' + id, ts.map(t => t.id), p.name);
    $('#results').innerHTML = `<div class="pc-head">${p.art ? `<img src="${esc(p.art)}" alt="">` : ''}<div><b>${esc(p.name)}</b><small>${esc(p.author)} · ${plural(ts.length, 'épisode')}</small></div></div>` +
      (ts.length ? `<div class="list">${ts.map((t, i) => onlineRow(t, i, key)).join('')}</div>` : '<div class="no-res"><b>Aucun épisode disponible</b></div>');
  } catch (e) {
    $('#results').innerHTML = `<div class="no-res"><b>Podcast indisponible</b><p>${esc(e.message)}</p></div>`;
  }
}

async function showRadios(tag, label) {
  const seq = ++searchSeq;
  $('#results').innerHTML = `<h2 class="sec-title">${esc(label)}</h2><div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div>`;
  try {
    const res = await Src.radioByTag(tag);
    if (seq !== searchSeq) return;
    const ts = res.map(x => remoteTrack(x, 'radio'));
    const key = registerList('radios-' + tag, ts.map(t => t.id), 'Radio ' + label);
    $('#results').innerHTML = `<button class="link back-link" data-act="src" data-src="radio">${icon('back')} Tous les genres</button><h2 class="sec-title">${esc(label)}</h2>` +
      (ts.length ? `<div class="list">${ts.map((t, i) => onlineRow(t, i, key)).join('')}</div>` : '<div class="no-res"><b>Aucune radio</b></div>');
  } catch (e) {
    $('#results').innerHTML = `<div class="no-res"><b>Radios indisponibles</b><p>${esc(e.message)}</p></div>`;
  }
}
// ======================================================================
// Vues
// ======================================================================
function registerList(key, ids, label, extra = {}) {
  S.lists[key] = { ids, label, ...extra };
  return key;
}

function trackRow(t, i, listKey, { num = false, showCover = true } = {}) {
  const playing = t.id === player.currentId;
  return `<div class="row ${playing ? 'playing' : ''}" data-tid="${t.id}" data-i="${i}" data-list="${listKey}" style="--d:${Math.min(i, 14) * 22}ms">
    ${num ? `<span class="num">${t.track || i + 1}</span>` : ''}
    ${showCover ? trackCover(t) : ''}
    <div class="row-meta"><b><span class="eq"><i></i><i></i><i></i></span>${esc(t.title)}</b><small>${t.liked ? `<span class="like-mark on">${icon('heart-f')}</span>` : '<span class="like-mark">' + icon('heart-f') + '</span>'}${esc(artistOf(t))}${num ? '' : t.album ? ' · ' + esc(t.album) : ''}</small></div>
    <button class="ib sm more" aria-label="Options">${icon('more')}</button>
  </div>`;
}

function card(href, coverHtml, title, sub, { round = false, play } = {}) {
  return `<a class="card ${round ? 'round' : ''}" href="${href}">
    <div class="card-art">${coverHtml}${play ? `<button class="card-play" data-act="play-list" data-list="${play}" aria-label="Lire">${icon('play')}</button>` : ''}</div>
    <b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</a>`;
}
const albumCard = a => card('#/album/' + encodeURIComponent(a.key), cover({ coverId: a.coverId, seed: a.title, kind: 'album' }), a.title, a.artist,
  { play: registerList('al:' + a.key, a.tracks.map(t => t.id), a.title, { route: '#/album/' + encodeURIComponent(a.key) }) });
const artistCard = a => card('#/artist/' + encodeURIComponent(a.name), cover({ coverId: a.coverId, seed: a.name, kind: 'artist' }), a.name, 'Artiste', { round: true });
const playlistCard = p => card('#/playlist/' + p.id, playlistCover(p), p.name, plural(p.trackIds.length, 'titre'),
  { play: registerList('pl:' + p.id, p.trackIds.filter(id => S.tracks.has(id)), p.name) });

function shelf(title, items, more) {
  if (!items.length) return '';
  return `<section class="shelf"><div class="shelf-head"><h2>${esc(title)}</h2>${more ? `<a href="${more}">Tout afficher</a>` : ''}</div><div class="shelf-row">${items.join('')}</div></section>`;
}

function emptyState() {
  return `<div class="empty">
    <div class="empty-art"><div class="disc"></div><span class="eq big"><i></i><i></i><i></i><i></i></span></div>
    <h2>Ta musique, chez toi.</h2>
    <p>Écoute directement YouTube et des milliers de radios, ou importe les fichiers de ton téléphone pour les avoir hors ligne.</p>
    <div class="empty-btns">
      <a class="btn primary" href="#/search?src=yt">${icon('search')} Chercher sur YouTube</a>
      <a class="btn ghost" href="#/search?src=radio">${icon('radio')} Écouter la radio</a>
      <button class="btn ghost" data-act="import">${icon('import')} Importer mes fichiers</button>
    </div>
  </div>`;
}

function greeting() {
  const h = new Date().getHours();
  const g = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  return S.settings.name ? `${g}, ${esc(S.settings.name)}` : g;
}

function viewHome() {
  const tracks = allTracks();
  const head = `<header class="page-head home-head"><div><div class="brand-line"><svg><use href="#i-logo"/></svg><span>MAISON <b>CHAHYN</b></span></div><h1>${greeting()}</h1></div>
    <div class="head-btns"><button class="ib gold-ib" data-act="voice" aria-label="Commande vocale">${icon('mic')}</button><button class="ib" data-act="import" aria-label="Importer">${icon('plus')}</button><a class="ib" href="#/settings" aria-label="Réglages">${icon('gear')}</a></div></header>`;
  const discover = homeDiscover();
  if (!tracks.length) return head + discover.top + discover.rest + `<section class="import-card">${icon('import')}<div><b>Tes propres fichiers</b><small>Importe des MP3 du téléphone pour les écouter hors ligne.</small></div><button class="btn ghost sm" data-act="import">Importer</button></section>`;

  const al = [...albums().values()];
  const pls = [...S.playlists.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const lk = liked();

  // tuiles rapides
  const quick = [];
  if (lk.length) quick.push(`<a class="quick" href="#/liked">${likedCover()}<b>Titres likés</b></a>`);
  pls.slice(0, 3).forEach(p => quick.push(`<a class="quick" href="#/playlist/${p.id}">${playlistCover(p)}<b>${esc(p.name)}</b></a>`));
  al.filter(a => a.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).forEach(a => {
    if (quick.length < 6) quick.push(`<a class="quick" href="#/album/${encodeURIComponent(a.key)}">${cover({ coverId: a.coverId, seed: a.title, kind: 'album' })}<b>${esc(a.title)}</b></a>`);
  });
  if (quick.length < 6) quick.push(`<a class="quick" href="#/all">${cover({ seed: 'tous', kind: 'playlist' })}<b>Tous les titres</b></a>`);

  const allKey = registerList('all-shuffle', tracks.map(t => t.id), 'Toute ta musique');

  const recent = tracks.filter(t => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 12);
  const recentKey = registerList('recent', recent.map(t => t.id), 'Écoutés récemment');
  const recentCards = recent.map((t, i) => `<div class="card track-card" data-tid="${t.id}" data-i="${i}" data-list="${recentKey}"><div class="card-art">${trackCover(t)}</div><b>${esc(t.title)}</b><small>${esc(artistOf(t))}</small></div>`);

  const newAlbums = al.sort((a, b) => b.addedAt - a.addedAt).slice(0, 12).map(albumCard);
  const newSingles = tracks.filter(t => !t.album).sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
  const singlesKey = registerList('new-singles', newSingles.map(t => t.id), 'Ajoutés récemment');
  const singleCards = newSingles.map((t, i) => `<div class="card track-card" data-tid="${t.id}" data-i="${i}" data-list="${singlesKey}"><div class="card-art">${trackCover(t)}</div><b>${esc(t.title)}</b><small>${esc(artistOf(t))}</small></div>`);
  const arts = [...artists().values()].sort((a, b) => b.plays - a.plays || b.tracks.length - a.tracks.length).slice(0, 12).map(artistCard);
  const top = tracks.filter(t => t.plays).sort((a, b) => b.plays - a.plays).slice(0, 5);
  const topKey = registerList('top', top.map(t => t.id), 'Tes titres les plus écoutés');

  return head + discover.top + `
    <div class="quick-grid">${quick.join('')}</div>
    <button class="mix-btn" data-act="shuffle-list" data-list="${allKey}">${icon('shuffle')}<span><b>Lecture aléatoire</b><small>${plural(tracks.length, 'titre')} · ${fmtTotal(tracks.reduce((s, t) => s + t.duration, 0))}</small></span>${icon('play', 'mix-play')}</button>
    ${tracks.length >= 4 ? shelf(`Composé pour toi${S.settings.name ? ', ' + S.settings.name : ''}`, HOME_MIXES.map(k => mixCard(getMix(k)))) : ''}
    ${shelf('Écoutés récemment', recentCards)}
    ${shelf('Albums ajoutés récemment', newAlbums, '#/library?f=albums')}
    ${shelf('Titres ajoutés récemment', singleCards, '#/all')}
    ${shelf('Tes artistes', arts, '#/library?f=artists')}
    ${pls.length ? shelf('Tes playlists', pls.slice(0, 12).map(playlistCard), '#/library?f=playlists') : ''}
    ${top.length ? `<section class="shelf"><div class="shelf-head"><h2>Tes titres les plus écoutés</h2></div><div class="list">${top.map((t, i) => trackRow(t, i, topKey)).join('')}</div></section>` : ''}
  ` + discover.rest;
}

// Sections « découverte » de l'accueil : utiles même sans aucune musique importée
function homeDiscover() {
  const anyRecent = [...S.tracks.values()].filter(t => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 14);
  const rk = registerList('home-recent', anyRecent.map(t => t.id), 'Écoutés récemment');
  const recentCards = anyRecent.map((t, i) => `<div class="card track-card ${t.source === 'radio' ? 'radio-card' : ''}" data-tid="${t.id}" data-i="${i}" data-list="${rk}"><div class="card-art">${trackCover(t, t.source === 'radio' ? 'radio-cv' : '')}${t.source === 'radio' ? '<span class="live-dot card-live">LIVE</span>' : ''}</div><b>${esc(t.title)}</b><small>${esc(t.source === 'radio' ? 'Radio' : t.source === 'podcast' ? 'Podcast' : artistOf(t))}</small></div>`);
  const radios = savedRadios();
  const radiosKey = registerList('home-radios', radios.map(t => t.id), 'Mes radios');
  const top = `
    <a class="home-search" href="#/search?src=yt">${icon('search')}<span>Que veux-tu écouter ?</span></a>
    ${anyRecent.length ? shelf('Reprendre', recentCards) : ''}`;
  const stations = Src.FR_STATIONS.slice(0, 14).map((n, i) => `<button class="station" data-act="radio-name" data-name="${esc(n)}" style="--h:${placeholderHue(n)};--d:${i * 25}ms"><span class="st-wave"><i></i><i></i><i></i></span><b>${esc(n)}</b><small>En direct</small></button>`);
  const rest = `
    ${radios.length ? shelf('Mes radios', radios.map((t, i) => `<div class="card track-card radio-card" data-tid="${t.id}" data-i="${i}" data-list="${radiosKey}"><div class="card-art">${trackCover(t, 'radio-cv')}<span class="live-dot card-live">LIVE</span></div><b>${esc(t.title)}</b><small>Radio</small></div>`)) : ''}
    ${shelf('Radios en direct', stations, '#/search?src=radio')}
    <section class="shelf yt-promo">
      <div class="yt-promo-in">${icon('play')}<div><b>Tout YouTube dans ta Maison</b><small>${S.settings.ytKey ? 'Cherche n\'importe quel artiste, garde tes sons, crée tes playlists.' : 'Ajoute ta clé gratuite pour chercher n\'importe quel son.'}</small></div></div>
      <a class="btn primary sm" href="${S.settings.ytKey ? '#/search?src=yt' : '#/settings'}">${S.settings.ytKey ? 'Chercher' : 'Configurer'}</a>
    </section>
    ${newsModule(false)}`;
  return { top, rest };
}

function viewSearch(params) {
  if (params?.get('src')) S.settings.searchSrc = params.get('src');
  if (S.settings.searchSrc === 'podcast') S.settings.searchSrc = 'info';
  const src = S.settings.searchSrc || 'yt';
  const ph = { yt: 'Artiste, titre, ou colle un lien YouTube', radio: 'Nom d\'une radio (Skyrock, NRJ…)',  info: 'Les infos du moment', lib: 'Dans ta bibliothèque…' }[src];
  return `<header class="page-head"><h1>Rechercher</h1></header>
    <div class="search-sticky"><div class="search-box">${icon('search')}<input type="search" id="q" placeholder="${ph}" value="${esc(S.searchQ)}" autocomplete="off" enterkeyhint="search"><button class="ib sm clear-q" aria-label="Effacer" ${S.searchQ ? '' : 'hidden'}>${icon('close')}</button></div>
    <div class="chips src-chips">${[['yt', 'YouTube'], ['radio', 'Radios'], ['info', 'Infos'], ['lib', 'Ma bibliothèque']].map(([k, l]) => `<button class="chip ${k === src ? 'on' : ''}" data-act="src" data-src="${k}">${l}</button>`).join('')}</div></div>
    <div id="results">${src === 'lib' ? searchResults(S.searchQ) : '<div class="online-loading"><span class="dots"><i></i><i></i><i></i></span></div>'}</div>`;
}

function searchResults(q) {
  const nq = norm(q.trim());
  if (!allTracks().length) return `<div class="no-res"><b>Ta bibliothèque est vide</b><p>Cherche sur YouTube ou importe tes fichiers.</p></div>`;
  if (!nq) {
    const genres = new Map();
    for (const t of allTracks()) if (t.genre) genres.set(t.genre, (genres.get(t.genre) || 0) + 1);
    const tiles = genres.size >= 3
      ? [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([g]) => ({ label: g, href: '#/genre/' + encodeURIComponent(g), seed: g }))
      : [...artists().values()].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 16).map(a => ({ label: a.name, href: '#/artist/' + encodeURIComponent(a.name), seed: a.name, coverId: a.coverId }));
    return `<h2 class="sec-title">${genres.size >= 3 ? 'Parcourir par genre' : 'Parcourir tes artistes'}</h2>
      <div class="browse">${tiles.map((x, i) => `<a class="browse-tile" href="${x.href}" style="--h:${placeholderHue(x.seed)};--d:${i * 30}ms"><b>${esc(x.label)}</b>${x.coverId ? `<img src="${coverURL(x.coverId)}" alt="">` : ''}</a>`).join('')}</div>`;
  }
  const words = nq.split(/\s+/);
  const match = s => { const n = norm(s); return words.every(w => n.includes(w)); };
  const tr = allTracks().filter(t => match(`${t.title} ${t.artist} ${t.album} ${t.genre}`)).slice(0, 50);
  const ar = [...artists().values()].filter(a => match(a.name)).slice(0, 12);
  const al = [...albums().values()].filter(a => match(`${a.title} ${a.artist}`)).slice(0, 12);
  const pl = [...S.playlists.values()].filter(p => match(p.name)).slice(0, 12);
  if (!tr.length && !ar.length && !al.length && !pl.length) return `<div class="no-res"><b>Aucun résultat pour « ${esc(q)} »</b><p>Vérifie l'orthographe ou essaie d'autres mots.</p></div>`;
  const key = registerList('search', tr.map(t => t.id), `Recherche « ${q} »`);
  return `${tr.length ? `<h2 class="sec-title">Titres</h2><div class="list">${tr.map((t, i) => trackRow(t, i, key)).join('')}</div>` : ''}
    ${shelf('Artistes', ar.map(artistCard))}
    ${shelf('Albums', al.map(albumCard))}
    ${shelf('Playlists', pl.map(playlistCard))}`;
}

function viewLibrary(params) {
  const f = params.get('f') || S.settings.libFilter;
  S.settings.libFilter = f; saveSettings();
  const sort = S.settings.libSort;
  const chips = [['all', 'Tout'], ['playlists', 'Playlists'], ['albums', 'Albums'], ['artists', 'Artistes'], ['tracks', 'Titres']];
  const items = [];
  const byName = (a, b) => collator.compare(a.sortName, b.sortName);
  const byRecent = (a, b) => b.at - a.at;
  if (f === 'all' || f === 'playlists') {
    if (liked().length || f === 'playlists') items.push({ pin: true, html: libItem('#/liked', likedCover(), 'Titres likés', `Playlist · ${plural(liked().length, 'titre')}`) });
    for (const p of S.playlists.values()) items.push({ sortName: p.name, at: p.updatedAt, html: libItem('#/playlist/' + p.id, playlistCover(p), p.name, `Playlist · ${plural(p.trackIds.length, 'titre')}`) });
  }
  if (f === 'all' || f === 'albums') for (const a of albums().values()) items.push({ sortName: a.title, at: Math.max(a.addedAt, a.lastPlayed), html: libItem('#/album/' + encodeURIComponent(a.key), cover({ coverId: a.coverId, seed: a.title, kind: 'album' }), a.title, `Album · ${a.artist}`) });
  if (f === 'all' || f === 'artists') for (const a of artists().values()) items.push({ sortName: a.name, at: a.addedAt, html: libItem('#/artist/' + encodeURIComponent(a.name), cover({ coverId: a.coverId, seed: a.name, kind: 'artist' }), a.name, 'Artiste', true) });
  let body;
  if (f === 'tracks') {
    const tr = allTracks().slice().sort(sort === 'az' ? (a, b) => collator.compare(a.title, b.title) : (a, b) => b.addedAt - a.addedAt);
    const key = registerList('lib-tracks', tr.map(t => t.id), 'Tous les titres', { route: '#/all' });
    body = tr.length ? `<div class="list">${tr.map((t, i) => trackRow(t, i, key)).join('')}</div>` : '';
  } else {
    const pinned = items.filter(i => i.pin);
    const rest = items.filter(i => !i.pin).sort(sort === 'az' ? byName : byRecent);
    body = `<div class="lib-list">${[...pinned, ...rest].map((x, i) => x.html.replace('style="', `style="--d:${Math.min(i, 14) * 22}ms;`)).join('')}</div>`;
  }
  return `<header class="page-head"><h1>Bibliothèque</h1>
      <div class="head-btns"><button class="ib" data-act="new-playlist" aria-label="Nouvelle playlist">${icon('list-add')}</button><button class="ib" data-act="import" aria-label="Importer">${icon('import')}</button><a class="ib" href="#/settings" aria-label="Réglages">${icon('gear')}</a></div></header>
    <div class="chips">${chips.map(([k, l]) => `<a class="chip ${k === f ? 'on' : ''}" href="#/library?f=${k}">${l}</a>`).join('')}</div>
    <div class="sort-row"><button class="link" data-act="sort">${icon('sort')} ${sort === 'az' ? 'Ordre alphabétique' : 'Récents'}</button></div>
    ${allTracks().length ? body : emptyState()}`;
}
function libItem(href, cov, title, sub, round = false) {
  return `<a class="lib-item ${round ? 'round' : ''}" href="${href}" style="">${cov}<div><b>${esc(title)}</b><small>${esc(sub)}</small></div></a>`;
}

function collectionView({ kind, title, sub, coverHtml, ids, listKey, label, color, actions = '', extra = '', num = false, emptyMsg }) {
  const tracks = ids.map(id => S.tracks.get(id)).filter(Boolean);
  registerList(listKey, tracks.map(t => t.id), label, { route: location.hash, ...(kind === 'playlist' ? { playlistId: listKey.slice(3) } : {}) });
  const total = tracks.reduce((s, t) => s + t.duration, 0);
  return `<div class="coll ${kind}" style="--tint:${color}">
    <div class="topbar"><button class="ib" data-act="back" aria-label="Retour">${icon('back')}</button><b class="topbar-title">${esc(title)}</b></div>
    <div class="coll-hero">
      <div class="coll-cover">${coverHtml}</div>
      <h1 class="coll-title">${esc(title)}</h1>
      <div class="coll-sub">${sub}</div>
      <div class="coll-meta">${tracks.length ? `${plural(tracks.length, 'titre')} · ${fmtTotal(total)}` : ''}</div>
    </div>
    <div class="coll-actions">
      ${actions}
      <span class="spacer"></span>
      ${tracks.length ? `<button class="ib shuffle-btn" data-act="shuffle-list" data-list="${listKey}" aria-label="Aléatoire">${icon('shuffle')}</button>
      <button class="hero-play" data-act="play-list" data-list="${listKey}" aria-label="Lire">${icon('play')}</button>` : ''}
    </div>
    ${tracks.length ? `<div class="list">${tracks.map((t, i) => trackRow(t, i, listKey, { num, showCover: !num })).join('')}</div>` : `<p class="coll-empty">${emptyMsg || 'Aucun titre.'}</p>`}
    ${extra}
  </div>`;
}

function viewAlbum(key) {
  const a = albums().get(key);
  if (!a) return notFound();
  return collectionView({
    kind: 'album', title: a.title,
    sub: `<a href="#/artist/${encodeURIComponent(a.artist)}">${cover({ coverId: a.coverId, seed: a.artist, kind: 'artist' }, 'xs round')}${esc(a.artist)}</a>`,
    coverHtml: cover({ coverId: a.coverId, seed: a.title, kind: 'album' }),
    ids: a.tracks.map(t => t.id), listKey: 'al:' + a.key, label: a.title,
    color: colorFor(a.coverId, a.title), coverId: a.coverId, num: true,
    extra: a.year ? `<p class="coll-foot">${esc(a.year)}</p>` : '',
  });
}

function viewArtist(name) {
  const a = artists().get(name);
  if (!a) return notFound();
  const pop = a.tracks.slice().sort((x, y) => (y.plays || 0) - (x.plays || 0) || y.addedAt - x.addedAt);
  const theirAlbums = [...albums().values()].filter(al => al.artist === name || al.tracks.some(t => artistOf(t) === name));
  return collectionView({
    kind: 'artist', title: a.name, sub: `${plural(theirAlbums.length, 'album')}`,
    coverHtml: cover({ coverId: a.coverId, seed: a.name, kind: 'artist' }),
    ids: pop.map(t => t.id), listKey: 'ar:' + name, label: a.name,
    color: colorFor(a.coverId, a.name),
    extra: shelf('Albums', theirAlbums.map(albumCard)),
  });
}

function viewPlaylist(id) {
  const p = S.playlists.get(id);
  if (!p) return notFound();
  const firstCover = p.trackIds.map(i => S.tracks.get(i)?.coverId).find(Boolean);
  return collectionView({
    kind: 'playlist', title: p.name, sub: 'Playlist',
    coverHtml: playlistCover(p), ids: p.trackIds, listKey: 'pl:' + p.id, label: p.name,
    color: colorFor(firstCover, p.name),
    actions: `<button class="ib" data-act="pl-add" data-id="${p.id}" aria-label="Ajouter des titres">${icon('plus')}</button><button class="ib" data-act="pl-more" data-id="${p.id}" aria-label="Options">${icon('more')}</button>`,
    emptyMsg: `Ta playlist est vide.<br><button class="btn primary" data-act="pl-add" data-id="${p.id}">${icon('plus')} Ajouter des titres</button>`,
  });
}

function viewLiked() {
  const lk = liked();
  return collectionView({
    kind: 'liked', title: 'Titres likés', sub: 'Playlist', coverHtml: likedCover(),
    ids: lk.map(t => t.id), listKey: 'liked', label: 'Titres likés', color: 'hsl(258 60% 38%)',
    emptyMsg: 'Appuie sur le cœur d\'un titre pour le retrouver ici.',
  });
}

function viewAll() {
  const tr = allTracks().slice().sort((a, b) => collator.compare(a.title, b.title));
  return collectionView({
    kind: 'all', title: 'Tous les titres', sub: 'Ta bibliothèque', coverHtml: cover({ seed: 'tous', kind: 'playlist' }),
    ids: tr.map(t => t.id), listKey: 'all', label: 'Tous les titres', color: colorFor(null, 'tous'),
  });
}

function viewGenre(g) {
  const tr = allTracks().filter(t => t.genre === g).sort((a, b) => collator.compare(a.artist, b.artist));
  return collectionView({
    kind: 'genre', title: g, sub: 'Genre', coverHtml: cover({ seed: g, kind: 'playlist' }),
    ids: tr.map(t => t.id), listKey: 'g:' + g, label: g, color: colorFor(null, g),
  });
}

function viewSettings() {
  return `<div class="coll settings" style="--tint:#2a2540">
    <div class="topbar show"><button class="ib" data-act="back" aria-label="Retour">${icon('back')}</button><b class="topbar-title">Réglages</b></div>
    <div class="set-wrap">
    <h1 class="set-h">Réglages</h1>
    <section class="set-group"><h3>Lecture</h3>
      <div class="set-item"><div><b>Fondu enchaîné</b><small>${isIOS ? 'Non disponible sur iPhone (le volume est verrouillé par iOS).' : 'Les titres se mélangent en douceur à la transition.'}</small></div><output id="cf-val">${S.settings.crossfade ? S.settings.crossfade + ' s' : 'Désactivé'}</output></div>
      ${isIOS ? '' : `<input type="range" class="range" id="cf" min="0" max="12" step="1" value="${S.settings.crossfade}">`}
      ${isIOS ? '' : `<label class="set-item toggle"><div><b>Visualiseur animé</b><small>Ondes autour de la pochette qui suivent la musique.</small></div><input type="checkbox" id="viz" ${S.settings.visualizer ? 'checked' : ''}><span class="sw"></span></label>`}
    </section>
    <section class="set-group"><h3>Toi</h3>
      <label class="set-item"><div><b>Ton prénom</b><small>Pour que l'app te parle à toi</small></div><input class="set-input" id="set-name" value="${esc(S.settings.name)}" maxlength="30" autocomplete="given-name"></label>
    </section>
    <section class="set-group"><h3>YouTube</h3>
      <label class="set-item col"><div><b>Clé YouTube (gratuite)</b><small>Pour chercher sur YouTube et importer tes playlists. Sans clé, tu peux déjà coller un lien YouTube dans la recherche.</small></div><input class="set-input wide" id="set-yt" type="password" value="${esc(S.settings.ytKey)}" placeholder="AIza…" autocomplete="off"></label>
      <details class="set-help"><summary>Comment obtenir ma clé (5 min)</summary><ol>
        <li>Va sur <b>console.cloud.google.com</b> et connecte-toi avec ton compte Google.</li>
        <li>Crée un projet (nom au choix).</li>
        <li>Menu « API et services » → « Bibliothèque » → cherche <b>YouTube Data API v3</b> → <b>Activer</b>.</li>
        <li>« Identifiants » → « Créer des identifiants » → <b>Clé API</b>. Copie-la ici.</li>
        <li>Conseillé : restreins la clé à « YouTube Data API v3 ».</li>
      </ol><p>Gratuit, environ 100 recherches par jour. La clé reste sur ton téléphone.</p></details>
    </section>
    <section class="set-group"><h3>Son</h3>
      <button class="set-item btnlike" data-act="sound"><div><b>Volume et égaliseur</b><small>Basses, voix, aigus · ${esc(EQ_NAMES[S.settings.eq] || 'Normal')}</small></div>${icon('gear')}</button>
      <label class="set-item col"><div><b>Voix du Concierge</b><small>${Voice.canSpeak ? 'Choisis la voix qui te répond' : 'Synthèse vocale indisponible sur ce navigateur'}</small></div>
        <select class="set-select" id="set-vname"><option value="">Automatique (la plus naturelle)</option>${Voice.frenchVoices().map(v => `<option value="${esc(v.name)}" ${v.name === S.settings.voiceName ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        <div class="vol-row"><small>Lente</small><input type="range" class="range" id="set-vrate" min="0.8" max="1.4" step="0.05" value="${S.settings.voiceRate}"><small>Rapide</small></div>
        <button class="btn ghost sm" data-act="voice-test" type="button">Écouter la voix</button></label>
    </section>
    <section class="set-group"><h3>Anti-pub</h3>
      <label class="set-item toggle"><div><b>Sauter les pubs et passages hors sujet</b><small>YouTube : sponsors, autopromo, intros (base collaborative SponsorBlock). Podcasts : quand tu sautes la pub du début ou de la fin, l'app s'en souvient pour les épisodes suivants de la même émission.</small></div><input type="checkbox" id="set-ads" ${S.settings.skipAds ? 'checked' : ''}><span class="sw"></span></label>
    </section>
    <section class="set-group"><h3>Paroles</h3>
      <label class="set-item toggle"><div><b>Chercher les paroles en ligne</b><small>Paroles synchronisées gratuites (LRCLIB) quand ton fichier n'en contient pas. Seuls le titre et l'artiste sont envoyés.</small></div><input type="checkbox" id="set-lyr" ${S.settings.onlineLyrics ? 'checked' : ''}><span class="sw"></span></label>
      <p class="set-note">Tu peux aussi importer des fichiers <b>.lrc</b> avec le même nom que tes musiques, ou coller les paroles depuis le menu ⋯ d'un titre.</p>
    </section>
    <section class="set-group"><h3>Le Concierge (IA)</h3>
      <label class="set-item toggle"><div><b>Réponses à voix haute</b><small>${Voice.canListen ? 'Quand tu parles au Concierge (bouton micro), il te répond aussi à l\'oral.' : 'La commande vocale n\'est pas disponible sur ce navigateur.'}</small></div><input type="checkbox" id="set-voice" ${S.settings.voiceReply ? 'checked' : ''}><span class="sw"></span></label>
      <div class="set-item"><div><b>Analyse de ta musique</b><small id="ana-stat">…</small></div></div>
      <div class="set-item"><div><b>Historique d'écoute</b><small>${plural(AI.historySize(), 'écoute')} mémorisée${AI.historySize() > 1 ? 's' : ''} pour apprendre tes goûts</small></div><button class="link" data-act="clear-hist">Effacer</button></div>
      <label class="set-item col"><div><b>Clé API Claude (optionnel)</b><small>Sans clé, le Concierge fonctionne déjà hors ligne. Avec une clé Anthropic, il comprend n'importe quelle demande. La clé reste sur ton téléphone ; ta liste de titres est envoyée à Anthropic seulement quand tu parles au Concierge.</small></div><input class="set-input wide" id="set-key" type="password" value="${esc(S.settings.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
    </section>
    <section class="set-group"><h3>Bibliothèque</h3>
      <button class="set-item btnlike" data-act="import"><div><b>Importer de la musique</b><small>Fichiers ou dossier depuis ton téléphone</small></div>${icon('import')}</button>
      <div class="set-item"><div><b>Stockage utilisé</b><small id="storage">Calcul…</small></div></div>
      <button class="set-item btnlike danger" data-act="wipe"><div><b>Tout effacer</b><small>Supprime toute la musique et les playlists de l'application</small></div>${icon('trash')}</button>
    </section>
    <section class="set-group"><h3>Installer l'application</h3>
      <div class="set-text">
        <p><b>Android (Chrome)</b> : menu ⋮ → « Installer l'application » ou « Ajouter à l'écran d'accueil ».</p>
        <p><b>iPhone (Safari)</b> : bouton Partager → « Sur l'écran d'accueil ».</p>
        <p>Une fois installée, Maison Chahyn s'ouvre en plein écran et fonctionne sans connexion.</p>
        ${S.installPrompt ? `<button class="btn primary" data-act="install">${icon('import')} Installer maintenant</button>` : ''}
      </div>
    </section>
    <p class="about">Maison Chahyn · ta maison de la musique · aucune pub, aucun pistage. Ta musique ne quitte jamais ton téléphone.</p>
    </div></div>`;
}

function notFound() {
  return `<div class="coll"><div class="topbar show"><button class="ib" data-act="back">${icon('back')}</button></div><div class="no-res" style="padding-top:120px"><b>Introuvable</b><p>Cet élément n'existe plus.</p></div></div>`;
}

// ======================================================================
// Routeur avec transitions
// ======================================================================
const main = $('#main');
const TAB_ROUTES = ['home', 'search', 'ai', 'library'];

function parseRoute() {
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const name = parts[0] || 'home';
  return { name, arg: parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : null, params: new URLSearchParams(qs || ''), key: h };
}

function goto(hash, replace = false) {
  if (replace) location.replace(hash);
  else location.hash = hash;
}

function render(keepScroll = false) {
  const r = parseRoute();
  const prev = S.route;
  if (prev && !keepScroll) S.scroll[prev.key] = main.scrollTop;
  const sameView = keepScroll && prev && prev.key === r.key;
  const scrollTop = main.scrollTop;
  S.route = r;
  S.lists = {};
  let html;
  switch (r.name) {
    case 'search': html = viewSearch(r.params); break;
    case 'ai': html = viewAI(); break;
    case 'mix': html = viewMix(r.arg); break;
    case 'library': html = viewLibrary(r.params); break;
    case 'album': html = viewAlbum(r.arg); break;
    case 'artist': html = viewArtist(r.arg); break;
    case 'playlist': html = viewPlaylist(r.arg); break;
    case 'liked': html = viewLiked(); break;
    case 'all': html = viewAll(); break;
    case 'genre': html = viewGenre(r.arg); break;
    case 'settings': html = viewSettings(); break;
    default: html = viewHome();
  }
  const view = document.createElement('div');
  view.className = 'view';
  view.innerHTML = html;
  const old = $('#view');
  view.id = 'view';
  if (!sameView && prev) {
    const toTab = TAB_ROUTES.includes(r.name);
    view.classList.add(toTab && (S.navDir === 'fwd' || TAB_ROUTES.includes(prev.name)) ? 'enter-fade' : S.navDir === 'fwd' ? 'enter-fwd' : 'enter-back');
  }
  old.replaceWith(view);
  main.scrollTop = sameView ? scrollTop : (S.navDir === 'back' ? S.scroll[r.key] || 0 : 0);
  // onglet actif
  const tab = TAB_ROUTES.includes(r.name) ? r.name : (prev && TAB_ROUTES.includes(prev.name) ? prev.name : S.lastTab || 'home');
  S.lastTab = tab;
  $$('#tabs a').forEach(a => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('on', on);
    if (a.dataset.tab === 'home') a.querySelector('use').setAttribute('href', on ? '#i-home' : '#i-home-o');
  });
  afterRender(view, r);
  onScroll();
}

function afterRender(view, r) {
  // teintes des en-têtes de collection selon la pochette
  const coll = $('.coll', view);
  if (coll && r.name === 'album') { const a = albums().get(r.arg); if (a) tint(coll, a.coverId, a.title); }
  if (coll && r.name === 'artist') { const a = artists().get(r.arg); if (a) tint(coll, a.coverId, a.name); }
  if (coll && r.name === 'playlist') { const p = S.playlists.get(r.arg); const c = p?.trackIds.map(i => S.tracks.get(i)?.coverId).find(Boolean); if (c) tint(coll, c, p.name); }
  if (r.name === 'search') {
    const q = $('#q', view);
    const clr = $('.clear-q', view);
    let deb;
    q.addEventListener('input', () => {
      S.searchQ = q.value;
      clr.hidden = !q.value;
      if (S.settings.searchSrc === 'lib') { S.lists = {}; $('#results').innerHTML = searchResults(q.value); return; }
      clearTimeout(deb);
      deb = setTimeout(() => onlineSearch(q.value), Src.parseYouTubeUrl(q.value) ? 0 : 650);
    });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(deb); onlineSearch(q.value); q.blur(); } });
    if (S.settings.searchSrc !== 'lib') onlineSearch(S.searchQ);
    clr.addEventListener('click', () => { q.value = ''; q.dispatchEvent(new Event('input')); q.focus(); });
  }
  if (r.name === 'ai') afterAI(view);
  if (r.name === 'settings') {
    $('#set-name', view).addEventListener('change', e => { S.settings.name = e.target.value.trim(); saveSettings(); toast('Enchanté, ' + (S.settings.name || 'toi') + ' ✦'); });
    $('#set-yt', view).addEventListener('change', e => { S.settings.ytKey = e.target.value.trim(); saveSettings(); toast(S.settings.ytKey ? 'Clé YouTube enregistrée ✦' : 'Clé supprimée'); });
    $('#set-vname', view)?.addEventListener('change', e => { S.settings.voiceName = e.target.value; saveSettings(); Voice.setVoicePrefs({ name: S.settings.voiceName }); });
    const vr = $('#set-vrate', view);
    vr?.style.setProperty('--p', `${(S.settings.voiceRate - 0.8) / 0.6 * 100}%`);
    vr?.addEventListener('input', () => { S.settings.voiceRate = +vr.value; saveSettings(); Voice.setVoicePrefs({ rate: +vr.value }); vr.style.setProperty('--p', `${(vr.value - 0.8) / 0.6 * 100}%`); });
    $('#set-ads', view).addEventListener('change', e => { S.settings.skipAds = e.target.checked; saveSettings(); });
    $('#set-voice', view).addEventListener('change', e => { S.settings.voiceReply = e.target.checked; saveSettings(); });
    $('#set-lyr', view).addEventListener('change', e => { S.settings.onlineLyrics = e.target.checked; saveSettings(); });
    $('#set-key', view).addEventListener('change', e => { S.settings.apiKey = e.target.value.trim(); saveSettings(); toast(S.settings.apiKey ? 'Clé enregistrée sur ce téléphone' : 'Clé supprimée'); });
    const all = allTracksRaw(), done = all.filter(t => t.features).length;
    $('#ana-stat', view).textContent = all.length ? `${done} / ${all.length} titres analysés (tempo, énergie)${done < all.length ? ' · en cours…' : ' ✓'}` : 'Aucun titre';
    const cf = $('#cf', view);
    cf?.addEventListener('input', () => {
      S.settings.crossfade = +cf.value; player.crossfade = +cf.value; saveSettings();
      $('#cf-val').textContent = cf.value > 0 ? cf.value + ' s' : 'Désactivé';
      cf.style.setProperty('--p', `${cf.value / 12 * 100}%`);
    });
    cf?.style.setProperty('--p', `${S.settings.crossfade / 12 * 100}%`);
    $('#viz', view)?.addEventListener('change', e => {
      S.settings.visualizer = e.target.checked; player.visualizer = e.target.checked; saveSettings();
      if (e.target.checked && player.playing) player.ensureAudioGraph();
    });
    (async () => {
      const total = allTracksRaw().reduce((s, t) => s + (t.size || 0), 0);
      let txt = `${plural(S.tracks.size, 'titre')} · ${fmtSize(total)}`;
      try {
        const est = await navigator.storage?.estimate?.();
        if (est?.quota) txt += ` · ${fmtSize(est.quota)} disponibles au total`;
        const persisted = await navigator.storage?.persisted?.();
        if (persisted) txt += ' · stockage protégé ✓';
      } catch { /* ignore */ }
      const el = $('#storage'); if (el) el.textContent = txt;
    })();
  }
}

window.addEventListener('hashchange', () => {
  S.navDir = S.pendingFwd ? 'fwd' : 'back';
  S.navCount++;
  S.pendingFwd = false;
  render();
});

// Barre du haut qui apparaît en défilant dans une collection
function onScroll() {
  const coll = $('#view .coll');
  if (!coll) return;
  const y = main.scrollTop;
  const hero = $('.coll-hero', coll);
  const tb = $('.topbar', coll);
  const h = hero ? hero.offsetHeight : 200;
  tb.classList.toggle('show', y > h - 60 || coll.classList.contains('settings'));
  const cv = $('.coll-cover', coll);
  if (cv) {
    const p = Math.min(1, Math.max(0, y / (h * 0.8)));
    cv.style.transform = `scale(${1 - p * 0.25}) translateY(${y * 0.35}px)`;
    cv.style.opacity = 1 - p * 0.9;
  }
}
main.addEventListener('scroll', onScroll, { passive: true });

// ======================================================================
// Clics globaux (délégation)
// ======================================================================
document.addEventListener('click', e => {
  if (S.lpFired) { S.lpFired = false; e.preventDefault(); e.stopPropagation(); return; }
  const a = e.target.closest('a[href^="#"]');
  if (a && !e.target.closest('[data-act]')) {
    // navigation vers une vue plus profonde
    S.pendingFwd = true;
    if (a.getAttribute('href') === location.hash) { e.preventDefault(); main.scrollTo({ top: 0, behavior: 'smooth' }); }
    return;
  }
  const act = e.target.closest('[data-act]');
  if (act && !act.closest('#np')) {
    e.preventDefault();
    e.stopPropagation();
    const L = S.lists[act.dataset.list];
    switch (act.dataset.act) {
      case 'import': return importSheet();
      case 'new-playlist': return newPlaylistSheet();
      case 'back': return S.navCount > 0 ? history.back() : goto('#/library', true);
      case 'play-list': {
        if (!L?.ids.length) return;
        if (player.context?.label === L.label && L.ids.includes(player.currentId)) return player.toggle();
        return playIds(L.ids, 0, { context: { label: L.label, route: L.route }, shuffle: false });
      }
      case 'shuffle-list': {
        if (!L?.ids.length) return;
        const start = Math.floor(Math.random() * L.ids.length);
        setTimeout(() => player.emit('modes'));
        return playIds(L.ids, start, { context: { label: L.label, route: L.route }, shuffle: true });
      }
      case 'pl-add': return addTracksSheet(S.playlists.get(act.dataset.id));
      case 'pl-more': return playlistSheet(S.playlists.get(act.dataset.id));
      case 'sort': S.settings.libSort = S.settings.libSort === 'az' ? 'recent' : 'az'; saveSettings(); return render(true);
      case 'wipe': return confirmSheet('Tout effacer ?', 'Toute la musique importée et tes playlists seront supprimées de l\'application. Tes fichiers d\'origine ne sont pas touchés.', 'Tout effacer', async () => {
        await deleteTracks([...S.tracks.keys()]);
        await db.clear();
        S.playlists.clear(); S.covers.clear(); bump();
        localStorage.removeItem('onde.session');
        render(true); toast('Bibliothèque effacée');
      });
      case 'install': S.installPrompt?.prompt(); return;
      case 'clear-hist': AI.clearHistory(); S.mixes = {}; toast('Historique effacé'); return render(true);
      case 'mix-regen': S.mixes[act.dataset.key] = null; getMix(act.dataset.key); return render(true);
      case 'mix-save': return saveMixAsPlaylist(S.mixes[act.dataset.key]);
      case 'ai-send': return aiSend(act.dataset.text);
      case 'voice': return startVoice({ navigate: S.route?.name === 'ai' });
      case 'src': S.settings.searchSrc = act.dataset.src; saveSettings(); if (location.hash.includes('src=')) return goto('#/search', true); return render(true);
      case 'radio-tag': return showRadios(act.dataset.tag, act.dataset.label);
      case 'radio-name': return playRadioByName(act.dataset.name, act);
      case 'pc-show': return showPodcast(act.dataset.id);
      case 'sound': return soundSheet();
      case 'voice-test': return Voice.speak(`Bonjour ${S.settings.name || ''}, je suis le Concierge de ta Maison.`);
      case 'news-flash': return playNewsFlash(+act.dataset.i || 0, act);
      case 'pc-more': return morePodcasts(act.dataset.q, act.dataset.name);
      case 'feat-pc': {
        if (S.route?.name === 'search') return openFeatured(act.dataset.q);
        S.settings.searchSrc = 'info'; S.searchQ = ''; S.pendingShow = act.dataset.q; saveSettings(); S.pendingFwd = true; return goto('#/search');
      }
      case 'yt-key': S.pendingFwd = true; return goto('#/settings');
      case 'ai-clear': S.chat = []; saveJSON('onde.chat', S.chat); return render(true);
      case 'ai-play': { const m = S.mixes[act.dataset.key]; if (m?.tracks.length) playIds(m.tracks.map(t => t.id), 0, { context: { label: m.name, route: '#/mix/' + m.key } }); return; }
    }
    return;
  }
  const more = e.target.closest('.row .more');
  if (more) {
    const row = more.closest('[data-tid]');
    return trackSheet(S.tracks.get(row.dataset.tid), { listKey: row.dataset.list });
  }
  const row = e.target.closest('#view [data-tid][data-list]');
  if (row) {
    const L = S.lists[row.dataset.list];
    if (!L) return;
    const i = +row.dataset.i;
    if (row.dataset.tid === player.currentId && player.context?.label === L.label) return player.toggle();
    row.classList.add('tapped');
    setTimeout(() => row.classList.remove('tapped'), 400);
    playIds(L.ids, i, { context: { label: L.label, route: L.route } });
  }
}, true);

// appui long sur un titre = menu
let lpT;
document.addEventListener('pointerdown', e => {
  const row = e.target.closest('#view .row[data-tid]');
  if (!row) return;
  lpT = setTimeout(() => {
    navigator.vibrate?.(12);
    S.lpFired = true;
    setTimeout(() => { S.lpFired = false; }, 800);
    trackSheet(S.tracks.get(row.dataset.tid), { listKey: row.dataset.list });
  }, 550);
});
['pointerup', 'pointercancel', 'pointermove'].forEach(ev => document.addEventListener(ev, e => {
  if (ev === 'pointermove' && Math.abs(e.movementX) + Math.abs(e.movementY) < 3) return;
  clearTimeout(lpT);
}, { passive: true }));
document.addEventListener('contextmenu', e => { if (e.target.closest('.row')) e.preventDefault(); });

// Fermeture de feuille => re-rendu si nécessaire
new MutationObserver(() => { if (sheet.hidden && S.needRender) { S.needRender = false; render(true); } }).observe(sheet, { attributes: true, attributeFilter: ['hidden'] });

// Installation PWA
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; });

// Raccourcis clavier (ordinateur)
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  if (e.code === 'ArrowRight' && e.shiftKey) player.next();
  if (e.code === 'ArrowLeft' && e.shiftKey) player.prev();
  if (e.code === 'Escape') { if (S.voiceOn) closeVoice(); else if (overlays.length) popOverlay(); }
});

// ======================================================================
// Démarrage
// ======================================================================
async function loadCovers() {
  const d = await new Promise((res, rej) => { const r = indexedDB.open('onde'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise(res => {
    const req = d.transaction('covers').objectStore('covers').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return res();
      S.covers.set(c.key, URL.createObjectURL(c.value));
      c.continue();
    };
    req.onerror = () => res();
  });
}

async function boot() {
  try {
    const [tracks, pls] = await Promise.all([db.all('tracks'), db.all('playlists')]);
    tracks.forEach(t => { S.tracks.set(t.id, t); if (t.thumb) S.covers.set(t.coverId, t.thumb); });
    pls.forEach(p => S.playlists.set(p.id, p));
    await loadCovers();
  } catch (e) {
    console.error(e);
    toast('Erreur de chargement de la bibliothèque');
  }
  bump();
  render();
  player.restore(new Set(S.tracks.keys()));
  updateNowPlaying();
  updateModes();
  document.body.classList.add('ready');
  const sp = $('#splash');
  setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 900); }, 1100);
  setTimeout(queueAnalysis, 4000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
    // nouvelle version installée → on recharge une fois pour l'afficher
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && S.hadController) { reloaded = true; location.reload(); } });
    S.hadController = !!navigator.serviceWorker.controller;
  }
}
boot();
