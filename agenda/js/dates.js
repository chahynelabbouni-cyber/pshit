// Outils de dates (heure locale du téléphone).
export const DAY = 86400000;
export const MIN = 60000;

export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const JOURS_C = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MOIS_C = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const startOfWeek = d => { const x = startOfDay(d); const w = (x.getDay() + 6) % 7; return addDays(x, -w); }; // lundi
export const startOfMonth = d => { const x = startOfDay(d); x.setDate(1); return x; };
export const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

export const pad = n => String(n).padStart(2, '0');
export const hm = d => { d = new Date(d); return `${d.getHours()}h${d.getMinutes() ? pad(d.getMinutes()) : ''}`; };
export const hm2 = d => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const ymd = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fromYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const localIso = d => `${ymd(d)}T${hm2(d)}`;

export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
export const fmtDay = d => { d = new Date(d); return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`; };
export const fmtDayShort = d => { d = new Date(d); return `${JOURS_C[d.getDay()]} ${d.getDate()} ${MOIS_C[d.getMonth()]}`; };

export function relDay(d, now = new Date()) {
  const n = dayDiff(now, d);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === 2) return 'après-demain';
  if (n === -1) return 'hier';
  if (n > 0 && n < 7) return JOURS[new Date(d).getDay()];
  return fmtDayShort(d);
}

export function fmtDuration(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${pad(r)}` : `${h} h`;
}

export function countdown(target, now = Date.now()) {
  const ms = target - now;
  if (ms <= 0) return 'maintenant';
  const m = Math.round(ms / MIN);
  if (m < 60) return `dans ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `dans ${h} h${m % 60 ? ' ' + pad(m % 60) : ''}`;
  const d = dayDiff(now, target);
  return d === 1 ? 'demain' : `dans ${d} jours`;
}
