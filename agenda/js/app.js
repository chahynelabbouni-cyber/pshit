import {
  S, save, CATS, refreshCats, recategorize, HOME_MODULES, guessCat, uid, norm,
  addEvent, updateEvent, deleteEvent, eventsBetween, eventsOfDay, duplicateIds, purgeDuplicates,
  addTask, updateTask, deleteTask, addNote, updateNote, deleteNote, deadlines, exportJson, importJson, mergeEvents, resetAll,
} from './store.js';
import {
  DAY, MIN, startOfDay, addDays, sameDay, startOfWeek, startOfMonth, dayDiff, pad, hm, hm2, ymd, fromYmd,
  cap, fmtDay, fmtDayShort, relDay, fmtDuration, countdown, JOURS_C, MOIS,
} from './dates.js';
import { localAssistant, askClaude, revisionPlan, revisionTitle } from './ai.js';
import {
  subjects, subjectOf, subjectColor, goalProgress, toggleCheck, busyMinutes, dayLoad, briefing, greetingWord,
  templates, countdownList, stats,
} from './insights.js';
import { parseIcs } from './ics.js';
import * as G from './google.js';
import { listen, stopListening, canListen, speak, stopSpeaking } from './voice.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = id => `<svg><use href="#i-${id}"/></svg>`;
const set = () => S().settings;
const catOf = k => CATS[k] || CATS.perso;
const colEv = e => e.color || catOf(e.cat).color;
const col = k => catOf(k).color;

let tab = 'today';
let calDate = startOfDay(new Date());
let selDay = startOfDay(new Date());
let dueFilter = 'all';
let noteQuery = '';
let noteFolder = 'Tout';
let statPeriod = 'week';
let showAllDue = false;
const undoBag = new Map();

// =====================================================================
// Apparence : ambiances, couleur d'accent, taille du texte, contraste
// =====================================================================
const PALETTES = {
  or:      { name: 'Noir & or',  dark: true,  bg: '#070707', bg2: '#121110', bg3: '#1c1a17', bg4: '#282420', text: '#f6f1e7', muted: '#b0a898', dim: '#6f695f', accent: '#d9b26a' },
  nuit:    { name: 'Nuit bleue', dark: true,  bg: '#060912', bg2: '#0e1424', bg3: '#172036', bg4: '#222d48', text: '#eef2ff', muted: '#a3add0', dim: '#606b8f', accent: '#7aa2ff' },
  rose:    { name: 'Rose nuit',  dark: true,  bg: '#0c0609', bg2: '#170e13', bg3: '#23151c', bg4: '#311d27', text: '#fdeff5', muted: '#c9a5b6', dim: '#7c5f6c', accent: '#ff8fb8' },
  menthe:  { name: 'Menthe',     dark: true,  bg: '#050d0b', bg2: '#0c1814', bg3: '#14241e', bg4: '#1d332b', text: '#ecfbf5', muted: '#9cc5b6', dim: '#5b7d71', accent: '#3ee0a8' },
  clair:   { name: 'Clair & or', dark: false, bg: '#f7f4ee', bg2: '#ffffff', bg3: '#efe9de', bg4: '#e4dccd', text: '#17130c', muted: '#5f574a', dim: '#9a9284', accent: '#a77c37' },
  lavande: { name: 'Lavande',    dark: false, bg: '#f5f3fb', bg2: '#ffffff', bg3: '#ebe7f7', bg4: '#ddd6f1', text: '#151225', muted: '#575273', dim: '#9590ad', accent: '#6d4dff' },
};
const ACCENTS = ['', '#d9b26a', '#ff8fb8', '#7aa2ff', '#3ee0a8', '#c47dff', '#ff9f43', '#ff5d6c', '#38c6f4'];
const AVATARS = ['🥊', '🦁', '🌙', '⭐', '🔥', '🦋', '🌸', '👑', '🎧', '📚', '🐺', '🌊'];

function applyLook() {
  const s = set();
  const p = PALETTES[s.palette] || PALETTES.or;
  const r = document.documentElement;
  r.dataset.theme = p.dark ? 'dark' : 'light';
  const acc = s.accent || p.accent;
  const vars = {
    '--bg': p.bg, '--bg2': p.bg2, '--bg3': p.bg3, '--bg4': p.bg4, '--text': p.text,
    '--muted': s.contrast ? p.text : p.muted, '--dim': s.contrast ? p.muted : p.dim,
    '--accent': acc,
    '--grad': `linear-gradient(135deg, color-mix(in srgb, ${acc} 55%, white) 0%, ${acc} 48%, color-mix(in srgb, ${acc} 70%, black) 100%)`,
    '--line': `color-mix(in srgb, ${acc} ${s.contrast ? 35 : 15}%, transparent)`,
    '--line2': p.dark ? `rgba(255,255,255,${s.contrast ? 0.16 : 0.07})` : `rgba(0,0,0,${s.contrast ? 0.18 : 0.07})`,
    '--on-accent': p.dark ? '#120d04' : '#fff',
    '--z': s.textSize || 1,
  };
  for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
  r.classList.toggle('contrast', !!s.contrast);
  document.querySelector('meta[name=theme-color]').content = p.bg;
}

// =====================================================================
// Navigation
// =====================================================================
function go(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'v-' + t; });
  $('#fab').hidden = t === 'ai' || t === 'me';
  $('#ai-bar').hidden = t !== 'ai';
  render();
  $('#main').scrollTop = 0;
  if (t === 'cal' && set().calView === 'day') scrollGridToNow();
  if (t === 'ai') setTimeout(() => { $('#main').scrollTop = 1e6; }, 30);
}

function header(kicker, title) { $('#top-kicker').textContent = kicker; $('#top-h').textContent = title; }

function render() {
  applyLook();
  ({ today: renderToday, cal: renderCal, todo: renderTodo, notes: renderNotes, me: renderMe, ai: renderAi })[tab]();
  $('#me-avatar').textContent = set().avatar;
  $('#btn-me').classList.toggle('on', tab === 'me');
  const sync = $('#btn-sync');
  sync.hidden = !set().googleConnected;
  sync.classList.toggle('ok', Date.now() - set().lastSync < 3600000);
}

// =====================================================================
// Composants
// =====================================================================
const travelOf = e => e.travel ?? (e.location && !/visio|teams|zoom|en ligne/i.test(e.location) ? set().travelMin : 0);

// Titre allégé : sans ⚠️ ni nom du prof pour les cours (le titre complet reste dans la fiche)
const shortTitle = e => {
  let t = e.title.replace(/⚠️?\s*/g, '').trim();
  if (['cours', 'exam', 'echeance'].includes(e.cat)) t = t.replace(/\s*\((?:G\d|TD\d[^)]*|CC\d?|Visio|en visio)\)/gi, '').trim();
  if (e.cat === 'cours' || e.cat === 'exam') t = t.replace(/\s[–—-]\s(?:M\.|Mme|Mr)?\s?[A-ZÉ][\w.\-' ]*(\s\([^)]*\))?$/u, '').trim();
  return t;
};

function tlItem(e, now = Date.now()) {
  const c = colEv(e);
  const cls = e.end < now ? 'past' : e.start <= now && e.end > now ? 'now' : '';
  const time = e.allDay ? `<div class="tl-time">${catOf(e.cat).emoji}</div>`
    : `<div class="tl-time">${hm(e.start)}<small>${hm(e.end)}</small></div>`;
  const tr = travelOf(e);
  const sub = [e.location, tr && e.start > now && e.start - now < DAY ? `🚶 partir à ${hm(e.start - tr * MIN)}` : ''].filter(Boolean).join(' · ');
  return `<div class="tl-item ${cls}" style="--c:${c}" data-a="ev" data-id="${e.id}">${time}<div class="tl-bar"></div>
    <div class="tl-body"><div class="tl-title">${e.star ? '<span class="star">★</span> ' : ''}${esc(shortTitle(e))}</div>${sub ? `<div class="tl-sub">${esc(sub)}</div>` : ''}</div></div>`;
}

function timeline(evs, { gaps = false, empty = 'Rien de prévu 🌿' } = {}) {
  if (!evs.length) return `<div class="empty">${empty}</div>`;
  let out = '', last = null;
  for (const e of evs) {
    if (gaps && !e.allDay && last && e.start - last >= 90 * MIN && e.start > Date.now()) {
      out += `<div class="free-gap" data-a="new-at" data-t="${Math.max(last, Date.now())}">Libre ${fmtDuration(e.start - Math.max(last, Date.now()))}</div>`;
    }
    out += tlItem(e);
    if (!e.allDay) last = Math.max(last || 0, e.end);
  }
  return out;
}

function urgency(due) {
  const d = dayDiff(new Date(), due);
  if (d < 0) return { c: 'var(--danger)', b: `+${-d}`, s: 'retard' };
  if (d === 0) return { c: 'var(--danger)', b: 'Auj.', s: '' };
  if (d === 1) return { c: 'var(--warn)', b: 'J-1', s: 'demain' };
  if (d <= 3) return { c: 'var(--warn)', b: `J-${d}`, s: 'jours' };
  if (d <= 7) return { c: 'var(--accent)', b: `J-${d}`, s: 'jours' };
  return { c: 'var(--ok)', b: `J-${d}`, s: 'jours' };
}

function dueItem(d) {
  const u = d.due ? urgency(d.due) : { c: 'var(--dim)', b: '—', s: '' };
  const when = d.due ? cap(relDay(d.due)) + (d.dueTime ? ' à ' + hm(d.due) : '') : 'Sans date';
  const canRevise = d.kind === 'event' && d.cat === 'exam' && !d.done && d.due - Date.now() < 15 * DAY;
  const left = d.kind === 'task'
    ? `<button class="check ${d.done ? 'on' : ''}" data-a="task-done" data-id="${d.id}" aria-label="Fait">${icon('check')}</button>` : '';
  return `<div class="due ${d.done ? 'done' : ''} ${d.priority === 'haute' ? 'prio-haute' : ''}" style="--u:${u.c}">
    ${left}<div class="jx"><b>${u.b}</b>${u.s ? `<small>${u.s}</small>` : ''}</div>
    <div class="grow" data-a="${d.kind === 'task' ? 'task' : 'ev'}" data-id="${d.id}">
      <div class="ttl">${esc(d.kind === 'event' ? shortTitle(d.ref) : d.title)}</div>
      <div class="sub">${when}</div>
    </div>
    ${canRevise ? `<button class="btn small" data-a="plan-rev" data-id="${d.id}">Réviser</button>` : ''}
  </div>`;
}

const NOTE_COLORS = { gold: '#d9b26a', rose: '#f472b6', bleu: '#5b8def', vert: '#2fd1a5', violet: '#c47dff', rouge: '#ff5d6c', gris: '#8b95a7' };
const NOTE_FOLDERS = ['Tout', 'Cours', 'Perso', 'Admin', 'Courses', 'Idées'];
const CHK = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s?(.*)$/;

function noteBody(n) {
  return n.text.split('\n').map((line, i) => {
    const m = CHK.exec(line);
    if (m) return `<div class="ck ${m[1] !== ' ' ? 'on' : ''}" data-a="note-chk" data-id="${n.id}" data-l="${i}"><span class="box">${m[1] !== ' ' ? '✓' : ''}</span>${esc(m[2])}</div>`;
    return `<div>${esc(line) || '&nbsp;'}</div>`;
  }).join('');
}
function noteCard(n, subs) {
  const c = NOTE_COLORS[n.color] || NOTE_COLORS.gold;
  const lines = n.text.split('\n');
  const total = lines.filter(l => CHK.test(l)).length;
  const done = lines.filter(l => CHK.test(l) && /\[(x|X)\]/.test(l)).length;
  const subj = n.subject ? (subs || subjects()).find(s => s.key === n.subject) : null;
  return `<div class="note" style="--nc:${c}" data-a="note" data-id="${n.id}">
    ${n.pinned ? `<svg class="pin"><use href="#i-pin"/></svg>` : ''}
    ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}<div class="nb">${noteBody(n)}</div>
    <div class="nmeta">${total ? `<span>☑ ${done}/${total}</span>` : ''}${subj ? `<span class="subj" style="--s:${subj.color}">${esc(subj.name)}</span>` : n.folder ? `<span>${esc(n.folder)}</span>` : ''}${n.remind ? `<span>⏰ ${relDay(n.remind)} ${hm(n.remind)}</span>` : ''}</div>
  </div>`;
}
const noteGrid = notes => { const subs = subjects(); return `<div class="notes-grid">${notes.map(n => noteCard(n, subs)).join('')}</div>`; };

function quickBar(id, ph) {
  return `<form class="quick" data-quick="${id}">
    <svg class="sp"><use href="#i-spark"/></svg>
    <input id="${id}" placeholder="${esc(ph)}" autocomplete="off" enterkeyhint="send">
    ${canListen ? `<button type="button" data-a="mic" data-for="${id}" aria-label="Dicter">${icon('mic')}</button>` : ''}
    <button class="go" aria-label="Envoyer">${icon('send')}</button>
  </form>`;
}

function ring(pct, color, label, size = 64) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--bg4)" stroke-width="7"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><span>${label}</span></div>`;
}

const card = (title, body, more = '') => `<div class="card"><h2>${title}${more}</h2>${body}</div>`;
const more = (label, a, extra = '') => `<span class="more" data-a="${a}" ${extra}>${label}</span>`;

// =====================================================================
// ACCUEIL — modules personnalisables
// =====================================================================
function shortBrief(d = new Date()) {
  const L = dayLoad(d);
  const evs = L.evs.filter(e => !e.allDay);
  const now = Date.now();
  const left = evs.filter(e => e.end > now);
  let s;
  if (!evs.length) s = 'Rien de prévu aujourd\'hui. Journée libre.';
  else if (!left.length) s = `Ta journée est finie (${fmtDuration(L.minutes * MIN)} occupées). Repose-toi.`;
  else s = `${left.length} chose${left.length > 1 ? 's' : ''} encore prévue${left.length > 1 ? 's' : ''}, tu finis vers ${hm(Math.max(...evs.map(e => e.end)))}.`;
  const dl = deadlines({ from: now }).filter(x => !x.done && x.due < now + 3 * DAY)[0];
  if (dl) s += ` À ne pas oublier : ${shortTitle(dl.ref || dl)} (${relDay(dl.due)}).`;
  return { L, s };
}

