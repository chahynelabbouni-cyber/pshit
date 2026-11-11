// Données de l'agenda : tout reste sur le téléphone (localStorage).
import { DAY, startOfDay } from './dates.js';

const KEY = 'agenda-chahyn-v1';

export const BASE_CATS = {
  cours:    { label: 'Cours',      color: '#5b8def', emoji: '📚' },
  exam:     { label: 'Examens',    color: '#ff5d6c', emoji: '⚠️' },
  echeance: { label: 'Échéances',  color: '#ff9f43', emoji: '⏳' },
  revision: { label: 'Révisions',  color: '#38c6f4', emoji: '🧠' },
  sante:    { label: 'Santé',      color: '#2fd1a5', emoji: '🩺' },
  sport:    { label: 'Sport',      color: '#c47dff', emoji: '🥊' },
  pro:      { label: 'Pro',        color: '#d9b26a', emoji: '💼' },
  perso:    { label: 'Perso',      color: '#f472b6', emoji: '✨' },
  ferie:    { label: 'Vacances & dates clés', color: '#8b95a7', emoji: '🌴' },
};

// Catégories effectives (base + personnalisations), mises à jour par refreshCats()
export const CATS = {};
export function refreshCats() {
  Object.keys(CATS).forEach(k => delete CATS[k]);
  const st = state?.settings || {};
  const o = st.catOverrides || {};
  for (const [k, v] of Object.entries(BASE_CATS)) CATS[k] = { ...v, ...(o[k] || {}) };
  for (const c of st.customCats || []) CATS[c.key] = { label: c.label, color: c.color, emoji: c.emoji, custom: true };
}

export const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'");

// Devine la catégorie d'un événement à partir de son titre.
export function guessCat(title, extra = '') {
  const t = norm(title) + ' ' + norm(extra);
  const st = state?.settings;
  // 1. tes règles perso
  for (const r of st?.rules || []) if (r.kw && CATS[r.cat] && t.includes(norm(r.kw))) return r.cat;
  // 2. tes catégories perso (mots-clés)
  for (const c of st?.customCats || []) if ((c.keywords || []).some(k => k && t.includes(norm(k)))) return c.key;
  if (/(debut des cours|fin des cours|jour ferie|vacances|ferie|toussaint|noel|paques|armistice|nouvel an|ascension|pentecote|assomption|fete du travail|fete nationale)/.test(t)) return 'ferie';
  if (/(ophtalm|medecin|medecine|docteur|\bdr\b|pneumo|dentiste|kine|fond d'(oe|œ)il|consultation|pharmacie|prise de sang|ologue|iatre|hopital|radio|dermato|psy|osteo|vaccin|sante)/.test(t)) return 'sante';
  if (/(date limite|remise|a rendre|deadline|depot|reception du|version finale)/.test(t)) return 'echeance';
  if (/^(revis|reviser|revision)/.test(t)) return 'revision';
  if (/(\bcc\d?\b|partiel|controle|\bexam|examen|\bds\b|soutenance|⚠)/.test(t)) return 'exam';
  if (/(revis|reviser|revision|bachoter|fiches)/.test(t)) return 'revision';
  if (/(date limite|remise|a rendre|rendre|deadline|echeance|envoi|dossier)/.test(t)) return 'echeance';
  if (/(\bcm\b|\btd\b|\btp\b|\bppe\b|cours|amphi|conference|atelier|lecon)/.test(t)) return 'cours';
  if (/(boxe|muscu|sport|foot|running|course a pied|salle de sport|piscine|natation|basket|gym|seance|entrainement)/.test(t)) return 'sport';
  if (/(entretien|adecco|stage|\bcv\b|job|travail|reunion|alternance|interim|boulot|taf|client)/.test(t)) return 'pro';
  return 'perso';
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export { uid };

function blank() {
  return {
    version: 1,
    events: [],   // {id, title, start, end, allDay, location, notes, cat, source:'local'|'google', gid, calId, dirty, reminder}
    tasks: [],    // {id, title, due (ms|null), dueTime(bool), priority, done, doneAt, cat, created}
    notes: [],    // {id, title, text, color, pinned, remind (ms|null), created, updated}
    tombstones: [], // {gid, calId} suppressions à reporter sur Google
    chat: [],     // historique de l'assistant
    settings: {
      name: '',
      lastName: '',
      profile: '',
      about: '',
      theme: 'dark',
      hideDups: true,
      hiddenCats: [],
      reminderMin: 30,
      dayStart: 7,
      dayEnd: 23,
      claudeKey: '',
      googleClientId: '',
      googleConnected: false,
      lastSync: 0,
      voiceReply: false,
      calView: 'week',
      uiVersion: 3,
      onboarded: false,
      googleAddPrompt: true,
      meSeg: 'goals',
      // personnalisation
      avatar: '🙂',
      palette: 'or',
      accent: '',
      textSize: 1,
      contrast: false,
      homeModules: defaultHome(),
      catOverrides: {},
      customCats: [],
      rules: [],
      subjectColors: {},
      travelMin: 0,
      goals: [],
      focusRun: null,
    },
    focus: [],      // séances de focus terminées {start, end, subject}
    checks: {},     // habitudes cochées {goalId: ['2026-11-10', ...]}
    countdowns: [], // {id, title, date, emoji}
  };
}

// Blocs de l'accueil : [titre, description]. Les 5 premiers sont affichés par défaut.
export const HOME_MODULES = {
  now: ['⏱ Maintenant / ensuite', 'Ce que tu fais et ce qui arrive'],
  quick: ['✦ Ajout rapide', 'Écrire ou dicter un événement'],
  insights: ['💡 Le conseil du jour', 'Une seule suggestion utile'],
  day: ["📅 Ma journée", "Tout ce qui est prévu aujourd'hui"],
  due: ['⏳ À ne pas rater', 'Les 3 prochains examens, remises et tâches'],
  brief: ['☀️ Résumé du jour', 'Ta journée en 2 phrases, à écouter'],
  tomorrow: ['🌙 Demain', 'Ce qui t\'attend demain'],
  goals: ['🎯 Mes objectifs', 'Boxe, révisions, habitudes'],
  focus: ['🧠 Minuteur de révision', 'Lancer une séance de travail'],
  subjects: ['📚 Mes matières', 'Prochain cours et contrôle par matière'],
  countdowns: ['⌛ Comptes à rebours', 'Vacances, examens, dates importantes'],
  notes: ['📌 Notes épinglées', 'Ce que tu ne dois pas oublier'],
  week: ['📊 Ma semaine en graphique', 'Heures occupées par jour'],
};
const DEFAULT_ON = ['now', 'quick', 'insights', 'day', 'due'];
function defaultHome() { return Object.keys(HOME_MODULES).map(id => ({ id, on: DEFAULT_ON.includes(id) })); }

let state = load();
refreshCats();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const b = blank();
      const out = { ...b, ...s, settings: { ...b.settings, ...(s.settings || {}) } };
      // nouvelle interface (v3) : accueil épuré, vue semaine, accueil guidé
      if ((out.settings.uiVersion || 0) < 3) {
        Object.assign(out.settings, { uiVersion: 3, homeModules: defaultHome(), calView: 'week', onboarded: false, textSize: Math.max(1, out.settings.textSize || 1) });
      }
      // ajoute les nouveaux modules d'accueil apparus depuis
      const have = new Set(out.settings.homeModules.map(m => m.id));
      for (const id of Object.keys(HOME_MODULES)) if (!have.has(id)) out.settings.homeModules.push({ id, on: false });
      out.settings.homeModules = out.settings.homeModules.filter(m => HOME_MODULES[m.id]);
      return out;
    }
  } catch { /* stockage indisponible */ }
  return blank();
}

