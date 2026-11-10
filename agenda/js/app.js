import {
  S, save, onChange, CATS, guessCat, addEvent, updateEvent, deleteEvent, eventsBetween, eventsOfDay,
  duplicateIds, purgeDuplicates, addTask, updateTask, deleteTask, addNote, updateNote, deleteNote,
  deadlines, exportJson, importJson, mergeEvents, resetAll,
} from './store.js';
import {
  DAY, MIN, startOfDay, addDays, sameDay, startOfWeek, startOfMonth, dayDiff, pad, hm, hm2, ymd, fromYmd,
  cap, fmtDay, fmtDayShort, relDay, fmtDuration, countdown, JOURS_C, MOIS,
} from './dates.js';
import { localAssistant, askClaude, revisionPlan, revisionTitle, freeSlots } from './ai.js';
import { parseIcs } from './ics.js';
import * as G from './google.js';
import { listen, stopListening, canListen, speak } from './voice.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = id => `<svg><use href="#i-${id}"/></svg>`;
const col = cat => (CATS[cat] || CATS.perso).color;
const set = () => S().settings;

let tab = 'today';
let calDate = startOfDay(new Date());
let selDay = startOfDay(new Date());
let dueFilter = 'all';
let noteQuery = '';
const undoBag = new Map();

// =====================================================================
// Navigation
// =====================================================================
function go(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'v-' + t; });
  $('#fab').hidden = t === 'ai';
  render();
  $('#main').scrollTop = 0;
  if (t === 'cal' && ['week', '3days', 'day'].includes(set().calView)) scrollGridToNow();
  if (t === 'ai') setTimeout(() => { $('#main').scrollTop = 1e6; }, 30);
}

function header(kicker, title) { $('#top-kicker').textContent = kicker; $('#top-h').textContent = title; }

function render() {
  applyTheme();
  ({ today: renderToday, cal: renderCal, due: renderDue, notes: renderNotes, ai: renderAi })[tab]();
  const sync = $('#btn-sync');
  sync.hidden = !set().googleClientId;
  sync.classList.toggle('ok', set().googleConnected && Date.now() - set().lastSync < 3600000);
}

function applyTheme() {
  const th = set().theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : set().theme;
  document.documentElement.dataset.theme = th;
  document.querySelector('meta[name=theme-color]').content = th === 'light' ? '#f7f4ee' : '#070707';
}

// =====================================================================
// Éléments réutilisables
// =====================================================================
function tlItem(e, now = Date.now()) {
  const c = col(e.cat);
  const cls = e.end < now ? 'past' : e.start <= now && e.end > now ? 'now' : '';
  const time = e.allDay ? `<div class="tl-time">${CATS[e.cat]?.emoji || '•'}<small>journée</small></div>`
    : `<div class="tl-time">${hm(e.start)}<small>${hm(e.end)}</small></div>`;
  const sub = [e.location, e.allDay ? '' : fmtDuration(e.end - e.start)].filter(Boolean).join(' · ');
  return `<div class="tl-item ${cls}" style="--c:${c}" data-a="ev" data-id="${e.id}">${time}<div class="tl-bar"></div>
    <div class="tl-body"><div class="tl-title">${esc(e.title)}</div><div class="tl-sub">${esc(sub || CATS[e.cat]?.label)}</div></div></div>`;
}

