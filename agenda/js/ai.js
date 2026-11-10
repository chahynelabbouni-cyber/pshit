// L'assistant de l'agenda.
// - Sans clé : compréhension locale des phrases (parse.js) + réponses aux questions courantes.
// - Avec ta clé Claude (Réglages) : comprend n'importe quelle demande et agit sur l'agenda.
import { S, CATS, eventsBetween, deadlines, duplicateIds } from './store.js';
import { parseFr } from './parse.js';
import { DAY, MIN, startOfDay, startOfWeek, addDays, fmtDay, hm, relDay, localIso, cap, countdown, dayDiff } from './dates.js';

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
function listLine(e) {
  return e.allDay ? `• ${e.title} (journée)` : `• ${hm(e.start)}–${hm(e.end)} ${e.title}${e.location ? ' · ' + e.location : ''}`;
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
  return `${cap(label)}, ${evs.length} élément${evs.length > 1 ? 's' : ''} :\n` + evs.map(listLine).join('\n');
}

export function localAssistant(text) {
  const p = parseFr(text);
  const t = text.toLowerCase();
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
  required: ['type', 'ref', 'title', 'start', 'end', 'all_day', 'location', 'category', 'due', 'priority', 'text'],
  properties: {
    type: { type: 'string', enum: ['create_event', 'update_event', 'delete_event', 'add_task', 'complete_task', 'delete_task', 'add_note'] },
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
  return { ev, tk, nt };
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
  const { ev, tk, nt } = context();
  const now = new Date();
  const system = [
    `Tu es l'assistant personnel intégré à l'agenda de ${st.settings.name}. Tu gères son calendrier, son échéancier (tâches avec date) et ses notes.`,
    st.settings.about ? `À propos de ${st.settings.name} : ${st.settings.about}` : '',
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
      due: d?.t ?? null, dueTime: !!d?.time, priority: a.priority || 'normale', text: a.text,
    };
  });
  return { reply: out.reply, actions };
}
