// L'assistant de l'agenda.
// - Sans clé : compréhension locale des phrases (parse.js) + réponses aux questions courantes.
// - Avec ta clé Claude (Réglages) : comprend n'importe quelle demande et agit sur l'agenda.
import { S, CATS, eventsBetween, deadlines, duplicateIds } from './store.js';
import { parseFr } from './parse.js';
import { DAY, MIN, startOfDay, startOfWeek, addDays, fmtDay, hm, relDay, localIso, cap, countdown, dayDiff, fmtDuration } from './dates.js';
import { briefing, stats, subjects, goalProgress } from './insights.js';
import { norm, CATS as C2 } from './store.js';

// Trouve l'événement dont on parle (« la boxe de jeudi », « mon rdv coiffeur »)
const FILLER = /\b(deplace|decale|bouge|avance|recule|repousse|reporte|mets|met|supprime|annule|efface|retire|enleve|mon|ma|mes|le|la|les|l|de|du|des|a|au|pour|rdv|rendez|vous|seance|cours|prochain|prochaine|aujourd|hui|demain|apres|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|matin|soir|midi|\d+h?\d*|h|et|en|sur|ce|cette|cet|stp|plutot|plus|tard|tot|heure|heures|min|minutes)\b/g;
function findEvent(text, p) {
  const words = norm(text).replace(/[^a-z0-9 ]/g, ' ').replace(FILLER, ' ').split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;
  const now = Date.now();
  let pool = eventsBetween(now - DAY, now + 60 * DAY);
  const scored = pool.map(e => {
    const t = norm(e.title + ' ' + e.location);
    const sc = words.filter(w => t.includes(w)).length;
    return { e, sc };
  }).filter(x => x.sc > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map(x => x.sc));
  let cands = scored.filter(x => x.sc === best).map(x => x.e).filter(e => e.end > now);
  return cands[0] || null;
}

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
function listLine(e) {
  return e.allDay ? `• ${cleanT(e)} (toute la journée)` : `• ${hm(e.start)} : ${cleanT(e)}`;
}

function answerQuery(text, p) {
  const t = text.toLowerCase();
  const now = new Date();
  if (/examen|partiel|contr[ôo]le|\bcc\b|[ée]ch[ée]ance|rendre|deadline|devoir/.test(t)) {
    const list = deadlines({ from: Date.now() }).filter(d => !d.done).slice(0, 8);
    if (!list.length) return 'Rien à l\'horizon côté échéances. Profite !';
    return 'Tes prochaines échéances :\n' + list.map(d => `• ${cap(relDay(d.due))}${d.dueTime ? ' ' + hm(d.due) : ''} — ${d.title} (${dayDiff(now, d.due) <= 0 ? 'aujourd\'hui' : 'J-' + dayDiff(now, d.due)})`).join('\n');
  }
  if (/note/.test(t)) {
    const n = S().notes.slice(-6).reverse();
    return n.length ? 'Tes dernières notes :\n' + n.map(x => `• ${x.title || x.text.split('\n')[0]}`).join('\n') : 'Aucune note pour l\'instant.';
  }
  if (/t[âa]che|à faire|a faire|todo/.test(t)) {
    const n = S().tasks.filter(x => !x.done);
    return n.length ? 'À faire :\n' + n.map(x => `• ${x.title}${x.due ? ' (' + relDay(x.due) + ')' : ''}`).join('\n') : 'Ta liste de tâches est vide 👌';
  }
  if (/prochain|ensuite|apr[eè]s/.test(t) && !p.explicitDay) {
    const next = eventsBetween(Date.now(), Date.now() + 30 * DAY).find(e => !e.allDay && e.start > Date.now());
    return next ? `Prochain : ${next.title}, ${relDay(next.start)} à ${hm(next.start)} (${countdown(next.start)})${next.location ? ', ' + next.location : ''}.` : 'Rien de prévu pour le moment.';
  }
  if (/libre|dispo|cr[ée]neau/.test(t)) {
    const d = p.day || now;
    const slots = freeSlots(d, { minMin: 45 });
    return slots.length ? `Créneaux libres ${relDay(d)} :\n` + slots.map(([a, b]) => `• ${hm(a)} → ${hm(b)}`).join('\n') : `Pas de vrai créneau libre ${relDay(d)}.`;
  }
  let a, b, label;
  if (p.weekRange) {
    a = startOfWeek(now); if (p.weekRange === 'next') a = addDays(a, 7);
    b = addDays(a, 7); label = p.weekRange === 'next' ? 'la semaine prochaine' : 'cette semaine';
  } else {
    a = startOfDay(p.day || now); b = addDays(a, 1); label = relDay(a);
  }
  const evs = eventsBetween(a.getTime(), b.getTime());
  if (!evs.length) return `Rien de prévu ${label} 🙌`;
  if (p.weekRange) {
    const byDay = new Map();
    evs.forEach(e => { const k = startOfDay(e.start).getTime(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); });
    return `${cap(label)} :\n` + [...byDay].map(([k, l]) => `${cap(fmtDay(k))}\n` + l.map(listLine).join('\n')).join('\n');
  }
  const timed = evs.filter(e => !e.allDay);
  return `${cap(label)}, tu as ${evs.length} chose${evs.length > 1 ? 's' : ''} de prévue${evs.length > 1 ? 's' : ''}${timed.length ? `, de ${hm(timed[0].start)} à ${hm(Math.max(...timed.map(e => e.end)))}` : ''} :\n` + evs.map(listLine).join('\n');
}