function timeline(evs, { gaps = false } = {}) {
  if (!evs.length) return '<div class="empty">Rien de prévu.</div>';
  let out = '', last = null;
  for (const e of evs) {
    if (gaps && !e.allDay && last && e.start - last >= 75 * MIN && e.start > Date.now()) {
      out += `<div class="free-gap">Libre ${fmtDuration(e.start - Math.max(last, Date.now()))}</div>`;
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
  const u = d.due ? urgency(d.due) : { c: 'var(--dim)', b: '—', s: 'sans date' };
  const when = d.due ? cap(relDay(d.due)) + (d.dueTime ? ' · ' + hm(d.due) : '') : 'Quand tu peux';
  const isExam = d.kind === 'event' && d.cat === 'exam' && !d.done;
  const left = d.kind === 'task'
    ? `<button class="check ${d.done ? 'on' : ''}" data-a="task-done" data-id="${d.id}" aria-label="Fait">${icon('check')}</button>` : '';
  return `<div class="due ${d.done ? 'done' : ''} ${d.priority === 'haute' ? 'prio-haute' : ''}" style="--u:${u.c}">
    ${left}<div class="jx"><b>${u.b}</b><small>${u.s}</small></div>
    <div class="grow" data-a="${d.kind === 'task' ? 'task' : 'ev'}" data-id="${d.id}">
      <div class="ttl">${esc(d.title)}</div>
      <div class="sub">${CATS[d.cat]?.emoji || ''} ${when}${d.ref.location ? ' · ' + esc(d.ref.location) : ''}</div>
    </div>
    ${isExam ? `<button class="btn small" data-a="plan-rev" data-id="${d.id}">Réviser</button>` : ''}
  </div>`;
}

const NOTE_COLORS = { gold: '#d9b26a', rose: '#f472b6', bleu: '#5b8def', vert: '#2fd1a5', violet: '#c47dff', rouge: '#ff5d6c', gris: '#8b95a7' };
function noteCard(n) {
  const c = NOTE_COLORS[n.color] || NOTE_COLORS.gold;
  return `<div class="note" style="--nc:${c}" data-a="note" data-id="${n.id}">
    ${n.pinned ? `<svg class="pin"><use href="#i-pin"/></svg>` : ''}
    ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}<p>${esc(n.text)}</p>
    ${n.remind ? `<div class="rm">⏰ ${cap(relDay(n.remind))} ${hm(n.remind)}</div>` : ''}
  </div>`;
}

function quickBar(id, ph) {
  return `<form class="quick" data-quick="${id}">
    <svg class="sp"><use href="#i-spark"/></svg>
    <input id="${id}" placeholder="${esc(ph)}" autocomplete="off" enterkeyhint="send">
    ${canListen ? `<button type="button" data-a="mic" data-for="${id}" aria-label="Dicter">${icon('mic')}</button>` : ''}
    <button class="go" aria-label="Envoyer">${icon('send')}</button>
  </form>`;
}

// =====================================================================
// AUJOURD'HUI
// =====================================================================
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
}

function busyMinutes(evs) {
  return evs.filter(e => !e.allDay && e.cat !== 'ferie').reduce((n, e) => n + (e.end - e.start) / MIN, 0);
}

function insights() {
  const out = [];
  const now = Date.now();
  const st = S();
  // examens proches sans révision
  const exams = deadlines({ from: now }).filter(d => d.kind === 'event' && d.cat === 'exam' && !d.done && d.due - now < 15 * DAY);
  for (const ex of exams.slice(0, 2)) {
    const revs = eventsBetween(now, ex.due).filter(e => e.cat === 'revision');
    if (revs.length) continue;
    const n = dayDiff(new Date(), ex.due);
    out.push({ c: CATS.exam.color, ic: '🎯', html: `<b>${esc(ex.title)}</b> ${n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`}, et aucune révision n'est prévue.`, btn: `<button class="btn small gold" data-a="plan-rev" data-id="${ex.id}">Planifier mes révisions</button>` });
  }
  // tâches en retard
  const late = st.tasks.filter(t => !t.done && t.due && t.due < startOfDay(new Date()).getTime());
  if (late.length) out.push({ c: 'var(--danger)', ic: '⏰', html: `${late.length} tâche${late.length > 1 ? 's' : ''} en retard : <b>${esc(late[0].title)}</b>${late.length > 1 ? '…' : ''}`, btn: `<button class="btn small" data-a="tab" data-tab="due">Voir l'échéancier</button>` });
  // demain chargé
  const tmr = eventsOfDay(addDays(new Date(), 1));
  const tm = busyMinutes(tmr);
  const first = tmr.find(e => !e.allDay);
  if (tm >= 300 && first) out.push({ c: 'var(--warn)', ic: '🔋', html: `Demain est chargé : <b>${fmtDuration(tm * MIN)}</b> occupées, premier rendez-vous à <b>${hm(first.start)}</b> (${esc(first.title)}).` });
  else if (first && new Date().getHours() >= 18) out.push({ c: col(first.cat), ic: '🌙', html: `Demain, tu commences à <b>${hm(first.start)}</b> : ${esc(first.title)}${first.location ? ' — ' + esc(first.location) : ''}.` });
  // notes à rappeler aujourd'hui
  const nr = st.notes.filter(n => n.remind && sameDay(n.remind, new Date()));
  if (nr.length) out.push({ c: NOTE_COLORS.gold, ic: '📝', html: `À ne pas oublier aujourd'hui : <b>${esc(nr[0].title || nr[0].text.split('\n')[0])}</b>${nr.length > 1 ? ` (+${nr.length - 1})` : ''}` });
  // doublons
  const dups = duplicateIds().size;
  if (dups && !st.settings.dupsSeen) out.push({ c: 'var(--accent)', ic: '🧹', html: `J'ai repéré <b>${dups} doublons</b> dans ton agenda Google. Je les masque pour que tout soit plus lisible.`, btn: `<button class="btn small" data-a="dups-ok">OK</button> <button class="btn small" data-a="settings">Gérer</button>` });
  // Google pas synchronisé depuis longtemps
  if (st.settings.googleClientId && Date.now() - st.settings.lastSync > 12 * 3600000) out.push({ c: '#4285F4', ic: '🔄', html: st.settings.lastSync ? `Dernière synchro Google : ${relDay(st.settings.lastSync)}.` : 'Google Agenda est prêt à être connecté.', btn: `<button class="btn small" data-a="sync">${icon('google')} Synchroniser</button>` });
  return out;
}

function renderToday() {
  const now = new Date();
  const st = S();
  header(cap(fmtDay(now)), `${greeting()}, ${set().name || 'toi'}`);
  const today = eventsOfDay(now);
  const timed = today.filter(e => !e.allDay);
  const nowEv = timed.find(e => e.start <= now && e.end > now);
  const upcoming = eventsBetween(now.getTime(), now.getTime() + 14 * DAY).filter(e => !e.allDay && e.start > now);
  const next = upcoming[0];
  let hero = '';
  if (!st.events.length && !st.tasks.length) {
    hero = `<div class="hero"><div class="lbl">Bienvenue</div><div class="ttl">On remplit ton agenda ?</div>
      <div class="meta">Connecte ton Google Agenda ou importe ton fichier d'agenda (.json ou .ics) pour retrouver tous tes événements ici.</div>
      <div class="actions"><button class="btn gold" data-a="settings">${icon('google')} Connecter Google</button><button class="btn" data-a="import">Importer un fichier</button></div></div>`;
  } else if (nowEv) {
    const p = Math.min(100, (now - nowEv.start) / (nowEv.end - nowEv.start) * 100);
    hero = `<div class="hero" style="--c:${col(nowEv.cat)}" data-a="ev" data-id="${nowEv.id}">
      <div class="cd">encore ${fmtDuration(nowEv.end - now)}</div>
      <div class="lbl">En ce moment</div><div class="ttl">${esc(nowEv.title)}</div>
      <div class="meta"><span>${icon('clock')}${hm(nowEv.start)} – ${hm(nowEv.end)}</span>${nowEv.location ? `<span>${icon('place')}${esc(nowEv.location)}</span>` : ''}</div>
      <div class="progress"><i style="width:${p}%"></i></div>
      ${next ? `<div class="next2">Ensuite : <b>${esc(next.title)}</b> · ${relDay(next.start) === "aujourd'hui" ? '' : relDay(next.start) + ' '}${hm(next.start)}</div>` : ''}</div>`;
  } else if (next) {
    const after = upcoming[1];
    hero = `<div class="hero" style="--c:${col(next.cat)}" data-a="ev" data-id="${next.id}">
      <div class="cd">${countdown(next.start)}</div>
      <div class="lbl">Prochain · ${CATS[next.cat]?.label}</div><div class="ttl">${esc(next.title)}</div>
      <div class="meta"><span>${icon('clock')}${cap(relDay(next.start))} · ${hm(next.start)} – ${hm(next.end)}</span>${next.location ? `<span>${icon('place')}${esc(next.location)}</span>` : ''}</div>
      ${after ? `<div class="next2">Puis : <b>${esc(after.title)}</b> · ${relDay(after.start) === "aujourd'hui" ? '' : relDay(after.start) + ' '}${hm(after.start)}</div>` : ''}</div>`;
  } else {
    hero = `<div class="hero"><div class="lbl">Tranquille</div><div class="ttl">Rien de prévu pour l'instant</div><div class="meta">Dis-moi ce que tu veux programmer ↓</div></div>`;
  }

  const dl = deadlines({ from: Date.now() - DAY }).filter(d => !d.done);
  const dl7 = dl.filter(d => d.due < Date.now() + 7 * DAY);
  const todo = st.tasks.filter(t => !t.done).sort((a, b) => (a.due || 9e15) - (b.due || 9e15));
  const busy = busyMinutes(today);

  const ins = insights().map(i => `<div class="insight" style="--c:${i.c}"><div class="ic">${i.ic}</div><div class="grow"><p>${i.html}</p>${i.btn ? `<div class="row wrap">${i.btn}</div>` : ''}</div></div>`).join('');

  const tmr = eventsOfDay(addDays(now, 1));
  const pinned = st.notes.filter(n => n.pinned);

  $('#v-today').innerHTML = `
    ${hero}
    ${quickBar('q-today', 'Ex : « boxe jeudi 20h30 » ou « note : appeler la CAF »')}
    <div class="stats">
      <div class="stat" data-a="tab" data-tab="cal"><b>${timed.length}</b><span>aujourd'hui · ${busy ? fmtDuration(busy * MIN) : 'libre'}</span></div>
      <div class="stat" data-a="tab" data-tab="due"><b style="color:${dl7.length ? 'var(--warn)' : 'inherit'}">${dl7.length}</b><span>échéance${dl7.length > 1 ? 's' : ''} sous 7 j</span></div>
      <div class="stat" data-a="tab" data-tab="due"><b>${todo.length}</b><span>tâche${todo.length > 1 ? 's' : ''} à faire</span></div>
    </div>
    ${ins}
    <div class="card"><h2>Ma journée <span class="more" data-a="day" data-d="${ymd(now)}">Ouvrir</span></h2><div class="tl">${timeline(today, { gaps: true })}</div></div>
    ${dl.length ? `<div class="card"><h2>⏳ Échéances <span class="more" data-a="tab" data-tab="due">Tout voir</span></h2>${dl.slice(0, 4).map(dueItem).join('')}</div>` : ''}
    ${todo.length ? `<div class="card"><h2>✅ À faire</h2>${todo.slice(0, 5).map(t => dueItem({ kind: 'task', id: t.id, title: t.title, due: t.due, dueTime: t.dueTime, cat: t.cat, done: t.done, priority: t.priority, ref: t })).join('')}</div>` : ''}
    ${pinned.length ? `<div class="card"><h2>📌 À ne pas oublier <span class="more" data-a="tab" data-tab="notes">Notes</span></h2><div class="notes-grid">${pinned.map(noteCard).join('')}</div></div>` : ''}
    <div class="card"><h2>Demain · ${fmtDayShort(addDays(now, 1))} <span class="more" data-a="day" data-d="${ymd(addDays(now, 1))}">Ouvrir</span></h2><div class="tl">${timeline(tmr)}</div></div>
    <div class="card"><h2>Ma semaine</h2>${weekChart()}</div>
  `;
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
    const segs = Object.entries(x.by).sort().map(([c, h]) => { used.add(c); return `<i style="height:${h / max * 100}%;background:${col(c)}"></i>`; }).join('');
    return `<div class="wb ${sameDay(x.d, new Date()) ? 'today' : ''}" data-a="day" data-d="${ymd(x.d)}"><em>${x.total ? Math.round(x.total * 10) / 10 + 'h' : ''}</em><div class="stack" style="height:${Math.max(3, x.total / max * 100)}%">${segs}</div><span>${JOURS_C[x.d.getDay()]}</span></div>`;
  }).join('');
  const total = data.reduce((a, b) => a + b.total, 0);
  return `<div class="week-bars">${bars}</div><div class="legend">${[...used].map(c => `<span><i style="background:${col(c)}"></i>${CATS[c].label}</span>`).join('')}<span class="dim" style="margin-left:auto">${Math.round(total)} h au total</span></div>`;
}

