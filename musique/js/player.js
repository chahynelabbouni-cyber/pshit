// Moteur de lecture : deux lecteurs audio pour les fondus enchaînés entre morceaux,
// file d'attente, aléatoire, répétition, écran de verrouillage (Media Session).
import { db } from './db.js?v=21';
import { YouTubeElement } from './sources.js?v=21';

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
    this.base = 1;
    this._seq = 0;

    this.els.forEach((el, i) => {
      if (i !== 2) el.preload = i === 3 ? 'none' : 'auto';
      el.addEventListener('timeupdate', () => i === this.cur && this.onTime());
      el.addEventListener('ended', () => i === this.cur && this.onEnded());
      el.addEventListener('play', () => { if (i === this.cur) { this.emit('state'); this.setMSState('playing'); } });
      el.addEventListener('pause', () => { if (i === this.cur && !this.fading) { this.emit('state'); this.setMSState('paused'); } });
      el.addEventListener('loadedmetadata', () => i === this.cur && this.emit('time'));
      el.addEventListener('durationchange', () => i === this.cur && this.updatePosition());
      el.addEventListener('error', () => {
        if (i !== this.cur || !el.src) return;
        if (i === 3 && this.current?.source === 'radio') return this.reconnectRadio();
        this.emit('error', { code: i === 2 ? el.errorCode : el.error?.code });
        this.emit('state');
      });
    });
    // Radio : reconnexion automatique si le flux coupe (changement de réseau, serveur…)
    const r = this.els[3];
    this._radioTries = 0;
    r.addEventListener('ended', () => { if (this.cur === 3 && this.current?.source === 'radio') this.reconnectRadio(); });
    r.addEventListener('waiting', () => { clearTimeout(this._stallT); if (this.current?.source === 'radio') this._stallT = setTimeout(() => this.reconnectRadio(), 12000); });
    r.addEventListener('playing', () => { clearTimeout(this._stallT); this._radioTries = 0; });
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
    if (t?.source === 'radio' || t?.source === 'podcast') return 3;
    return this.cur < 2 ? this.cur : 0;
  }
  get currentId() { return this.queue[this.index] ?? null; }
  get current() { return this.currentId ? this.getTrack(this.currentId) : null; }
  get playing() { return !this.el.paused; }
  get time() { return this.el.currentTime || 0; }
  get duration() { return this.el.duration || this.current?.duration || 0; }

  emit(type, detail) {
    if (type === 'queue') this._remote = null;
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  reconnectRadio() {
    const t = this.current;
    if (this.cur !== 3 || t?.source !== 'radio' || this._radioPaused) return;
    if (this._radioTries++ >= 6) { this._radioTries = 0; this.emit('error', { code: 'radio' }); this.emit('state'); return; }
    clearTimeout(this._reconT);
    this._reconT = setTimeout(() => {
      if (this.current !== t || this._radioPaused) return;
      const el = this.els[3];
      el.removeAttribute('src'); el.load();
      el.src = t.url; this.ids[3] = t.id;
      el.play().catch(() => {});
    }, 800 * this._radioTries);
  }

  async srcFor(slot, id) {
    if (slot === 2) {
      const t = this.getTrack(id);
      if (this.ids[2] !== id) { await this.els[2].load(t.ytId, t.duration, this._autoplay, this._startAt || 0); this.ids[2] = id; }
      return;
    }
    if (slot === 3) {
      const t = this.getTrack(id);
      if (this.ids[3] !== id || !this.els[3].getAttribute('src')) { this.els[3].src = t.url; this.ids[3] = id; }
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
  // Volume général (0 à 1) réglable à la voix
  setVolume(v) {
    this.base = Math.max(0.05, Math.min(1, v));
    this.gain = this._ducked ? 0.2 * this.base : this.base;
    if (isIOS || this.fading) return this.base;
    this.el.volume = this.gain;
    return this.base;
  }

  duck(on) {
    this._ducked = on;
    this.gain = (on ? 0.2 : 1) * (this.base ?? 1);
    if (isIOS || this.fading) return;
    const el = this.el, from = el.volume, to = this.gain;
    clearInterval(this._duckT);
    this._duckT = this.ramp(350, p => { el.volume = from + (to - from) * p; });
  }

  async load(autoplay = true, startAt = 0) {
    this.cancelFade();
    const id = this.currentId;
    if (!id) return;
    const seq = ++this._seq;
    this.cur = this.slotFor(this.current);
    this.pauseOthers();
    this._radioPaused = false; this._radioTries = 0;
    try {
      this._autoplay = autoplay;
      this._startAt = startAt;
      await this.srcFor(this.cur, id);
    } catch (e) {
      if (seq !== this._seq) return;
      this.emit('error', { code: 'load', message: e.message });
      this.emit('state');
      return;
    }
    if (seq !== this._seq) return; // un chargement plus récent a pris la main (appuis rapides sur « suivant »)
    if (!isIOS) this.el.volume = this.gain;
    if (this.cur === 2) { /* YouTube : la position de départ est déjà transmise au lecteur */ } else if (startAt) {
      const seek = () => { try { this.el.currentTime = startAt; } catch { /* ignore */ } };
      if (this.el.readyState >= 1) seek(); else this.el.addEventListener('loadedmetadata', seek, { once: true });
    } else if (this.el.currentTime) {
      this.el.currentTime = 0;
    }
    this.emit('track');
    this.updateMediaSession();
    this.updateActions();
    this.updatePosition();
    if (autoplay) await this.play();
    else this.emit('state');
  }

  ensureAudioGraph() {
    if (this.ctx || isIOS) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'playback' });
      this.pre = this.ctx.createGain(); // marge pour que l'égaliseur ne sature pas
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      // Égaliseur 3 bandes : basses, médiums (voix), aigus
      this.eq = {
        bass: Object.assign(this.ctx.createBiquadFilter(), { type: 'lowshelf' }),
        mid: Object.assign(this.ctx.createBiquadFilter(), { type: 'peaking' }),
        treble: Object.assign(this.ctx.createBiquadFilter(), { type: 'highshelf' }),
      };
      this.eq.bass.frequency.value = 120; this.eq.mid.frequency.value = 1500; this.eq.mid.Q.value = 0.9; this.eq.treble.frequency.value = 6000;
      this.els.slice(0, 2).forEach(el => this.ctx.createMediaElementSource(el).connect(this.pre));
      this.pre.connect(this.eq.bass);
      // Booster : on amplifie, puis un limiteur évite que ça sature (pas de grésillement)
      this.boostGain = this.ctx.createGain();
      this.limiter = Object.assign(this.ctx.createDynamicsCompressor(), {});
      this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003; this.limiter.release.value = 0.25;
      this.eq.bass.connect(this.eq.mid); this.eq.mid.connect(this.eq.treble); this.eq.treble.connect(this.boostGain);
      this.boostGain.connect(this.limiter); this.limiter.connect(this.analyser);
      this.setBoost(this.boost || 0);
      this.analyser.connect(this.ctx.destination);
      if (this.eqGains) this.setEQ(this.eqGains);
      // Si le système suspend le moteur audio (écran éteint), on le relance pour ne pas couper la musique
      const wake = () => { if ((this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') && this.playing) this.ctx.resume().catch(() => {}); };
      this.ctx.addEventListener('statechange', wake);
      document.addEventListener('visibilitychange', wake);
    } catch (e) {
      console.warn('Visualiseur indisponible', e);
      this.ctx = null; this.analyser = null;
    }
  }

  // Booster de son : 0 = coupé, 1 = léger, 2 = fort, 3 = max (fichiers importés)
  setBoost(level) {
    this.boost = Math.max(0, Math.min(3, level | 0));
    if (this.boost && this.kind === 'local') this.ensureAudioGraph();
    if (this.boostGain) this.boostGain.gain.setTargetAtTime([1, 1.6, 2.3, 3.2][this.boost], this.ctx.currentTime, 0.05);
    return this.boost;
  }

  setEQ(g) {
    this.eqGains = g;
    if (!this.eq) return;
    this.eq.bass.gain.value = g[0]; this.eq.mid.gain.value = g[1]; this.eq.treble.gain.value = g[2];
    this.pre.gain.value = Math.pow(10, -Math.max(0, ...g) * 0.8 / 20);
  }

  async play() {
    if (!this.currentId) return;
    if (this.visualizer || this.boost || (this.eqGains && this.eqGains.some(Boolean))) this.ensureAudioGraph();
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    clearInterval(this._sleepFade);
    if (this._sleepFade) { this._sleepFade = 0; if (!isIOS) this.el.volume = this.gain; }
    // Radio en pause : on repart du direct au lieu d'un vieux morceau en mémoire
    if (this.cur === 3 && this._radioPaused) { this._radioPaused = false; this.ids[3] = null; await this.srcFor(3, this.currentId); }
    if (this._sleepPendingMin) this.armSleep();
    try { await this.el.play(); } catch (e) {
      if (e.name !== 'AbortError') { console.warn(e); this.emit('state'); return; }
    }
    this.markPlayed();
  }

  pause() {
    this.cancelFade();
    this.el.pause();
    if (this.cur === 3 && this.current?.source === 'radio') {
      // on coupe le flux (pas de données consommées en pause)
      this._radioPaused = true;
      clearTimeout(this._stallT); clearTimeout(this._reconT);
      setTimeout(() => { if (this._radioPaused) { this.els[3].removeAttribute('src'); this.els[3].load(); } }, 50);
    }
    this.save();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    this.cancelFade();
    if (isFinite(t)) this.el.currentTime = Math.max(0, Math.min(t, this.duration || t));
    this.updatePosition();
    this.emit('time');
  }

  playList(ids, start = 0, { shuffle = false, context = null, ordered = false } = {}) {
    if (!ids.length) return;
    this.context = context;
    this.queue = ids.slice();
    this.original = null;
    this.index = Math.max(0, Math.min(start, ids.length - 1));
    if (shuffle) { this.shuffle = true; this.applyShuffle(); }
    else if (this.shuffle && !ordered) this.applyShuffle();
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
    if (auto && this.repeat === 'one') { this.el.currentTime = 0; this.play(); this.emit('loop'); return; }
    if (auto && this.sleepEndOfTrack) { this.sleepEndOfTrack = false; this.emit('sleep'); this.el.pause(); return; }
    const n = this.nextIndex();
    if (n < 0) {
      // Fin de la file : l'application peut enchaîner sur des sons similaires
      if (auto) { this.el.pause(); this.el.currentTime = 0; this.emit('state'); this.emit('queueend'); }
      else this.emit('queueend', { manual: true });
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
    if (this.original) { const k = this.original.indexOf(this.currentId); this.original.splice(k + 1, 0, id); }
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

  // Vide la suite de la file (et l'ordre d'origine du mode aléatoire)
  clearUpcoming() {
    this.queue.splice(this.index + 1);
    if (this.original) { const keep = new Set(this.queue); this.original = this.original.filter(id => keep.has(id)); }
    this.emit('queue');
  }

  // Retire des morceaux supprimés de la bibliothèque
  purge(ids) {
    const set = new Set(ids);
    const cur = this.currentId;
    if (set.has(cur)) {
      this.cancelFade();
      this.el.pause(); this.el.removeAttribute('src'); this.ids[this.cur] = null;
      if (this.urls[this.cur]) { URL.revokeObjectURL(this.urls[this.cur]); this.urls[this.cur] = null; }
    }
    this.queue = this.queue.filter(id => !set.has(id));
    if (this.original) this.original = this.original.filter(id => !set.has(id));
    this.index = set.has(cur) ? Math.min(this.index, this.queue.length - 1) : this.queue.indexOf(cur);
    if (set.has(cur) && this.queue.length) this.load(false);
    this.emit('queue');
    if (set.has(cur)) this.emit('track');
  }

  onTime() {
    this.emit('time');
    if (!this._posSet && this.el.duration) { this._posSet = true; this.updatePosition(); }
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
    this.cancelFade();
    const el = this.el;
    if (isIOS) { this.pause(); return; }
    const v0 = el.volume;
    clearInterval(this._sleepFade);
    this._sleepFade = this.ramp(3000, p => { el.volume = v0 * (1 - p); }, () => { this._sleepFade = 0; this.pause(); el.volume = this.gain; this.emit('state'); });
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

  // Minuteur de sommeil : un vrai compte à rebours (marche aussi écran éteint, et avec les radios)
  setSleep(minutes) {
    clearTimeout(this._sleepT);
    this.sleepEndOfTrack = minutes === 'end' && this.current?.source !== 'radio';
    if (minutes === 'end' && !this.sleepEndOfTrack) minutes = 0;
    this.sleepAt = typeof minutes === 'number' && minutes > 0 ? Date.now() + minutes * 60000 : 0;
    this._sleepPendingMin = 0;
    if (this.sleepAt) this.armSleep();
    this.emit('sleep');
  }
  armSleep() {
    clearTimeout(this._sleepT);
    if (this._sleepPendingMin) { this.sleepAt = Date.now() + this._sleepPendingMin; this._sleepPendingMin = 0; }
    if (!this.sleepAt) return;
    this._sleepT = setTimeout(() => {
      if (!this.playing) { this._sleepPendingMin = 0; this.sleepAt = 0; this.emit('sleep'); return; }
      this.sleepAt = 0; this.fadeOutAndPause(); this.emit('sleep');
    }, Math.max(0, this.sleepAt - Date.now()));
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
    h('seekbackward', d => this.seek(this.time - (d.seekOffset || (this.current?.source === 'podcast' ? 15 : 10))));
    h('seekforward', d => this.seek(this.time + (d.seekOffset || (this.current?.source === 'podcast' ? 30 : 10))));
    h('stop', () => this.pause());
  }

  // Commandes de l'écran verrouillé adaptées à la source (pas d'avance rapide sur une radio en direct)
  updateActions() {
    if (!('mediaSession' in navigator)) return;
    const live = this.current?.source === 'radio';
    const ms = navigator.mediaSession;
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* non supporté */ } };
    h('seekto', live ? null : d => this.seek(d.seekTime));
    h('seekbackward', live ? null : d => this.seek(this.time - (d.seekOffset || (this.current?.source === 'podcast' ? 15 : 10))));
    h('seekforward', live ? null : d => this.seek(this.time + (d.seekOffset || (this.current?.source === 'podcast' ? 30 : 10))));
    h('nexttrack', live && this.nextIndex() < 0 ? null : () => this.next());
    h('previoustrack', live && this.index === 0 ? null : () => this.prev());
  }

  async updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = this.current;
    if (!t) return;
    const art = await this.getCoverURL(t);
    if (t !== this.current) return;
    const fallback = new URL('icons/icon-512.png', location.href).href;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.source === 'radio' ? 'En direct' : t.artist || 'Artiste inconnu',
      album: t.album || this.context?.label || '',
      artwork: art ? [{ src: art, sizes: '512x512' }, { src: fallback, sizes: '512x512', type: 'image/png' }] : [{ src: fallback, sizes: '512x512', type: 'image/png' }],
    });
  }

  setMSState(st) {
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = st; } catch { /* ignore */ }
  }

  updatePosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    this._posSet = false;
    const d = this.current?.source === 'radio' ? Infinity : this.el.duration;
    try {
      if (!isFinite(d) || !d) { navigator.mediaSession.setPositionState(); return; }
      this._posSet = true;
      navigator.mediaSession.setPositionState({ duration: d, playbackRate: this.el.playbackRate || 1, position: Math.max(0, Math.min(this.time, d)) });
    } catch { /* ignore */ }
  }

  // ----- Sauvegarde de la session -----
  save() {
    try {
      // les titres en ligne (YouTube, podcasts, radios) à venir sont gardés pour la reprise après redémarrage
      if (!this._remote) {
        this._remote = {};
        for (const id of this.queue.slice(0, 400)) { const t = this.getTrack(id); if (t?.source) { const { lyrics, ...rest } = t; this._remote[id] = rest; } }
      }
      localStorage.setItem('onde.session', JSON.stringify({
        queue: this.queue, original: this.original, index: this.index, time: this.time,
        shuffle: this.shuffle, repeat: this.repeat, context: this.context, remote: this._remote,
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
