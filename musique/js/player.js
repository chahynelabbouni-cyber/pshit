// Moteur de lecture : deux lecteurs audio pour les fondus enchaînés entre morceaux,
// file d'attente, aléatoire, répétition, écran de verrouillage (Media Session).
import { db } from './db.js';
import { YouTubeElement } from './sources.js';

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
  constructor(getTrack, getCoverURL, ytHost) {
    super();
    this.getTrack = getTrack;
    this.getCoverURL = getCoverURL;
    // 0-1 : fichiers locaux (deux lecteurs pour les fondus) · 2 : YouTube (lecteur officiel) · 3 : radios
    this.els = [new Audio(), new Audio(), new YouTubeElement(ytHost), new Audio()];
    this.urls = [null, null, null, null];
    this.ids = [null, null, null, null];
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
    this.gain = 1;

    this.els.forEach((el, i) => {
      if (i !== 2) el.preload = i === 3 ? 'none' : 'auto';
      el.addEventListener('timeupdate', () => i === this.cur && this.onTime());
      el.addEventListener('ended', () => i === this.cur && this.onEnded());
      el.addEventListener('play', () => { if (i === this.cur) { this.emit('state'); this.setMSState('playing'); } });
      el.addEventListener('pause', () => { if (i === this.cur && !this.fading) { this.emit('state'); this.setMSState('paused'); } });
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
  get other() { return this.els[this.cur < 2 ? 1 - this.cur : 0]; }
  get kind() { return this.cur === 2 ? 'yt' : this.cur === 3 ? 'radio' : 'local'; }
  pauseOthers() { this.els.forEach((e, i) => { if (i !== this.cur && !e.paused) e.pause(); }); }
  slotFor(t) {
    if (t?.source === 'yt') return 2;
    if (t?.source === 'radio') return 3;
    return this.cur < 2 ? this.cur : 0;
  }
  get currentId() { return this.queue[this.index] ?? null; }
  get current() { return this.currentId ? this.getTrack(this.currentId) : null; }
  get playing() { return !this.el.paused; }
  get time() { return this.el.currentTime || 0; }
  get duration() { return this.el.duration || this.current?.duration || 0; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async srcFor(slot, id) {
    if (slot === 2) {
      const t = this.getTrack(id);
      if (this.ids[2] !== id) { await this.els[2].load(t.ytId, t.duration); this.ids[2] = id; }
      return;
    }
    if (slot === 3) {
      const t = this.getTrack(id);
      if (this.ids[3] !== id) { this.els[3].src = t.url; this.ids[3] = id; }
      return;
    }
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
    clearInterval(this.fading.timer);
    this.fading = null;
    this.other.pause();
    if (!isIOS) this.el.volume = this.gain;
  }

  // Les minuteurs (contrairement aux animations) continuent quand l'écran est éteint
  // ou l'app en arrière-plan : les fondus fonctionnent donc aussi en poche.
  ramp(ms, onStep, onDone) {
    const start = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / ms);
      onStep(p);
      if (p >= 1) { clearInterval(id); onDone?.(); }
    }, 50);
    return id;
  }

  // Baisse le son pendant que l'assistant vocal écoute ou parle
  duck(on) {
    this.gain = on ? 0.2 : 1;
    if (isIOS || this.fading) return;
    const el = this.el, from = el.volume, to = this.gain;
    clearInterval(this._duckT);
    this._duckT = this.ramp(350, p => { el.volume = from + (to - from) * p; });
  }

  async load(autoplay = true, startAt = 0) {
    this.cancelFade();
    const id = this.currentId;
    if (!id) return;
    this.cur = this.slotFor(this.current);
    this.pauseOthers();
    try {
      await this.srcFor(this.cur, id);
    } catch (e) {
      this.emit('error', e);
      return;
    }
    if (!isIOS) this.el.volume = this.gain;
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
      this.els.slice(0, 2).forEach(el => this.ctx.createMediaElementSource(el).connect(this.analyser));
      this.analyser.connect(this.ctx.destination);
      // Si le système suspend le moteur audio (écran éteint), on le relance pour ne pas couper la musique
      const wake = () => { if (this.ctx.state !== 'running' && this.playing) this.ctx.resume().catch(() => {}); };
      this.ctx.addEventListener('statechange', wake);
      document.addEventListener('visibilitychange', wake);
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
    if (!this.crossfade || isIOS || this.fading || this.repeat === 'one' || this.sleepEndOfTrack || !d || !isFinite(d) || this.cur > 1) return;
    const nt = this.getTrack(this.queue[this.nextIndex()]);
    if (nt?.source) return; // pas de fondu vers YouTube / radio
    const remaining = d - this.el.currentTime;
    if (remaining <= this.crossfade && remaining > 0.3 && this.nextIndex() >= 0 && d > this.crossfade * 2) {
      this.startCrossfade(remaining);
    }
  }

  fadeOutAndPause() {
    const el = this.el;
    if (isIOS) { el.pause(); return; }
    const v0 = el.volume;
    this.ramp(3000, p => { el.volume = v0 * (1 - p); }, () => { el.pause(); el.volume = this.gain; this.emit('state'); });
  }

  async startCrossfade(len) {
    const n = this.nextIndex();
    const nextSlot = 1 - this.cur;
    const out = this.el;
    this.fading = { timer: 0 };
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
    const g = this.gain;
    const finish = () => { out.pause(); out.volume = this.gain; inc.volume = this.gain; this.fading = null; this.emit('state'); };
    // Courbe à puissance constante
    this.fading.timer = this.ramp(len * 1000, p => {
      out.volume = Math.cos(p * Math.PI / 2) * g;
      inc.volume = Math.sin(p * Math.PI / 2) * g;
    }, finish);
    out.addEventListener('ended', () => { if (this.fading) { clearInterval(this.fading.timer); finish(); } }, { once: true });
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

  setMSState(st) {
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = st; } catch { /* ignore */ }
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
