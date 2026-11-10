// Tout ce qui rend l'agenda « personnel » : matières, objectifs, stats, briefing, raccourcis.
import { S, CATS, norm, eventsBetween, eventsOfDay, deadlines, duplicateIds } from './store.js';
import { DAY, MIN, startOfDay, startOfWeek, addDays, ymd, hm, relDay, fmtDuration, dayDiff, JOURS, cap } from './dates.js';

// ---------------------------------------------------------------------
// Matières (détectées depuis les titres de cours : « TD Statistiques – E. Feyeux »)
// ---------------------------------------------------------------------
const PREFIX = /^\s*(⚠️?|cm|td\d*|tp\d*|cc\d*|partiel|controle|contrôle|examen|exam|ds|rattrapage)\b\s*(de |d'|du |des )?/i;
const ALIAS = {
  infos: 'informatique', info: 'informatique', excel: 'informatique', pix: 'informatique',
  compta: 'comptabilite', stat: 'statistiques', stats: 'statistiques',
  'enjeux du developpement durable': 'enjeux developpement durable', 'les enjeux du developpement durable': 'enjeux developpement durable',
  'etude de marche': 'etudes de marche', 'etudes marche': 'etudes de marche',
  'droit des affaires': 'droit des affaires',
};
const SUBJ_COLORS = ['#5b8def', '#38c6f4', '#2fd1a5', '#c47dff', '#ff9f43', '#f472b6', '#d9b26a', '#7ee081', '#ff7a7a', '#a3a8ff'];

export function subjectOf(e) {
  if (!e || !['cours', 'exam', 'revision', 'echeance'].includes(e.cat)) return null;
  let t = e.title.replace(/[⚠️]/gu, '').trim();
  if (e.cat === 'revision') t = t.replace(/^r[ée]vis(ion|er)s?\s*(de |d'|du |des |en )?/i, '');
  else {
    let guard = 0, prev;
    if (!PREFIX.test(t) && !/\b(cc\d*|td\d*)\b/i.test(t)) return null;
    do { prev = t; t = t.replace(PREFIX, ''); } while (t !== prev && guard++ < 4);
  }
  t = t.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*[–—-]\s.*$/, '').replace(/\s*:.*$/, '').trim();
  let k = norm(t).replace(/[^a-z0-9' ]/g, ' ').replace(/^(les|le|la|l') ?/, '').replace(/\s+/g, ' ').trim();
  k = k.split(' ').filter(w => !/^(td|tp|cc|g)\d*$/.test(w)).map(w => ALIAS[w] || w).join(' ');
  k = ALIAS[k] || k;
  if (!k || k.length < 3) return null;
  return { key: k, name: cap(t.replace(/^(les|le|la)\s+/i, '').replace(/\s+(td|tp|cc|g)\d*\b/gi, '').trim()) };
}

// couleurs distinctes par matière (attribuées dans l'ordre alphabétique)
let colorMap = { sig: '', map: new Map() };
export function subjectColor(key) {
  const o = S().settings.subjectColors?.[key];
  if (o) return o;
  const sig = String(S().events.length);
  if (colorMap.sig !== sig) {
    const keys = new Set();
    for (const e of S().events) { const s = subjectOf(e); if (s) keys.add(s.key); }
    colorMap = { sig, map: new Map([...keys].sort().map((k, i) => [k, SUBJ_COLORS[i % SUBJ_COLORS.length]])) };
  }
  if (colorMap.map.has(key)) return colorMap.map.get(key);
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SUBJ_COLORS[h % SUBJ_COLORS.length];
}

export function subjects() {
  const now = Date.now();
  const ws = startOfWeek(new Date()).getTime();
  const dups = duplicateIds();
  const map = new Map();
  for (const e of S().events) {
    if (dups.has(e.id)) continue;
    const s = subjectOf(e);
    if (!s) continue;
    if (!map.has(s.key)) map.set(s.key, { key: s.key, names: {}, teachers: new Map(), rooms: new Set(), sessions: [], exams: [], revisions: [], hoursWeek: 0, hoursTotal: 0 });
    const m = map.get(s.key);
    m.names[s.name] = (m.names[s.name] || 0) + 1;
    const teacher = /[–—-]\s*(?:M\.|Mme|Mr)?\s*([A-ZÉ][\w.\- ]+?)(?:\s*\(|$)/u.exec(e.title)?.[1];
    if (teacher && e.cat === 'cours') { const k = norm(teacher).replace(/[^a-z]/g, '').slice(-6); if (!m.teachers.has(k) || /[a-z]/.test(teacher)) m.teachers.set(k, teacher.trim()); }
    if (e.location && e.cat === 'cours') m.rooms.add(e.location);
    if (e.cat === 'exam' || e.cat === 'echeance') m.exams.push(e);
    else if (e.cat === 'revision') m.revisions.push(e);
    else m.sessions.push(e);
    const h = (e.end - e.start) / 3600000;
    if (e.cat === 'cours') { m.hoursTotal += h; if (e.start >= ws && e.start < ws + 7 * DAY) m.hoursWeek += h; }
  }
  // temps de focus par matière
  for (const f of S().focus) {
    const m = map.get(f.subject);
    if (m) m.focusMin = (m.focusMin || 0) + (f.end - f.start) / MIN;
  }
  const out = [...map.values()].map(m => {
    m.name = Object.entries(m.names).sort((a, b) => b[1] - a[1])[0][0];
    m.color = subjectColor(m.key);
    m.sessions.sort((a, b) => a.start - b.start);
    m.exams.sort((a, b) => a.start - b.start);
    m.next = m.sessions.find(e => e.end > now);
    m.nextExam = m.exams.find(e => e.end > now);
    m.notes = S().notes.filter(n => n.subject === m.key);
    return m;
  }).filter(m => m.sessions.length || m.exams.length);
  return out.sort((a, b) => (a.nextExam?.start || 9e15) - (b.nextExam?.start || 9e15) || (a.next?.start || 9e15) - (b.next?.start || 9e15));
}

// ---------------------------------------------------------------------
// Objectifs & habitudes (semaine du lundi au dimanche)
// ---------------------------------------------------------------------
const matchGoal = (g, e) => (g.cat && e.cat === g.cat) || (g.kw && norm(e.title).includes(norm(g.kw)));

export function goalProgress(g, ref = new Date()) {
  const a = startOfWeek(ref).getTime(), b = a + 7 * DAY;
  const now = Date.now();
  if (g.kind === 'check') {
    const days = (S().checks[g.id] || []).filter(d => { const t = new Date(d + 'T12:00').getTime(); return t >= a && t < b; });
    return { done: days.length, planned: days.length, target: g.target, unit: 'j', todayDone: (S().checks[g.id] || []).includes(ymd(new Date())), streak: streak(g) };
  }
  const evs = eventsBetween(a, b).filter(e => !e.allDay && matchGoal(g, e));
  if (g.kind === 'count') {
    return { done: evs.filter(e => e.start <= now).length, planned: evs.length, target: g.target, unit: '' };
  }
  let doneH = evs.filter(e => e.end <= now).reduce((n, e) => n + (e.end - e.start) / 3600000, 0);
  let planH = evs.reduce((n, e) => n + (e.end - e.start) / 3600000, 0);
  if (g.cat === 'revision' || /r[ée]vis/.test(g.kw || '')) {
    const f = S().focus.filter(x => x.start >= a && x.start < b).reduce((n, x) => n + (x.end - x.start) / 3600000, 0);
    doneH += f; planH += f;
  }
  return { done: Math.round(doneH * 10) / 10, planned: Math.round(planH * 10) / 10, target: g.target, unit: 'h' };
}

function streak(g) {
  const set = new Set(S().checks[g.id] || []);
  let n = 0, d = new Date();
  if (!set.has(ymd(d))) d = addDays(d, -1);
  while (set.has(ymd(d))) { n++; d = addDays(d, -1); }
  return n;
}

export function toggleCheck(goalId, day = new Date()) {
  const st = S();
  const k = ymd(day);
  const arr = st.checks[goalId] || (st.checks[goalId] = []);
  const i = arr.indexOf(k);
  if (i >= 0) arr.splice(i, 1); else arr.push(k);
  return i < 0;
}

// ---------------------------------------------------------------------
// Charge d'une journée
// ---------------------------------------------------------------------
export function busyMinutes(evs) {
  return evs.filter(e => !e.allDay && e.cat !== 'ferie').reduce((n, e) => n + (e.end - e.start) / MIN, 0);
}
export function dayLoad(d) {
  const evs = eventsOfDay(d);
  const m = busyMinutes(evs);
  const exams = evs.filter(e => e.cat === 'exam').length;
  const score = Math.min(10, m / 60 + exams * 2);
  const level = score < 3 ? { label: 'Journée légère', c: 'var(--ok)', emoji: '🌿' } : score < 6 ? { label: 'Journée normale', c: 'var(--accent)', emoji: '⚖️' } : { label: 'Journée chargée', c: 'var(--danger)', emoji: '🔥' };
  return { minutes: m, score, ...level, evs };
}

// ---------------------------------------------------------------------
// Briefing en une phrase (affiché et lisible à voix haute)
// ---------------------------------------------------------------------
export function briefing(d = new Date()) {
  const name = S().settings.name;
  const now = Date.now();
  const isToday = dayDiff(new Date(), d) === 0;
  const evs = eventsOfDay(d).filter(e => !e.allDay);
  const allDay = eventsOfDay(d).filter(e => e.allDay);
  const parts = [];
  const cours = evs.filter(e => e.cat === 'cours');
  const exams = evs.filter(e => e.cat === 'exam');
  const rest = evs.filter(e => !['cours', 'exam'].includes(e.cat));
  const remaining = isToday ? evs.filter(e => e.end > now) : evs;
  if (!evs.length) parts.push(`${isToday ? "Aujourd'hui" : cap(relDay(d))}, rien de prévu : journée libre`);
  else {
    const bits = [];
    if (cours.length) bits.push(`${cours.length} cours (${fmtDuration(busyMinutes(cours) * MIN)})`);
    if (exams.length) bits.push(`${exams.length === 1 ? 'un contrôle' : exams.length + ' contrôles'} : ${exams.map(e => e.title.replace(/⚠️?/g, '').trim() + ' à ' + hm(e.start)).join(', ')}`);
    if (rest.length) bits.push(rest.slice(0, 3).map(e => `${e.title} à ${hm(e.start)}`).join(', '));
    parts.push(`${isToday ? "Aujourd'hui" : cap(relDay(d))} : ${bits.join(' ; ')}`);
    if (isToday && remaining.length && remaining.length < evs.length) parts.push(`Il te reste ${remaining.length} élément${remaining.length > 1 ? 's' : ''}, prochain : ${remaining[0].title} à ${hm(remaining[0].start)}`);
    else if (evs[0]) parts.push(`Tu commences à ${hm(evs[0].start)} et tu finis vers ${hm(Math.max(...evs.map(e => e.end)))}`);
  }
  if (allDay.length) parts.push(allDay.map(e => e.title).join(', '));
  const dl = deadlines({ from: now }).filter(x => !x.done && x.due < now + 3 * DAY);
  if (dl.length) parts.push(`À ne pas rater : ${dl.slice(0, 2).map(x => `${x.title.replace(/⚠️?/g, '').trim()} (${relDay(x.due)})`).join(', ')}`);
  for (const g of S().settings.goals) {
    if (g.kind !== 'count') continue;
    const p = goalProgress(g);
    const left = g.target - p.done;
    if (left > 0 && p.planned < g.target) parts.push(`Objectif ${g.label.toLowerCase()} : ${p.done}/${g.target} cette semaine, pense à en caler ${left > 1 ? left : 'une'}`);
  }
  return `${greetingWord()} ${name}, voici ton point. ` + parts.join('. ') + '.';
}

export function greetingWord() {
  const h = new Date().getHours();
  return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
}

// ---------------------------------------------------------------------
// Raccourcis : tes événements récurrents « à toi » (hors cours), appris de l'historique
// ---------------------------------------------------------------------
export function templates(limit = 6) {
  const since = Date.now() - 150 * DAY;
  const counts = new Map();
  for (const e of S().events) {
    if (e.allDay || e.start < since || ['cours', 'exam', 'ferie', 'echeance', 'sante'].includes(e.cat) || norm(e.title).length < 4) continue;
    const key = norm(e.title);
    const c = counts.get(key) || { n: 0, title: e.title, cat: e.cat, location: e.location, dur: e.end - e.start, hours: {} };
    c.n++;
    const h = hm(e.start);
    c.hours[h] = (c.hours[h] || 0) + 1;
    if (e.location) c.location = e.location;
    counts.set(key, c);
  }
  const list = [...counts.values()].filter(c => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, limit);
  return list.map(c => {
    const h = Object.entries(c.hours).sort((a, b) => b[1] - a[1])[0][0];
    const [hh, mm] = h.split('h');
    return { title: c.title, cat: c.cat, location: c.location, dur: c.dur, h: +hh, m: +(mm || 0), label: `${CATS[c.cat]?.emoji || '•'} ${c.title.split(/\s[–—-]\s/)[0].trim()} ${h}` };
  });
}

// ---------------------------------------------------------------------
// Comptes à rebours : vacances, prochain examen, événements importants, perso
// ---------------------------------------------------------------------
export function countdownList() {
  const now = Date.now();
  const out = [];
  const dups = duplicateIds();
  const vac = S().events.filter(e => e.allDay && /vacances|f[ée]ri|no[eë]l/i.test(e.title) && e.start > now && !dups.has(e.id)).sort((a, b) => a.start - b.start)[0];
  if (vac) out.push({ title: vac.title, date: vac.start, emoji: '🌴', auto: true });
  const exam = deadlines({ from: now }).find(d => d.kind === 'event' && d.cat === 'exam' && !d.done);
  if (exam) out.push({ title: exam.title.replace(/⚠️?/g, '').trim(), date: exam.due, emoji: '🎯', auto: true, id: exam.id, ev: true });
  for (const e of S().events.filter(e => e.star && e.start > now)) out.push({ title: e.title, date: e.start, emoji: '⭐', id: e.id, ev: true });
  for (const c of S().countdowns.filter(c => c.date > now - DAY)) out.push({ ...c, custom: true });
  return out.sort((a, b) => a.date - b.date);
}

// ---------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------
export function stats(period = 'week', ref = new Date()) {
  let a, b;
  if (period === 'week') { a = startOfWeek(ref); b = addDays(a, 7); }
  else { a = new Date(ref.getFullYear(), ref.getMonth(), 1); b = new Date(ref.getFullYear(), ref.getMonth() + 1, 1); }
  const evs = eventsBetween(a.getTime(), b.getTime()).filter(e => !e.allDay);
  const byCat = {};
  evs.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + (e.end - e.start) / 3600000; });
  const bySubj = {};
  evs.forEach(e => { const s = subjectOf(e); if (s && e.cat === 'cours') bySubj[s.key] = (bySubj[s.key] || 0) + (e.end - e.start) / 3600000; });
  const byDay = {};
  evs.forEach(e => { const k = ymd(e.start); byDay[k] = (byDay[k] || 0) + (e.end - e.start) / 3600000; });
  const busiest = Object.entries(byDay).sort((x, y) => y[1] - x[1])[0];
  const starts = Object.values(evs.reduce((m, e) => { const k = ymd(e.start); if (!m[k] || e.start < m[k]) m[k] = e.start; return m; }, {})).map(t => new Date(t).getHours() * 60 + new Date(t).getMinutes());
  const avgStart = starts.length ? starts.reduce((x, y) => x + y, 0) / starts.length : null;
  const focusH = S().focus.filter(f => f.start >= a && f.start < b).reduce((n, f) => n + (f.end - f.start) / 3600000, 0);
  return {
    a, b, total: evs.reduce((n, e) => n + (e.end - e.start) / 3600000, 0), count: evs.length,
    byCat, bySubj, busiest: busiest ? { day: busiest[0], h: busiest[1] } : null,
    avgStart: avgStart == null ? null : `${Math.floor(avgStart / 60)}h${String(Math.round(avgStart % 60)).padStart(2, '0')}`,
    focusH,
    sport: evs.filter(e => e.cat === 'sport').length,
    sante: evs.filter(e => e.cat === 'sante').length,
  };
}

export { JOURS };