let saveTimer = null;
function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save', e); }
}
// on enregistre aussi tout de suite si l'appli est fermée ou mise en arrière-plan
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => saveTimer && writeNow());
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) writeNow(); });
}
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 60);
  listeners.forEach(fn => fn());
}

export const S = () => state;
export const onChange = fn => listeners.add(fn);
export function replaceAll(s) { const b = blank(); state = { ...b, ...s, settings: { ...b.settings, ...(s.settings || {}) } }; refreshCats(); save(); }
export function resetAll() { state = blank(); refreshCats(); save(); }

// Recalcule la catégorie des événements (après changement de règles)
export function recategorize() {
  let n = 0;
  for (const e of state.events) {
    if (e.catLocked || e.cat === 'ferie') continue;
    const c = guessCat(e.title, e.notes);
    if (c !== e.cat) { e.cat = c; n++; }
  }
  for (const t of state.tasks) t.cat = guessCat(t.title);
  save();
  return n;
}

// ---------- Événements ----------
export function addEvent(e) {
  const ev = {
    id: uid(), title: 'Sans titre', start: Date.now(), end: Date.now() + 3600000, allDay: false,
    location: '', notes: '', source: 'local', gid: null, calId: null, dirty: true, reminder: null, ...e,
  };
  if (!ev.cat) ev.cat = guessCat(ev.title, ev.notes);
  if (ev.end <= ev.start) ev.end = ev.start + (ev.allDay ? DAY : 3600000);
  state.events.push(ev);
  save();
  return ev;
}
export function updateEvent(id, patch) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return null;
  Object.assign(ev, patch, { dirty: true });
  if (ev.end <= ev.start) ev.end = ev.start + (ev.allDay ? DAY : 3600000);
  save();
  return ev;
}
export function deleteEvent(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  if (ev.gid) state.tombstones.push({ gid: ev.gid, calId: ev.calId || 'primary' });
  state.events = state.events.filter(e => e.id !== id);
  save();
}

// Événements visibles qui touchent l'intervalle [a, b[
export function eventsBetween(a, b, { all = false } = {}) {
  const hidden = new Set(state.settings.hiddenCats);
  const dups = state.settings.hideDups ? duplicateIds() : new Set();
  return state.events
    .filter(e => e.start < b && e.end > a)
    .filter(e => all || (!hidden.has(e.cat) && !dups.has(e.id)))
    .sort((x, y) => (y.allDay - x.allDay) || x.start - y.start || x.end - y.end);
}
export const eventsOfDay = (d, opt) => { const a = startOfDay(d).getTime(); return eventsBetween(a, a + DAY, opt); };