// =====================================================================
// CALENDRIER
// =====================================================================
const VIEWS = [['month', 'Mois'], ['week', 'Semaine'], ['3days', '3 jours'], ['day', 'Jour'], ['list', 'Liste']];

function calTitle(v) {
  if (v === 'month') return `${MOIS[calDate.getMonth()]} ${calDate.getFullYear()}`;
  if (v === 'day') return fmtDay(calDate);
  if (v === 'list') return `À partir du ${fmtDayShort(calDate)}`;
  const a = v === 'week' ? startOfWeek(calDate) : calDate;
  const b = addDays(a, v === 'week' ? 6 : 2);
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MOIS[a.getMonth()]}` : `${a.getDate()} ${MOIS[a.getMonth()].slice(0, 4)}. – ${b.getDate()} ${MOIS[b.getMonth()].slice(0, 4)}.`;
}

function renderCal() {
  const v = set().calView;
  header(cap(fmtDay(new Date())), 'Mon calendrier');
  const hidden = new Set(set().hiddenCats);
  const chips = Object.entries(CATS).map(([k, c]) => `<button class="chip ${hidden.has(k) ? '' : 'on'}" data-a="cat-toggle" data-cat="${k}" style="${hidden.has(k) ? '' : `background:${c.color};color:#111`}"><span>${c.emoji}</span>${c.label}</button>`).join('');
  let body = '';
  if (v === 'month') body = monthView();
  else if (v === 'list') body = listView();
  else body = gridView(v === 'day' ? 1 : v === '3days' ? 3 : 7, v === 'week' ? startOfWeek(calDate) : calDate);
  $('#v-cal').innerHTML = `
    <div class="seg">${VIEWS.map(([k, l]) => `<button class="${k === v ? 'on' : ''}" data-a="view" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="cal-bar">
      <button class="icon-btn" data-a="cal-prev" aria-label="Précédent">${icon('left')}</button>
      <h2>${calTitle(v)}</h2>
      <button class="btn small" data-a="cal-today">Auj.</button>
      <button class="icon-btn" data-a="cal-next" aria-label="Suivant">${icon('right')}</button>
    </div>
    <div class="chips">${chips}</div>
    <div id="cal-body">${body}</div>`;
}

function monthView() {
  const m0 = startOfMonth(calDate);
  const g0 = startOfWeek(m0);
  const evs = eventsBetween(g0.getTime(), addDays(g0, 42).getTime());
  let cells = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map(d => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(g0, i);
    if (i === 35 && d.getMonth() !== m0.getMonth()) break;
    const a = d.getTime(), b = a + DAY;
    const de = evs.filter(e => e.start < b && e.end > a);
    const hours = busyMinutes(de) / 60;
    const shown = de.slice(0, 3).map(e => `<div class="ev" style="--c:${col(e.cat)}">${e.allDay ? '' : hm(e.start) + ' '}${esc(e.title.replace(/^(CM|TD|TP) /, '$1 '))}</div>`).join('');
    cells += `<div class="mc ${d.getMonth() !== m0.getMonth() ? 'out' : ''} ${sameDay(d, new Date()) ? 'today' : ''} ${sameDay(d, selDay) ? 'sel' : ''}" data-a="sel" data-d="${ymd(d)}">
      <div class="dn">${d.getDate()}</div>${shown}${de.length > 3 ? `<div class="more">+${de.length - 3}</div>` : ''}<div class="heat" style="--h:${Math.min(1, hours / 8)}"></div></div>`;
  }
  const list = eventsOfDay(selDay);
  return `<div class="month" id="swipe">${cells}</div>
    <div class="daylist-h">${relDay(selDay) === fmtDayShort(selDay) ? fmtDay(selDay) : cap(relDay(selDay)) + ' · ' + fmtDay(selDay)} <span class="tag">${list.length} élément${list.length > 1 ? 's' : ''}</span></div>
    <div class="tl">${timeline(list, { gaps: true })}</div>`;
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
  return [...by].map(([k, l]) => `<div class="daylist-h" style="${sameDay(k, new Date()) ? 'color:var(--accent)' : ''}">${['aujourd\'hui', 'demain'].includes(relDay(k)) ? cap(relDay(k)) + ' · ' : ''}${fmtDay(k)} <span class="tag">${fmtDuration(busyMinutes(l) * MIN) === '0 min' ? l.length : fmtDuration(busyMinutes(l) * MIN)}</span></div><div class="tl">${timeline(l)}</div>`).join('');
}

function layoutCols(evs) {
  // répartit les événements qui se chevauchent en colonnes
  const sorted = [...evs].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [], clusterEnd = 0;
  const flush = () => {
    const cols = [];
    for (const e of cluster) {
      let c = cols.findIndex(end => end <= e.start);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = e.end;
      out.push({ e, c });
    }
    out.slice(-cluster.length).forEach(o => { o.n = cols.length; });
    cluster = []; clusterEnd = 0;
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push(e); clusterEnd = Math.max(clusterEnd, e.end);
  }
  if (cluster.length) flush();
  return out;
}

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
  const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 58;
  const head = days.map(d => `<div class="${sameDay(d, new Date()) ? 'today' : ''}" data-a="day" data-d="${ymd(d)}">${JOURS_C[d.getDay()]}<b>${d.getDate()}</b></div>`).join('');
  const allDay = days.map(d => `<div>${all.filter(e => e.allDay && e.start < d.getTime() + DAY && e.end > d.getTime()).map(e => `<div class="ev" style="--c:${col(e.cat)}" data-a="ev" data-id="${e.id}">${esc(e.title)}</div>`).join('')}</div>`).join('');
  const hasAllDay = all.some(e => e.allDay);
  const hours = [...Array(h1 - h0)].map((_, i) => `<div>${i ? pad(h0 + i) + 'h' : ''}</div>`).join('');
  const now = Date.now();
  const cols = days.map(d => {
    const d0 = d.getTime();
    const evs = all.filter(e => !e.allDay && e.start < d0 + DAY && e.end > d0);
    const items = layoutCols(evs).map(({ e, c, n: cn }) => {
      const s = Math.max(e.start, d0 + h0 * 3600000), en = Math.min(e.end, d0 + h1 * 3600000);
      const top = (s - d0 - h0 * 3600000) / 3600000 * hourPx;
      const hgt = Math.max(20, (en - s) / 3600000 * hourPx - 2);
      const w = 100 / cn;
      return `<div class="gev ${e.end < now ? 'past' : ''}" style="--c:${col(e.cat)};top:${top}px;height:${hgt}px;left:calc(${c * w}% + 1px);width:calc(${w}% - 3px)" data-a="ev" data-id="${e.id}"><b>${esc(e.title)}</b>${hgt > 34 ? `<small>${hm(e.start)}–${hm(e.end)}${e.location && hgt > 60 ? ' · ' + esc(e.location) : ''}</small>` : ''}</div>`;
    }).join('');
    const nl = sameDay(d, new Date()) ? `<div class="now-line" style="top:${(now - d0 - h0 * 3600000) / 3600000 * hourPx}px"></div>` : '';
    return `<div class="col ${sameDay(d, new Date()) ? 'today' : ''}" data-a="slot" data-d="${ymd(d)}" data-h0="${h0}">${items}${nl}</div>`;
  }).join('');
  return `<div class="col-h">${head}</div>${hasAllDay ? `<div class="allday-row">${allDay}</div>` : ''}
    <div class="grid-wrap ${n === 7 ? 'tight' : ''}" id="swipe"><div class="hours">${hours}</div><div class="cols" style="grid-template-columns:repeat(${n},1fr);height:${(h1 - h0) * hourPx}px">${cols}</div></div>`;
}

