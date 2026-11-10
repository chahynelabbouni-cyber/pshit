// Lecture d'un fichier .ics (export Google Agenda, Apple, Outlook…).
import { guessCat } from './store.js';
import { DAY, addDays } from './dates.js';

function unfold(text) { return text.replace(/\r?\n[ \t]/g, ''); }
const unesc = s => (s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseDate(v, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return { t: NaN, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || /VALUE=DATE(?!-)/.test(params)) return { t: new Date(+y, mo - 1, +d).getTime(), allDay: true };
  if (z) return { t: Date.UTC(+y, mo - 1, +d, +h, +mi, +(s || 0)), allDay: false };
  return { t: new Date(+y, mo - 1, +d, +h, +mi, +(s || 0)).getTime(), allDay: false };
}

export function parseIcs(text, { untilDays = 400 } = {}) {
  const lines = unfold(text).split(/\r?\n/);
  const out = [];
  let cur = null;
  const horizon = Date.now() + untilDays * DAY;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start && !isNaN(cur.start)) {
        if (!cur.end || isNaN(cur.end)) cur.end = cur.start + (cur.allDay ? DAY : 3600000);
        const base = {
          title: cur.title || '(sans titre)', start: cur.start, end: cur.end, allDay: cur.allDay,
          location: cur.location || '', notes: cur.notes || '', source: 'local', gid: null,
        };
        base.cat = guessCat(base.title, base.notes);
        out.push(base);
        // répétitions hebdo/quotidiennes simples
        if (cur.rrule) {
          const r = Object.fromEntries(cur.rrule.split(';').map(x => x.split('=')));
          const step = r.FREQ === 'DAILY' ? 1 : r.FREQ === 'WEEKLY' ? 7 * (+r.INTERVAL || 1) : 0;
          if (step) {
            const until = r.UNTIL ? parseDate(r.UNTIL, '').t : horizon;
            const count = +r.COUNT || 500;
            const dur = base.end - base.start;
            for (let i = 1; i < count; i++) {
              const s = addDays(new Date(base.start), step * i).getTime();
              if (s > until || s > horizon) break;
              if (cur.exdates?.includes(s)) continue;
              out.push({ ...base, start: s, end: s + dur });
            }
          }
        }
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i), val = line.slice(i + 1);
    const [name, ...params] = head.split(';');
    const p = params.join(';');
    switch (name) {
      case 'SUMMARY': cur.title = unesc(val); break;
      case 'LOCATION': cur.location = unesc(val); break;
      case 'DESCRIPTION': cur.notes = unesc(val).slice(0, 2000); break;
      case 'DTSTART': { const d = parseDate(val, p); cur.start = d.t; cur.allDay = d.allDay; break; }
      case 'DTEND': cur.end = parseDate(val, p).t; break;
      case 'RRULE': cur.rrule = val; break;
      case 'EXDATE': (cur.exdates ||= []).push(...val.split(',').map(v => parseDate(v, p).t)); break;
    }
  }
  return out;
}