// ---------- Doublons ----------
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'un', 'une', 'mme', 'mr', 'm', 'pour', 'avec']);
const tokens = s => new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)));
let dupCache = { sig: '', ids: new Set() };
export function duplicateIds() {
  const sig = state.events.length + ':' + state.events.reduce((n, e) => n + e.start % 997 + e.title.length, 0);
  if (dupCache.sig === sig) return dupCache.ids;
  const groups = new Map();
  for (const e of state.events) {
    const k = e.start + '|' + e.end;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const ids = new Set();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // on garde le plus complet (lieu renseigné, titre le plus long)
    g.sort((a, b) => (!!b.location - !!a.location) || b.title.length - a.title.length);
    const kept = [];
    for (const e of g) {
      const te = tokens(e.title);
      const dup = kept.find(k => {
        const tk = tokens(k.title);
        let inter = 0; te.forEach(w => tk.has(w) && inter++);
        const union = new Set([...te, ...tk]).size || 1;
        return inter / union >= 0.5;
      });
      if (dup) ids.add(e.id); else kept.push(e);
    }
  }
  dupCache = { sig, ids };
  return ids;
}
export function purgeDuplicates() {
  const ids = duplicateIds();
  [...ids].forEach(deleteEvent);
  return ids.size;
}

// ---------- Tâches / échéances ----------
export function addTask(t) {
  const task = { id: uid(), title: 'Tâche', due: null, dueTime: false, priority: 'normale', done: false, doneAt: null, created: Date.now(), ...t };
  if (!task.cat) task.cat = guessCat(task.title);
  state.tasks.push(task);
  save();
  return task;
}
export function updateTask(id, patch) {
  const t = state.tasks.find(x => x.id === id);
  if (t) { Object.assign(t, patch); save(); }
  return t;
}
export function deleteTask(id) { state.tasks = state.tasks.filter(t => t.id !== id); save(); }

// ---------- Notes ----------
export function addNote(n) {
  const note = { id: uid(), title: '', text: '', color: 'gold', pinned: false, remind: null, created: Date.now(), updated: Date.now(), ...n };
  state.notes.push(note);
  save();
  return note;
}
export function updateNote(id, patch) {
  const n = state.notes.find(x => x.id === id);
  if (n) { Object.assign(n, patch, { updated: Date.now() }); save(); }
  return n;
}
export function deleteNote(id) { state.notes = state.notes.filter(n => n.id !== id); save(); }

// ---------- Échéancier : tâches + examens/remises à venir ----------
export function deadlines({ from = startOfDay(new Date()).getTime() - 30 * DAY, includeDone = false } = {}) {
  const dups = duplicateIds();
  const evs = state.events
    .filter(e => (e.cat === 'exam' || e.cat === 'echeance') && e.end > from && !dups.has(e.id))
    .map(e => ({ kind: 'event', id: e.id, title: e.title, due: e.start, dueTime: !e.allDay, cat: e.cat, done: e.end < Date.now(), ref: e }));
  const tks = state.tasks
    .filter(t => t.due && (includeDone || !t.done))
    .map(t => ({ kind: 'task', id: t.id, title: t.title, due: t.due, dueTime: t.dueTime, cat: t.cat, done: t.done, priority: t.priority, ref: t }));
  return [...evs, ...tks].sort((a, b) => a.due - b.due);
}

// ---------- Import / export ----------
export function exportJson() {
  const { settings, ...rest } = state;
  const { claudeKey, ...safe } = settings;
  return JSON.stringify({ ...rest, settings: safe, exportedAt: new Date().toISOString() }, null, 1);
}

// Fusionne des événements importés (fichier .json de l'agenda, export Google, .ics).
export function mergeEvents(list) {
  let added = 0, updated = 0;
  for (const e of list) {
    const ex = e.gid ? state.events.find(x => x.gid === e.gid) : state.events.find(x => x.start === e.start && x.end === e.end && x.title === e.title);
    if (ex) { Object.assign(ex, { ...e, id: ex.id, dirty: false }); updated++; }
    else { state.events.push({ id: uid(), location: '', notes: '', source: 'local', dirty: false, reminder: null, ...e, cat: e.cat || guessCat(e.title, e.notes) }); added++; }
  }
  save();
  return { added, updated };
}

export function importJson(text) {
  const data = JSON.parse(text);
  let r = { added: 0, updated: 0 };
  if (Array.isArray(data.events)) r = mergeEvents(data.events.map(({ id, ...e }) => e));
  let t = 0, n = 0;
  if (Array.isArray(data.tasks)) for (const x of data.tasks) if (!state.tasks.some(y => y.id === x.id)) { state.tasks.push(x); t++; }
  if (Array.isArray(data.notes)) for (const x of data.notes) if (!state.notes.some(y => y.id === x.id)) { state.notes.push(x); n++; }
  save();
  return { ...r, tasks: t, notes: n };
}