function scrollGridToNow() {
  requestAnimationFrame(() => {
    const nl = document.querySelector('.now-line');
    if (nl) $('#main').scrollTop = Math.max(0, nl.getBoundingClientRect().top + $('#main').scrollTop - 260);
  });
}

function calShift(dir) {
  const v = set().calView;
  if (v === 'month') { calDate = new Date(calDate.getFullYear(), calDate.getMonth() + dir, 1); selDay = sameDay(startOfMonth(new Date()), calDate) ? startOfDay(new Date()) : calDate; }
  else calDate = addDays(calDate, dir * (v === 'week' ? 7 : v === '3days' ? 3 : v === 'list' ? 30 : 1));
  renderCal();
}

// =====================================================================
// ÉCHÉANCES
// =====================================================================
function renderDue() {
  header('Échéancier', 'Mes échéances');
  const all = deadlines({ includeDone: dueFilter === 'done' });
  let list = all;
  if (dueFilter === 'exam') list = all.filter(d => d.kind === 'event');
  if (dueFilter === 'task') list = all.filter(d => d.kind === 'task');
  if (dueFilter === 'done') list = all.filter(d => d.done).reverse();
  else list = list.filter(d => !d.done);
  const t0 = startOfDay(new Date()).getTime();
  const late = all.filter(d => !d.done && d.due < t0).length;
  const w = all.filter(d => !d.done && d.due >= t0 && d.due < t0 + 7 * DAY).length;
  const nodate = S().tasks.filter(t => !t.due && !t.done);
  const groups = [
    ['🔴 En retard', d => d.due < t0],
    ["📍 Aujourd'hui", d => d.due >= t0 && d.due < t0 + DAY],
    ['🔥 Cette semaine', d => d.due >= t0 + DAY && d.due < t0 + 7 * DAY],
    ['📅 Ce mois-ci', d => d.due >= t0 + 7 * DAY && d.due < t0 + 31 * DAY],
    ['🔭 Plus tard', d => d.due >= t0 + 31 * DAY],
  ];
  let body = '';
  if (dueFilter === 'done') body = list.length ? list.map(dueItem).join('') : '<div class="empty">Rien de terminé pour l\'instant.</div>';
  else {
    for (const [label, fn] of groups) {
      const g = list.filter(fn);
      if (g.length) body += `<div class="group-h">${label} <span class="n">${g.length}</span></div>` + g.map(dueItem).join('');
    }
    if (dueFilter !== 'exam' && nodate.length) body += `<div class="group-h">🗂 Sans date <span class="n">${nodate.length}</span></div>` + nodate.map(t => `<div class="due"><button class="check" data-a="task-done" data-id="${t.id}">${icon('check')}</button><div class="grow" data-a="task" data-id="${t.id}"><div class="ttl">${esc(t.title)}</div><div class="sub">${CATS[t.cat]?.emoji || ''} ${t.priority === 'haute' ? 'Priorité haute' : 'Quand tu peux'}</div></div></div>`).join('');
    if (!body) body = '<div class="empty" style="text-align:center;padding:30px 0">Aucune échéance 🎉<br>Ajoute une tâche avec le bouton +</div>';
  }
  $('#v-due').innerHTML = `
    <div class="stats">
      <div class="stat"><b style="color:${late ? 'var(--danger)' : 'inherit'}">${late}</b><span>en retard</span></div>
      <div class="stat"><b style="color:${w ? 'var(--warn)' : 'inherit'}">${w}</b><span>sous 7 jours</span></div>
      <div class="stat"><b>${all.filter(d => !d.done).length + nodate.length}</b><span>au total</span></div>
    </div>
    ${quickBar('q-due', 'Ex : « dossier stage à rendre vendredi »')}
    <div class="chips">${[['all', 'Tout'], ['exam', '⚠️ Examens & remises'], ['task', '✅ Mes tâches'], ['done', 'Terminé']].map(([k, l]) => `<button class="chip ${dueFilter === k ? 'on' : ''}" data-a="due-f" data-f="${k}">${l}</button>`).join('')}</div>
    ${body}`;
}

// =====================================================================
// NOTES
// =====================================================================
function renderNotes() {
  header('Notes', 'À ne pas oublier');
  const q = noteQuery.toLowerCase();
  const notes = S().notes.filter(n => !q || (n.title + ' ' + n.text).toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated);
  $('#v-notes').innerHTML = `
    <div class="search">${icon('search')}<input id="note-q" placeholder="Rechercher dans mes notes" value="${esc(noteQuery)}"></div>
    ${quickBar('q-note', 'Note rapide… (Entrée pour enregistrer)')}
    ${notes.length ? `<div class="notes-grid">${notes.map(noteCard).join('')}</div>` : `<div class="empty" style="text-align:center;padding:30px 0">${q ? 'Aucun résultat.' : 'Aucune note. Écris ce que tu ne veux pas oublier ✍️'}</div>`}`;
}

// =====================================================================
// ASSISTANT
// =====================================================================
const SUGG = [
  "Qu'est-ce que j'ai demain ?",
  'Mes examens à venir',
  'Planifie mes révisions',
  'Ajoute boxe vendredi de 21h à 22h30',
  'Rappelle-moi de payer le loyer le 5',
  'Quels créneaux libres jeudi ?',
];