export function localAssistant(text) {
  const p = parseFr(text);
  const t = text.toLowerCase();
  const tn = norm(text);
  // briefing
  if (/(resume|résume|briefing|recap|récap|comment se presente|ma journee|ma journée)/.test(tn) && !/(ajoute|programme)/.test(tn)) {
    return { reply: briefing(p.day || new Date()), actions: [] };
  }
  // combien d'heures
  if (/combien/.test(tn) && /(heure|h\b|seance|fois|cours|boxe|sport)/.test(tn)) {
    const st = stats(/mois/.test(tn) ? 'month' : 'week');
    const lbl = /mois/.test(tn) ? 'ce mois-ci' : 'cette semaine';
    const catKey = Object.keys(C2).find(k => tn.includes(norm(C2[k].label).slice(0, 5)) || tn.includes(k));
    const bits = Object.entries(st.byCat).filter(([k]) => k !== 'ferie').sort((a, b) => b[1] - a[1]).map(([k, h]) => `• ${C2[k]?.emoji || ''} ${C2[k]?.label || k} : ${Math.round(h * 10) / 10} h`);
    if (/boxe|sport/.test(tn)) return { reply: `${cap(lbl)} : ${st.sport} séance${st.sport > 1 ? 's' : ''} de sport.`, actions: [] };
    if (catKey && st.byCat[catKey] != null) return { reply: `${cap(lbl)} : ${Math.round(st.byCat[catKey] * 10) / 10} h de ${C2[catKey].label.toLowerCase()}.`, actions: [] };
    return { reply: `${cap(lbl)}, ${Math.round(st.total)} h programmées :\n${bits.join('\n')}`, actions: [] };
  }
  // prochain X / quand est X
  const nm = /(?:quand|prochain|prochaine|c'est quand)\b.*?\b(?:mon|ma|mes|le|la|l'|de|du)?\s*([a-zàâçéèêëîïôûùüÿñæœ' -]{3,})\s*\??$/i.exec(text);
  if (nm && /^(quand|c'est quand|.*prochain)/i.test(t) && !/(ajoute|programme|mets)/.test(tn)) {
    const kw = norm(nm[1]).replace(/^(mon|ma|le|la|les|l'|de|du|prochaine?|est)\s+/g, '').replace(/\?/g, '').trim();
    const words = kw.split(/\s+/).filter(w => w.length > 2 && !/^(est|mon|prochain|prochaine)$/.test(w));
    const now = Date.now();
    const isExam = /(examen|exam|controle|partiel|cc)/.test(kw);
    const e = eventsBetween(now, now + 200 * DAY).sort((a, b) => a.start - b.start).find(ev => isExam ? ev.cat === 'exam' : words.length && words.every(w => norm(ev.title + ' ' + ev.location).includes(w)));
    if (e) return { reply: `${cleanT(e)} : ${relDay(e.start)}${e.allDay ? '' : ' à ' + hm(e.start)}${e.location ? ', ' + e.location : ''}.`, actions: [] };
    if (words.length) return { reply: `Je ne trouve rien de prévu pour « ${nm[1].trim()} ».`, actions: [] };
  }
  // supprimer / annuler
  if (/^(supprime|annule|efface|retire|enleve|enlève)/.test(tn)) {
    const e = findEvent(text, p);
    if (!e) return { reply: 'Je ne vois pas de quel événement tu parles. Donne-moi son nom (ex : « annule la boxe de vendredi »).', actions: [] };
    return { reply: `J'ai supprimé « ${e.title} » (${relDay(e.start)}${e.allDay ? '' : ' ' + hm(e.start)}).`, actions: [{ type: 'delete_event', id: e.id }] };
  }
  // déplacer
  if (/^(deplace|decale|bouge|avance|recule|repousse|reporte|change)/.test(tn)) {
    const e = findEvent(text, p);
    if (!e) return { reply: 'Je ne vois pas quel événement déplacer. Ex : « déplace la boxe à 21h ».', actions: [] };
    const dur = e.end - e.start;
    let start;
    const shift = /(\d+)\s?(min|h)/.exec(tn);
    if (/(avance|recule|repousse|plus tard|plus tot)/.test(tn) && shift && !p.explicitDay && !/\ba\s?\d/.test(tn)) {
      const m = +shift[1] * (shift[2] === 'h' ? 60 : 1) * (/(avance|plus tot)/.test(tn) ? -1 : 1);
      start = e.start + m * MIN;
    } else if (p.start) {
      const base = new Date(p.explicitDay ? p.start : e.start);
      if (p.hasTime) { const n = new Date(p.start); base.setHours(n.getHours(), n.getMinutes(), 0, 0); }
      else { const o = new Date(e.start); base.setHours(o.getHours(), o.getMinutes(), 0, 0); }
      start = base.getTime();
    }
    if (!start) return { reply: `À quel moment veux-tu déplacer « ${e.title} » ?`, actions: [] };
    return { reply: `« ${e.title} » est déplacé à ${relDay(start)} ${hm(start)}.`, actions: [{ type: 'update_event', id: e.id, start, end: start + dur }] };
  }
  // demandes spéciales
  if (/(planifi|organise|pr[ée]vois).*(r[ée]vision|r[ée]viser)/.test(t)) {
    const exams = deadlines({ from: Date.now() }).filter(d => d.kind === 'event' && d.cat === 'exam' && !d.done);
    const ex = exams.find(d => t.split(/\s+/).some(w => w.length > 3 && d.title.toLowerCase().includes(w) && !/r[ée]vis|planifi|pour|examen/.test(w))) || exams[0];
    if (!ex) return { reply: 'Je ne vois pas d\'examen à venir dans ton agenda.', actions: [] };
    const plan = revisionPlan(ex.ref);
    if (!plan.length) return { reply: `Je n'ai pas trouvé de créneau libre avant « ${ex.title} ».`, actions: [] };
    return {
      reply: `Je te bloque ${plan.length} séance${plan.length > 1 ? 's' : ''} de révision avant « ${ex.title} » (${relDay(ex.due)}).`,
      actions: plan.map(s => ({ type: 'create_event', title: revisionTitle(ex.ref), start: s.start, end: s.end, category: 'revision' })),
    };
  }
  // rappel X min / h avant un événement : « mets-moi un rappel 30 min avant la boxe »
  const before = /(\d+)\s?(min|minutes?|h|heures?)\s+avant\b/.exec(tn);
  if (before && /(rappel|previen|alerte|rappelle)/.test(tn)) {
    const e = findEvent(text.replace(before[0], ' '), p);
    const min = +before[1] * (before[2].startsWith('h') ? 60 : 1);
    if (!e) return { reply: 'Pour quel événement ? Ex : « rappel 30 min avant la boxe ».', actions: [] };
    return { reply: `D'accord, je te préviens ${fmtDuration(min * MIN)} avant « ${cleanT(e)} » (${relDay(e.start)} ${hm(e.start)}).`, actions: [{ type: 'set_event_reminder', id: e.id, minutes: min }] };
  }
  // rappel à un moment précis : « rappelle-moi d'appeler maman demain à 18h »
  if (/(rappelle|rappel|previens|previens[- ]moi|alerte|reveille|n'oublie pas de me)/.test(tn) && (p.hasTime || p.explicitDay)) {
    let at = p.start;
    if (!p.hasTime) at = new Date(p.start).setHours(9, 0, 0, 0);
    const what = (p.title || 'Rappel').replace(/^(un |le )?rappel\s*(pour|de|d')?\s*/i, '') || 'Rappel';
    const title = what[0].toUpperCase() + what.slice(1);
    return { reply: `C'est noté, je te le rappelle ${relDay(at)} à ${hm(at)} : « ${title} ».`, actions: [{ type: 'add_reminder', title, start: at }] };
  }
  if (p.intent === 'query') return { reply: answerQuery(text, p), actions: [] };
  if (p.intent === 'note') {
    if (!p.title) return { reply: 'Dis-moi ce que tu veux noter 🙂', actions: [] };
    return { reply: `C'est noté : « ${p.title} ».`, actions: [{ type: 'add_note', text: p.title }] };
  }
  if (p.intent === 'task') {
    return {
      reply: `Ajouté à ton échéancier : « ${p.title || 'Tâche'} »${p.start ? ', pour ' + relDay(p.start) + (p.hasTime ? ' à ' + hm(p.start) : '') : ''}.`.replace('..', '.'),
      actions: [{ type: 'add_task', title: p.title || 'Tâche', due: p.start, dueTime: p.hasTime }],
    };
  }
  if (!p.start) return { reply: 'Je n\'ai pas compris la date. Essaie par ex. « boxe jeudi 20h30 ».', actions: [] };
  const title = p.title || 'Événement';
  return {
    reply: `C'est programmé : ${title}, ${relDay(p.start)}${p.allDay ? ' (journée)' : ` de ${hm(p.start)} à ${hm(p.end)}`}.`.replace('..', '.'),
    actions: [{ type: 'create_event', title, start: p.start, end: p.end, allDay: p.allDay }],
  };
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
