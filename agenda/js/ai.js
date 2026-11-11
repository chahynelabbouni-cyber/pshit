// L'assistant de l'agenda.
// - Sans clé : compréhension locale des phrases (parse.js) + réponses aux questions courantes.
// - Avec ta clé Claude (Réglages) : comprend n'importe quelle demande et agit sur l'agenda.
import { S, CATS, eventsBetween, deadlines, duplicateIds } from './store.js';
import { parseFr, stripPreamble } from './parse.js';
import { normalizeSpoken, SYNONYMS, WEAK } from './nlu.js';
import { DAY, MIN, startOfDay, startOfWeek, addDays, fmtDay, hm, relDay, localIso, cap, countdown, dayDiff, fmtDuration } from './dates.js';
import { eventsOfDay } from './store.js';
import { briefing, stats, subjects, goalProgress } from './insights.js';
import { norm, CATS as C2 } from './store.js';

// ---------------------------------------------------------------------
// Créneaux libres (utilisé pour « planifie mes révisions »)
// ---------------------------------------------------------------------
export function freeSlots(dayDate, { minMin = 60, from = 8, to = 21 } = {}) {
  const d0 = startOfDay(dayDate).getTime();
  const a = d0 + from * 3600000, b = d0 + to * 3600000;
  const busy = eventsBetween(d0, d0 + DAY).filter(e => !e.allDay).map(e => [Math.max(a, e.start - 15 * MIN), Math.min(b, e.end + 15 * MIN)]).sort((x, y) => x[0] - y[0]);
  const out = [];
  let cur = Math.max(a, Date.now() + 30 * MIN);
  for (const [s, e] of busy) {
    if (s - cur >= minMin * MIN) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (b - cur >= minMin * MIN) out.push([cur, b]);
  return out;
}

// Propose des séances de révision avant un examen.
export function revisionPlan(exam, { sessions = 3, length = 90 } = {}) {
  const plan = [];
  const examDay = startOfDay(exam.start);
  for (let back = 1; back <= 10 && plan.length < sessions; back++) {
    const d = addDays(examDay, -back);
    if (d < startOfDay(new Date())) break;
    const dist = sl => { const p = new Date(d).setHours(17, 0, 0, 0); return p < sl[0] ? sl[0] - p : p > sl[1] ? p - sl[1] : 0; };
    const slot = freeSlots(d, { minMin: length }).sort((x, y) => dist(x) - dist(y))[0];
    if (!slot) continue;
    // cale la séance au plus près de 17h dans le créneau libre
    const pref = new Date(d).setHours(17, 0, 0, 0);
    let s = Math.min(Math.max(slot[0], pref), slot[1] - length * MIN);
    const sd = new Date(s);
    if (sd.getMinutes() % 15) s += (15 - sd.getMinutes() % 15) * MIN;
    if (s + length * MIN > slot[1]) s -= 15 * MIN;
    plan.push({ start: s, end: s + length * MIN });
  }
  return plan.reverse();
}

const subject = title => title.replace(/⚠️?/g, '').replace(/^(cc|partiel|contr[ôo]le|exam(en)?)\s*(de |d'|du )?/i, '').replace(/\s*[–-]\s*.*$/, '').trim() || title;
export const revisionTitle = exam => `Révision ${subject(exam.title.replace(/^.*?(cc|partiel|contr[ôo]le)\s*/i, ''))}`.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------
// Réponses locales
// ---------------------------------------------------------------------
// Titre court et lisible : sans ⚠️, sans (G2), sans le nom du prof
export function cleanT(e) {
  let t = e.title.replace(/⚠️?\s*/g, '').replace(/\s*\((?:G\d|TD\d[^)]*|CC\d?|Visio|en visio|facultatif|obligatoire)\)/gi, '').trim();
  if (['cours', 'exam'].includes(e.cat)) t = t.replace(/\s[–—-]\s(?:M\.|Mme|Mr|Dr)?\s?[A-ZÉ][\w.\-' ]*$/u, '').trim();
  return t;
}
// =====================================================================
// CERVEAU LOCAL (sans internet) — comprend l'oral et agit sur l'agenda
// =====================================================================
const rd = d => (new Date().getHours() < 4 && dayDiff(new Date(), d) === 0) ? 'ce ' + fmtDay(d).split(' ')[0] : relDay(d);
const capT = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// ---------- Retrouver un événement dont on parle ----------
const STOPW = new Set(('deplace decale bouge avance recule repousse reporte retarde mets met mettre supprime annule annuler efface retire enleve enlever vire degage change renomme modifie finalement plutot irai vais pas aller maintenant lieu passe commence termine fait faire elle il est sera cest plus tard tot meme heure heures min minutes demi quart une un jour jours semaine prochain prochaine matin soir apres midi aujourd hui demain lundi mardi mercredi jeudi vendredi samedi dimanche que qui pour avec dans sur par au aux en et ou de du des le la les mon ma mes ce cet cette ses tu peux me moi je ai prof malade nouveau nouvelle mais alors bon ok stp quand quelle quel tombe quoi prevu programme emploi temps dire dis montre attend attendre est-ce combien veux voudrais rappel rappelle previens preveniravant veille alerte alarme notif notification avant vient lui leur on nous vous faut il as encore deja bien tout toute toutes tous libre dispo trou creneau premier premiere derniere dernier finis termine salle amphi elle-meme vers quelque chose trucs truc')
  .split(' '));
function keywords(text) {
  return norm(normalizeSpoken(text)).replace(/[^a-z0-9' -]/g, ' ').split(/[\s'-]+/)
    .filter(w => w.length > 1 && !/^\d/.test(w) && !STOPW.has(w));
}
const PARTS = { matin: [0, 12], aprem: [12, 18], soir: [18, 24] };
const partOf = tn => /\bmatin\b/.test(tn) ? 'matin' : /(aprem|apres-midi|apres midi)/.test(tn) ? 'aprem' : /\bsoir\b/.test(tn) ? 'soir' : null;
function findEvent(text, { day = null, part = null, futureOnly = false } = {}) {
  const words = keywords(text);
  if (!words.length) return null;
  const now = Date.now();
  const from = day ? startOfDay(day).getTime() : now - (futureOnly ? 0 : 3 * 3600000);
  const to = day ? from + DAY : now + 120 * DAY;
  let pool = eventsBetween(from, to).sort((a, b) => a.start - b.start);
  if (part) pool = pool.filter(e => { const h = new Date(e.start).getHours(); return e.allDay || (h >= PARTS[part][0] && h < PARTS[part][1]); });
  let best = null, bs = 0;
  for (const e of pool) {
    const t = norm(e.title + ' ' + e.location);
    let sc = 0;
    for (const w of words) {
      const direct = new RegExp(`\\b${w}`).test(t) || (w.length >= 5 && t.includes(w.slice(0, 5)));
      const syn = !direct && (SYNONYMS[w] || []).some(a => new RegExp(`\\b${a}`).test(t));
      if (direct || syn) sc += (WEAK.has(w) ? 0.3 : 1) * (direct ? 1 : 0.7);
    }
    if (e.allDay) sc -= 0.2;
    if (sc > bs) { best = e; bs = sc; }
  }
  if (bs < 0.7 && day && !futureOnly) return findEvent(text, { part, futureOnly: true });
  return bs >= 0.7 ? best : null;
}

// ---------- Réponses aux questions ----------
function listLine(e) {
  return e.allDay ? `• ${cleanT(e)} (toute la journée)` : `• ${hm(e.start)} : ${cleanT(e)}${e.location ? ' (' + e.location + ')' : ''}`;
}
function inPart(evs, part) {
  if (!part) return evs;
  return evs.filter(e => !e.allDay && new Date(e.start).getHours() >= PARTS[part][0] && new Date(e.start).getHours() < PARTS[part][1]);
}
function answerQuery(text, p) {
  const tn = norm(normalizeSpoken(text));
  const now = new Date();
  const part = partOf(tn);
  let day = p.explicitDay ? p.day : (/(ce soir|ce matin|cet apres|cet aprem|aujourd)/.test(tn) ? now : null);
  const label = d => rd(d);

  // examens / contrôles
  if (/(examen|\bexam|partiel|controle|\bcc\b)/.test(tn) && !/(quand|tombe|pour quand|a quelle|ou est|ou ca)/.test(tn)) {
    let a = Date.now(), b = a + 60 * DAY, lbl = 'à venir';
    if (p.weekRange) { a = startOfWeek(now).getTime() + (p.weekRange === 'next' ? 7 * DAY : 0); b = a + 7 * DAY; lbl = p.weekRange === 'next' ? 'la semaine prochaine' : 'cette semaine'; }
    const list = eventsBetween(a, b).filter(e => e.cat === 'exam');
    if (!list.length) return `Aucun contrôle ${lbl} 🙌`;
    return `Tes contrôles ${lbl} :\n` + list.slice(0, 8).map(e => `• ${cap(rd(e.start))}${e.allDay ? '' : ' ' + hm(e.start)} : ${cleanT(e)}`).join('\n');
  }
  // choses à rendre, devoirs, tâches
  if (/(rendre|devoirs?|taches?|a faire|deadline|echeance|dossier)/.test(tn) && !/(quand|pour quand)/.test(tn)) {
    let list = deadlines({ from: Date.now() }).filter(d => !d.done && d.cat !== 'exam');
    if (day) list = list.filter(d => d.due >= startOfDay(day).getTime() - 3 * DAY && d.due < startOfDay(day).getTime() + DAY);
    const nodate = day ? [] : S().tasks.filter(t => !t.done && !t.due);
    if (!list.length && !nodate.length) return day ? `Rien à rendre pour ${label(day)} 🙌` : 'Rien à rendre pour l\'instant 🙌';
    return 'À faire :\n' + [...list.slice(0, 8).map(d => `• ${cleanT(d.ref.title ? d.ref : d)} — ${rd(d.due)}`), ...nodate.slice(0, 5).map(t => `• ${t.title}`)].join('\n');
  }
  // où ?
  if (/(\bou\b|quelle salle|quel endroit|c'est ou|il est ou|elle est ou)/.test(tn) && !/\bou pas\b/.test(tn)) {
    const e = findEvent(text, { day, futureOnly: !day });
    if (!e) return 'Je ne trouve pas cet événement.';
    return e.location ? `${cleanT(e)} (${rd(e.start)} à ${hm(e.start)}) : c'est ${/^(en |au |à )/i.test(e.location) ? '' : /^(amphi|salle|labo|s\.|[0-9])/i.test(e.location) ? 'en ' : 'à '}${e.location}.` : `${cleanT(e)} : ${rd(e.start)} à ${hm(e.start)}, mais aucun lieu n'est indiqué.`;
  }
  // je commence / je finis
  const firstQ = /(je commence|premier cours|commence a quelle|je debute|mon premier|premiere chose)/.test(tn);
  const lastQ = /(je finis|je termine|finis tard|termine a quelle|fini a quelle|ma derniere|mon dernier)/.test(tn);
  if (firstQ || lastQ) {
    let d = day || now;
    let evs = inPart(eventsOfDay(d).filter(e => !e.allDay), part);
    if (!day && !evs.some(e => e.end > Date.now())) { d = addDays(now, 1); evs = eventsOfDay(d).filter(e => !e.allDay); }
    if (!evs.length) return `Rien de prévu ${label(d)}, tu es libre 🌿`;
    if (firstQ) { const e = evs[0]; return `${cap(label(d))}, tu commences à ${hm(e.start)} avec ${cleanT(e)}${e.location ? ' (' + e.location + ')' : ''}.`; }
    const e = evs.reduce((a, b) => (b.end > a.end ? b : a));
    return `${cap(label(d))}, tu finis à ${hm(e.end)} après ${cleanT(e)}.`;
  }
  // libre ? trous ?
  if (/(libre|dispo|trous?|creneau|du temps|de la place)/.test(tn)) {
    const d = day || now;
    const [from, to] = part ? [Math.max(8, PARTS[part][0]), Math.min(23, PARTS[part][1])] : [8, 22];
    const slots = freeSlots(d, { minMin: 45, from, to });
    const evs = inPart(eventsOfDay(d).filter(e => !e.allDay), part);
    if (!evs.length) return `Oui, tu es complètement libre ${label(d)}${part ? (part === 'matin' ? ' matin' : part === 'aprem' ? ' après-midi' : ' soir') : ''} 🌿`;
    if (!slots.length) return `Non, ${label(d)} est plein${part ? ' sur ce moment-là' : ''}.`;
    return `${cap(label(d))}, tu es libre :\n` + slots.map(([a, b]) => `• de ${hm(a)} à ${hm(b)} (${fmtDuration(b - a)})`).join('\n');
  }
  // combien
  if (/combien/.test(tn)) {
    const st = stats(/mois/.test(tn) ? 'month' : 'week');
    const lbl = /mois/.test(tn) ? 'ce mois-ci' : 'cette semaine';
    if (/(boxe|sport|seance)/.test(tn)) return `${cap(lbl)} : ${st.sport} séance${st.sport > 1 ? 's' : ''} de sport.`;
    const catKey = Object.keys(C2).find(k => tn.includes(norm(C2[k].label).slice(0, 5)) || tn.includes(k));
    if (catKey && st.byCat[catKey] != null) return `${cap(lbl)} : ${Math.round(st.byCat[catKey] * 10) / 10} h de ${C2[catKey].label.toLowerCase()}.`;
    return `${cap(lbl)}, ${Math.round(st.total)} h programmées :\n` + Object.entries(st.byCat).filter(([k]) => k !== 'ferie').sort((a, b) => b[1] - a[1]).map(([k, h]) => `• ${C2[k]?.label || k} : ${Math.round(h * 10) / 10} h`).join('\n');
  }
  // une chose précise : « quand est ma prochaine boxe », « à quelle heure j'ai stats », « j'ai boxe ce soir ? »
  const kws = keywords(text).filter(w => !['ai', 'j', 'cours', 'programme', 'planning', 'agenda', 'semaine', 'resume'].includes(w));
  const generic = /(qu'?est[- ]ce|j'ai quoi|je fais quoi|mon programme|emploi du temps|qui m'attend|de prevu|j'ai des trucs|quelque chose|c'est quoi mon|dis[- ]moi ce que)/.test(tn);
  if (kws.length && !generic) {
    let range = null;
    if (p.weekRange) { const a = startOfWeek(now).getTime() + (p.weekRange === 'next' ? 7 * DAY : 0); range = [a, a + 7 * DAY]; }
    const e = range ? (eventsBetween(range[0], range[1]).find(x => findEvent(text, { day: new Date(x.start) }) === x) || null) : findEvent(text, { day, part, futureOnly: !day });
    if (e) {
      const yes = /^(j'ai|est-ce que j'ai|ai-je|il y a)/.test(tn) || /ou pas/.test(tn);
      return `${yes ? 'Oui : ' : ''}${cleanT(e)}, ${rd(e.start)}${e.allDay ? '' : ' à ' + hm(e.start)}${e.location ? ' — ' + e.location : ''}.`;
    }
    return day || range ? `Non, rien de ce genre ${day ? label(day) : 'cette semaine-là'}.` : `Je ne trouve rien de prévu pour « ${kws.join(' ')} ».`;
  }
  // c'est quoi après ?
  if (/(apres|ensuite|prochain)/.test(tn) && !day) {
    const next = eventsBetween(Date.now(), Date.now() + 30 * DAY).find(e => !e.allDay && e.start > Date.now());
    return next ? `Ensuite : ${cleanT(next)}, ${rd(next.start)} à ${hm(next.start)}${next.location ? ' — ' + next.location : ''}.` : 'Rien de prévu pour le moment.';
  }
  // liste d'un jour, d'une partie de journée, ou d'une semaine
  if (p.weekRange) {
    const a = addDays(startOfWeek(now), p.weekRange === 'next' ? 7 : 0);
    const evs = eventsBetween(a.getTime(), addDays(a, 7).getTime()).filter(e => e.end > Date.now() || p.weekRange === 'next');
    if (!evs.length) return 'Rien de prévu cette semaine-là 🙌';
    const byDay = new Map();
    evs.forEach(e => { const k = startOfDay(e.start).getTime(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); });
    return [...byDay].map(([k, l]) => `${cap(fmtDay(k))} : ${l.map(e => (e.allDay ? '' : hm(e.start) + ' ') + cleanT(e)).join(', ')}`).join('\n');
  }
  const d = day || now;
  const evs = inPart(eventsOfDay(d), part);
  const lbl = cap(label(d)) + (part ? (part === 'matin' ? ' matin' : part === 'aprem' ? ' après-midi' : ' soir') : '');
  if (!evs.length) return `${lbl}, rien de prévu 🙌`;
  const timed = evs.filter(e => !e.allDay);
  return `${lbl}, tu as ${evs.length} chose${evs.length > 1 ? 's' : ''} de prévue${evs.length > 1 ? 's' : ''}${timed.length ? `, de ${hm(timed[0].start)} à ${hm(Math.max(...timed.map(e => e.end)))}` : ''} :\n` + evs.map(listLine).join('\n');
}

// ---------- Conversation : l'assistant pose une question quand il manque une info ----------
let pending = null;
const ask = (kind, ev, reply) => { pending = { kind, ev, at: Date.now() }; return { reply, actions: [], expectsAnswer: true, ask: kind }; };
export const resetPending = () => { pending = null; };
function finishEvent(ev) {
  pending = null;
  const title = ev.title || 'Événement';
  return {
    reply: `C'est programmé : ${title}, ${rd(ev.start)}${ev.allDay ? ', toute la journée' : ` de ${hm(ev.start)} à ${hm(ev.end)}`}.`,
    actions: [{ type: 'create_event', title, start: ev.start, end: ev.end, allDay: ev.allDay }],
  };
}
const VAGUE = /^(rendez[- ]vous|rdv|événement|évènement|evenement|truc|chose|activité|un truc|quelque chose|un rendez-vous|un rdv|un événement)$/i;
function nextQuestion(ev) {
  if (ev.title && VAGUE.test(ev.title.trim())) ev.title = '';
  if (!ev.start) return ask('date', ev, ev.title ? `« ${ev.title} »${ev.timeOnly ? ' à ' + ev.timeOnly[0] + 'h' + (ev.timeOnly[1] ? String(ev.timeOnly[1]).padStart(2, '0') : '') : ''}, c'est pour quel jour ?` : 'Pour quel jour ? (ex : « vendredi à 10h »)');
  if (ev.allDay && !ev.allDayConfirmed) return ask('time', ev, `${ev.title ? `« ${ev.title} » ` : ''}${rd(ev.start)}, à quelle heure ? (ou dis « toute la journée »)`);
  if (!ev.title) return ask('title', ev, `${cap(rd(ev.start))}${ev.allDay ? '' : ' à ' + hm(ev.start)}, c'est noté. Comment je l'appelle ?`);
  return finishEvent(ev);
}
function continuePending(text, p) {
  const tn = norm(text).trim();
  if (/^(non|annule|laisse tomber|rien|oublie|stop|pas grave)\b/.test(tn)) { pending = null; return { reply: "D'accord, j'annule.", actions: [] }; }
  const ev = { ...pending.ev };
  if (pending.kind === 'title') {
    const t = text.replace(/^(ça s'appelle|ca s'appelle|appelle[- ]le|appelle[- ]la|mets|c'est|le titre c'est|le nom c'est)\s*/i, '').replace(/[.!]+$/, '').trim();
    if (!t) return null;
    ev.title = capT(t);
    return nextQuestion(ev);
  }
  if (pending.kind === 'time') {
    if (/journee|toute la journee|pas d'heure|sans heure/.test(tn)) { ev.allDayConfirmed = true; return nextQuestion(ev); }
    if (!p.hasTime) return null;
    const base = new Date(ev.start), t1 = new Date(p.start);
    base.setHours(t1.getHours(), t1.getMinutes(), 0, 0);
    ev.start = base.getTime(); ev.end = ev.start + (p.end - p.start); ev.allDay = false;
    return nextQuestion(ev);
  }
  if (pending.kind === 'date') {
    let start = p.explicitDay ? p.start : null;
    if (!start && /^(oui|ouais|ok|d'accord|aujourd)/.test(tn)) start = startOfDay(new Date()).getTime();
    if (!start) return null;
    if (ev.timeOnly && !p.hasTime) {
      const d = new Date(start); d.setHours(ev.timeOnly[0], ev.timeOnly[1], 0, 0);
      Object.assign(ev, { start: d.getTime(), end: d.getTime() + (ev.dur || 3600000), allDay: false });
    } else Object.assign(ev, { start: p.explicitDay ? p.start : start, end: p.explicitDay ? p.end : start + DAY, allDay: p.explicitDay ? p.allDay : true });
    if (p.allDayExplicit) ev.allDayConfirmed = true;
    return nextQuestion(ev);
  }
  if (pending.kind === 'remind') {
    if (!p.hasTime && !p.explicitDay) return null;
    const at = p.hasTime ? p.start : new Date(p.start).setHours(9, 0, 0, 0);
    pending = null;
    return { reply: `C'est noté, je te le rappelle ${rd(at)} à ${hm(at)} : « ${ev.title} ».`, actions: [{ type: 'add_reminder', title: ev.title, start: at }] };
  }
  return null;
}

// ---------- Nettoyage des titres ----------
function cleanTitle(t, kind = 'event') {
  t = (t || '')
    .replace(/^(en fait |finalement |alors )/i, '')
    .replace(/^(j'ai (un |une |le |la |l'|des )?|il y a (un |une |le |la |l')?|on a (un |une )?|y a (un |une )?)/i, '')
    .replace(/\b(m[eê]me heure|maintenant|s'il te pla[iî]t|merci)\b/gi, '')
    .replace(/\s+(d'ici|avant|pour|de|du|à|a|le|la)$/i, '')
    .replace(/\s{2,}/g, ' ').replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '').trim();
  if (kind === 'reminder') t = t.replace(/^(rappelle[- ]moi|tu me rappelles?|tu peux me rappeler|me rappeler|fais[- ]moi penser|fais moi penser|pense à me dire|previens[- ]moi|préviens[- ]moi|me prévenir|me prevenir|mets(-moi)? un rappel|un rappel|rappel|une alarme|alarme|réveille[- ]moi|reveille[- ]moi)\s*(pour |de |d'|à |a |que |qu')?/i, '').replace(/^(pour |de |d')/i, '');
  if (kind === 'task') t = t.replace(/^(je dois |je devrai |il faut que je |faut que je |faut que j'|il faut que j'|faut pas que j'oublie (de |d')?|il faut pas que j'oublie (de |d')?|n'oublie pas (de |d')?|deadline (du |de la |pour le |pour la )?|date limite (du |de la |pour )?|(ajoute |mets )?(à |a |dans )?(ma |mes )?(liste de choses à faire|liste de choses a faire|liste|tâches|taches|to-?do)\s*:?\s*)/i, '').replace(/\s+(d'ici|avant la fin du mois|avant|pour)\s*$/i, '');
  if (kind === 'note') t = t.replace(/^(note[sz]?|prends note|retiens|écris dans mes notes|ecris dans mes notes|garde en tête|souviens[- ]toi)\s*(que |qu'|de |d'|:)?\s*/i, '');
  t = t.replace(/^(taf|boulot|le taf|le boulot)$/i, 'Travail');
  return capT(t.trim());
}

// ---------- Point d'entrée ----------
export function localAssistant(text) {
  const n = normalizeSpoken(text);
  const p = parseFr(text);
  if (pending && Date.now() - pending.at < 3 * 60000) {
    const r = continuePending(n, p);
    if (r) return r;
  }
  pending = null;
  const tn = norm(n);
  const core = norm(stripPreamble(n));
  const addVerb = /\b(ajoute[rsz]?|rajoute[rsz]?|mets|mettre|met|mette|mettes|cale[rsz]?|(?<!(?:mon|ton|le|du|au) )programme[rsz]?|prevois|prevoir|planifie[rsz]?|cree[rsz]?|inscris|bloque[rsz]?|reserve[rsz]?)\b/.test(tn) || /\bnote[sz]? (le|un|mon) (rendez|rdv)/.test(tn);
  const qStart = /^(et |qu'?est[- ]ce|est[- ]ce que (je|j'ai|il)|quand|quel|quelle|combien|ou |a quelle|dis[- ]moi|dis moi|tu peux me dire|c'est quoi|c'est quand|j'ai quoi|je fais quoi|qu'ai[- ]je|ai[- ]je|mon programme|mes (examens|controles|devoirs|cours|rdv|taches)|montre|affiche|liste|resume|recap)/;
  const isQ = /\?\s*$/.test(text) || qStart.test(tn) || qStart.test(core)
    || /(c'est (pour )?quand|a quelle heure|il tombe quand|il est ou|elle est ou|\bou pas\b|qui m'attend|je suis (libre|dispo)|j'ai des (trous|creneaux|controles|devoirs|exam|cours)|j'ai un creneau|je commence|je finis|je termine|finis tard|mon premier|emploi du temps|quelle salle|dans quelle|j'ai quoi|de prevu)/.test(tn);

  // 1. résumé / briefing
  if (/(resume|recap|briefing|comment se presente)/.test(tn) && !addVerb) return { reply: briefing(p.explicitDay ? p.day : new Date()), actions: [] };

  // 2. alerte avant un événement : « préviens-moi 30 min avant la boxe », « la veille du partiel »
  if (/(rappel|previen|prevenir|alerte|alarme|rappelle|notif)/.test(tn) && /(avant|la veille|le jour meme)/.test(tn)) {
    let min = null, cut = '';
    let m;
    if ((m = /\bla veille\b/.exec(n))) { min = 1440; cut = m[0]; }
    else if ((m = /(\d+) jours? avant/.exec(n))) { min = +m[1] * 1440; cut = m[0]; }
    else if ((m = /(\d+)h(\d{2})? avant/.exec(n))) { min = +m[1] * 60 + +(m[2] || 0); cut = m[0]; }
    else if ((m = /(\d+) ?(?:min|minutes?) avant/.exec(n))) { min = +m[1]; cut = m[0]; }
    else if ((m = /\b(une|1) heure avant/.exec(n))) { min = 60; cut = m[0]; }
    if (min != null) {
      const e = findEvent(n.replace(cut, ' '), { day: p.explicitDay && !p.relTime ? p.day : null, futureOnly: true });
      if (!e) return { reply: 'Pour quel événement ? Ex : « préviens-moi 30 min avant la boxe ».', actions: [] };
      return { reply: `D'accord, je te préviens ${min >= 1440 ? (min === 1440 ? 'la veille' : `${min / 1440} jours avant`) : fmtDuration(min * MIN) + ' avant'} : « ${cleanT(e)} » (${rd(e.start)} à ${hm(e.start)}).`, actions: [{ type: 'set_event_reminder', id: e.id, minutes: min }] };
    }
  }

  // 3. rappel à un moment : « rappelle-moi d'appeler maman demain à 18h »
  if (/(rappelle|\brappel\b|rappeler|fais[- ]moi penser|fais moi penser|previens[- ]moi|previens moi|me prevenir|alarme|reveille|tu me rappelles|n'oublie pas de me)/.test(tn) && !isQ) {
    const title = cleanTitle(p.title, 'reminder') || 'Rappel';
    if (!p.hasTime && !p.explicitDay) return ask('remind', { title }, `Quand veux-tu que je te rappelle « ${title} » ?`);
    const at = p.hasTime ? p.start : new Date(p.start).setHours(9, 0, 0, 0);
    return { reply: `C'est noté, je te le rappelle ${rd(at)} à ${hm(at)} : « ${title} ».`, actions: [{ type: 'add_reminder', title, start: at }] };
  }

  // 4. supprimer / annuler
  if (/\b(supprime|supprimer|annule|annuler|efface|retire|enleve|enlever|vire|degage)\b|j'irai pas|je (ne )?vais pas (a|au|a la)|je n'irai pas|pas aller (a|au)/.test(tn) && !isQ) {
    const e = findEvent(n, { day: p.explicitDay ? p.day : null, part: partOf(tn) });
    if (!e) return { reply: 'Je ne vois pas de quel événement tu parles. Ex : « annule la boxe de vendredi ».', actions: [] };
    return { reply: `C'est supprimé : « ${cleanT(e)} » (${rd(e.start)}${e.allDay ? '' : ' à ' + hm(e.start)}).`, actions: [{ type: 'delete_event', id: e.id }] };
  }

  // 5. modifier : renommer, changer de lieu, déplacer, décaler
  const modVerb = /\b(deplace|decale|bouge|avance|recule|repousse|reporte|retarde|change|renomme|modifie)\b|c'est finalement|\bfinalement\b|au lieu de|\b(il|elle) passe a\b|commence a|est deplace|a lieu|se fait|se passe|se deroule|\bplutot\b/.test(tn)
    || /\b(mets|met|mettre)\b.*\b(de|du) (ce soir|ce matin|demain|aujourd'hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b.*\s(a|à) /.test(tn);
  if (modVerb && !isQ) {
    const ren = /(?:renomme|change le nom (?:de la |de l'|du |de |des )?)(.+?) en (.+)$/i.exec(n);
    if (ren) {
      const e = findEvent(ren[1]);
      if (e) { const title = capT(ren[2].trim()); return { reply: `« ${cleanT(e)} » s'appelle maintenant « ${title} ».`, actions: [{ type: 'update_event', id: e.id, title }] }; }
    }
    // partie « quel événement » / partie « nouveau moment »
    const mk = /\s(?:(?:c'est )?(?:finalement )?(?:a|à)\s(?=\d|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|apr|aujourd|la semaine)|pour\s(?=\d)|plut[oô]t\s|(?:il |elle )?(?:passe|commence|est d[ée]plac[ée]e?)\s(?:a|à)\s|c'est (?:finalement )?(?:a|à)\s|au lieu de\s)/i.exec(n);
    const srcText = mk ? n.slice(0, mk.index) : n;
    const tgtText = mk ? n.slice(mk.index + mk[0].length) : '';
    const sp = parseFr(srcText);
    const e = findEvent(srcText, { day: sp.explicitDay && !sp.relTime ? sp.day : null, part: partOf(norm(srcText)) });
    if (e) {
      // lieu
      const loc = /\b((?:en |au |à |a )?(?:salle|amphi|gymnase|cabinet|labo|bureau|bâtiment|batiment)\b[^,]*?)(?=\s+(?:au lieu|maintenant|change|desormais)|\s*$)/i.exec(n);
      if (loc && /(lieu|salle|amphi|gymnase|cabinet|se fait|se passe|a lieu|en salle|labo)/.test(tn) && !/\d{1,2}h/.test(tgtText)) {
        const location = loc[1].replace(/^(en |au |à |a )/i, '').trim();
        return { reply: `C'est noté : « ${cleanT(e)} » a lieu ${/^(salle|amphi|labo|bureau)/i.test(location) ? 'en' : 'à'} ${location}.`, actions: [{ type: 'update_event', id: e.id, location }] };
      }
      const dur = e.end - e.start;
      let start = null;
      const tp = tgtText ? parseFr(tgtText) : null;
      const keep = /m[eê]me heure/.test(n);
      if (tp && (tp.hasTime || tp.explicitDay)) {
        const base = new Date(tp.explicitDay ? tp.start : e.start);
        if (tp.hasTime && !keep) { const t1 = new Date(tp.start); base.setHours(t1.getHours(), t1.getMinutes(), 0, 0); }
        else { const o = new Date(e.start); base.setHours(o.getHours(), o.getMinutes(), 0, 0); }
        start = base.getTime();
      } else {
        // décalage : « d'une heure », « de 30 minutes », « d'un quart d'heure »
        const sh = /(?:d'|de |d’)?\s?(\d+)h(\d{2})?\b/.exec(n) || /(?:d'|de )?\s?(\d+) ?(?:min|minutes?)\b/.exec(n);
        const shiftMin = sh ? (sh[0].includes('h') ? +sh[1] * 60 + +(sh[2] || 0) : +sh[1]) : /d'une heure|d'1h/.test(tn) ? 60 : null;
        if (shiftMin != null && /(avance|recule|repousse|decale|retarde|plus tot|plus tard)/.test(tn)) start = e.start + shiftMin * MIN * (/(avance|plus tot)/.test(tn) ? -1 : 1);
      }
      if (start != null) return { reply: `« ${cleanT(e)} » est déplacé à ${rd(start)} ${hm(start)}.`, actions: [{ type: 'update_event', id: e.id, start, end: start + dur }] };
      if (/\b(deplace|decale|bouge|change)\b/.test(tn)) return { reply: `À quel moment veux-tu mettre « ${cleanT(e)} » ?`, actions: [] };
    }
  }

  // 6. planifier des révisions avant un examen
  if (/(planifi|organise|prevoi|cale).*(revision|reviser)/.test(tn) && !p.hasTime && !p.explicitDay) {
    const exams = deadlines({ from: Date.now() }).filter(d => d.kind === 'event' && d.cat === 'exam' && !d.done);
    const ex = (findEvent(n, { futureOnly: true })?.cat === 'exam' && exams.find(d => d.ref === findEvent(n, { futureOnly: true }))) || exams[0];
    if (!ex) return { reply: 'Je ne vois pas d\'examen à venir dans ton agenda.', actions: [] };
    const plan = revisionPlan(ex.ref);
    if (!plan.length) return { reply: `Je n'ai pas trouvé de créneau libre avant « ${cleanT(ex.ref)} ».`, actions: [] };
    return { reply: `Je te bloque ${plan.length} séance${plan.length > 1 ? 's' : ''} de révision avant « ${cleanT(ex.ref)} » (${rd(ex.due)}).`, actions: plan.map(s => ({ type: 'create_event', title: revisionTitle(ex.ref), start: s.start, end: s.end, category: 'revision' })) };
  }

  // 7a. tâche explicite (« ajoute une tâche… », « mets dans ma to-do… », « à faire : … »)
  if (/(une tache|ma to-?do|mes taches|a mes taches|liste de choses|ma liste|^a faire|^(un )?rendu |\brendu du\b)/.test(tn)) {
    const due = p.explicitDay ? p.start : null;
    const title = cleanTitle(p.title.replace(/^(une )?t[âa]che\s*:?\s*/i, '').replace(/^(à|a) faire\s*:?\s*/i, '').replace(/^(dans |à |a )?(ma |mes )?(to-?do|t[âa]ches|liste)\s*/i, ''), 'task') || 'Tâche';
    return { reply: `Ajouté à tes choses à faire : « ${title} »${due ? ', pour ' + rd(due) + (p.hasTime ? ' à ' + hm(due) : '') : ''}.`, actions: [{ type: 'add_task', title, due, dueTime: p.hasTime }] };
  }

  // 7b. notes (« note que… », « garde en note… », « ajoute une note… »)
  if (/^(note[sz]?|prends note|retiens|ecris dans mes notes|garde en (tete|note)|souviens[- ]toi|ajoute une note|mets une note|nouvelle note)\b/.test(tn) && !/(rendez|rdv|cours|seance)/.test(tn.slice(0, 30))) {
    const txt = capT(n.replace(/^(prends note|note[sz]?|retiens|écris dans mes notes|ecris dans mes notes|garde en (tête|tete|note)|souviens[- ]toi|ajoute une note|mets une note|nouvelle note)\s*(que |qu'|:|de |d')?\s*/i, '').trim());
    if (!txt) return { reply: 'Dis-moi ce que tu veux noter 🙂', actions: [] };
    return { reply: `C'est noté : « ${txt} ».`, actions: [{ type: 'add_note', text: txt }] };
  }

  // 7c. questions
  const realTime = p.hasTime && !p.partTime;
  const jaiStatement = /^(j'ai|il y a|y a) /.test(core) && !realTime && !addVerb && !p.allDayExplicit && !/^(j'ai|il y a|y a) (un|une) (?!creneau|truc)/.test(core);
  if ((isQ && !addVerb) || jaiStatement) return { reply: answerQuery(n, p), actions: [] };

  // 8. tâches / choses à rendre
  if (/(je dois|il faut que|faut que|faut pas que j'oublie|deadline|date limite|a rendre|\brendre\b|d'ici|avant le|avant la fin|avant (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain))/.test(tn) && !addVerb) {
    let due = p.explicitDay ? p.start : null;
    if (/avant la fin du mois/.test(tn)) { const d = new Date(); due = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime(); }
    const title = cleanTitle(p.title, 'task') || 'Tâche';
    return { reply: `Ajouté à tes choses à faire : « ${title} »${due ? ', pour ' + rd(due) + (p.hasTime ? ' à ' + hm(due) : '') : ''}.`, actions: [{ type: 'add_task', title, due, dueTime: p.hasTime }] };
  }

  // 9. notes
  if (/^(note|notes|retiens|prends note|ecris dans mes notes|garde en tete|souviens)/.test(core) && !(p.hasTime && /(rendez|rdv|cours)/.test(tn))) {
    const txt = cleanTitle(stripPreamble(n).replace(/^(prends note|note[sz]?|retiens|écris dans mes notes|ecris dans mes notes|garde en tête|garde en tete)\s*(que |qu'|:)?\s*/i, ''), 'note');
    if (!txt) return { reply: 'Dis-moi ce que tu veux noter 🙂', actions: [] };
    return { reply: `C'est noté : « ${txt} ».`, actions: [{ type: 'add_note', text: txt }] };
  }

  // 10. événement
  if (addVerb || p.hasTime || p.explicitDay) {
    const title = cleanTitle(p.title);
    if (p.hasTime && !p.explicitDay && !p.relTime) {
      const t1 = new Date(p.start);
      return nextQuestion({ title, start: null, timeOnly: [t1.getHours(), t1.getMinutes()], dur: p.end - p.start });
    }
    return nextQuestion({ title, start: p.start, end: p.end, allDay: p.allDay, allDayConfirmed: p.allDayExplicit });
  }
  if (isQ) return { reply: answerQuery(n, p), actions: [] };
  return { reply: "Je n'ai pas bien compris 🤔 Tu peux me dire par exemple :\n• « Ajoute boxe vendredi à 21h »\n• « Qu'est-ce que j'ai demain ? »\n• « Rappelle-moi d'appeler maman à 18h »", actions: [] };
}


// ---------------------------------------------------------------------
// Mode Claude
// ---------------------------------------------------------------------
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const MODEL = 'claude-opus-5-5';

const ACTION = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'ref', 'title', 'start', 'end', 'all_day', 'location', 'category', 'due', 'priority', 'text', 'minutes'],
  properties: {
    type: { type: 'string', enum: ['create_event', 'update_event', 'delete_event', 'add_task', 'complete_task', 'delete_task', 'add_note', 'add_reminder', 'set_event_reminder'] },
    ref: { type: 'string', description: 'Référence (#E12, #T3) de l\'élément existant pour update/delete/complete, sinon vide.' },
    title: { type: 'string' },
    start: { type: 'string', description: 'YYYY-MM-DDTHH:MM (heure locale) ou YYYY-MM-DD si journée entière. Vide si non concerné.' },
    end: { type: 'string', description: 'Même format. Vide = 1 h après le début.' },
    all_day: { type: 'boolean' },
    location: { type: 'string' },
    category: { type: 'string', enum: ['', ...Object.keys(CATS)] },
    due: { type: 'string', description: 'Pour une tâche : YYYY-MM-DD ou YYYY-MM-DDTHH:MM, vide si aucune date.' },
    priority: { type: 'string', enum: ['', 'haute', 'normale', 'basse'] },
    text: { type: 'string', description: 'Contenu de la note (add_note).' },
    minutes: { type: 'integer', description: 'set_event_reminder : minutes avant l\'événement. Sinon 0.' },
  },
};
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'actions'],
  properties: {
    reply: { type: 'string', description: 'Réponse courte en français, chaleureuse et claire. Peut contenir des listes avec « • ».' },
    actions: { type: 'array', items: ACTION },
  },
};

function context() {
  const st = S();
  const now = Date.now();
  const dups = duplicateIds();
  const evs = st.events
    .filter(e => e.end > now - 7 * DAY && e.start < now + 60 * DAY && !dups.has(e.id))
    .sort((a, b) => a.start - b.start);
  st._refs = { E: evs.map(e => e.id), T: st.tasks.map(t => t.id) };
  const ev = evs.map((e, i) => `#E${i} | ${e.allDay ? localIso(e.start).slice(0, 10) + ' (journée)' : localIso(e.start) + ' → ' + localIso(e.end).slice(11)} | ${e.title} | ${CATS[e.cat]?.label || ''}${e.location ? ' | ' + e.location : ''}`).join('\n');
  const tk = st.tasks.map((t, i) => `#T${i} | ${t.done ? '✔' : '☐'} ${t.title}${t.due ? ' | pour ' + localIso(t.due) : ''} | ${t.priority}`).join('\n');
  const nt = st.notes.slice(-25).map(n => `- ${(n.title ? n.title + ' : ' : '') + n.text.slice(0, 160).replace(/\n/g, ' / ')}`).join('\n');
  const sb = subjects().map(m => `- ${m.name}${m.nextExam ? ' | prochain contrôle : ' + localIso(m.nextExam.start) : ''}`).join('\n');
  const gl = st.settings.goals.map(g => { const p = goalProgress(g); return `- ${g.emoji} ${g.label} : ${p.done}/${g.target}${p.unit} cette semaine (prévu ${p.planned})`; }).join('\n');
  return { ev, tk, nt, sb, gl };
}

const parseLocal = s => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  return { t: new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime(), time: !!m[4] };
};

export async function askClaude(text) {
  const st = S();
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: st.settings.claudeKey, dangerouslyAllowBrowser: true });
  const { ev, tk, nt, sb, gl } = context();
  const now = new Date();
  const system = [
    `Tu es l'assistant personnel intégré à l'agenda de ${st.settings.name}. Tu gères son calendrier, son échéancier (tâches avec date) et ses notes.`,
    st.settings.about ? `À propos de ${st.settings.name} : ${st.settings.about}` : '',
    'Pour « rappelle-moi de X à tel moment », utilise add_reminder (title = X, start = moment). Pour « préviens-moi N min avant tel événement », utilise set_event_reminder (ref + minutes).',
    'Tes réponses sont souvent lues à voix haute : fais des phrases courtes et naturelles, sans listes à puces longues.',
    'Quand on te demande de programmer, ajouter, déplacer, annuler ou noter quelque chose, renvoie les actions correspondantes : elles sont appliquées directement dans l\'agenda (et sur Google Agenda s\'il est connecté).',
    'Pour modifier/supprimer un élément existant, utilise sa référence (#E.. ou #T..). Vérifie les conflits d\'horaires et signale-les. Pour planifier des révisions, place-les dans des créneaux libres raisonnables (pas pendant les cours, pas après 22h).',
    'Si la demande est une question, réponds sans action. Ne crée jamais un doublon d\'un événement déjà présent.',
    'Catégories possibles : ' + Object.entries(CATS).map(([k, v]) => `${k} (${v.label})`).join(', ') + '.',
    'Ton : bref, direct, bienveillant, tutoiement, en français.',
    '',
    `Maintenant : ${fmtDay(now)} ${now.getFullYear()}, ${hm(now)} (fuseau ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    '',
    'AGENDA (7 jours passés → 60 jours) :', ev || '(vide)',
    '', 'TÂCHES :', tk || '(aucune)',
    '', 'NOTES :', nt || '(aucune)',
    '', 'MATIÈRES :', sb || '(aucune)',
    '', 'OBJECTIFS DE LA SEMAINE :', gl || '(aucun)',
  ].join('\n');
  const messages = [...st.chat.filter(m => m.role === 'user' || m.role === 'assistant').slice(-8).map(m => ({ role: m.role, content: m.text })), { role: 'user', content: text }];
  // l'API exige une alternance user/assistant commençant par user
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  });
  if (res.stop_reason === 'refusal') throw new Error('L\'assistant ne peut pas répondre à cette demande.');
  const out = JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const refId = r => {
    const m = /^#?([ET])(\d+)$/.exec((r || '').trim());
    return m ? st._refs?.[m[1]]?.[+m[2]] : null;
  };
  const actions = (out.actions || []).map(a => {
    const s = parseLocal(a.start), e = parseLocal(a.end), d = parseLocal(a.due);
    const allDay = a.all_day || (s && !s.time);
    return {
      type: a.type, id: refId(a.ref), title: a.title, location: a.location, category: a.category || undefined,
      start: s?.t, end: e ? e.t : s ? s.t + (allDay ? DAY : 3600000) : undefined, allDay,
      due: d?.t ?? null, dueTime: !!d?.time, priority: a.priority || 'normale', text: a.text, minutes: a.minutes,
    };
  });
  return { reply: out.reply, actions };
}

// Transforme une réponse écrite en phrase agréable à écouter
export function spoken(text) {
  return text
    .replace(/[✦★⚠️🎯⏳📝🥊🌿🙌👌💪🎉👋«»]/gu, '')
    .replace(/:\s*\n•\s*/g, '. ').replace(/\n•\s*/g, '. ').replace(/^•\s*/gm, '')
    .replace(/(\d{1,2})h(\d{2})\b/g, '$1 h $2').replace(/(\d{1,2})h\b/g, '$1 heures')
    .replace(/(\d+) min\b/g, '$1 minutes').replace(/\b1 heures\b/g, '1 heure').replace(/ · /g, ', ').replace(/\(J-(\d+)\)/g, '(dans $1 jours)')
    .replace(/\s*:\s*\./g, '.').replace(/\n+/g, '. ').replace(/\s{2,}/g, ' ').replace(/\s+([.,])/g, '$1').replace(/\.\s*\./g, '.').trim();
}

// ---------------------------------------------------------------------
// Photo → agenda : lit un emploi du temps (photo, capture) avec Claude
// ---------------------------------------------------------------------
const PHOTO_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['events', 'note'],
  properties: {
    note: { type: 'string', description: 'Une phrase courte en français pour décrire ce que tu as lu (ou pourquoi tu n\'as rien trouvé).' },
    events: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'date', 'start', 'end', 'location', 'weekly'],
        properties: {
          title: { type: 'string', description: 'Titre court et propre, ex : « TD Statistiques ».' },
          date: { type: 'string', description: 'YYYY-MM-DD de la première occurrence (à partir d\'aujourd\'hui).' },
          start: { type: 'string', description: 'HH:MM, vide si journée entière.' },
          end: { type: 'string', description: 'HH:MM, vide si inconnue.' },
          location: { type: 'string' },
          weekly: { type: 'boolean', description: 'true si c\'est un emploi du temps type qui se répète chaque semaine (jours de la semaine sans dates précises).' },
        },
      },
    },
  },
};

export async function readSchedulePhoto(base64, mediaType = 'image/jpeg') {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: S().settings.claudeKey, dangerouslyAllowBrowser: true });
  const now = new Date();
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: `Tu lis des photos d'emplois du temps, de convocations, d'affiches ou de captures d'écran et tu en extrais les événements pour un agenda. Nous sommes le ${fmtDay(now)} ${now.getFullYear()} (fuseau ${Intl.DateTimeFormat().resolvedOptions().timeZone}). Si la photo montre une semaine type (lundi, mardi… sans dates), place chaque cours à sa prochaine occurrence à partir d'aujourd'hui et mets weekly=true. Garde les titres courts (matière + type CM/TD), mets la salle dans location. N'invente rien d'illisible.`,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Extrais tous les événements de cette image.' },
    ] }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: PHOTO_SCHEMA } },
  });
  if (res.stop_reason === 'refusal') throw new Error('Image refusée.');
  const out = JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const evs = (out.events || []).map(e => {
    const d = parseLocal(e.date);
    if (!d) return null;
    const [h1, m1] = (e.start || '').split(':').map(Number);
    const [h2, m2] = (e.end || '').split(':').map(Number);
    const allDay = !e.start;
    const start = allDay ? d.t : new Date(d.t).setHours(h1, m1 || 0, 0, 0);
    const end = allDay ? d.t + DAY : (e.end ? new Date(d.t).setHours(h2, m2 || 0, 0, 0) : start + 3600000);
    return { title: e.title, start, end: end > start ? end : start + 3600000, allDay, location: e.location || '', weekly: !!e.weekly };
  }).filter(Boolean);
  return { note: out.note, events: evs };
}

// Vérifie qu'une clé Claude fonctionne
export async function testClaudeKey(key) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const r = await client.messages.create({ model: MODEL, max_tokens: 20, messages: [{ role: 'user', content: 'Réponds juste OK.' }] });
  return r.content.some(b => b.type === 'text');
}