function renderAi() {
  header('Assistant', 'Ton assistant ✦');
  const chat = S().chat;
  const hasKey = !!set().claudeKey;
  const msgs = chat.map((m, i) => `<div class="msg ${m.role}">${esc(m.text)}${m.acts?.length ? `<div class="acts">${m.acts.map((a, j) => `<div class="act" style="--c:${col(a.cat)}"><div class="grow">${esc(a.label)}</div>${undoBag.has(`${i}:${j}`) ? `<button data-a="undo" data-k="${i}:${j}">Annuler</button>` : ''}</div>`).join('')}</div>` : ''}</div>`).join('');
  $('#v-ai').innerHTML = `
    ${chat.length ? '' : `<div class="ai-hello"><div class="orb">${icon('spark')}</div><h2>Que veux-tu programmer ?</h2><p>Écris ou dicte : je mets tout directement dans ton calendrier${set().googleConnected ? ' et sur Google Agenda' : ''}.</p></div>`}
    <div class="mode">${hasKey ? '✦ Mode Claude : je comprends toutes tes demandes' : 'Mode hors-ligne · ajoute ta clé Claude dans les Réglages pour une IA complète'}${chat.length ? ' · <a href="#" data-a="chat-clear">Effacer</a>' : ''}</div>
    <div class="chat">${msgs}</div>
    <div class="sugg">${SUGG.map(s => `<button class="chip" data-a="sugg">${esc(s)}</button>`).join('')}</div>
    <div class="ai-input">${quickBar('q-ai', 'Demande-moi quelque chose…')}</div>`;
}

async function runAssistant(text, { stay = false } = {}) {
  const st = S();
  text = text.trim();
  if (!text) return;
  st.chat.push({ role: 'user', text });
  st.chat.push({ role: 'assistant', text: '…', thinking: true });
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
  st.chat[idx] = { role: 'assistant', text: res.reply, acts: acts.map(a => ({ label: a.label, cat: a.cat })) };
  save();
  if (set().voiceReply) speak(res.reply);
  if (tab === 'ai') { renderAi(); $('#main').scrollTop = 1e6; }
  else {
    render();
    if (acts.length) toast(res.reply, acts.length === 1 ? { label: 'Annuler', fn: () => doUndo(`${idx}:0`) } : null);
    else if (!stay) { go('ai'); }
    else toast(res.reply);
  }
}

