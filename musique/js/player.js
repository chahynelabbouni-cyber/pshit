// Moteur de lecture : deux lecteurs audio pour les fondus enchaînés entre morceaux,
// file d'attente, aléatoire, répétition, écran de verrouillage (Media Session).
import { db } from './db.js';

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Player extends EventTarget {
  constructor(getTrack, getCoverURL) {
    super();
    this.getTrack = getTrack;
    this.getCoverURL = getCoverURL;
    this.els = [new Audio(), new Audio()];
    this.urls = [null, null];
    this.ids = [null, null];
    this.cur = 0;
    this.queue = [];
    this.original = null;
    this.index = -1;
    this.context = null; // { label, route }
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.crossfade = 0;
    this.fading = null;
    this.analyser = null;
    this.ctx = null;
    this.sleepAt = 0;
    this.sleepEndOfTrack = false;

    this.els.forEach((el, i) => {
      el.preload = 'auto';
      el.addEventListener('timeupdate', () => i === this.cur && this.onTime());
      el.addEventListener('ended', () => i === this.cur && this.onEnded());
      el.addEventListener('play', () => i === this.cur && this.emit('state'));
      el.addEventListener('pause', () => i === this.cur && !this.fading && this.emit('state'));
      el.addEventListener('loadedmetadata', () => i === this.cur && this.emit('time'));
      el.addEventListener('error', () => {
        if (i === this.cur && el.src) { this.emit('error'); }
      });
    });
    this.setupMediaSession();
    setInterval(() => this.save(), 4000);
    window.addEventListener('pagehide', () => this.save());
  }

  get el() { return this.els[this.cur]; }
  get other() { return this.els[1 - this.cur]; }
  get currentId() { return this.queue[this.index] ?? null; }
  get current() { return this.currentId ? this.getTrack(this.currentId) : null; }
  get playing() { return !this.el.paused; }
  get time() { return this.el.currentTime || 0; }
  get duration() { return this.el.duration || this.current?.duration || 0; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async srcFor(slot, id) {
    if (this.ids[slot] === id && this.urls[slot]) return;
    const blob = await db.get('audio', id);
    if (!blob) throw new Error('Fichier introuvable');
    if (this.urls[slot]) URL.revokeObjectURL(this.urls[slot]);
    this.urls[slot] = URL.createObjectURL(blob);
    this.ids[slot] = id;
    this.els[slot].src = this.urls[slot];
  }

  cancelFade() {
    if (!this.fading) return;
    cancelAnimationFrame(this.fading.raf);
    this.fading = null;
    this.other.pause();
    if (!isIOS) this.el.volume = 1;
  }

  async load(autoplay = true, startAt = 0) {
    this.cancelFade();
    const id = this.currentId;
    if (!id) return;
    this.other.pause();
    try {
      await this.srcFor(this.cur, id);
    } catch (e) {
      this.emit('error', e);
      return;
    }
    this.el.volume = 1;
    if (startAt) {
      const seek = () => { try { this.el.currentTime = startAt; } catch { /* ignore */ } };
      if (this.el.readyState >= 1) seek(); else this.el.addEventListener('loadedmetadata', seek, { once: true });
    } else if (this.el.currentTime) {
      this.el.currentTime = 0;
    }
    this.emit('track');
    this.updateMediaSession();
    if (autoplay) await this.play();
    else this.emit('state');
  }

  ensureAudioGraph() {
    if (this.ctx || isIOS) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.els.forEach(el => this.ctx.createMediaElementSource(el).connect(this.analyser));
      this.analyser.connect(this.ctx.destination);
    } catch (e) {
      console.warn('Visualiseur indisponible', e);
      this.ctx = null; this.analyser = null;
    }
  }

  async play() {
    if (!this.currentId) return;
    if (this.visualizer) this.ensureAudioGraph();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    try { await this.el.play(); } catch (e) { if (e.name !== 'AbortError') console.warn(e); }
    this.markPlayed();
  }

  pause() {
    this.cancelFade();
    this.el.pause();
    this.save();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    this.cancelFade();
    if (isFinite(t)) this.el.currentTime = Math.max(0, Math.min(t, this.duration || t));
    this.updatePosition();
    this.emit('time');
  }

  playList(ids, start = 0, { shuffle = false, context = null } = {}) {
    if (!ids.length) return;
    this.context = context;
    this.queue = ids.slice();
    this.original = null;
    this.index = Math.max(0, Math.min(start, ids.length - 1));
    if (shuffle) { this.shuffle = true; this.applyShuffle(); }
    else if (this.shuffle) this.applyShuffle();
    this.emit('queue');
    this.load(true);
  }

  applyShuffle() {
    const cur = this.queue[this.index];
    this.original = this.queue.slice();
    const rest = this.queue.filter((_, i) => i !== this.index);
    this.queue = cur ? [cur, ...shuffleArr(rest)] : shuffleArr(rest);
    this.index = 0;
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.shuffle) this.applyShuffle();
    else if (this.original) {
      const cur = this.currentId;
      this.queue = this.original;
      this.original = null;
      this.index = Math.max(0, this.queue.indexOf(cur));
    }
    this.emit('queue');
    this.emit('modes');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.emit('modes');
  }

  hasNext() { return this.index < this.queue.length - 1 || this.repeat === 'all'; }

  nextIndex() {
    if (this.index < this.queue.length - 1) return this.index + 1;
    if (this.repeat === 'all') return 0;
    return -1;
  }

  next(auto = false) {
    if (auto && this.repeat === 'one') { this.el.currentTime = 0; this.play(); return; }
    if (auto && this.sleepEndOfTrack) { this.sleepEndOfTrack = false; this.emit('sleep'); this.el.pause(); return; }
    const n = this.nextIndex();
    if (n < 0) {
      this.el.pause();
      if (auto) { this.el.currentTime = 0; this.emit('state'); }
      return;
    }
    this.index = n;
    this.emit('queue');
    this.load(true);
  }

  prev() {
    if (this.time > 3 || this.index === 0) { this.seek(0); if (!this.playing) this.play(); return; }
    this.index--;
    this.emit('queue');
    this.load(true);
  }

  jump(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.index = i;
    this.emit('queue');
    this.load(true);
  }

  addNext(id) {
    if (!this.queue.length) return this.playList([id], 0);
    this.queue.splice(this.index + 1, 0, id);
    if (this.original) this.original.push(id);
    this.emit('queue');
  }

  addToQueue(id) {
    if (!this.queue.length) return this.playList([id], 0);
    this.queue.push(id);
    if (this.original) this.original.push(id);
    this.emit('queue');
  }

  removeAt(i) {
    if (i === this.index) return;
    const [id] = this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    if (this.original) {
      const k = this.original.indexOf(id);
      if (k >= 0) this.original.splice(k, 1);
    }
    this.emit('queue');
  }

  // Retire des morceaux supprimés de la bibliothèque
  purge(ids) {
    const set = new Set(ids);
    const cur = this.currentId;
    if (set.has(cur)) { this.el.pause(); this.el.removeAttribute('src'); this.ids[this.cur] = null; }
    this.queue = this.queue.filter(id => !set.has(id));
    if (this.original) this.original = this.original.filter(id => !set.has(id));
    this.index = set.has(cur) ? Math.min(this.index, this.queue.length - 1) : this.queue.indexOf(cur);
    if (set.has(cur) && this.queue.length) this.load(false);
    this.emit('queue');
    this.emit('track');
  }

  onTime() {
    this.emit('time');
    if (this.sleepAt && Date.now() >= this.sleepAt) {
      this.sleepAt = 0;
      this.fadeOutAndPause();
      this.emit('sleep');
    }
    const d = this.el.duration;
    if (!this.crossfade || isIOS || this.fading || this.repeat === 'one' || this.sleepEndOfTrack || !d) return;
    const remaining = d - this.el.currentTime;
    if (remaining <= this.crossfade && remaining > 0.3 && this.nextIndex() >= 0 && d > this.crossfade * 2) {
      this.startCrossfade(remaining);
    }
  }

  fadeOutAndPause() {
    const el = this.el;
    if (isIOS) { el.pause(); return; }
    const start = performance.now();
    const step = now => {
      const p = Math.min(1, (now - start) / 3000);
      el.volume = 1 - p;
      if (p < 1) requestAnimationFrame(step); else { el.pause(); el.volume = 1; this.emit('state'); }
    };
    requestAnimationFrame(step);
  }

  async startCrossfade(len) {
    const n = this.nextIndex();
    const nextSlot = 1 - this.cur;
    const out = this.el;
    this.fading = { raf: 0 };
    try {
      await this.srcFor(nextSlot, this.queue[n]);
    } catch { this.fading = null; return; }
    if (!this.fading) return;
    const inc = this.els[nextSlot];
    inc.currentTime = 0;
    inc.volume = 0;
    inc.play().catch(() => {});
    this.cur = nextSlot;
    this.index = n;
    this.emit('queue');
    this.emit('track');
    this.updateMediaSession();
    this.markPlayed();
    const start = performance.now();
    const dur = len * 1000;
    const step = now => {
      if (!this.fading) return;
      const p = Math.min(1, (now - start) / dur);
      // Courbe à puissance constante
      out.volume = Math.cos(p * Math.PI / 2);
      inc.volume = Math.sin(p * Math.PI / 2);
      if (p < 1) this.fading.raf = requestAnimationFrame(step);
      else { out.pause(); out.volume = 1; inc.volume = 1; this.fading = null; this.emit('state'); }
    };
    this.fading.raf = requestAnimationFrame(step);
  }

  onEnded() {
    if (this.fading) return;
    this.next(true);
  }

  markPlayed() {
    const t = this.current;
    if (!t || this._marked === this.currentId + this.index) return;
    this._marked = this.currentId + this.index;
    this.emit('played', t);
  }

  setSleep(minutes) {
    this.sleepEndOfTrack = minutes === 'end';
    this.sleepAt = typeof minutes === 'number' && minutes > 0 ? Date.now() + minutes * 60000 : 0;
    this.emit('sleep');
  }

  // ----- Écran de verrouillage / casque Bluetooth -----
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* non supporté */ } };
    h('play', () => this.play());
    h('pause', () => this.pause());
    h('previoustrack', () => this.prev());
    h('nexttrack', () => this.next());
    h('seekto', d => this.seek(d.seekTime));
    h('seekbackward', d => this.seek(this.time - (d.seekOffset || 10)));
    h('seekforward', d => this.seek(this.time + (d.seekOffset || 10)));
    h('stop', () => this.pause());
  }

  async updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = this.current;
    if (!t) return;
    const art = await this.getCoverURL(t);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist || 'Artiste inconnu',
      album: t.album || '',
      artwork: art ? [{ src: art, sizes: '512x512' }] : [],
    });
  }

  updatePosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = this.el.duration;
    if (!isFinite(d) || !d) return;
    try {
      navigator.mediaSession.setPositionState({ duration: d, playbackRate: 1, position: Math.min(this.time, d) });
    } catch { /* ignore */ }
  }

  // ----- Sauvegarde de la session -----
  save() {
    try {
      localStorage.setItem('onde.session', JSON.stringify({
        queue: this.queue, original: this.original, index: this.index, time: this.time,
        shuffle: this.shuffle, repeat: this.repeat, context: this.context,
      }));
    } catch { /* ignore */ }
  }

  restore(validIds) {
    try {
      const s = JSON.parse(localStorage.getItem('onde.session') || 'null');
      if (!s) return;
      const cur = s.queue?.[s.index];
      this.queue = (s.queue || []).filter(id => validIds.has(id));
      this.original = s.original ? s.original.filter(id => validIds.has(id)) : null;
      this.index = Math.max(0, this.queue.indexOf(cur));
      this.shuffle = !!s.shuffle;
      this.repeat = s.repeat || 'off';
      this.context = s.context || null;
      if (this.queue.length) this.load(false, validIds.has(cur) ? s.time : 0);
      this.emit('modes');
      this.emit('queue');
    } catch { /* ignore */ }
  }
}