const HOME = {
  now() {
    const now = new Date();
    if (!S().events.length && !S().tasks.length) {
      return `<div class="hero"><div class="lbl">Bienvenue ${esc(set().avatar)}</div><div class="ttl">Ton agenda est vide</div>
        <div class="meta">Ouvre le lien d'import que tu as reçu, ou ajoute ton premier événement avec le bouton +.</div>
        <div class="actions"><button class="btn" data-a="import">Importer un fichier</button></div></div>`;
    }
    const timed = eventsOfDay(now).filter(e => !e.allDay);
    const cur = timed.find(e => e.start <= now && e.end > now);
    const upcoming = eventsBetween(now.getTime(), now.getTime() + 21 * DAY).filter(e => !e.allDay && e.start > now);
    const next = upcoming[0];
    const block = (e, lbl, cd, extra = '') => {
      const tr = travelOf(e);
      return `<div class="hero" style="--c:${colEv(e)}" data-a="ev" data-id="${e.id}">
        <div class="lbl">${lbl}</div>
        <div class="ttl">${esc(shortTitle(e))}</div>
        <div class="hero-when"><b>${cd}</b>${e.start > now ? ` · ${relDay(e.start) === "aujourd'hui" ? '' : relDay(e.start) + ' '}${hm(e.start)}` : ` · jusqu'à ${hm(e.end)}`}</div>
        ${e.location ? `<div class="meta">${icon('place')}${esc(e.location)}</div>` : ''}
        ${tr && e.start > now ? `<div class="meta go">${icon('walk')}Partir à ${hm(e.start - tr * MIN)}</div>` : ''}
        ${extra}</div>`;
    };
    if (cur) {
      const p = Math.min(100, (now - cur.start) / (cur.end - cur.start) * 100);
      return block(cur, 'En ce moment', `Encore ${fmtDuration(cur.end - now)}`, `<div class="progress"><i style="width:${p}%"></i></div>${next ? `<div class="next2">Ensuite : <b>${esc(shortTitle(next))}</b> à ${hm(next.start)}</div>` : ''}`);
    }
    if (next) return block(next, 'Ensuite', cap(countdown(next.start)));
    return `<div class="hero"><div class="lbl">Tranquille</div><div class="ttl">Rien de prévu</div><div class="meta">Profite 🌿</div></div>`;
  },
  quick() {
    return quickBar('q-today', 'Ajouter… ex : « boxe jeudi 20h30 »');
  },
  insights() {
    const i = insights()[0];
    if (!i) return '';
    return `<div class="insight" style="--c:${i.c}"><div class="ic">${i.ic}</div><div class="grow"><p>${i.html}</p>${i.btn ? `<div class="row wrap">${i.btn}</div>` : ''}</div></div>`;
  },
  day() {
    const now = new Date();
    return card("Aujourd'hui", `<div class="tl">${timeline(eventsOfDay(now), { gaps: true })}</div>`);
  },
  due() {
    const dl = deadlines({ from: Date.now() - DAY }).filter(d => !d.done).slice(0, 3);
    if (!dl.length) return '';
    return card('À ne pas rater', dl.map(dueItem).join(''), more('Tout voir', 'tab', 'data-tab="todo"'));
  },
  brief() {
    const { L, s } = shortBrief();
    return `<div class="brief" style="--l:${L.c}"><div class="row"><div class="load grow">${L.emoji} ${L.label}</div><button class="icon-btn" data-a="speak-brief" aria-label="Écouter">${icon('speaker')}</button></div><p class="brief-txt">${esc(s)}</p></div>`;
  },
  tomorrow() {
    const t = addDays(new Date(), 1);
    return card(`Demain · ${fmtDayShort(t)}`, `<div class="tl">${timeline(eventsOfDay(t), { empty: 'Rien de prévu demain 🌿' })}</div>`);
  },
  goals() {
    const gs = set().goals;
    if (!gs.length) return '';
    return card('Mes objectifs', `<div class="goals">${gs.map(goalTile).join('')}</div>`, more('Gérer', 'set-goals'));
  },
  focus() { return card('Minuteur de révision', focusBlock()); },
  countdowns() {
    const list = countdownList().slice(0, 2);
    if (!list.length) return '';
    return card('Comptes à rebours', `<div class="cds">${list.map(cdTile).join('')}</div>`);
  },
  subjects() {
    const ss = subjects().filter(s => s.next || s.nextExam).slice(0, 4);
    if (!ss.length) return '';
    return card('Mes matières', ss.map(subjRow).join(''), more('Toutes', 'me-seg', 'data-s="subjects"'));
  },
  notes() {
    const pinned = S().notes.filter(n => n.pinned);
    if (!pinned.length) return '';
    return card('Notes épinglées', noteGrid(pinned), more('Notes', 'tab', 'data-tab="notes"'));
  },
  week() { return card('Ma semaine', weekChart()); },
};

function goalTile(g) {
  const p = goalProgress(g);
  const pct = p.done / (g.target || 1);
  const c = pct >= 1 ? 'var(--ok)' : 'var(--accent)';
  const sub = g.kind === 'check'
    ? `<button class="btn small ${p.todayDone ? 'on-ok' : ''}" data-a="goal-check" data-id="${g.id}">${p.todayDone ? '✓ Fait aujourd\'hui' : 'Cocher aujourd\'hui'}</button>${p.streak > 1 ? `<small>🔥 ${p.streak} jours d'affilée</small>` : ''}`
    : `<small>${pct >= 1 ? 'Objectif atteint 🎉' : p.planned > p.done ? `${p.planned}${p.unit} prévu${p.unit === 'h' ? 'es' : 's'} au total` : `encore ${Math.round((g.target - p.done) * 10) / 10}${p.unit} à caler`}</small>`;
  return `<div class="goal">${ring(pct, c, `${g.emoji}`)}<div class="grow"><b>${esc(g.label)}</b><div class="gnum">${p.done}${p.unit} <span>/ ${g.target}${p.unit}</span></div>${sub}</div></div>`;
}

function cdTile(c) {
  const d = Math.max(0, dayDiff(new Date(), c.date));
  return `<div class="cd-tile" ${c.ev ? `data-a="ev" data-id="${c.id}"` : c.custom ? `data-a="cd-edit" data-id="${c.id}"` : ''}><div class="cd-n">${d}<small>${d > 1 ? 'jours' : 'jour'}</small></div><div class="cd-t">${c.emoji} ${esc(c.title.replace(/ - L2 Gestion/, ''))}</div><div class="dim small">${fmtDayShort(c.date)}</div></div>`;
}

function subjRow(s) {
  const exam = s.nextExam ? `<span class="tag" style="background:color-mix(in srgb, var(--danger) 18%, transparent);color:var(--danger)">${s.nextExam.cat === 'exam' ? '🎯' : '⏳'} J-${dayDiff(new Date(), s.nextExam.start)}</span>` : '';
  return `<div class="subj-row" data-a="subj" data-k="${esc(s.key)}" style="--s:${s.color}"><div class="sdot"></div><div class="grow"><b>${esc(s.name)}</b><div class="dim small">${s.next ? `${cap(relDay(s.next.start))} ${hm(s.next.start)}${s.next.location ? ' · ' + esc(s.next.location) : ''}` : 'Plus de cours prévu'}</div></div>${exam}</div>`;
}

function insights() {
  const out = [];
  const now = Date.now();
  const st = S();
  const exams = deadlines({ from: now }).filter(d => d.kind === 'event' && d.cat === 'exam' && !d.done && d.due - now < 15 * DAY);
  for (const ex of exams.slice(0, 2)) {
    const subj = subjectOf(ex.ref);
    const revs = eventsBetween(now, ex.due).filter(e => e.cat === 'revision' && (!subj || subjectOf(e)?.key === subj.key));
    const n = dayDiff(new Date(), ex.due);
    const when = n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`;
    if (revs.length) out.push({ c: CATS.revision.color, ic: '✅', html: `<b>${esc(ex.title.replace(/⚠️?/g, ''))}</b> ${when} : ${revs.length} révision${revs.length > 1 ? 's' : ''} prévue${revs.length > 1 ? 's' : ''}. Tu gères.` });
    else out.push({ c: CATS.exam.color, ic: '🎯', html: `<b>${esc(ex.title.replace(/⚠️?/g, ''))}</b> ${when}, et aucune révision n'est prévue.`, btn: `<button class="btn small gold" data-a="plan-rev" data-id="${ex.id}">Planifier mes révisions</button>` });
  }
  const late = st.tasks.filter(t => !t.done && t.due && t.due < startOfDay(new Date()).getTime());
  if (late.length) out.push({ c: 'var(--danger)', ic: '⏰', html: `${late.length} tâche${late.length > 1 ? 's' : ''} en retard : <b>${esc(late[0].title)}</b>${late.length > 1 ? '…' : ''}`, btn: `<button class="btn small" data-a="memo-due">Voir</button>` });
  for (const g of st.settings.goals.filter(g => g.kind === 'count')) {
    const p = goalProgress(g);
    const dow = (new Date().getDay() + 6) % 7;
    if (dow >= 2 && p.planned < g.target) out.push({ c: 'var(--accent)', ic: g.emoji, html: `${esc(g.label)} : <b>${p.planned}/${g.target}</b> prévu${p.planned > 1 ? 's' : ''} cette semaine.`, btn: `<button class="btn small" data-a="goal-plan" data-id="${g.id}">Caler une séance</button>` });
  }
  const tmr = eventsOfDay(addDays(new Date(), 1));
  const tm = busyMinutes(tmr);
  const first = tmr.find(e => !e.allDay);
  if (tm >= 300 && first) out.push({ c: 'var(--warn)', ic: '🔋', html: `Demain est chargé : <b>${fmtDuration(tm * MIN)}</b> occupées, premier rendez-vous à <b>${hm(first.start)}</b>. Couche-toi tôt.` });
  else if (first && new Date().getHours() >= 18) out.push({ c: colEv(first), ic: '🌙', html: `Demain, tu commences à <b>${hm(first.start)}</b> : ${esc(first.title)}${first.location ? ' — ' + esc(first.location) : ''}.` });
  const bring = eventsBetween(now, now + DAY).filter(e => e.bring?.some(b => !b.done));
  if (bring.length) out.push({ c: 'var(--accent)', ic: '🎒', html: `Pour <b>${esc(bring[0].title)}</b>, n'oublie pas : ${bring[0].bring.filter(b => !b.done).map(b => esc(b.t)).join(', ')}.` });
  const nr = st.notes.filter(n => n.remind && sameDay(n.remind, new Date()));
  if (nr.length) out.push({ c: NOTE_COLORS.gold, ic: '📝', html: `À ne pas oublier aujourd'hui : <b>${esc(nr[0].title || nr[0].text.split('\n')[0])}</b>${nr.length > 1 ? ` (+${nr.length - 1})` : ''}` });
  const dups = duplicateIds().size;
  if (dups && !st.settings.dupsSeen) out.push({ c: 'var(--accent)', ic: '🧹', html: `J'ai repéré <b>${dups} doublons</b> dans ton agenda Google. Je les masque pour que tout soit plus lisible.`, btn: `<button class="btn small" data-a="dups-ok">OK</button> <button class="btn small" data-a="set-data">Gérer</button>` });
  if (st.settings.googleClientId && Date.now() - st.settings.lastSync > 12 * 3600000) out.push({ c: '#4285F4', ic: '🔄', html: st.settings.lastSync ? `Dernière synchro Google : ${relDay(st.settings.lastSync)}.` : 'Google Agenda est prêt à être connecté.', btn: `<button class="btn small" data-a="sync">Synchroniser</button>` });
  return out;
}

function renderToday() {
  const now = new Date();
  header(cap(fmtDay(now)), `${greetingWord()}, ${set().name || 'toi'}`);
  $('#v-today').innerHTML = set().homeModules.filter(m => m.on && HOME[m.id]).map(m => HOME[m.id]()).join('') +
    `<button class="link-btn" data-a="set-home">✎ Choisir ce qui s'affiche ici</button>`;
}

function weekChart() {
  const ws = startOfWeek(new Date());
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const data = days.map(d => {
    const evs = eventsOfDay(d).filter(e => !e.allDay && e.cat !== 'ferie');
    const by = {};
    evs.forEach(e => { by[e.cat] = (by[e.cat] || 0) + (e.end - e.start) / 3600000; });
    return { d, by, total: Object.values(by).reduce((a, b) => a + b, 0) };
  });
  const max = Math.max(6, ...data.map(x => x.total));
  const used = new Set();
  const bars = data.map(x => {
    const segs = Object.entries(x.by).sort().map(([c, h]) => { used.add(c); return `<i style="height:${h / x.total * 100}%;background:${col(c)}"></i>`; }).join('');
    return `<div class="wb ${sameDay(x.d, new Date()) ? 'today' : ''}" data-a="day" data-d="${ymd(x.d)}"><em>${x.total ? Math.round(x.total * 10) / 10 + 'h' : ''}</em><div class="stack" style="height:${Math.max(3, x.total / max * 100)}%">${segs}</div><span>${JOURS_C[x.d.getDay()]}</span></div>`;
  }).join('');
  const total = data.reduce((a, b) => a + b.total, 0);
  return `<div class="week-bars">${bars}</div><div class="legend">${[...used].map(c => `<span><i style="background:${col(c)}"></i>${esc(catOf(c).label)}</span>`).join('')}<span class="dim" style="margin-left:auto">${Math.round(total)} h au total</span></div>`;
}

// =====================================================================
// CALENDRIER
// =====================================================================
const VIEWS = [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']];
const calView = () => (['day', 'week', 'month'].includes(set().calView) ? set().calView : 'week');

function calTitle(v) {
  if (v === 'month') return cap(`${MOIS[calDate.getMonth()]} ${calDate.getFullYear()}`);
  if (v === 'day') return cap(relDay(calDate) === fmtDayShort(calDate) ? fmtDay(calDate) : relDay(calDate) + ' · ' + fmtDayShort(calDate));
  const a = startOfWeek(calDate), b = addDays(a, 6);
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${MOIS[a.getMonth()]}` : `${a.getDate()} ${MOIS[a.getMonth()].slice(0, 4)}. – ${b.getDate()} ${MOIS[b.getMonth()].slice(0, 4)}.`;
}

function renderCal() {
  const v = calView();
  header(cap(fmtDay(new Date())), 'Mon agenda');
  const body = v === 'month' ? monthView() : v === 'week' ? weekRows() : gridView(1, calDate);
  $('#v-cal').innerHTML = `
    <div class="seg">${VIEWS.map(([k, l]) => `<button class="${k === v ? 'on' : ''}" data-a="view" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="cal-bar">
      <button class="icon-btn" data-a="cal-prev" aria-label="Précédent">${icon('left')}</button>
      <h2>${calTitle(v)}</h2>
      <button class="icon-btn" data-a="cal-next" aria-label="Suivant">${icon('right')}</button>
    </div>
    ${sameDay(calDate, new Date()) && v === 'day' || (v === 'week' && sameDay(startOfWeek(calDate), startOfWeek(new Date()))) || (v === 'month' && calDate.getMonth() === new Date().getMonth() && calDate.getFullYear() === new Date().getFullYear()) ? '' : `<button class="link-btn top" data-a="cal-today">↺ Revenir à aujourd'hui</button>`}
    <div id="cal-body">${body}</div>`;
}

function dayBanner(d) {
  const L = dayLoad(d);
  return `<div class="day-banner" style="--l:${L.c}"><div class="load">${L.emoji} ${L.label}<span>${L.minutes ? fmtDuration(L.minutes * MIN) + ' occupées' : 'libre'}</span></div><p>${esc(briefing(d).replace(/^[^.]+\.\s*/, ''))}</p></div>`;
}

function monthView() {
  const m0 = startOfMonth(calDate);
  const g0 = startOfWeek(m0);
  const evs = eventsBetween(g0.getTime(), addDays(g0, 42).getTime());
  let cells = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(g0, i);
    if (i === 35 && d.getMonth() !== m0.getMonth()) break;
    const a = d.getTime(), b = a + DAY;
    const de = evs.filter(e => e.start < b && e.end > a);
    const vac = de.some(e => e.allDay && e.cat === 'ferie');
    const visible = de.filter(e => !(e.allDay && e.cat === 'ferie'));
    const exam = visible.some(e => e.cat === 'exam' || e.cat === 'echeance');
    const dots = [...new Set(visible.map(e => colEv(e)))].slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('');
    cells += `<div class="mc ${d.getMonth() !== m0.getMonth() ? 'out' : ''} ${sameDay(d, new Date()) ? 'today' : ''} ${sameDay(d, selDay) ? 'sel' : ''} ${vac ? 'vac' : ''} ${exam ? 'exam' : ''}" data-a="sel" data-d="${ymd(d)}">
      <div class="dn">${d.getDate()}</div><div class="dots">${dots}</div></div>`;
  }
  const list = eventsOfDay(selDay);
  return `<div class="month" id="swipe">${cells}</div>
    <div class="legend small"><span><i class="lg-exam"></i>examen ou remise</span><span><i class="lg-vac"></i>vacances</span></div>
    <div class="daylist-h">${cap(['aujourd\'hui', 'demain', 'hier'].includes(relDay(selDay)) ? relDay(selDay) + ' · ' + fmtDayShort(selDay) : fmtDay(selDay))}</div>
    <div class="tl">${timeline(list, { gaps: true })}</div>`;
}

function weekRows() {
  const a = startOfWeek(calDate);
  return `<div id="swipe" class="wrows">${[...Array(7)].map((_, i) => {
    const d = addDays(a, i);
    const evs = eventsOfDay(d);
    const L = dayLoad(d);
    const items = evs.map(e => e.allDay
      ? `<div class="wr-ev allday" style="--c:${colEv(e)}" data-a="ev" data-id="${e.id}">${catOf(e.cat).emoji} ${esc(e.title)}</div>`
      : `<div class="wr-ev ${e.end < Date.now() ? 'past' : ''}" style="--c:${colEv(e)}" data-a="ev" data-id="${e.id}"><b>${hm(e.start)}</b><span>${esc(e.title)}${e.location ? `<small>${esc(e.location)}</small>` : ''}</span></div>`).join('');
    return `<div class="wrow ${sameDay(d, new Date()) ? 'today' : ''}">
      <div class="wr-day" data-a="day" data-d="${ymd(d)}"><span>${JOURS_C[d.getDay()]}</span><b>${d.getDate()}</b><i style="background:${L.c};opacity:${evs.length ? 1 : 0.2}"></i></div>
      <div class="wr-list">${items || `<div class="wr-free" data-a="new-at" data-t="${new Date(d).setHours(10)}">Libre · ajouter</div>`}</div></div>`;
  }).join('')}</div>`;
}

function listView() {
  const a = startOfDay(calDate);
  const evs = eventsBetween(a.getTime(), addDays(a, 60).getTime());
  if (!evs.length) return '<div class="empty">Rien sur les 60 prochains jours.</div>';
  const by = new Map();
  evs.forEach(e => {
    const k = Math.max(startOfDay(e.start).getTime(), a.getTime());
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  });
  return [...by].map(([k, l]) => `<div class="daylist-h" style="${sameDay(k, new Date()) ? 'color:var(--accent)' : ''}">${['aujourd\'hui', 'demain'].includes(relDay(k)) ? cap(relDay(k)) + ' · ' : ''}${fmtDay(k)} <span class="tag">${busyMinutes(l) ? fmtDuration(busyMinutes(l) * MIN) : l.length}</span></div><div class="tl">${timeline(l)}</div>`).join('');
}

function layoutCols(evs) {
  const sorted = [...evs].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [], clusterEnd = 0;
  const flush = () => {
    const cols = [];
    const startIdx = out.length;
    for (const e of cluster) {
      let c = cols.findIndex(end => end <= e.start);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = e.end;
      out.push({ e, c });
    }
    for (let i = startIdx; i < out.length; i++) out[i].n = cols.length;
    cluster = []; clusterEnd = 0;
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push(e); clusterEnd = Math.max(clusterEnd, e.end);
  }
  if (cluster.length) flush();
  return out;
}

const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 58;

function gridView(n, from) {
  const a = startOfDay(from);
  const days = [...Array(n)].map((_, i) => addDays(a, i));
  const all = eventsBetween(a.getTime(), addDays(a, n).getTime());
  let h0 = set().dayStart, h1 = set().dayEnd;
  all.filter(e => !e.allDay).forEach(e => {
    const s = new Date(e.start), en = new Date(e.end);
    if (s >= a) h0 = Math.min(h0, s.getHours());
    if (sameDay(s, en)) h1 = Math.max(h1, en.getHours() + (en.getMinutes() ? 1 : 0));
  });
  h1 = Math.min(24, Math.max(h1, h0 + 6));
  const hp = hourPx();
  const head = days.map(d => `<div class="${sameDay(d, new Date()) ? 'today' : ''}" data-a="day" data-d="${ymd(d)}">${JOURS_C[d.getDay()]}<b>${d.getDate()}</b></div>`).join('');
  const allDay = days.map(d => `<div>${all.filter(e => e.allDay && e.start < d.getTime() + DAY && e.end > d.getTime()).map(e => `<div class="ev" style="--c:${colEv(e)}" data-a="ev" data-id="${e.id}">${esc(e.title)}</div>`).join('')}</div>`).join('');
  const hours = [...Array(h1 - h0)].map((_, i) => `<div>${i ? pad(h0 + i) + 'h' : ''}</div>`).join('');
  const now = Date.now();
  const cols = days.map(d => {
    const d0 = d.getTime();
    const evs = all.filter(e => !e.allDay && e.start < d0 + DAY && e.end > d0);
    const items = layoutCols(evs).map(({ e, c, n: cn }) => {
      const s = Math.max(e.start, d0 + h0 * 3600000), en = Math.min(e.end, d0 + h1 * 3600000);
      const top = (s - d0 - h0 * 3600000) / 3600000 * hp;
      const hgt = Math.max(20, (en - s) / 3600000 * hp - 2);
      const w = 100 / cn;
      return `<div class="gev ${e.end < now ? 'past' : ''}" style="--c:${colEv(e)};top:${top}px;height:${hgt}px;left:calc(${c * w}% + 1px);width:calc(${w}% - 3px)" data-a="ev" data-id="${e.id}"><b>${esc(e.title)}</b>${hgt > 34 ? `<small>${hm(e.start)}–${hm(e.end)}${e.location && hgt > 60 ? ' · ' + esc(e.location) : ''}</small>` : ''}</div>`;
    }).join('');
    const nl = sameDay(d, new Date()) ? `<div class="now-line" style="top:${(now - d0 - h0 * 3600000) / 3600000 * hp}px"></div>` : '';
    return `<div class="col ${sameDay(d, new Date()) ? 'today' : ''}" data-a="slot" data-d="${ymd(d)}" data-h0="${h0}">${items}${nl}</div>`;
  }).join('');
  return `${n > 1 ? `<div class="col-h">${head}</div>` : ''}${all.some(e => e.allDay) ? `<div class="allday-row">${allDay}</div>` : ''}
    <div class="grid-wrap ${n === 7 ? 'tight' : ''}" id="swipe"><div class="hours">${hours}</div><div class="cols" style="grid-template-columns:repeat(${n},1fr);height:${(h1 - h0) * hp}px">${cols}</div></div>`;
}

function scrollGridToNow() {
  requestAnimationFrame(() => {
    const nl = document.querySelector('.now-line');
    if (nl) $('#main').scrollTop = Math.max(0, nl.getBoundingClientRect().top + $('#main').scrollTop - 280);
  });
}

function calShift(dir) {
  const v = calView();
  if (v === 'month') { calDate = new Date(calDate.getFullYear(), calDate.getMonth() + dir, 1); selDay = sameDay(startOfMonth(new Date()), calDate) ? startOfDay(new Date()) : calDate; }
  else calDate = addDays(calDate, dir * (v === 'week' ? 7 : 1));
  renderCal();
  if (v === 'day') scrollGridToNow();
}

// =====================================================================
// MÉMO : échéancier + notes
// =====================================================================
function renderTodo() {
  header('À faire', 'Mes échéances');
  $('#v-todo').innerHTML = dueView();
}
function renderNotes() {
  header('Notes', 'À ne pas oublier');
  $('#v-notes').innerHTML = notesView();
}

function dueView() {
  const all = deadlines({ includeDone: dueFilter === 'done' });
  let list = all;
  if (dueFilter === 'exam') list = all.filter(d => d.kind === 'event');
  if (dueFilter === 'task') list = all.filter(d => d.kind === 'task');
  if (dueFilter === 'done') list = all.filter(d => d.done).reverse();
  else list = list.filter(d => !d.done);
  const t0 = startOfDay(new Date()).getTime();
  const nodate = S().tasks.filter(t => !t.due && !t.done);
  const groups = [
    ['En retard', d => d.due < t0, 'var(--danger)'],
    ["Aujourd'hui", d => d.due >= t0 && d.due < t0 + DAY, 'var(--danger)'],
    ['Cette semaine', d => d.due >= t0 + DAY && d.due < t0 + 7 * DAY, 'var(--warn)'],
    ['Plus tard', d => d.due >= t0 + 7 * DAY && (showAllDue || d.due < t0 + 45 * DAY), 'var(--muted)'],
  ];
  let body = '';
  if (dueFilter === 'done') body = list.length ? list.map(dueItem).join('') : '<div class="empty">Rien de terminé pour l\'instant.</div>';
  else {
    for (const [label, fn, c] of groups) {
      const g = list.filter(fn);
      if (g.length) body += `<div class="group-h" style="color:${c}">${label}</div>` + g.map(dueItem).join('');
    }
    const hiddenLater = list.filter(d => d.due >= t0 + 45 * DAY).length;
    if (!showAllDue && hiddenLater) body += `<button class="link-btn" data-a="due-more">Voir les ${hiddenLater} suivantes</button>`;
    if (dueFilter !== 'exam' && nodate.length) body += `<div class="group-h">Sans date</div>` + nodate.map(t => dueItem({ kind: 'task', id: t.id, title: t.title, due: null, cat: t.cat, done: false, priority: t.priority, ref: t })).join('');
    if (!body) body = '<div class="empty big-empty">Rien à faire 🎉<br><small>Ajoute une tâche avec le bouton +</small></div>';
  }
  return `
    ${quickBar('q-due', 'Ajouter… ex : « dossier stage pour vendredi »')}
    <div class="seg small">${[['all', 'Tout'], ['exam', 'Examens'], ['task', 'Mes tâches'], ['done', 'Fait']].map(([k, l]) => `<button class="${dueFilter === k ? 'on' : ''}" data-a="due-f" data-f="${k}">${l}</button>`).join('')}</div>
    ${body}`;
}

function notesView() {
  const q = norm(noteQuery);
  const subjs = subjects();
  const allNotes = S().notes;
  let notes = allNotes.filter(n => !q || norm(n.title + ' ' + n.text).includes(q));
  if (noteFolder.startsWith('s:')) notes = notes.filter(n => n.subject === noteFolder.slice(2));
  else if (noteFolder !== 'Tout') notes = notes.filter(n => (n.folder || 'Perso') === noteFolder);
  notes.sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated);
  const usedFolders = NOTE_FOLDERS.slice(1).filter(f => allNotes.some(n => (n.folder || 'Perso') === f));
  const usedSubjects = subjs.filter(s => allNotes.some(n => n.subject === s.key));
  const showFilters = usedFolders.length + usedSubjects.length > 1;
  return `
    ${quickBar('q-note', 'Note rapide… (« [ ] » = case à cocher)')}
    ${allNotes.length > 6 ? `<div class="search">${icon('search')}<input id="note-q" placeholder="Rechercher" value="${esc(noteQuery)}"></div>` : ''}
    ${showFilters ? `<div class="chips">${['Tout', ...usedFolders].map(f => `<button class="chip ${noteFolder === f ? 'on' : ''}" data-a="note-f" data-f="${f}">${f}</button>`).join('')}${usedSubjects.map(s => `<button class="chip ${noteFolder === 's:' + s.key ? 'on' : ''}" data-a="note-f" data-f="s:${esc(s.key)}">${esc(s.name)}</button>`).join('')}</div>` : ''}
    ${notes.length ? noteGrid(notes) : `<div class="empty big-empty">${q ? 'Aucun résultat.' : 'Aucune note ✍️<br><small>Écris ce que tu ne veux pas oublier</small>'}</div>`}`;
}

// =====================================================================
// MOI : profil, focus, objectifs, matières, comptes à rebours, stats
// =====================================================================


const ME_SEGS = [['goals', 'Objectifs'], ['subjects', 'Matières'], ['focus', 'Focus'], ['stats', 'Stats'], ['cds', 'Dates']];
function renderMe() {
  const s = set();
  header('Mon espace', s.name);
  const seg = ME_SEGS.some(([k]) => k === s.meSeg) ? s.meSeg : 'goals';
  let body = '';
  if (seg === 'goals') body = s.goals.length ? `<div class="goals">${s.goals.map(goalTile).join('')}</div><button class="link-btn" data-a="set-goals">✎ Gérer mes objectifs</button>` : `<div class="empty">Aucun objectif.</div><button class="btn block" data-a="set-goals">+ Ajouter un objectif</button>`;
  if (seg === 'subjects') { const subs = subjects(); body = subs.length ? subs.map(subjRow).join('') : '<div class="empty">Tes matières apparaissent toutes seules à partir de tes cours (CM, TD, CC…).</div>'; }
  if (seg === 'focus') body = focusBlock();
  if (seg === 'stats') body = statsCard();
  if (seg === 'cds') { const cds = countdownList(); body = (cds.length ? `<div class="cds">${cds.map(cdTile).join('')}</div>` : '<div class="empty">Aucune date pour l\'instant.</div>') + `<button class="link-btn" data-a="cd-new">+ Ajouter une date importante</button>`; }
  $('#v-me').innerHTML = `
    <div class="profile">
      <div class="avatar big" data-a="settings">${esc(s.avatar)}</div>
      <div class="grow"><h2>${esc(s.name)}</h2><div class="muted small">Ton espace perso</div></div>
      <button class="btn small" data-a="settings">${icon('gear')} Réglages</button>
    </div>
    <div class="chips me-tabs">${ME_SEGS.map(([k, l]) => `<button class="chip ${seg === k ? 'on' : ''}" data-a="me-seg" data-s="${k}">${l}</button>`).join('')}</div>
    <div class="card">${body}</div>`;
}

function statsCard() {
  const st = stats(statPeriod);
  const cats = Object.entries(st.byCat).filter(([k]) => k !== 'ferie').sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map(c => c[1]));
  return `
    <div class="seg small">${[['week', 'Cette semaine'], ['month', 'Ce mois-ci']].map(([k, l]) => `<button class="${statPeriod === k ? 'on' : ''}" data-a="stat-p" data-p="${k}">${l}</button>`).join('')}</div>
    <div class="big-num">${Math.round(st.total)} h <span>programmées</span></div>
    ${cats.map(([k, h]) => `<div class="bar-row"><span>${catOf(k).emoji} ${esc(catOf(k).label)}</span><div class="bar"><i style="width:${h / max * 100}%;background:${col(k)}"></i></div><b>${Math.round(h * 10) / 10}h</b></div>`).join('') || '<div class="empty">Pas encore de données.</div>'}`;
}

// =====================================================================
// FOCUS (minuteur de révision)
// =====================================================================
function focusBlock() {
  const run = set().focusRun;
  const subs = subjects();
  if (run) {
    const left = Math.max(0, run.start + run.len * MIN - Date.now());
    const pct = 1 - left / (run.len * MIN);
    const sname = subs.find(s => s.key === run.subject)?.name || 'Révision libre';
    return `<div class="focus-run">${ring(pct, 'var(--accent)', `<b id="focus-time">${fmtClock(left)}</b>`, 120)}
      <div class="grow"><b>${esc(sname)}</b><div class="muted small">Concentre-toi, je m'occupe du reste. La séance comptera dans tes révisions.</div>
      <div class="row wrap" style="margin-top:10px"><button class="btn small" data-a="focus-stop">Terminer</button><button class="btn small danger" data-a="focus-cancel">Annuler</button></div></div></div>`;
  }
  const today = S().focus.filter(f => sameDay(f.start, new Date())).reduce((n, f) => n + (f.end - f.start) / MIN, 0);
  return `<div class="focus-start">
    <select id="focus-subj" class="inp"><option value="">✦ Révision libre</option>${subs.map(s => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select>
    <div class="row">${[25, 50, 90].map(m => `<button class="btn grow" data-a="focus-go" data-m="${m}">▶ ${m} min</button>`).join('')}</div>
    ${today ? `<div class="dim small">Aujourd'hui : ${fmtDuration(today * MIN)} de focus 💪</div>` : ''}</div>`;
}
const fmtClock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
function focusTick() {
  const run = set().focusRun;
  if (!run) return;
  const left = run.start + run.len * MIN - Date.now();
  const el = document.getElementById('focus-time');
  if (el) el.textContent = fmtClock(Math.max(0, left));
  if (left <= 0) finishFocus(true);
}
function finishFocus(completed) {
  const run = set().focusRun;
  if (!run) return;
  const end = Math.min(Date.now(), run.start + run.len * MIN);
  if (end - run.start >= 5 * MIN) S().focus.push({ start: run.start, end, subject: run.subject });
  set().focusRun = null;
  save();
  if (completed) notify('🧠 Séance terminée !', `${run.len} min de focus. Fais une pause de 5 min.`);
  render();
}

// =====================================================================
// ASSISTANT
// =====================================================================
const SUGG = [
  "Qu'est-ce que j'ai demain ?",
  'Quand est ma prochaine boxe ?',
  'Ajoute boxe vendredi 21h',
  'Planifie mes révisions',
];

function renderAi() {
  header('Assistant', 'Dis-moi tout');
  const chat = S().chat;
  const msgs = chat.map((m, i) => `<div class="msg ${m.role}">${esc(m.text)}${m.acts?.length ? `<div class="acts">${m.acts.map((a, j) => `<div class="act" style="--c:${col(a.cat)}"><div class="grow">${esc(a.label)}</div>${undoBag.has(`${i}:${j}`) ? `<button data-a="undo" data-k="${i}:${j}">Annuler</button>` : ''}${a.g ? `<a class="gbtn" href="${esc(a.g)}" target="_blank" rel="noopener">+ Google</a>` : ''}</div>`).join('')}</div>` : ''}</div>`).join('');
  $('#v-ai').innerHTML = chat.length
    ? `<div class="chat">${msgs}</div><button class="link-btn" data-a="chat-clear">Effacer la conversation</button>`
    : `<div class="ai-hello"><div class="orb">${icon('spark')}</div><h2>Que veux-tu faire ?</h2><p>Écris ou appuie sur le micro 🎙️<br>Je range tout dans ton agenda.</p></div>
       <div class="sugg">${SUGG.map(s => `<button class="chip" data-a="sugg">${esc(s)}</button>`).join('')}</div>`;
  if (!$('#q-ai')) $('#ai-bar').innerHTML = quickBar('q-ai', 'Écris ici…');
}

async function runAssistant(text, { stay = false } = {}) {
  const st = S();
  text = text.trim();
  if (!text) return;
  st.chat.push({ role: 'user', text });
  st.chat.push({ role: 'assistant', text: '…' });
  if (st.chat.length > 60) st.chat.splice(0, st.chat.length - 60);
  save();
  if (tab === 'ai') { renderAi(); $('#main').scrollTop = 1e6; }
  let res;
  try {
    res = st.settings.claudeKey ? await askClaude(text) : localAssistant(text);
  } catch (err) {
    console.warn(err);
    res = localAssistant(text);
    res.reply = `(IA en ligne indisponible : ${err.message || err}. Je fais au mieux hors-ligne.)\n` + res.reply;
  }
  const idx = st.chat.length - 1;
  const acts = await applyActions(res.actions || [], idx);
  st.chat[idx] = { role: 'assistant', text: res.reply, acts: acts.map(a => ({ label: a.label, cat: a.cat, g: a.g || '' })) };
  save();
  if (set().voiceReply) speak(res.reply);
  if (tab === 'ai') { renderAi(); $('#main').scrollTop = 1e6; }
  else if (acts.length && stay) { render(); toast(res.reply, acts.length === 1 ? { label: 'Annuler', fn: () => doUndo(`${idx}:0`) } : null); }
  else go('ai');
}

async function applyActions(actions, msgIdx) {
  const out = [];
  for (const a of actions) {
    let r = null;
    try {
      if (a.type === 'create_event' && a.start) {
        const ev = addEvent({ title: a.title || 'Événement', start: a.start, end: a.end || a.start + 3600000, allDay: !!a.allDay, location: a.location || '', cat: a.category || guessCat(a.title || '') });
        gpush(ev);
        r = { label: `＋ ${ev.title} · ${relDay(ev.start)}${ev.allDay ? '' : ' ' + hm(ev.start) + '–' + hm(ev.end)}`, cat: ev.cat, g: set().googleConnected ? '' : googleAddUrl(ev), undo: () => { deleteEvent(ev.id); flushDeletes(); } };
      } else if (a.type === 'update_event' && a.id) {
        const ev = S().events.find(e => e.id === a.id);
        if (!ev) continue;
        const before = { ...ev };
        const patch = {};
        if (a.title) patch.title = a.title;
        if (a.start) { patch.start = a.start; patch.end = a.end || a.start + (ev.end - ev.start); patch.allDay = !!a.allDay; }
        if (a.location) patch.location = a.location;
        if (a.category) { patch.cat = a.category; patch.catLocked = true; }
        updateEvent(ev.id, patch); gpush(ev);
        r = { label: `✎ ${ev.title} → ${relDay(ev.start)}${ev.allDay ? '' : ' ' + hm(ev.start)}`, cat: ev.cat, undo: () => { Object.assign(ev, before, { dirty: true }); save(); gpush(ev); } };
      } else if (a.type === 'delete_event' && a.id) {
        const ev = S().events.find(e => e.id === a.id);
        if (!ev) continue;
        const copy = { ...ev };
        deleteEvent(ev.id); flushDeletes();
        r = { label: `✕ ${copy.title} supprimé`, cat: copy.cat, undo: () => { const { id, gid, ...rest } = copy; gpush(addEvent({ ...rest, source: 'local' })); } };
      } else if (a.type === 'add_task') {
        const t = addTask({ title: a.title || 'Tâche', due: a.due ?? a.start ?? null, dueTime: !!a.dueTime, priority: a.priority || 'normale', cat: a.category || undefined });
        r = { label: `☐ ${t.title}${t.due ? ' · ' + relDay(t.due) + (t.dueTime ? ' ' + hm(t.due) : '') : ''}`, cat: t.cat, undo: () => deleteTask(t.id) };
      } else if (a.type === 'complete_task' && a.id) {
        const t = updateTask(a.id, { done: true, doneAt: Date.now() });
        if (t) r = { label: `✔ ${t.title}`, cat: t.cat, undo: () => updateTask(t.id, { done: false }) };
      } else if (a.type === 'delete_task' && a.id) {
        const t = S().tasks.find(x => x.id === a.id);
        if (t) { const c = { ...t }; deleteTask(t.id); r = { label: `✕ ${c.title}`, cat: c.cat, undo: () => { S().tasks.push(c); save(); } }; }
      } else if (a.type === 'add_note') {
        const body = a.text || a.title || '';
        const n = addNote({ title: a.text && a.title && a.title !== a.text ? a.title : '', text: body, pinned: true, folder: 'Perso' });
        r = { label: `📝 ${body.slice(0, 60)}`, cat: 'perso', undo: () => deleteNote(n.id) };
      }
    } catch (e) { console.warn('action', a, e); }
    if (r) { undoBag.set(`${msgIdx}:${out.length}`, r.undo); out.push(r); }
  }
  return out;
}

function doUndo(k) {
  const fn = undoBag.get(k);
  if (!fn) return;
  fn();
  undoBag.delete(k);
  const [i, j] = k.split(':').map(Number);
  const m = S().chat[i];
  if (m?.acts?.[j]) m.acts[j].label = '↩︎ annulé : ' + m.acts[j].label;
  save(); render(); toast('Annulé');
}

// =====================================================================
// Google
// =====================================================================
function gpush(ev) {
  if (!ev || !set().googleConnected) return;
  G.pushEvent(ev).catch(err => { console.warn(err); toast('Hors ligne : ce sera envoyé à Google à la prochaine synchro.'); });
}
function flushDeletes() {
  if (!set().googleConnected) return;
  const st = S();
  for (const t of [...st.tombstones]) {
    G.removeRemote(t.gid, t.calId).then(() => { st.tombstones = st.tombstones.filter(x => x !== t); save(); }).catch(() => {});
  }
}
async function syncNow() {
  const b = $('#btn-sync');
  if (!set().googleClientId) { openConnect(); toast('Ajoute d\'abord ton identifiant Google (guide juste ici).'); return; }
  b.classList.add('spin');
  try {
    const r = await G.syncAll();
    toast(`Google Agenda synchronisé : ${r.count} événements (${r.calendars} agendas).`);
  } catch (e) {
    toast('Synchro impossible : ' + (e.message || e));
  } finally { b.classList.remove('spin'); render(); }
}

// =====================================================================
// Feuilles
// =====================================================================
let sheetBack = null;
function openSheet(html, back = null) {
  sheetBack = back;
  $('#sheet-body').innerHTML = html;
  $('#sheet-wrap').hidden = false;
  $('#sheet').scrollTop = 0;
}
function closeSheet() { $('#sheet-wrap').hidden = true; $('#sheet-body').innerHTML = ''; sheetBack = null; }
const shTitle = (t, back = false) => `<div class="sh-title">${back ? `<button type="button" class="icon-btn" data-a="sheet-back" aria-label="Retour">${icon('left')}</button>` : ''}<span class="grow">${t}</span><button type="button" class="icon-btn" data-a="close" aria-label="Fermer">${icon('x')}</button></div>`;

// ---------- Événement : fiche détaillée ----------
const TRAVELS = [0, 10, 15, 20, 30, 45, 60];
// Lien « ajouter à Google Agenda » : ouvre Google Agenda pré-rempli, sans aucun réglage
function googleAddUrl(e) {
  const z = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dates = e.allDay ? `${ymd(e.start).replace(/-/g, '')}/${ymd(e.end).replace(/-/g, '')}` : `${z(e.start)}/${z(e.end)}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates });
  if (e.location) q.set('location', e.location);
  if (e.notes) q.set('details', e.notes);
  return 'https://calendar.google.com/calendar/render?' + q;
}
const inGoogle = e => e.source === 'google' || e.gid || e.addedToGoogle;

function openEvent(id) {
  const e = S().events.find(x => x.id === id);
  if (!e) return;
  const c = catOf(e.cat);
  const when = e.allDay
    ? (e.end - e.start > DAY ? `Du ${fmtDay(e.start)} au ${fmtDay(e.end - DAY)}` : cap(fmtDay(e.start)))
    : `${cap(fmtDay(e.start))}<br><b>${hm(e.start)} – ${hm(e.end)}</b> <span class="dim">(${fmtDuration(e.end - e.start)})</span>`;
  const subj = subjectOf(e);
  const tr = travelOf(e);
  const future = e.start > Date.now();
  const nBring = (e.bring || []).length;
  openSheet(`<div class="ev-detail">
    <div class="row" style="margin-bottom:6px"><span class="tag" style="background:${colEv(e)};color:#111">${c.emoji} ${esc(c.label)}</span>${future ? `<span class="tag">${countdown(e.start)}</span>` : ''}
      <button class="icon-btn" style="margin-left:auto;color:${e.star ? 'var(--accent)' : 'var(--dim)'}" data-a="ev-star" data-id="${e.id}" aria-label="Important">${icon(e.star ? 'star-f' : 'star')}</button><button class="icon-btn" data-a="close" aria-label="Fermer">${icon('x')}</button></div>
    <div class="big">${esc(e.title)}</div>
    <div class="line">${icon('clock')}<div>${when}</div></div>
    ${e.location ? `<div class="line">${icon('place')}<div><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}" target="_blank" rel="noopener">${esc(e.location)}</a></div></div>` : ''}
    ${tr && future && !e.allDay ? `<div class="line go">${icon('walk')}<div>Partir à <b>${hm(e.start - tr * MIN)}</b></div></div>` : ''}
    ${subj ? `<button class="subj-link" data-a="subj" data-k="${esc(subj.key)}" style="--s:${subjectColor(subj.key)}">📚 ${esc(subj.name)} <span>›</span></button>` : ''}
    ${e.bring?.length ? `<div class="bring-line">🎒 ${e.bring.map(b => `<span class="${b.done ? 'ok' : ''}">${esc(b.t)}</span>`).join('')}</div>` : ''}
    ${e.memo ? `<div class="notes">📝 ${esc(e.memo)}</div>` : ''}
    <div class="actions">
      <button class="btn gold" data-a="ev-edit" data-id="${e.id}">Modifier</button>
      <button class="btn danger" data-a="ev-del" data-id="${e.id}">Supprimer</button>
    </div>
    ${!inGoogle(e) ? `<a class="btn block gbtn-big" href="${esc(googleAddUrl(e))}" target="_blank" rel="noopener" data-a="g-added" data-id="${e.id}">${icon('google')} Ajouter aussi à Google Agenda</a>` : ''}
    ${(e.cat === 'exam' || e.cat === 'echeance') && future ? `<button class="btn block" style="margin-top:8px" data-a="plan-rev" data-id="${e.id}">🧠 Planifier des révisions</button>` : ''}
    <details class="more-opts"><summary>Plus d'options</summary>
      ${!e.allDay && future ? `<div class="sub-h">🚶 Temps de trajet</div><div class="chips">${TRAVELS.map(m => `<button class="chip ${tr === m ? 'on' : ''}" data-a="ev-travel" data-id="${e.id}" data-m="${m}">${m ? m + ' min' : 'Aucun'}</button>`).join('')}</div>` : ''}
      <div class="sub-h">🎒 À apporter${nBring ? ` (${nBring})` : ''}</div>
      <div class="bring">${(e.bring || []).map((b, i) => `<div class="ck ${b.done ? 'on' : ''}" data-a="ev-bring" data-id="${e.id}" data-i="${i}"><span class="box">${b.done ? '✓' : ''}</span><span class="grow">${esc(b.t)}</span><button class="x-mini" data-a="ev-bring-del" data-id="${e.id}" data-i="${i}" aria-label="Retirer">✕</button></div>`).join('')}
        <form class="mini-form" data-form="bring" data-id="${e.id}"><input class="inp grow" placeholder="Ex : calculatrice"><button class="btn small">Ajouter</button></form></div>
      <div class="sub-h">📝 Ma note</div>
      <textarea class="memo" data-memo="${e.id}" placeholder="À retenir…">${esc(e.memo || '')}</textarea>
      <div class="sub-h">Catégorie</div>
      <div class="chips wrap">${Object.entries(CATS).map(([k, cc]) => `<button class="chip ${e.cat === k ? 'on' : ''}" data-a="ev-cat" data-id="${e.id}" data-cat="${k}" style="${e.cat === k ? `background:${cc.color};color:#111` : ''}">${cc.emoji} ${esc(cc.label)}</button>`).join('')}</div>
      ${e.notes ? `<div class="sub-h">Description</div><div class="notes">${esc(e.notes)}</div>` : ''}
      <button class="btn block" style="margin-top:12px" data-a="ev-dup" data-id="${e.id}">Dupliquer</button>
    </details>
  </div>`);
}

// ---------- Événement : édition ----------
const REMINDERS = [[null, 'Par défaut'], [0, 'À l\'heure'], [10, '10 min avant'], [30, '30 min avant'], [60, '1 h avant'], [120, '2 h avant'], [1440, 'La veille']];
const EV_COLORS = ['', '#5b8def', '#38c6f4', '#2fd1a5', '#7ee081', '#d9b26a', '#ff9f43', '#ff5d6c', '#f472b6', '#c47dff', '#8b95a7'];

function editEvent(id, preset = {}) {
  const e = id ? S().events.find(x => x.id === id) : null;
  const st = preset.start || nextHalfHour();
  const base = e || { title: '', start: st, end: st + 3600000, allDay: false, location: '', notes: '', cat: '', reminder: null, color: '', star: false, ...preset };
  const catOpts = Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${base.cat === k ? 'selected' : ''}>${c.emoji} ${esc(c.label)}</option>`).join('');
  openSheet(`<form id="ev-form">
    ${shTitle(e ? 'Modifier' : 'Nouvel événement')}
    <div class="field"><input name="title" class="big-input" value="${esc(base.title)}" placeholder="Quoi ? (ex : Boxe, RDV médecin…)" required></div>
    <div class="field"><label>Quand ?</label><input type="date" name="date" value="${ymd(base.start)}" required></div>
    <div class="fields2 tm">
      <div class="field"><label>De</label><input type="time" name="t1" value="${hm2(base.start)}"></div>
      <div class="field"><label>À</label><input type="time" name="t2" value="${hm2(base.end)}"></div>
    </div>
    <div class="field"><label>Où ? (facultatif)</label><input name="location" value="${esc(base.location)}" placeholder="Salle, adresse…"></div>
    <button class="btn gold block">${e ? 'Enregistrer' : 'Ajouter'}</button>
    <details class="more-opts"><summary>Plus d'options</summary>
      <div class="switch">Toute la journée<button type="button" class="tg ${base.allDay ? 'on' : ''}" data-a="tg" data-name="allDay"></button><input type="hidden" name="allDay" value="${base.allDay ? 1 : 0}"></div>
      <div class="field" style="margin-top:12px"><label>Jusqu'au (plusieurs jours)</label><input type="date" name="date2" value="${ymd(base.allDay ? base.end - DAY : base.end)}"></div>
      ${e ? '' : `<div class="field"><label>Répéter</label><select name="repeat"><option value="0">Non</option><option value="w4">Chaque semaine (4 fois)</option><option value="w8">Chaque semaine (8 fois)</option><option value="w15">Chaque semaine (tout le semestre)</option><option value="d5">Chaque jour (5 jours)</option></select></div>`}
      <div class="field"><label>Catégorie</label><select name="cat"><option value="">Automatique</option>${catOpts}</select></div>
      <div class="fields2">
        <div class="field"><label>Rappel</label><select name="reminder">${REMINDERS.map(([v, l]) => `<option value="${v ?? ''}" ${base.reminder === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Trajet</label><select name="travel"><option value="">Par défaut</option>${TRAVELS.map(m => `<option value="${m}" ${base.travel === m ? 'selected' : ''}>${m ? m + ' min' : 'Aucun'}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Couleur</label><div class="swatches">${EV_COLORS.map(c => `<button type="button" class="sw ${(base.color || '') === c ? 'on' : ''} ${c ? '' : 'auto'}" style="--c:${c || 'var(--bg4)'}" data-a="sw" data-c="${c}" aria-label="${c || 'Automatique'}">${c ? '' : 'A'}</button>`).join('')}</div><input type="hidden" name="color" value="${base.color || ''}"></div>
      <div class="switch">⭐ Important<button type="button" class="tg ${base.star ? 'on' : ''}" data-a="tg" data-name="star"></button><input type="hidden" name="star" value="${base.star ? 1 : 0}"></div>
      <div class="field" style="margin-top:12px"><label>Description</label><textarea name="notes">${esc(base.notes)}</textarea></div>
    </details>
    <input type="hidden" name="id" value="${e?.id || ''}">
  </form>`);
  toggleTimeFields();
  if (!e) setTimeout(() => $('#ev-form [name=title]')?.focus(), 60);
}
function toggleTimeFields() {
  const f = $('#ev-form');
  if (!f) return;
  const all = f.allDay.value === '1';
  f.querySelectorAll('.tm').forEach(x => { x.hidden = all; });
}
function nextHalfHour() { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); return d.getTime(); }

function saveEventForm(f) {
  const d1 = fromYmd(f.date.value), d2 = f.date2.value ? fromYmd(f.date2.value) : d1;
  const allDay = f.allDay.value === '1';
  let start, end;
  if (allDay) { start = d1.getTime(); end = Math.max(d2.getTime(), start) + DAY; }
  else {
    const [h1, m1] = (f.t1.value || '09:00').split(':').map(Number);
    const [h2, m2] = (f.t2.value || '10:00').split(':').map(Number);
    start = new Date(d1).setHours(h1, m1, 0, 0);
    end = new Date(d2 < d1 ? d1 : d2).setHours(h2, m2, 0, 0);
    if (end <= start) end = start + 3600000;
  }
  const data = {
    title: f.title.value.trim() || 'Sans titre', allDay, start, end,
    location: f.location.value.trim(), notes: f.notes.value.trim(),
    reminder: f.reminder.value === '' ? null : +f.reminder.value,
    color: f.color.value, star: f.star.value === '1',
  };
  if (f.travel.value !== '') data.travel = +f.travel.value;
  data.cat = f.cat.value || guessCat(data.title, data.notes);
  if (f.cat.value) data.catLocked = true;
  let ev;
  if (f.id.value) ev = updateEvent(f.id.value, data);
  else {
    ev = addEvent(data);
    const rep = f.repeat?.value || '0';
    if (rep !== '0') {
      const step = rep[0] === 'w' ? 7 : 1, n = +rep.slice(1);
      for (let i = 1; i < n; i++) gpush(addEvent({ ...data, start: addDays(new Date(start), step * i).getTime(), end: addDays(new Date(end), step * i).getTime() }));
    }
  }
  gpush(ev);
  closeSheet();
  selDay = startOfDay(ev.start);
  render();
  if (!f.id.value && set().googleAddPrompt && !set().googleConnected) toast(`Ajouté ✓ ${ev.title}, ${relDay(ev.start)}${ev.allDay ? '' : ' à ' + hm(ev.start)}`, { label: '+ Google', href: googleAddUrl(ev), fn: () => { ev.addedToGoogle = true; save(); } });
  else toast(f.id.value ? 'Modifié ✓' : `Ajouté ✓ ${ev.title}, ${relDay(ev.start)}${ev.allDay ? '' : ' à ' + hm(ev.start)}`);
}

// ---------- Tâches ----------
function editTask(id, preset = {}) {
  const t = id ? S().tasks.find(x => x.id === id) : null;
  const b = t || { title: '', due: null, dueTime: false, priority: 'normale', cat: '', ...preset };
  openSheet(`<form id="task-form">
    ${shTitle(t ? 'Modifier la tâche' : 'Nouvelle échéance')}
    <div class="field"><label>Quoi ?</label><input name="title" value="${esc(b.title)}" placeholder="Ex : Rendre le guide d'entretien" required></div>
    <div class="chips">${[['Aujourd\'hui', 0], ['Demain', 1], ['Dans 3 j', 3], ['Dans 1 sem.', 7], ['Sans date', -1]].map(([l, n]) => `<button type="button" class="chip" data-a="task-quick-date" data-n="${n}">${l}</button>`).join('')}</div>
    <div class="fields2">
      <div class="field"><label>Pour le</label><input type="date" name="date" value="${b.due ? ymd(b.due) : ''}"></div>
      <div class="field"><label>Heure (option)</label><input type="time" name="time" value="${b.due && b.dueTime ? hm2(b.due) : ''}"></div>
    </div>
    <div class="field"><label>Priorité</label><div class="seg">${['haute', 'normale', 'basse'].map(p => `<button type="button" class="${b.priority === p ? 'on' : ''}" data-a="prio" data-p="${p}">${p === 'haute' ? '🔴 Haute' : p === 'normale' ? '🟡 Normale' : '🟢 Basse'}</button>`).join('')}</div><input type="hidden" name="priority" value="${b.priority}"></div>
    <button class="btn gold block">${t ? 'Enregistrer' : 'Ajouter à l\'échéancier'}</button>
    ${t ? `<div class="actions"><button type="button" class="btn" data-a="task-done" data-id="${t.id}">${t.done ? 'Rouvrir' : '✓ Terminé'}</button><button type="button" class="btn" data-a="task-to-ev" data-id="${t.id}">📅 Bloquer un créneau</button><button type="button" class="btn danger" data-a="task-del" data-id="${t.id}">Supprimer</button></div>` : ''}
    <input type="hidden" name="id" value="${t?.id || ''}">
  </form>`);
}
function saveTaskForm(f) {
  let due = null, dueTime = false;
  if (f.date.value) {
    const d = fromYmd(f.date.value);
    if (f.time.value) { const [h, m] = f.time.value.split(':').map(Number); d.setHours(h, m); dueTime = true; }
    due = d.getTime();
  }
  const data = { title: f.title.value.trim() || 'Tâche', due, dueTime, priority: f.priority.value };
  data.cat = guessCat(data.title);
  if (f.id.value) updateTask(f.id.value, data); else addTask(data);
  closeSheet(); render(); toast('Échéancier mis à jour ✓');
}

// ---------- Notes ----------
function editNote(id, preset = {}) {
  const n = id ? S().notes.find(x => x.id === id) : null;
  const b = n || { title: '', text: '', color: 'gold', pinned: false, remind: null, folder: noteFolder.startsWith('s:') ? 'Cours' : noteFolder === 'Tout' ? 'Perso' : noteFolder, subject: noteFolder.startsWith('s:') ? noteFolder.slice(2) : '', ...preset };
  const subs = subjects();
  openSheet(`<form id="note-form">
    ${shTitle(n ? 'Note' : 'Nouvelle note')}
    <div class="field"><input name="title" value="${esc(b.title)}" placeholder="Titre (facultatif)"></div>
    <div class="field"><textarea name="text" id="note-text" placeholder="Ce que je ne dois pas oublier…" style="min-height:170px">${esc(b.text)}</textarea>
      <div class="row" style="margin-top:6px"><button type="button" class="btn small" data-a="note-add-chk">☑ Case à cocher</button></div></div>
    <div class="fields2">
      <div class="field"><label>Dossier</label><select name="folder">${NOTE_FOLDERS.slice(1).map(f => `<option ${(b.folder || 'Perso') === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      <div class="field"><label>Matière</label><select name="subject"><option value="">—</option>${subs.map(s => `<option value="${esc(s.key)}" ${b.subject === s.key ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Couleur</label><div class="swatches">${Object.entries(NOTE_COLORS).map(([k, c]) => `<button type="button" class="sw ${b.color === k ? 'on' : ''}" style="--c:${c}" data-a="sw" data-c="${k}" aria-label="${k}"></button>`).join('')}</div><input type="hidden" name="color" value="${b.color}"></div>
    <div class="switch">📌 Épingler sur l'accueil<button type="button" class="tg ${b.pinned ? 'on' : ''}" data-a="tg" data-name="pinned"></button><input type="hidden" name="pinned" value="${b.pinned ? 1 : 0}"></div>
    <div class="field" style="margin-top:12px"><label>⏰ Me le rappeler</label><input type="datetime-local" name="remind" value="${b.remind ? ymd(b.remind) + 'T' + hm2(b.remind) : ''}"></div>
    <button class="btn gold block">Enregistrer</button>
    ${n ? `<div class="actions"><button type="button" class="btn" data-a="note-task" data-id="${n.id}">→ En tâche</button><button type="button" class="btn danger" data-a="note-del" data-id="${n.id}">Supprimer</button></div>` : ''}
    <input type="hidden" name="id" value="${n?.id || ''}">
  </form>`);
}
function saveNoteForm(f) {
  const data = { title: f.title.value.trim(), text: f.text.value.replace(/\s+$/, ''), color: f.color.value, pinned: f.pinned.value === '1', remind: f.remind.value ? new Date(f.remind.value).getTime() : null, reminded: false, folder: f.folder.value, subject: f.subject.value };
  if (!data.text && !data.title) { closeSheet(); return; }
  if (f.id.value) updateNote(f.id.value, data); else addNote(data);
  closeSheet(); render(); toast('Note enregistrée ✓');
}

// ---------- Matière ----------
function openSubject(key) {
  const s = subjects().find(x => x.key === key);
  if (!s) return;
  const now = Date.now();
  const upcoming = s.sessions.filter(e => e.end > now).slice(0, 5);
  const exams = s.exams.filter(e => e.end > now);
  const revs = s.revisions.filter(e => e.end > now);
  openSheet(`${shTitle(`<span class="sdot big" style="--s:${s.color}"></span>${esc(s.name)}`)}
    <div class="stats">
      <div class="stat"><b>${Math.round(s.hoursWeek * 10) / 10}h</b><span>cette semaine</span></div>
      <div class="stat"><b>${Math.round(s.hoursTotal)}h</b><span>de cours au total</span></div>
      <div class="stat"><b>${s.focusMin ? fmtDuration(s.focusMin * MIN) : '0'}</b><span>de focus</span></div>
    </div>
    ${s.teachers.size ? `<div class="line muted">👤 ${[...s.teachers.values()].map(esc).join(' · ')}</div>` : ''}
    ${s.rooms.size ? `<div class="line muted">📍 ${[...s.rooms].slice(0, 4).map(esc).join(' · ')}</div>` : ''}
    <div class="sub-h">🎯 Contrôles & remises</div>
    ${exams.length ? exams.map(e => dueItem({ kind: 'event', id: e.id, title: e.title, due: e.start, dueTime: !e.allDay, cat: e.cat, done: false, ref: e })).join('') : '<div class="empty">Aucun contrôle prévu.</div>'}
    ${revs.length ? `<div class="sub-h">🧠 Révisions prévues</div><div class="tl">${revs.map(e => tlItem(e)).join('')}</div>` : ''}
    <div class="sub-h">📅 Prochains cours</div>
    <div class="tl">${upcoming.length ? upcoming.map(e => tlItem(e).replace('<div class="tl-time">', `<div class="tl-time"><small>${fmtDayShort(e.start)}</small>`)).join('') : '<div class="empty">Plus de cours prévu.</div>'}</div>
    <div class="sub-h">📝 Notes de cours (${s.notes.length})</div>
    ${s.notes.length ? noteGrid(s.notes) : ''}
    <div class="sub-h">Couleur</div>
    <div class="swatches">${['#5b8def', '#38c6f4', '#2fd1a5', '#7ee081', '#d9b26a', '#ff9f43', '#ff5d6c', '#f472b6', '#c47dff', '#a3a8ff'].map(c => `<button class="sw ${s.color === c ? 'on' : ''}" style="--c:${c}" data-a="subj-color" data-k="${esc(key)}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>
    <div class="actions">
      <button class="btn" data-a="subj-note" data-k="${esc(key)}">📝 Nouvelle note</button>
      <button class="btn" data-a="subj-focus" data-k="${esc(key)}">🧠 Focus 25 min</button>
      ${exams[0] ? `<button class="btn gold" data-a="plan-rev" data-id="${exams[0].id}">Planifier révisions</button>` : ''}
    </div>`);
}

// ---------- Recherche ----------
function openSearch() {
  openSheet(`${shTitle('Rechercher')}<div class="search">${icon('search')}<input id="gsearch" placeholder="Événement, note, tâche, matière…" autocomplete="off"></div><div id="gsearch-res"><div class="dim small">Tape au moins 2 lettres.</div></div>`);
  setTimeout(() => $('#gsearch')?.focus(), 50);
}
function runSearch(q) {
  const n = norm(q.trim());
  const out = $('#gsearch-res');
  if (!out) return;
  if (n.length < 2) { out.innerHTML = '<div class="dim small">Tape au moins 2 lettres.</div>'; return; }
  const now = Date.now();
  const dups = duplicateIds();
  const evs = S().events.filter(e => !dups.has(e.id) && norm(e.title + ' ' + e.location + ' ' + (e.memo || '')).includes(n))
    .sort((a, b) => (a.start < now) - (b.start < now) || (a.start < now ? b.start - a.start : a.start - b.start)).slice(0, 25);
  const tasks = S().tasks.filter(t => norm(t.title).includes(n));
  const notes = S().notes.filter(x => norm(x.title + ' ' + x.text).includes(n));
  const subs = subjects().filter(s => norm(s.name).includes(n));
  out.innerHTML = [
    subs.length ? `<div class="sub-h">Matières</div>${subs.map(subjRow).join('')}` : '',
    evs.length ? `<div class="sub-h">Événements (${evs.length})</div><div class="tl">${evs.map(e => tlItem(e).replace('<div class="tl-time">', `<div class="tl-time"><small>${fmtDayShort(e.start)}</small>`)).join('')}</div>` : '',
    tasks.length ? `<div class="sub-h">Tâches</div>${tasks.map(t => dueItem({ kind: 'task', id: t.id, title: t.title, due: t.due, dueTime: t.dueTime, cat: t.cat, done: t.done, priority: t.priority, ref: t })).join('')}` : '',
    notes.length ? `<div class="sub-h">Notes</div>${noteGrid(notes)}` : '',
  ].join('') || '<div class="empty">Aucun résultat.</div>';
}

// ---------- Objectifs ----------
function openGoals() {
  const gs = set().goals;
  openSheet(`${shTitle('🎯 Objectifs & habitudes', true)}
    <p class="muted" style="margin-top:0">Les objectifs « séances » et « heures » se remplissent tout seuls à partir de ton agenda (et du Focus). Les habitudes se cochent chaque jour.</p>
    ${gs.map(g => `<div class="set-row"><span class="me-ic">${esc(g.emoji)}</span><div class="grow"><b>${esc(g.label)}</b><small>${g.kind === 'count' ? `${g.target} séances / semaine` : g.kind === 'hours' ? `${g.target} h / semaine` : `${g.target} jours / semaine`}${g.kw ? ` · titre contient « ${esc(g.kw)} »` : g.cat ? ` · catégorie ${esc(catOf(g.cat).label)}` : ''}</small></div><button class="btn small" data-a="goal-edit" data-id="${g.id}">Modifier</button></div>`).join('')}
    <button class="btn gold block" style="margin-top:12px" data-a="goal-edit">+ Nouvel objectif</button>
    <div class="dim small" style="margin-top:12px">Idées : 📖 Lire 3 fois, 🏃 Courir 2 fois, 💧 Boire 1,5 L, 📵 Pas d'écran après 23h, 💰 Pas de dépense inutile…</div>`, 'menu');
}
function editGoal(id) {
  const g = set().goals.find(x => x.id === id) || { id: '', emoji: '⭐', label: '', kind: 'check', kw: '', cat: '', target: 3 };
  openSheet(`<form id="goal-form">${shTitle(g.id ? 'Modifier l\'objectif' : 'Nouvel objectif', true)}
    <div class="fields2" style="grid-template-columns:80px 1fr"><div class="field"><label>Emoji</label><input name="emoji" value="${esc(g.emoji)}" maxlength="4"></div><div class="field"><label>Nom</label><input name="label" value="${esc(g.label)}" placeholder="Ex : Boxe, Lecture…" required></div></div>
    <div class="field"><label>Type</label><select name="kind"><option value="count" ${g.kind === 'count' ? 'selected' : ''}>Nombre de séances (compté dans l'agenda)</option><option value="hours" ${g.kind === 'hours' ? 'selected' : ''}>Nombre d'heures (compté dans l'agenda)</option><option value="check" ${g.kind === 'check' ? 'selected' : ''}>Habitude à cocher chaque jour</option></select></div>
    <div class="fields2"><div class="field"><label>Mot-clé du titre</label><input name="kw" value="${esc(g.kw)}" placeholder="Ex : boxe"></div><div class="field"><label>ou catégorie</label><select name="cat"><option value="">—</option>${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${g.cat === k ? 'selected' : ''}>${c.emoji} ${esc(c.label)}</option>`).join('')}</select></div></div>
    <div class="field"><label>Objectif par semaine</label><input type="number" name="target" min="1" max="100" step="0.5" value="${g.target}"></div>
    <button class="btn gold block">Enregistrer</button>
    ${g.id ? `<button type="button" class="btn danger block" style="margin-top:8px" data-a="goal-del" data-id="${g.id}">Supprimer</button>` : ''}
    <input type="hidden" name="gid" value="${g.id}"></form>`, 'goals');
}

// ---------- Compte à rebours ----------
function editCountdown(id) {
  const c = S().countdowns.find(x => x.id === id) || { id: '', title: '', date: addDays(new Date(), 30).getTime(), emoji: '🎉' };
  openSheet(`<form id="cd-form">${shTitle(c.id ? 'Compte à rebours' : 'Nouveau compte à rebours')}
    <div class="fields2" style="grid-template-columns:80px 1fr"><div class="field"><label>Emoji</label><input name="emoji" value="${esc(c.emoji)}" maxlength="4"></div><div class="field"><label>Quoi ?</label><input name="title" value="${esc(c.title)}" placeholder="Ex : Anniversaire, voyage, gala de boxe…" required></div></div>
    <div class="field"><label>Date</label><input type="date" name="date" value="${ymd(c.date)}" required></div>
    <button class="btn gold block">Enregistrer</button>
    ${c.id ? `<button type="button" class="btn danger block" style="margin-top:8px" data-a="cd-del" data-id="${c.id}">Supprimer</button>` : ''}
    <input type="hidden" name="cid" value="${c.id}"></form>`);
}

function keepScroll(fn) { const y = $('#sheet').scrollTop; fn(); $('#sheet').scrollTop = y; }
function reopenHome() { if (sheetBack === 'home') keepScroll(openHome); else keepScroll(openSettings); }

// ---------- Accueil guidé ----------
const INTERESTS = [
  ['brief', '☀️', 'Un résumé de ma journée'],
  ['tomorrow', '🌙', 'Voir aussi demain'],
  ['subjects', '📚', 'Mes cours par matière'],
  ['goals', '🎯', 'Suivre mes objectifs (boxe, révisions…)'],
  ['focus', '🧠', 'Un minuteur pour réviser'],
  ['countdowns', '⌛', 'Compter les jours avant les vacances et examens'],
  ['notes', '📌', 'Mes notes importantes'],
];
let obStep = 0;
function openOnboarding(step = 0) {
  obStep = step;
  const s = set();
  const dots = `<div class="ob-dots">${[0, 1, 2].map(i => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '';
  if (step === 0) body = `<div class="ob-emoji">${esc(s.avatar)}</div><h2>Salut ! Comment tu t'appelles ?</h2>
    <input class="big-input" data-set="name" value="${esc(s.name)}" placeholder="Ton prénom">
    <p class="muted">Choisis ton emoji :</p><div class="emoji-pick center">${AVATARS.map(a => `<button class="${s.avatar === a ? 'on' : ''}" data-a="ob-avatar" data-v="${a}">${a}</button>`).join('')}</div>`;
  if (step === 1) body = `<h2>Ton style</h2>
    <div class="palettes">${Object.entries(PALETTES).map(([k, p]) => `<button class="pal ${s.palette === k ? 'on' : ''}" data-a="ob-palette" data-v="${k}" style="background:${p.bg};color:${p.text};border-color:${s.palette === k ? p.accent : 'transparent'}"><i style="background:${p.accent}"></i>${p.name}</button>`).join('')}</div>
    <p class="muted">Taille du texte :</p><div class="seg">${[[1, 'Normal'], [1.12, 'Grand'], [1.25, 'Très grand']].map(([v, l]) => `<button class="${s.textSize === v ? 'on' : ''}" data-a="ob-size" data-v="${v}">${l}</button>`).join('')}</div>`;
  if (step === 2) body = `<h2>Sur ton écran d'accueil</h2><p class="muted">Tu auras toujours : ce qui se passe maintenant, ta journée et ce qu'il ne faut pas rater. Tu veux ajouter quoi d'autre ?</p>
    ${INTERESTS.map(([id, e, l]) => { const on = s.homeModules.find(m => m.id === id)?.on; return `<button class="ob-opt ${on ? 'on' : ''}" data-a="ob-int" data-id="${id}"><span>${e}</span><span class="grow">${l}</span><span class="box">${on ? '✓' : ''}</span></button>`; }).join('')}
    <p class="dim small">Tu pourras changer ça quand tu veux dans Réglages.</p>`;
  openSheet(`<div class="onboard">${dots}${body}
    <div class="row" style="margin-top:18px">${step ? `<button class="btn" data-a="ob-prev">Retour</button>` : ''}<button class="btn gold grow" data-a="ob-next">${step < 2 ? 'Suivant' : 'C\'est parti !'}</button></div></div>`);
}

// ---------- Réglages ----------
function openMenu() { openSettings(); }
function openLook() { openSettings(); }
function openSettings() {
  const s = set();
  openSheet(`${shTitle('Réglages')}
    <div class="set-sec">Moi</div>
    <div class="field"><label>Prénom</label><input data-set="name" value="${esc(s.name)}"></div>
    <div class="emoji-pick">${AVATARS.map(a => `<button class="${s.avatar === a ? 'on' : ''}" data-a="avatar" data-v="${a}">${a}</button>`).join('')}</div>

    <div class="set-sec">Style</div>
    <div class="palettes">${Object.entries(PALETTES).map(([k, p]) => `<button class="pal ${s.palette === k ? 'on' : ''}" data-a="palette" data-v="${k}" style="background:${p.bg};color:${p.text};border-color:${s.palette === k ? p.accent : 'transparent'}"><i style="background:${p.accent}"></i>${p.name}</button>`).join('')}</div>
    <div class="field" style="margin-top:12px"><label>Taille du texte</label><div class="seg">${[[1, 'Normal'], [1.12, 'Grand'], [1.25, 'Très grand']].map(([v, l]) => `<button class="${s.textSize === v ? 'on' : ''}" data-a="textsize" data-v="${v}">${l}</button>`).join('')}</div></div>

    <div class="set-sec">Mon écran d'accueil</div>
    ${homeToggles()}

    <div class="set-sec">Google Agenda</div>
    <div class="guide">✅ <b>Rien à configurer.</b> Quand tu ajoutes un événement, un bouton <b>« + Google »</b> te permet de l'ajouter aussi dans ton Google Agenda en 1 clic.</div>
    <div class="switch"><div>Proposer « + Google » après chaque ajout</div><button class="tg ${s.googleAddPrompt ? 'on' : ''}" data-a="set-tg" data-k="googleAddPrompt"></button></div>

    <div class="set-sec">Assistant</div>
    <div class="guide">✅ <b>Gratuit, rien à configurer.</b> Il comprend : ajouter, déplacer, annuler, « qu'est-ce que j'ai demain ? », « quand est ma prochaine boxe ? », « planifie mes révisions »…</div>

    <details class="more-opts"><summary>Réglages avancés</summary>
      <button class="menu-row" data-a="set-cats"><span class="me-ic">🏷</span><span class="grow"><b>Catégories & couleurs</b><small>Renommer, recolorer, créer les tiennes</small></span>${icon('right')}</button>
      <button class="menu-row" data-a="set-goals"><span class="me-ic">🎯</span><span class="grow"><b>Objectifs</b><small>Boxe, révisions, habitudes</small></span>${icon('right')}</button>
      <button class="menu-row" data-a="set-connect"><span class="me-ic">🔗</span><span class="grow"><b>Synchro Google automatique & IA Claude</b><small>Pour les experts, facultatif</small></span>${icon('right')}</button>
      <button class="menu-row" data-a="set-data"><span class="me-ic">💾</span><span class="grow"><b>Mes données</b><small>Importer, sauvegarder, doublons</small></span>${icon('right')}</button>
      <div class="switch"><div>Contraste renforcé</div><button class="tg ${s.contrast ? 'on' : ''}" data-a="set-tg" data-k="contrast"></button></div>
      <div class="switch"><div>Masquer les doublons</div><button class="tg ${s.hideDups ? 'on' : ''}" data-a="set-tg" data-k="hideDups"></button></div>
      <div class="field" style="margin-top:12px"><label>Temps de trajet par défaut</label><select data-set="travelMin">${TRAVELS.map(m => `<option value="${m}" ${s.travelMin === m ? 'selected' : ''}>${m ? m + ' min' : 'Aucun'}</option>`).join('')}</select></div>
      <button class="btn block" data-a="notif">🔔 Activer les notifications</button>
      <button class="btn block" style="margin-top:8px" data-a="onboard">Refaire l'accueil guidé</button>
    </details>`);
}
function homeToggles() {
  const mods = set().homeModules;
  return mods.map((m, i) => `<div class="set-row"><div class="grow"><b>${HOME_MODULES[m.id][0]}</b><small>${HOME_MODULES[m.id][1]}</small></div>${m.on ? `<button class="icon-btn" data-a="home-up" data-i="${i}" ${i ? '' : 'disabled'} aria-label="Monter">${icon('up')}</button>` : ''}<button class="tg ${m.on ? 'on' : ''}" data-a="home-tg" data-i="${i}" aria-label="Afficher"></button></div>`).join('');
}

function openHome() {
  openSheet(`${shTitle('Mon écran d\'accueil')}<p class="muted" style="margin-top:0">Allume ce que tu veux voir. Moins tu en mets, plus c'est clair.</p>${homeToggles()}`, 'home');
}

function openCats() {
  const s = set();
  const hidden = new Set(s.hiddenCats);
  openSheet(`${shTitle('🏷 Catégories & règles', true)}
    <p class="muted" style="margin-top:0">Renomme, recolore, ou crée tes propres catégories. Elles sont reconnues automatiquement grâce aux mots-clés.</p>
    ${Object.entries(CATS).map(([k, c]) => `<div class="cat-row">
      <input class="emo inp" data-cat-e="${k}" value="${esc(c.emoji)}" maxlength="4" aria-label="Emoji">
      <input class="grow inp" data-cat-l="${k}" value="${esc(c.label)}" aria-label="Nom">
      <input type="color" data-cat-c="${k}" value="${c.color}" aria-label="Couleur">
      <button class="tg ${hidden.has(k) ? '' : 'on'}" data-a="cat-vis" data-cat="${k}" aria-label="Afficher"></button>
      ${c.custom ? `<button class="icon-btn" data-a="cat-del" data-cat="${k}" aria-label="Supprimer">${icon('x')}</button>` : ''}</div>`).join('')}
    <form id="newcat-form" class="card" style="margin-top:12px"><h2>+ Nouvelle catégorie</h2>
      <div class="row"><input name="emoji" value="⭐" maxlength="4" class="emo inp"><input name="label" class="grow inp" placeholder="Ex : Travail Adecco" required><input type="color" name="color" value="#ff9f43"></div>
      <input name="keywords" class="inp" style="width:100%;margin:8px 0" placeholder="Mots-clés séparés par des virgules (ex : adecco, mission)">
      <button class="btn gold block">Créer</button></form>
    <div class="sub-h">Règles perso</div>
    <p class="muted small" style="margin-top:0">« Si le titre contient… → mettre dans… ». Prioritaires sur tout le reste.</p>
    ${s.rules.map((r, i) => `<div class="set-row"><div class="grow">« ${esc(r.kw)} » → ${catOf(r.cat).emoji} ${esc(catOf(r.cat).label)}</div><button class="icon-btn" data-a="rule-del" data-i="${i}" aria-label="Supprimer">${icon('x')}</button></div>`).join('')}
    <form id="rule-form" class="row" style="margin-top:8px"><input name="kw" class="grow inp" placeholder="Mot du titre" required><select name="cat" class="inp">${Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.emoji} ${esc(c.label)}</option>`).join('')}</select><button class="btn small gold">+</button></form>
    <button class="btn block" style="margin-top:14px" data-a="recat">↻ Réappliquer à tous mes événements</button>`, 'menu');
}

function openConnect() {
  const s = set();
  openSheet(`<form id="set-form">${shTitle('🔗 Google, IA & rappels', true)}
    <div class="set-sec">Google Agenda</div>
    <div class="guide">${s.googleConnected ? `✅ Connecté · dernière synchro ${s.lastSync ? relDay(s.lastSync) + ' à ' + hm(s.lastSync) : 'jamais'}.<br>Tout ce que tu ajoutes ici part aussi sur Google Agenda (et inversement à chaque synchro).` : `Pour lire <b>et</b> écrire directement dans ton Google Agenda, crée une fois ton identifiant (gratuit, ~3 min) :
      <ol><li>Va sur <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">console.cloud.google.com</a> → crée un projet.</li>
      <li>« API et services » → Bibliothèque → active <b>Google Calendar API</b>.</li>
      <li>« Écran de consentement OAuth » → Externe → ajoute ton adresse Gmail comme <b>utilisateur test</b>.</li>
      <li>« Identifiants » → Créer → <b>ID client OAuth</b> → Application Web → Origine JavaScript autorisée : <code>${esc(location.origin)}</code></li>
      <li>Copie l'« ID client » (…apps.googleusercontent.com) ci-dessous, puis « Connecter ».</li></ol>`}</div>
    <div class="field"><label>ID client Google</label><input name="googleClientId" value="${esc(s.googleClientId)}" placeholder="1234-abc.apps.googleusercontent.com" autocomplete="off"></div>
    <div class="row wrap">${s.googleConnected ? `<button type="button" class="btn gold" data-a="sync">${icon('sync')} Synchroniser</button><button type="button" class="btn" data-a="g-off">Déconnecter</button>` : `<button type="button" class="btn gold" data-a="g-connect">${icon('google')} Connecter Google Agenda</button>`}</div>
    <div class="set-sec">Assistant IA</div>
    <div class="field"><label>À propos de moi (pour l'IA)</label><textarea name="about" style="min-height:70px" placeholder="Ex : L2 Gestion, boxe le soir, je révise mieux en fin d'après-midi…">${esc(s.about)}</textarea></div>
    <div class="field"><label>Clé API Claude (facultatif)</label><input name="claudeKey" type="password" value="${esc(s.claudeKey)}" placeholder="sk-ant-…" autocomplete="off"><div class="hint">Sans clé, l'assistant comprend déjà les demandes courantes hors-ligne. Avec ta clé (console.anthropic.com), il comprend tout : déplacer, annuler, organiser ta semaine… La clé reste sur ton téléphone.</div></div>
    <div class="switch"><div>Réponses à voix haute<small>L'assistant lit ses réponses</small></div><button type="button" class="tg ${s.voiceReply ? 'on' : ''}" data-a="tg" data-name="voiceReply"></button><input type="hidden" name="voiceReply" value="${s.voiceReply ? 1 : 0}"></div>
    <div class="set-sec">Rappels</div>
    <div class="field"><label>Rappel par défaut</label><select name="reminderMin">${[[0, 'Aucun'], [10, '10 min avant'], [15, '15 min avant'], [30, '30 min avant'], [60, '1 h avant']].map(([v, l]) => `<option value="${v}" ${s.reminderMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="hint">Les notifications s'affichent quand l'appli est ouverte ou en arrière-plan récent. Avec Google connecté, ton téléphone te prévient aussi via Google Agenda. Si un trajet est réglé, je te préviens aussi à l'heure de partir.</div></div>
    <button type="button" class="btn" data-a="notif">🔔 Autoriser les notifications</button>
    <button class="btn gold block" style="margin-top:20px">Enregistrer</button>
  </form>`, 'menu');
}

function openData() {
  const dups = duplicateIds().size;
  openSheet(`${shTitle('💾 Mes données', true)}
    <p class="muted" style="margin-top:0">${S().events.length} événements · ${S().tasks.length} tâches · ${S().notes.length} notes, stockés sur ce téléphone.</p>
    <div class="row wrap"><button class="btn" data-a="import">Importer (.json / .ics)</button><button class="btn" data-a="export">Exporter une sauvegarde</button></div>
    ${dups ? `<button class="btn block" style="margin-top:8px" data-a="dups-purge">🧹 Supprimer définitivement les ${dups} doublons</button>` : '<p class="dim small">Aucun doublon détecté.</p>'}
    <button class="btn danger block" style="margin-top:8px" data-a="reset">Tout effacer</button>`, 'menu');
}

function saveConnect(f, silent = false) {
  if (!f) return;
  const s = set();
  s.about = f.about.value.trim();
  s.googleClientId = f.googleClientId.value.trim();
  s.claudeKey = f.claudeKey.value.trim();
  s.voiceReply = f.voiceReply.value === '1';
  s.reminderMin = +f.reminderMin.value;
  save();
  if (!silent) { closeSheet(); render(); toast('Réglages enregistrés ✓'); }
}

// =====================================================================
// Toast & notifications
// =====================================================================
let toastT = null;
function toast(msg, action = null) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg).replace(/\n/g, '<br>')}</span>${action ? (action.href ? `<a href="${esc(action.href)}" target="_blank" rel="noopener">${esc(action.label)}</a>` : `<button>${esc(action.label)}</button>`) : ''}`;
  t.hidden = false;
  if (action) t.querySelector('a,button').onclick = () => { action.fn?.(); t.hidden = true; };
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3500);
}

let notified = new Set();
try { notified = new Set(JSON.parse(localStorage.getItem('agenda-notified') || '[]')); } catch { /* */ }
function notify(title, body) {
  toast(`${title}${body ? ' — ' + body : ''}`);
  if ('Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready.then(r => r.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: title })).catch(() => {});
  }
}
function checkReminders() {
  const now = Date.now();
  const st = S();
  let changed = false;
  const once = (key, fn) => { if (!notified.has(key)) { notified.add(key); changed = true; fn(); } };
  for (const e of eventsBetween(now, now + 2 * DAY)) {
    if (e.allDay) continue;
    const rem = e.reminder ?? st.settings.reminderMin;
    if (!(e.reminder == null && !rem) && e.start - rem * MIN <= now && e.start > now - 5 * MIN) {
      once(e.id + ':' + e.start, () => notify(e.title, `${countdown(e.start)} · ${hm(e.start)}${e.location ? ' · ' + e.location : ''}${e.bring?.some(b => !b.done) ? ' · 🎒 ' + e.bring.filter(b => !b.done).map(b => b.t).join(', ') : ''}`));
    }
    const tr = travelOf(e);
    if (tr && e.start - tr * MIN - 5 * MIN <= now && e.start - tr * MIN > now - 10 * MIN) {
      once(e.id + ':go:' + e.start, () => notify('🚶 Pars dans 5 min', `${e.title} à ${hm(e.start)} · ${e.location}`));
    }
  }
  for (const n of st.notes) if (n.remind && n.remind <= now && !n.reminded) { n.reminded = true; save(); notify('⏰ ' + (n.title || 'À ne pas oublier'), n.text.slice(0, 120)); }
  if (changed) try { localStorage.setItem('agenda-notified', JSON.stringify([...notified].slice(-300))); } catch { /* */ }
}

// =====================================================================
// Révisions & objectifs
// =====================================================================
function planRevisions(id) {
  const ev = S().events.find(e => e.id === id);
  if (!ev) return;
  const plan = revisionPlan(ev);
  if (!plan.length) { toast('Pas de créneau libre trouvé avant cet examen.'); return; }
  const title = revisionTitle(ev);
  openSheet(`${shTitle('🧠 Révisions')}
    <p class="muted" style="margin-top:0">Pour <b style="color:var(--text)">${esc(ev.title)}</b> (${relDay(ev.start)}), je te propose ${plan.length} séance${plan.length > 1 ? 's' : ''} dans tes créneaux libres :</p>
    ${plan.map(p => `<div class="tl-item" style="--c:${CATS.revision.color}"><div class="tl-time">${hm(p.start)}<small>${hm(p.end)}</small></div><div class="tl-bar"></div><div class="tl-body"><div class="tl-title">${esc(title)}</div><div class="tl-sub">${cap(fmtDay(p.start))}</div></div></div>`).join('')}
    <button class="btn gold block" style="margin-top:14px" data-a="plan-ok" data-id="${id}">Ajouter ces ${plan.length} séances</button>`);
}

// Cale une séance pour un objectif (ex : boxe) au prochain créneau habituel libre
function planGoal(id) {
  const g = set().goals.find(x => x.id === id);
  if (!g) return;
  const tp = templates(20).find(t => (g.kw && norm(t.title).includes(norm(g.kw))) || (g.cat && t.cat === g.cat));
  const base = tp || { title: g.label, cat: g.cat || guessCat(g.label), location: '', dur: 3600000, h: 18, m: 0 };
  const d = startOfDay(new Date());
  for (let i = 0; i < 7; i++) {
    const s = new Date(addDays(d, i)).setHours(base.h, base.m, 0, 0);
    if (s < Date.now()) continue;
    if (!eventsBetween(s, s + base.dur).some(e => !e.allDay)) { editEvent(null, { title: base.title, start: s, end: s + base.dur, location: base.location || '', cat: base.cat }); return; }
  }
  editEvent(null, { title: base.title });
}

// =====================================================================
// Import / export
// =====================================================================
async function handleFile(file) {
  const text = await file.text();
  try {
    if (/\.ics$/i.test(file.name) || text.startsWith('BEGIN:VCALENDAR')) {
      const r = mergeEvents(parseIcs(text));
      toast(`Importé : ${r.added} nouveaux événements, ${r.updated} mis à jour.`);
    } else {
      const data = JSON.parse(text);
      if (data.settings?.about && !set().about) set().about = data.settings.about;
      const r = importJson(text);
      toast(`Importé : ${r.added} événements, ${r.tasks} tâches, ${r.notes} notes.`);
    }
    closeSheet(); render();
  } catch (e) { toast('Fichier illisible : ' + e.message); }
}
function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// =====================================================================
// Actions (clics)
// =====================================================================
const evById = id => S().events.find(x => x.id === id);
const ACTIONS = {
  tab: el => go(el.dataset.tab),
  ev: el => openEvent(el.dataset.id),
  task: el => editTask(el.dataset.id),
  note: el => editNote(el.dataset.id),
  subj: el => openSubject(el.dataset.k),
  close: closeSheet,
  'sheet-back': () => (sheetBack === 'goals' ? openGoals() : openSettings()),
  settings: openMenu,
  'set-look': openLook, 'set-home': openHome, 'set-cats': openCats, 'set-goals': openGoals, 'set-connect': openConnect, 'set-data': openData,
  'memo-due': () => go('todo'),
  'memo-notes': () => go('notes'),
  'me-seg': el => { set().meSeg = el.dataset.s; save(); go('me'); },
  'due-more': () => { showAllDue = true; renderTodo(); },
  'g-added': el => { const e = evById(el.dataset.id); if (e) { e.addedToGoogle = true; save(); setTimeout(() => { closeSheet(); render(); toast('Ajouté dans Google Agenda ✓'); }, 400); } },
  onboard: () => openOnboarding(0),
  'ob-avatar': el => { set().avatar = el.dataset.v; save(); render(); openOnboarding(0); },
  'ob-palette': el => { set().palette = el.dataset.v; set().accent = ''; save(); render(); openOnboarding(1); },
  'ob-size': el => { set().textSize = +el.dataset.v; save(); render(); openOnboarding(1); },
  'ob-int': el => { const m = set().homeModules.find(x => x.id === el.dataset.id); if (m) { m.on = !m.on; save(); } openOnboarding(2); },
  'ob-prev': () => openOnboarding(Math.max(0, obStep - 1)),
  'ob-next': () => {
    if (obStep < 2) return openOnboarding(obStep + 1);
    set().onboarded = true; save(); closeSheet(); go('today');
    toast(`C'est prêt, ${set().name} ✨`);
  },
  sync: () => { saveConnect($('#set-form'), true); closeSheet(); syncNow(); },
  'g-connect': () => { saveConnect($('#set-form'), true); closeSheet(); syncNow(); },
  'g-off': () => { G.disconnect(); closeSheet(); render(); toast('Google Agenda déconnecté.'); },
  import: () => $('#file-in').click(),
  export: () => download(`agenda-${ymd(new Date())}.json`, exportJson()),
  reset: () => { if (confirm('Effacer toutes les données de l\'agenda sur ce téléphone ?')) { resetAll(); closeSheet(); render(); } },
  'dups-purge': () => { if (confirm('Supprimer les doublons de l\'agenda (et de Google s\'il est connecté) ?')) { const n = purgeDuplicates(); flushDeletes(); closeSheet(); render(); toast(`${n} doublons supprimés.`); } },
  'dups-ok': () => { set().dupsSeen = true; save(); render(); },
  notif: async () => {
    if (!('Notification' in window)) return toast('Notifications non disponibles ici. Installe l\'appli sur l\'écran d\'accueil.');
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Notifications activées 🔔' : 'Notifications refusées.');
  },
  // apparence
  avatar: el => { set().avatar = el.dataset.v; save(); keepScroll(openSettings); render(); },
  palette: el => { set().palette = el.dataset.v; set().accent = ''; save(); keepScroll(openSettings); render(); },
  accent: el => { set().accent = el.dataset.v; save(); keepScroll(openSettings); render(); },
  textsize: el => { set().textSize = +el.dataset.v; save(); keepScroll(openSettings); render(); },
  'set-tg': el => { const k = el.dataset.k; set()[k] = !set()[k]; save(); el.classList.toggle('on', set()[k]); render(); },
  // accueil
  'home-tg': el => { const m = set().homeModules[+el.dataset.i]; m.on = !m.on; save(); reopenHome(); render(); },
  'home-up': el => { const a = set().homeModules, i = +el.dataset.i; if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; save(); reopenHome(); render(); } },
  'home-down': el => { const a = set().homeModules, i = +el.dataset.i; if (i < a.length - 1) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; save(); openHome(); render(); } },
  // catégories
  'cat-vis': el => { const s = set(), k = el.dataset.cat; s.hiddenCats = s.hiddenCats.includes(k) ? s.hiddenCats.filter(x => x !== k) : [...s.hiddenCats, k]; save(); el.classList.toggle('on', !s.hiddenCats.includes(k)); render(); },
  'cat-del': el => { const s = set(); s.customCats = s.customCats.filter(c => c.key !== el.dataset.cat); refreshCats(); recategorize(); openCats(); render(); },
  'rule-del': el => { set().rules.splice(+el.dataset.i, 1); save(); openCats(); },
  recat: () => { const n = recategorize(); toast(`${n} événement${n > 1 ? 's' : ''} reclassé${n > 1 ? 's' : ''}.`); render(); },
  // objectifs
  'goal-edit': el => editGoal(el.dataset.id),
  'goal-del': el => { set().goals = set().goals.filter(g => g.id !== el.dataset.id); save(); openGoals(); render(); },
  'goal-check': el => { const on = toggleCheck(el.dataset.id); save(); render(); if (on) toast('Bravo 🔥'); },
  'goal-plan': el => planGoal(el.dataset.id),
  // comptes à rebours
  'cd-new': () => editCountdown(),
  'cd-edit': el => editCountdown(el.dataset.id),
  'cd-del': el => { S().countdowns = S().countdowns.filter(c => c.id !== el.dataset.id); save(); closeSheet(); render(); },
  // matières
  'subj-color': el => { set().subjectColors[el.dataset.k] = el.dataset.c; save(); openSubject(el.dataset.k); render(); },
  'subj-note': el => { closeSheet(); editNote(null, { folder: 'Cours', subject: el.dataset.k }); },
  'subj-focus': el => { set().focusRun = { start: Date.now(), len: 25, subject: el.dataset.k }; save(); closeSheet(); go('me'); },
  // focus
  'focus-go': el => { set().focusRun = { start: Date.now(), len: +el.dataset.m, subject: $('#focus-subj')?.value || '' }; save(); render(); toast(`C'est parti pour ${el.dataset.m} min 💪`); },
  'focus-stop': () => finishFocus(false),
  'focus-cancel': () => { set().focusRun = null; save(); render(); },
  'stat-p': el => { statPeriod = el.dataset.p; renderMe(); },
  'speak-brief': () => { stopSpeaking(); speak(briefing()); },
  tpl: el => {
    const t = templates()[+el.dataset.i];
    let d = new Date(); d.setHours(t.h, t.m, 0, 0);
    if (d < new Date()) d = addDays(d, 1);
    editEvent(null, { title: t.title, start: d.getTime(), end: d.getTime() + t.dur, location: t.location || '', cat: t.cat });
  },
  // formulaires
  tg: el => { el.classList.toggle('on'); const i = el.parentNode.querySelector(`input[name=${el.dataset.name}]`); i.value = el.classList.contains('on') ? 1 : 0; toggleTimeFields(); },
  sw: el => { el.parentNode.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b === el)); el.closest('form').color.value = el.dataset.c; },
  prio: el => { el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); el.closest('form').priority.value = el.dataset.p; },
  dur: el => {
    const f = $('#ev-form'); const [h, m] = (f.t1.value || '09:00').split(':').map(Number);
    f.t2.value = hm2(new Date(2000, 0, 1, h, m + +el.dataset.m));
  },
  'task-quick-date': el => { const f = $('#task-form'); const n = +el.dataset.n; f.date.value = n < 0 ? '' : ymd(addDays(new Date(), n)); if (n < 0) f.time.value = ''; },
  'cat-toggle': el => { const s = set(); const k = el.dataset.cat; s.hiddenCats = s.hiddenCats.includes(k) ? s.hiddenCats.filter(x => x !== k) : [...s.hiddenCats, k]; save(); render(); },
  view: el => { set().calView = el.dataset.v; save(); renderCal(); if (el.dataset.v === 'day') scrollGridToNow(); },
  'cal-prev': () => calShift(-1),
  'cal-next': () => calShift(1),
  'cal-today': () => { calDate = startOfDay(new Date()); selDay = calDate; renderCal(); scrollGridToNow(); },
  sel: el => { selDay = fromYmd(el.dataset.d); renderCal(); setTimeout(() => document.querySelector('.daylist-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); },
  day: el => { calDate = fromYmd(el.dataset.d); selDay = calDate; set().calView = 'day'; save(); go('cal'); },
  'new-at': el => { const d = new Date(+el.dataset.t); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); editEvent(null, { start: d.getTime(), end: d.getTime() + 3600000 }); },
  slot: (el, ev) => {
    if (ev.target !== el) return;
    const r = el.getBoundingClientRect();
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
    const h = +el.dataset.h0 + (ev.clientY - r.top) / z / hourPx();
    const d = fromYmd(el.dataset.d); d.setHours(Math.floor(h), Math.round((h % 1) * 2) * 30, 0, 0);
    editEvent(null, { start: d.getTime(), end: d.getTime() + 3600000 });
  },
  // fiche événement
  'ev-edit': el => editEvent(el.dataset.id),
  'ev-dup': el => { const e = evById(el.dataset.id); if (e) { const { id, gid, calId, source, ...rest } = e; editEvent(null, { ...rest }); } },
  'ev-del': el => { const e = evById(el.dataset.id); if (e && confirm(`Supprimer « ${e.title} »${e.gid && set().googleConnected ? ' (aussi sur Google Agenda)' : ''} ?`)) { const copy = { ...e }; deleteEvent(e.id); flushDeletes(); closeSheet(); render(); toast('Supprimé', { label: 'Annuler', fn: () => { const { id, gid, ...rest } = copy; gpush(addEvent({ ...rest, source: 'local' })); render(); } }); } },
  'ev-star': el => { const e = evById(el.dataset.id); e.star = !e.star; save(); openEvent(e.id); render(); },
  'ev-travel': el => { const e = evById(el.dataset.id); e.travel = +el.dataset.m; save(); openEvent(e.id); render(); },
  'ev-cat': el => { const e = evById(el.dataset.id); e.cat = el.dataset.cat; e.catLocked = true; save(); openEvent(e.id); render(); },
  'ev-bring': (el, ev) => { if (ev.target.closest('.x-mini')) return; const e = evById(el.dataset.id); const b = e.bring[+el.dataset.i]; b.done = !b.done; save(); openEvent(e.id); render(); },
  'ev-bring-del': el => { const e = evById(el.dataset.id); e.bring.splice(+el.dataset.i, 1); save(); openEvent(e.id); render(); },
  // tâches & notes
  'task-done': el => { const t = S().tasks.find(x => x.id === el.dataset.id); if (t) { updateTask(t.id, { done: !t.done, doneAt: Date.now() }); if ($('#task-form')) closeSheet(); render(); if (t.done) toast('Bien joué ✓', { label: 'Annuler', fn: () => { updateTask(t.id, { done: false }); render(); } }); } },
  'task-del': el => { deleteTask(el.dataset.id); closeSheet(); render(); },
  'task-to-ev': el => { const t = S().tasks.find(x => x.id === el.dataset.id); closeSheet(); editEvent(null, { title: t.title, cat: t.cat }); },
  'note-del': el => { const n = S().notes.find(x => x.id === el.dataset.id); deleteNote(el.dataset.id); closeSheet(); render(); toast('Note supprimée', { label: 'Annuler', fn: () => { S().notes.push(n); save(); render(); } }); },
  'note-task': el => { const n = S().notes.find(x => x.id === el.dataset.id); closeSheet(); editTask(null, { title: n.title || n.text.split('\n')[0] }); },
  'note-chk': el => {
    const n = S().notes.find(x => x.id === el.dataset.id);
    const lines = n.text.split('\n'); const i = +el.dataset.l;
    lines[i] = lines[i].replace(/\[( |x|X)\]/, m => (m === '[ ]' ? '[x]' : '[ ]'));
    updateNote(n.id, { text: lines.join('\n') }); render();
    if ($('#gsearch')) runSearch($('#gsearch').value);
  },
  'note-add-chk': () => { const t = $('#note-text'); t.value = (t.value && !t.value.endsWith('\n') ? t.value + '\n' : t.value) + '[ ] '; t.focus(); },
  'note-f': el => { noteFolder = el.dataset.f; renderNotes(); },
  'due-f': el => { dueFilter = el.dataset.f; showAllDue = false; renderTodo(); },
  'plan-rev': el => planRevisions(el.dataset.id),
  'plan-ok': el => {
    const ev = evById(el.dataset.id);
    const plan = revisionPlan(ev);
    plan.forEach(p => gpush(addEvent({ title: revisionTitle(ev), start: p.start, end: p.end, cat: 'revision' })));
    closeSheet(); render(); toast(`${plan.length} séances de révision ajoutées 💪`);
  },
  sugg: el => runAssistant(el.textContent),
  undo: el => doUndo(el.dataset.k),
  'chat-clear': () => { S().chat = []; undoBag.clear(); save(); renderAi(); },
  mic: async el => {
    const input = document.getElementById(el.dataset.for);
    if (el.classList.contains('listening')) { stopListening(); return; }
    el.classList.add('listening');
    try {
      const text = await listen({ onPartial: t => { input.value = t; } });
      if (text) { input.value = ''; runAssistant(text, { stay: el.dataset.for !== 'q-ai' }); }
    } catch (e) { toast('Micro indisponible : ' + e.message); } finally { el.classList.remove('listening'); }
  },
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.a];
  if (fn) { if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault(); fn(el, ev); }
});

document.addEventListener('submit', ev => {
  ev.preventDefault();
  const f = ev.target;
  const fid = f.getAttribute('id');
  if (fid === 'ev-form') return saveEventForm(f);
  if (fid === 'task-form') return saveTaskForm(f);
  if (fid === 'note-form') return saveNoteForm(f);
  if (fid === 'set-form') return saveConnect(f);
  if (fid === 'goal-form') {
    const s = set();
    const g = { id: f.gid.value || uid(), emoji: f.emoji.value || '⭐', label: f.label.value.trim(), kind: f.kind.value, kw: f.kw.value.trim(), cat: f.cat.value, target: +f.target.value || 1 };
    if (g.kind !== 'check' && !g.kw && !g.cat) g.kw = g.label;
    const i = s.goals.findIndex(x => x.id === g.id);
    if (i >= 0) s.goals[i] = g; else s.goals.push(g);
    save(); openGoals(); render(); return;
  }
  if (fid === 'cd-form') {
    const c = { id: f.cid.value || uid(), emoji: f.emoji.value || '🎉', title: f.title.value.trim(), date: fromYmd(f.date.value).getTime() };
    const l = S().countdowns; const i = l.findIndex(x => x.id === c.id);
    if (i >= 0) l[i] = c; else l.push(c);
    save(); closeSheet(); render(); return;
  }
  if (fid === 'newcat-form') {
    const key = 'c-' + uid();
    set().customCats.push({ key, label: f.label.value.trim(), emoji: f.emoji.value || '⭐', color: f.color.value, keywords: f.keywords.value.split(',').map(x => x.trim()).filter(Boolean) });
    refreshCats(); const n = recategorize(); openCats(); render(); toast(`Catégorie créée${n ? ` · ${n} événements reclassés` : ''}.`); return;
  }
  if (fid === 'rule-form') {
    set().rules.push({ kw: f.kw.value.trim(), cat: f.cat.value });
    const n = recategorize(); openCats(); render(); toast(`Règle ajoutée · ${n} événement${n > 1 ? 's' : ''} reclassé${n > 1 ? 's' : ''}.`); return;
  }
  if (f.dataset.form === 'bring') {
    const v = f.querySelector('input').value.trim();
    if (!v) return;
    const e = evById(f.dataset.id); (e.bring ||= []).push({ t: v, done: false }); save(); openEvent(e.id); render();
    setTimeout(() => document.querySelector('[data-form=bring] input')?.focus(), 30);
    return;
  }
  if (f.dataset.quick) {
    const input = f.querySelector('input');
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    if (f.dataset.quick === 'q-note') {
      const isChk = /^\[ ?\]/.test(v);
      addNote({ text: isChk ? v.replace(/^\[ ?\]\s*/, '[ ] ') : v, folder: noteFolder.startsWith('s:') ? 'Cours' : noteFolder === 'Tout' ? 'Perso' : noteFolder, subject: noteFolder.startsWith('s:') ? noteFolder.slice(2) : '' });
      render(); toast('Note ajoutée ✓'); return;
    }
    if (f.dataset.quick === 'q-due' && !/\b(ajoute|programme|rdv|rendez|cours|réunion)\b/i.test(v)) {
      const r = localAssistant(/rendre|avant|tâche|deadline/i.test(v) ? v : 'à faire : ' + v);
      if (r.actions[0]?.type === 'add_task') { applyActions(r.actions, -1).then(() => { render(); toast(r.reply); }); return; }
    }
    runAssistant(v, { stay: f.dataset.quick !== 'q-ai' });
  }
});

let memoT = null;
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'note-q') {
    noteQuery = t.value;
    const pos = t.selectionStart;
    renderNotes();
    const i = $('#note-q'); i.focus(); i.setSelectionRange(pos, pos);
  } else if (t.id === 'gsearch') runSearch(t.value);
  else if (t.dataset.memo) {
    clearTimeout(memoT);
    memoT = setTimeout(() => { const e = evById(t.dataset.memo); if (e) { e.memo = t.value; save(); } }, 300);
  } else if (t.dataset.set) {
    const k = t.dataset.set;
    set()[k] = t.type === 'number' || k === 'travelMin' ? +t.value : t.value;
    save();
  } else if (t.dataset.catL || t.dataset.catE || t.dataset.catC) {
    const k = t.dataset.catL || t.dataset.catE || t.dataset.catC;
    const field = t.dataset.catL ? 'label' : t.dataset.catE ? 'emoji' : 'color';
    const s = set();
    const custom = s.customCats.find(c => c.key === k);
    if (custom) custom[field] = t.value;
    else (s.catOverrides[k] ||= {})[field] = t.value;
    refreshCats(); save();
  }
});
document.addEventListener('change', ev => { const t = ev.target; if (t.dataset.catC || t.dataset.catL || t.dataset.catE || t.dataset.set || t.dataset.memo) render(); });

$('#file-in').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
$('#btn-settings').onclick = openSettings;
$('#btn-me').onclick = () => go(tab === 'me' ? 'today' : 'me');
$('#btn-sync').onclick = syncNow;
$('#btn-search').onclick = openSearch;
$('#sheet-bg').onclick = closeSheet;
$('#fab').onclick = () => {
  if (tab === 'todo') return editTask(null);
  if (tab === 'notes') return editNote(null);
  editEvent(null, tab === 'cal' && !sameDay(selDay, new Date()) ? { start: new Date(selDay).setHours(10), end: new Date(selDay).setHours(11) } : {});
};
$('#main').addEventListener('scroll', () => $('#top').classList.toggle('scrolled', $('#main').scrollTop > 4), { passive: true });

let sx = 0, sy = 0;
$('#main').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
$('#main').addEventListener('touchend', e => {
  if (tab !== 'cal' || !e.target.closest('#swipe')) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 50) calShift(dx < 0 ? 1 : -1);
}, { passive: true });