// Applique les actions de l'assistant ; retourne de quoi les afficher / annuler.
async function applyActions(actions, msgIdx) {
  const out = [];
  for (const a of actions) {
    let r = null;
    try {
      if (a.type === 'create_event' && a.start) {
        const ev = addEvent({ title: a.title || 'Événement', start: a.start, end: a.end || a.start + 3600000, allDay: !!a.allDay, location: a.location || '', cat: a.category || guessCat(a.title || '') });
        gpush(ev);
        r = { label: `＋ ${ev.title} · ${relDay(ev.start)}${ev.allDay ? '' : ' ' + hm(ev.start) + '–' + hm(ev.end)}`, cat: ev.cat, undo: () => { deleteEvent(ev.id); flushDeletes(); } };
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
        const n = addNote({ title: a.text && a.title && a.title !== a.text ? a.title : '', text: body, pinned: true });
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
  if (!set().googleConnected) return;
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
  if (!set().googleClientId) { openSettings(); toast('Ajoute d\'abord ton identifiant Google (2 min, guide dans les Réglages).'); return; }
  b.classList.add('spin');
  try {
    const r = await G.syncAll();
    toast(`Google Agenda synchronisé : ${r.count} événements (${r.calendars} agendas).`);
  } catch (e) {
    toast('Synchro impossible : ' + (e.message || e));
  } finally { b.classList.remove('spin'); render(); }
}

// =====================================================================
// Feuilles : événement, tâche, note, réglages
// =====================================================================
function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet-wrap').hidden = false;
  $('#sheet').scrollTop = 0;
}
function closeSheet() { $('#sheet-wrap').hidden = true; $('#sheet-body').innerHTML = ''; }

function openEvent(id) {
  const e = S().events.find(x => x.id === id);
  if (!e) return;
  const c = CATS[e.cat] || CATS.perso;
  const when = e.allDay
    ? (e.end - e.start > DAY ? `Du ${fmtDay(e.start)} au ${fmtDay(e.end - DAY)}` : cap(fmtDay(e.start)) + ' · journée')
    : `${cap(fmtDay(e.start))} · ${hm(e.start)} – ${hm(e.end)} (${fmtDuration(e.end - e.start)})`;
  const isExam = e.cat === 'exam' && e.start > Date.now();
  openSheet(`<div class="ev-detail">
    <div class="row" style="margin-bottom:8px"><span class="tag" style="background:${c.color};color:#111">${c.emoji} ${c.label}</span>${e.source === 'google' ? `<span class="tag">${icon('google').replace('<svg>', '<svg style="width:12px;height:12px;vertical-align:-2px">')} Google</span>` : ''}${e.start > Date.now() ? `<span class="tag">${countdown(e.start)}</span>` : ''}<button class="icon-btn x" style="margin-left:auto" data-a="close">${icon('x')}</button></div>
    <div class="big">${esc(e.title)}</div>
    <div class="line">${icon('clock')}<div>${when}</div></div>
    ${e.location ? `<div class="line">${icon('place')}<div><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}" target="_blank" rel="noopener">${esc(e.location)}</a></div></div>` : ''}
    ${e.notes ? `<div class="notes">${esc(e.notes)}</div>` : ''}
    <div class="actions">
      <button class="btn gold" data-a="ev-edit" data-id="${e.id}">Modifier</button>
      <button class="btn" data-a="ev-dup" data-id="${e.id}">Dupliquer</button>
      <button class="btn danger" data-a="ev-del" data-id="${e.id}">Supprimer</button>
    </div>
    ${isExam ? `<button class="btn block" style="margin-top:8px" data-a="plan-rev" data-id="${e.id}">🧠 Planifier des révisions avant</button>` : ''}
  </div>`);
}

const REMINDERS = [[null, 'Par défaut'], [0, 'À l\'heure'], [10, '10 min avant'], [30, '30 min avant'], [60, '1 h avant'], [120, '2 h avant'], [1440, 'La veille']];

function editEvent(id, preset = {}) {
  const e = id ? S().events.find(x => x.id === id) : null;
  const base = e || { title: '', start: preset.start || nextHalfHour(), end: (preset.start || nextHalfHour()) + 3600000, allDay: false, location: '', notes: '', cat: '', reminder: null, ...preset };
  const catOpts = Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${base.cat === k ? 'selected' : ''}>${c.emoji} ${c.label}</option>`).join('');
  openSheet(`<form id="ev-form">
    <div class="sh-title">${e ? 'Modifier' : 'Nouvel événement'}<button type="button" class="icon-btn x" data-a="close">${icon('x')}</button></div>
    <div class="field"><label>Titre</label><input name="title" value="${esc(base.title)}" placeholder="Ex : TD Stats, Boxe, RDV médecin…" required></div>
    <div class="field"><label>Catégorie</label><select name="cat"><option value="">✦ Automatique</option>${catOpts}</select></div>
    <div class="switch">Toute la journée<button type="button" class="tg ${base.allDay ? 'on' : ''}" data-a="tg" data-name="allDay"></button><input type="hidden" name="allDay" value="${base.allDay ? 1 : 0}"></div>
    <div class="fields2" style="margin-top:12px">
      <div class="field"><label>Date</label><input type="date" name="date" value="${ymd(base.start)}" required></div>
      <div class="field"><label>Fin (date)</label><input type="date" name="date2" value="${ymd(base.allDay ? base.end - DAY : base.end)}"></div>
      <div class="field tm"><label>Début</label><input type="time" name="t1" value="${hm2(base.start)}"></div>
      <div class="field tm"><label>Fin</label><input type="time" name="t2" value="${hm2(base.end)}"></div>
    </div>
    <div class="field"><label>Lieu</label><input name="location" value="${esc(base.location)}" placeholder="Amphi, adresse…"></div>
    <div class="field"><label>Rappel</label><select name="reminder">${REMINDERS.map(([v, l]) => `<option value="${v ?? ''}" ${base.reminder === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Notes</label><textarea name="notes" placeholder="Détails, à apporter…">${esc(base.notes)}</textarea></div>
    <button class="btn gold block">${e ? 'Enregistrer' : 'Ajouter au calendrier'}</button>
    <input type="hidden" name="id" value="${e?.id || ''}">
  </form>`);
  toggleTimeFields();
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
  };
  data.cat = f.cat.value || guessCat(data.title, data.notes);
  if (f.cat.value) data.catLocked = true;
  const ev = f.id.value ? updateEvent(f.id.value, data) : addEvent(data);
  gpush(ev);
  closeSheet();
  selDay = startOfDay(ev.start);
  render();
  toast(f.id.value ? 'Modifié ✓' : `Ajouté : ${ev.title}, ${relDay(ev.start)}${ev.allDay ? '' : ' à ' + hm(ev.start)}`);
}

function editTask(id, preset = {}) {
  const t = id ? S().tasks.find(x => x.id === id) : null;
  const b = t || { title: '', due: null, dueTime: false, priority: 'normale', cat: '', ...preset };
  openSheet(`<form id="task-form">
    <div class="sh-title">${t ? 'Modifier la tâche' : 'Nouvelle échéance'}<button type="button" class="icon-btn x" data-a="close">${icon('x')}</button></div>
    <div class="field"><label>Quoi ?</label><input name="title" value="${esc(b.title)}" placeholder="Ex : Rendre le guide d'entretien" required></div>
    <div class="fields2">
      <div class="field"><label>Pour le</label><input type="date" name="date" value="${b.due ? ymd(b.due) : ''}"></div>
      <div class="field"><label>Heure (option)</label><input type="time" name="time" value="${b.due && b.dueTime ? hm2(b.due) : ''}"></div>
    </div>
    <div class="field"><label>Priorité</label><div class="seg">${['haute', 'normale', 'basse'].map(p => `<button type="button" class="${b.priority === p ? 'on' : ''}" data-a="prio" data-p="${p}">${p === 'haute' ? '🔴 Haute' : p === 'normale' ? '🟡 Normale' : '🟢 Basse'}</button>`).join('')}</div><input type="hidden" name="priority" value="${b.priority}"></div>
    <button class="btn gold block">${t ? 'Enregistrer' : 'Ajouter à l\'échéancier'}</button>
    ${t ? `<div class="actions"><button type="button" class="btn" data-a="task-done" data-id="${t.id}">${t.done ? 'Rouvrir' : '✓ Terminé'}</button><button type="button" class="btn danger" data-a="task-del" data-id="${t.id}">Supprimer</button></div>` : ''}
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

function editNote(id) {
  const n = id ? S().notes.find(x => x.id === id) : null;
  const b = n || { title: '', text: '', color: 'gold', pinned: false, remind: null };
  openSheet(`<form id="note-form">
    <div class="sh-title">${n ? 'Note' : 'Nouvelle note'}<button type="button" class="icon-btn x" data-a="close">${icon('x')}</button></div>
    <div class="field"><input name="title" value="${esc(b.title)}" placeholder="Titre (facultatif)"></div>
    <div class="field"><textarea name="text" placeholder="Ce que je ne dois pas oublier…" style="min-height:160px">${esc(b.text)}</textarea></div>
    <div class="field"><label>Couleur</label><div class="swatches">${Object.entries(NOTE_COLORS).map(([k, c]) => `<button type="button" class="sw ${b.color === k ? 'on' : ''}" style="--c:${c}" data-a="sw" data-c="${k}" aria-label="${k}"></button>`).join('')}</div><input type="hidden" name="color" value="${b.color}"></div>
    <div class="switch">📌 Épingler sur l'accueil<button type="button" class="tg ${b.pinned ? 'on' : ''}" data-a="tg" data-name="pinned"></button><input type="hidden" name="pinned" value="${b.pinned ? 1 : 0}"></div>
    <div class="field" style="margin-top:12px"><label>⏰ Me le rappeler</label><input type="datetime-local" name="remind" value="${b.remind ? ymd(b.remind) + 'T' + hm2(b.remind) : ''}"></div>
    <button class="btn gold block">Enregistrer</button>
    ${n ? `<div class="actions"><button type="button" class="btn" data-a="note-task" data-id="${n.id}">→ En tâche</button><button type="button" class="btn danger" data-a="note-del" data-id="${n.id}">Supprimer</button></div>` : ''}
    <input type="hidden" name="id" value="${n?.id || ''}">
  </form>`);
}
function saveNoteForm(f) {
  const data = { title: f.title.value.trim(), text: f.text.value.trim(), color: f.color.value, pinned: f.pinned.value === '1', remind: f.remind.value ? new Date(f.remind.value).getTime() : null, reminded: false };
  if (!data.text && !data.title) { closeSheet(); return; }
  if (f.id.value) updateNote(f.id.value, data); else addNote(data);
  closeSheet(); render(); toast('Note enregistrée ✓');
}

function openSettings() {
  const s = set();
  const origin = location.origin;
  const dups = duplicateIds().size;
  const hidden = new Set(s.hiddenCats);
  openSheet(`<form id="set-form">
    <div class="sh-title">Réglages<button type="button" class="icon-btn x" data-a="close">${icon('x')}</button></div>

    <div class="set-sec">Profil</div>
    <div class="field"><label>Prénom</label><input name="name" value="${esc(s.name)}"></div>
    <div class="field"><label>À propos de moi (pour l'IA)</label><textarea name="about" style="min-height:70px" placeholder="Ex : L2 Gestion, boxe le soir, je révise mieux en fin d'après-midi…">${esc(s.about)}</textarea></div>

    <div class="set-sec">Google Agenda</div>
    <div class="guide">${s.googleConnected ? `✅ Connecté · dernière synchro ${s.lastSync ? relDay(s.lastSync) + ' à ' + hm(s.lastSync) : 'jamais'}.<br>Tout ce que tu ajoutes ici part aussi sur Google Agenda (et inversement à chaque synchro).` : `Pour lire <b>et</b> écrire directement dans ton Google Agenda, crée une fois ton identifiant (gratuit, ~3 min) :
      <ol><li>Va sur <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">console.cloud.google.com</a> → crée un projet.</li>
      <li>« API et services » → Bibliothèque → active <b>Google Calendar API</b>.</li>
      <li>« Écran de consentement OAuth » → Externe → ajoute ton adresse Gmail comme <b>utilisateur test</b>.</li>
      <li>« Identifiants » → Créer → <b>ID client OAuth</b> → Application Web → Origine JavaScript autorisée : <code>${esc(origin)}</code></li>
      <li>Copie l'« ID client » (…apps.googleusercontent.com) ci-dessous, puis « Connecter ».</li></ol>`}</div>
    <div class="field"><label>ID client Google</label><input name="googleClientId" value="${esc(s.googleClientId)}" placeholder="1234-abc.apps.googleusercontent.com" autocomplete="off"></div>
    <div class="row wrap">${s.googleConnected ? `<button type="button" class="btn gold" data-a="sync">${icon('sync')} Synchroniser</button><button type="button" class="btn" data-a="g-off">Déconnecter</button>` : `<button type="button" class="btn gold" data-a="g-connect">${icon('google')} Connecter Google Agenda</button>`}</div>

    <div class="set-sec">Assistant IA</div>
    <div class="field"><label>Clé API Claude (facultatif)</label><input name="claudeKey" type="password" value="${esc(s.claudeKey)}" placeholder="sk-ant-…" autocomplete="off"><div class="hint">Sans clé, l'assistant comprend déjà les demandes simples hors-ligne. Avec ta clé (console.anthropic.com), il comprend tout : déplacer, annuler, organiser ta semaine… La clé reste sur ton téléphone.</div></div>
    <div class="switch"><div>Réponses à voix haute<small>L'assistant lit ses réponses</small></div><button type="button" class="tg ${s.voiceReply ? 'on' : ''}" data-a="tg" data-name="voiceReply"></button><input type="hidden" name="voiceReply" value="${s.voiceReply ? 1 : 0}"></div>

    <div class="set-sec">Affichage</div>
    <div class="field"><label>Thème</label><div class="seg">${[['dark', '🌙 Noir & or'], ['light', '☀️ Clair'], ['auto', 'Auto']].map(([k, l]) => `<button type="button" class="${s.theme === k ? 'on' : ''}" data-a="theme" data-t="${k}">${l}</button>`).join('')}</div></div>
    <div class="fields2"><div class="field"><label>Journée de</label><input type="number" name="dayStart" min="0" max="12" value="${s.dayStart}"></div><div class="field"><label>à</label><input type="number" name="dayEnd" min="13" max="24" value="${s.dayEnd}"></div></div>
    <div class="switch"><div>Masquer les doublons<small>${dups} doublon${dups > 1 ? 's' : ''} détecté${dups > 1 ? 's' : ''} (même horaire, titre presque identique)</small></div><button type="button" class="tg ${s.hideDups ? 'on' : ''}" data-a="tg" data-name="hideDups"></button><input type="hidden" name="hideDups" value="${s.hideDups ? 1 : 0}"></div>
    <div class="field" style="margin-top:12px"><label>Catégories affichées</label><div class="chips" style="flex-wrap:wrap">${Object.entries(CATS).map(([k, c]) => `<button type="button" class="chip ${hidden.has(k) ? '' : 'on'}" data-a="cat-toggle" data-cat="${k}" style="${hidden.has(k) ? '' : `background:${c.color};color:#111`}">${c.emoji} ${c.label}</button>`).join('')}</div></div>

    <div class="set-sec">Rappels</div>
    <div class="field"><label>Rappel par défaut</label><select name="reminderMin">${[[0, 'Aucun'], [10, '10 min avant'], [15, '15 min avant'], [30, '30 min avant'], [60, '1 h avant']].map(([v, l]) => `<option value="${v}" ${s.reminderMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="hint">Les notifications s'affichent quand l'appli est ouverte ou en arrière-plan récent. Avec Google connecté, ton téléphone te prévient aussi via Google Agenda.</div></div>
    <button type="button" class="btn" data-a="notif">🔔 Autoriser les notifications</button>

    <div class="set-sec">Données</div>
    <div class="row wrap"><button type="button" class="btn" data-a="import">Importer (.json / .ics)</button><button type="button" class="btn" data-a="export">Exporter</button></div>
    ${dups ? `<button type="button" class="btn block" style="margin-top:8px" data-a="dups-purge">🧹 Supprimer définitivement les ${dups} doublons</button>` : ''}
    <button type="button" class="btn danger block" style="margin-top:8px" data-a="reset">Tout effacer</button>

    <button class="btn gold block" style="margin-top:20px">Enregistrer</button>
  </form>`);
}

function saveSettings(f, silent = false) {
  const s = set();
  s.name = f.name.value.trim() || 'toi';
  s.about = f.about.value.trim();
  s.googleClientId = f.googleClientId.value.trim();
  s.claudeKey = f.claudeKey.value.trim();
  s.voiceReply = f.voiceReply.value === '1';
  s.hideDups = f.hideDups.value === '1';
  s.dayStart = Math.max(0, Math.min(12, +f.dayStart.value || 7));
  s.dayEnd = Math.max(13, Math.min(24, +f.dayEnd.value || 23));
  s.reminderMin = +f.reminderMin.value;
  save();
  if (!silent) { closeSheet(); render(); toast('Réglages enregistrés ✓'); }
}

// =====================================================================
// Toast
// =====================================================================
let toastT = null;
function toast(msg, action = null) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg).replace(/\n/g, '<br>')}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { action.fn(); t.hidden = true; };
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3500);
}

// =====================================================================
// Révisions
// =====================================================================
function planRevisions(id) {
  const ev = S().events.find(e => e.id === id);
  if (!ev) return;
  const plan = revisionPlan(ev);
  if (!plan.length) { toast('Pas de créneau libre trouvé avant cet examen.'); return; }
  const title = revisionTitle(ev);
  openSheet(`<div class="sh-title">🧠 Révisions<button type="button" class="icon-btn x" data-a="close">${icon('x')}</button></div>
    <p class="muted" style="margin-top:0">Pour <b style="color:var(--text)">${esc(ev.title)}</b> (${relDay(ev.start)}), je te propose ${plan.length} séance${plan.length > 1 ? 's' : ''} dans tes créneaux libres :</p>
    ${plan.map(p => `<div class="tl-item" style="--c:${CATS.revision.color}"><div class="tl-time">${hm(p.start)}<small>${hm(p.end)}</small></div><div class="tl-bar"></div><div class="tl-body"><div class="tl-title">${esc(title)}</div><div class="tl-sub">${cap(fmtDay(p.start))}</div></div></div>`).join('')}
    <button class="btn gold block" style="margin-top:14px" data-a="plan-ok" data-id="${id}">Ajouter ces ${plan.length} séances</button>`);
}

// =====================================================================
// Rappels / notifications
// =====================================================================
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
  for (const e of eventsBetween(now, now + 2 * DAY)) {
    if (e.allDay) continue;
    const rem = e.reminder ?? st.settings.reminderMin;
    if (e.reminder == null && !rem) continue; // pas de rappel
    const key = e.id + ':' + e.start;
    if (e.start - rem * MIN <= now && e.start > now - 5 * MIN && !notified.has(key)) {
      notified.add(key); changed = true;
      notify(e.title, `${countdown(e.start)} · ${hm(e.start)}${e.location ? ' · ' + e.location : ''}`);
    }
  }
  for (const n of st.notes) if (n.remind && n.remind <= now && !n.reminded) { n.reminded = true; save(); notify('⏰ ' + (n.title || 'À ne pas oublier'), n.text.slice(0, 120)); }
  if (changed) try { localStorage.setItem('agenda-notified', JSON.stringify([...notified].slice(-300))); } catch { /* */ }
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
      if (data.settings?.about && !set().about) { set().about = data.settings.about; }
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
// Événements DOM
// =====================================================================
const ACTIONS = {
  tab: el => go(el.dataset.tab),
  ev: el => openEvent(el.dataset.id),
  task: el => editTask(el.dataset.id),
  note: el => editNote(el.dataset.id),
  close: closeSheet,
  settings: openSettings,
  sync: () => { const f = $('#set-form'); if (f) saveSettings(f, true); closeSheet(); syncNow(); },
  'g-connect': () => { const f = $('#set-form'); saveSettings(f, true); closeSheet(); syncNow(); },
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
  theme: el => { set().theme = el.dataset.t; save(); applyTheme(); el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); },
  tg: el => { el.classList.toggle('on'); const i = el.parentNode.querySelector(`input[name=${el.dataset.name}]`); i.value = el.classList.contains('on') ? 1 : 0; toggleTimeFields(); },
  sw: el => { el.parentNode.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b === el)); el.closest('form').color.value = el.dataset.c; },
  prio: el => { el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); el.closest('form').priority.value = el.dataset.p; },
  'cat-toggle': el => {
    const s = set(); const k = el.dataset.cat;
    s.hiddenCats = s.hiddenCats.includes(k) ? s.hiddenCats.filter(x => x !== k) : [...s.hiddenCats, k];
    save();
    if ($('#set-form')) { const on = !s.hiddenCats.includes(k); el.classList.toggle('on', on); el.style.cssText = on ? `background:${CATS[k].color};color:#111` : ''; }
    render();
  },
  view: el => { set().calView = el.dataset.v; save(); renderCal(); if (el.dataset.v !== 'month' && el.dataset.v !== 'list') scrollGridToNow(); },
  'cal-prev': () => calShift(-1),
  'cal-next': () => calShift(1),
  'cal-today': () => { calDate = startOfDay(new Date()); selDay = calDate; renderCal(); scrollGridToNow(); },
  sel: el => { const d = fromYmd(el.dataset.d); if (sameDay(d, selDay)) { set().calView = 'day'; calDate = d; save(); renderCal(); scrollGridToNow(); return; } selDay = d; renderCal(); },
  day: el => { calDate = fromYmd(el.dataset.d); selDay = calDate; set().calView = 'day'; save(); go('cal'); },
  slot: (el, ev) => {
    if (ev.target !== el) return;
    const r = el.getBoundingClientRect();
    const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 58;
    const h = +el.dataset.h0 + (ev.clientY - r.top) / hourPx;
    const d = fromYmd(el.dataset.d); d.setHours(Math.floor(h), Math.round((h % 1) * 2) * 30, 0, 0);
    editEvent(null, { start: d.getTime(), end: d.getTime() + 3600000 });
  },
  'ev-edit': el => editEvent(el.dataset.id),
  'ev-dup': el => { const e = S().events.find(x => x.id === el.dataset.id); if (e) { const { id, gid, calId, source, ...rest } = e; editEvent(null, { ...rest, title: e.title }); } },
  'ev-del': el => { const e = S().events.find(x => x.id === el.dataset.id); if (e && confirm(`Supprimer « ${e.title} »${e.gid && set().googleConnected ? ' (aussi sur Google Agenda)' : ''} ?`)) { const copy = { ...e }; deleteEvent(e.id); flushDeletes(); closeSheet(); render(); toast('Supprimé', { label: 'Annuler', fn: () => { const { id, gid, ...rest } = copy; gpush(addEvent({ ...rest, source: 'local' })); render(); } }); } },
  'task-done': el => { const t = S().tasks.find(x => x.id === el.dataset.id); if (t) { updateTask(t.id, { done: !t.done, doneAt: Date.now() }); if ($('#task-form')) closeSheet(); render(); if (t.done) toast('Bien joué ✓', { label: 'Annuler', fn: () => { updateTask(t.id, { done: false }); render(); } }); } },
  'task-del': el => { deleteTask(el.dataset.id); closeSheet(); render(); },
  'note-del': el => { const n = S().notes.find(x => x.id === el.dataset.id); deleteNote(el.dataset.id); closeSheet(); render(); toast('Note supprimée', { label: 'Annuler', fn: () => { S().notes.push(n); save(); render(); } }); },
  'note-task': el => { const n = S().notes.find(x => x.id === el.dataset.id); closeSheet(); editTask(null, { title: n.title || n.text.split('\n')[0] }); },
  'due-f': el => { dueFilter = el.dataset.f; renderDue(); },
  'plan-rev': el => planRevisions(el.dataset.id),
  'plan-ok': el => {
    const ev = S().events.find(e => e.id === el.dataset.id);
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
  if (fn) { if (el.tagName === 'A') ev.preventDefault(); fn(el, ev); }
});