let shY = 0;
$('#sheet').addEventListener('touchstart', e => { shY = $('#sheet').scrollTop <= 0 ? e.touches[0].clientY : -1; }, { passive: true });
$('#sheet').addEventListener('touchend', e => { if (shY >= 0 && e.changedTouches[0].clientY - shY > 110) closeSheet(); }, { passive: true });

// Démarrage
const qp = new URLSearchParams(location.search);
go(['today', 'cal', 'todo', 'notes', 'me', 'ai'].includes(qp.get('tab')) ? qp.get('tab') : 'today');

// Lien d'import en 1 clic : …/agenda/#import=<données compressées>. Les données restent dans le lien
// (la partie après # n'est jamais envoyée au serveur) puis sont effacées de l'adresse.
async function importFromLink() {
  const m = /#import=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const data = JSON.parse(await new Response(stream).text());
    const events = (data.e || []).map(x => ({ gid: x.g, calId: 'primary', source: 'google', title: x.t, start: x.s, end: x.f, allDay: !!x.a, location: x.l || '', notes: '' }));
    const r = mergeEvents(events);
    if (data.n && (!set().name || set().name === 'Chahyn')) set().name = data.n;
    if (data.ab && !set().about) set().about = data.ab;
    save(); render();
    toast(`Ton agenda est importé : ${r.added + r.updated} événements ✓`);
    return true;
  } catch (e) { console.warn(e); toast('Le lien d\'import est incomplet. Réessaie depuis le message d\'origine.'); return false; }
}
importFromLink().then(() => { if (!set().onboarded) openOnboarding(0); });
setInterval(focusTick, 1000);
setInterval(() => {
  checkReminders();
  const busy = !$('#sheet-wrap').hidden || document.activeElement?.matches('input,textarea,select');
  if (!busy && (tab === 'today' || tab === 'me')) render();
}, 30000);
setTimeout(checkReminders, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { focusTick(); render(); checkReminders(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