document.addEventListener('submit', ev => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === 'ev-form') return saveEventForm(f);
  if (f.id === 'task-form') return saveTaskForm(f);
  if (f.id === 'note-form') return saveNoteForm(f);
  if (f.id === 'set-form') return saveSettings(f);
  if (f.dataset.quick) {
    const input = f.querySelector('input');
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    if (f.dataset.quick === 'q-note') { addNote({ text: v }); render(); toast('Note ajoutée ✓'); return; }
    if (f.dataset.quick === 'q-due' && !/\b(ajoute|programme|rdv|rendez|cours|réunion)\b/i.test(v)) {
      const r = localAssistant(/rendre|avant|tâche|deadline/i.test(v) ? v : 'à faire : ' + v);
      if (r.actions[0]?.type === 'add_task') { applyActions(r.actions, -1).then(() => { render(); toast(r.reply); }); return; }
    }
    runAssistant(v, { stay: f.dataset.quick !== 'q-ai' });
  }
});

document.addEventListener('input', ev => {
  if (ev.target.id === 'note-q') {
    noteQuery = ev.target.value;
    const pos = ev.target.selectionStart;
    renderNotes();
    const i = $('#note-q'); i.focus(); i.setSelectionRange(pos, pos);
  }
});

document.addEventListener('change', ev => { if (ev.target.name === 'cat' && ev.target.form?.id === 'ev-form') { /* rien */ } });
$('#file-in').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
$('#btn-settings').onclick = openSettings;
$('#btn-sync').onclick = syncNow;
$('#sheet-bg').onclick = closeSheet;
$('#fab').onclick = () => {
  if (tab === 'due') editTask(null);
  else if (tab === 'notes') editNote(null);
  else editEvent(null, tab === 'cal' && !sameDay(selDay, new Date()) ? { start: new Date(selDay).setHours(10), end: new Date(selDay).setHours(11) } : {});
};
$('#main').addEventListener('scroll', () => $('#top').classList.toggle('scrolled', $('#main').scrollTop > 4), { passive: true });

// glisser à gauche / droite dans le calendrier
let sx = 0, sy = 0;
$('#main').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
$('#main').addEventListener('touchend', e => {
  if (tab !== 'cal' || !e.target.closest('#swipe')) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 50) calShift(dx < 0 ? 1 : -1);
}, { passive: true });

// glisser la feuille vers le bas pour la fermer
let shY = 0;
$('#sheet').addEventListener('touchstart', e => { shY = $('#sheet').scrollTop <= 0 ? e.touches[0].clientY : -1; }, { passive: true });
$('#sheet').addEventListener('touchend', e => { if (shY >= 0 && e.changedTouches[0].clientY - shY > 110) closeSheet(); }, { passive: true });

// raccourcis d'installation (manifest « shortcuts ») : ?tab=ai
const qp = new URLSearchParams(location.search);
onChange(() => {});
go(qp.get('tab') && ['today', 'cal', 'due', 'notes', 'ai'].includes(qp.get('tab')) ? qp.get('tab') : 'today');
setInterval(() => { checkReminders(); if (tab === 'today' && $('#sheet-wrap').hidden && !document.activeElement?.matches('input,textarea')) renderToday(); }, 30000);
setTimeout(checkReminders, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checkReminders(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
