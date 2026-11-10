// Synchronisation directe avec Google Agenda (lecture + écriture), depuis le téléphone.
// Utilise Google Identity Services : aucun serveur, le jeton reste dans l'appli.
import { S, save, guessCat, uid } from './store.js';
import { DAY, startOfDay, ymd, fromYmd } from './dates.js';

const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';
let token = null, tokenExp = 0, client = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res; s.onerror = () => rej(new Error('Impossible de charger Google (pas de connexion ?)'));
    document.head.appendChild(s);
  });
}

export async function getToken(interactive = true) {
  if (token && Date.now() < tokenExp - 60000) return token;
  const cid = S().settings.googleClientId.trim();
  if (!cid) throw new Error('Ajoute ton identifiant client Google dans les Réglages.');
  await loadGis();
  return new Promise((resolve, reject) => {
    client = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: SCOPES,
      prompt: interactive ? '' : 'none',
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
        resolve(token);
      },
      error_callback: e => reject(new Error(e?.message || e?.type || 'Connexion Google annulée')),
    });
    client.requestAccessToken();
  });
}

async function api(path, opt = {}) {
  const tk = await getToken();
  const r = await fetch(API + path, {
    ...opt,
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', ...(opt.headers || {}) },
  });
  if (r.status === 401) { token = null; throw new Error('Session Google expirée, reconnecte-toi.'); }
  if (r.status === 204 || r.status === 410) return null;
  if (!r.ok) throw new Error(`Google Agenda : erreur ${r.status}`);
  return r.json();
}

const encId = id => encodeURIComponent(id);

function fromGoogle(g, calId, calName) {
  const allDay = !!g.start?.date;
  const start = allDay ? fromYmd(g.start.date).getTime() : new Date(g.start.dateTime).getTime();
  const end = allDay ? fromYmd(g.end.date).getTime() : new Date(g.end?.dateTime || g.start.dateTime).getTime();
  const holiday = /holiday/.test(calId);
  return {
    gid: g.id, calId, source: 'google',
    title: g.summary || '(sans titre)',
    start, end, allDay,
    location: g.location || '',
    notes: (g.description || '').replace(/<[^>]+>/g, ' ').trim(),
    cat: holiday ? 'ferie' : guessCat(g.summary || '', calName || ''),
    recurring: !!g.recurringEventId,
    dirty: false,
  };
}

function toGoogle(e) {
  const body = { summary: e.title, location: e.location || undefined, description: e.notes || undefined };
  if (e.allDay) { body.start = { date: ymd(e.start) }; body.end = { date: ymd(e.end) }; }
  else {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    body.start = { dateTime: new Date(e.start).toISOString(), timeZone: tz };
    body.end = { dateTime: new Date(e.end).toISOString(), timeZone: tz };
  }
  if (e.reminder != null) body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: e.reminder }] };
  return body;
}

// Envoie un événement local vers Google (création ou mise à jour).
export async function pushEvent(e) {
  if (!S().settings.googleConnected) return;
  const cal = e.calId || 'primary';
  if (/holiday/.test(cal)) { e.dirty = false; return; }
  const res = e.gid
    ? await api(`/calendars/${encId(cal)}/events/${encId(e.gid)}`, { method: 'PATCH', body: JSON.stringify(toGoogle(e)) })
    : await api(`/calendars/${encId(cal)}/events`, { method: 'POST', body: JSON.stringify(toGoogle(e)) });
  if (res) { e.gid = res.id; e.calId = cal; e.source = 'google'; }
  e.dirty = false;
  save();
}

export async function removeRemote(gid, calId = 'primary') {
  if (!S().settings.googleConnected || /holiday/.test(calId)) return;
  await api(`/calendars/${encId(calId)}/events/${encId(gid)}`, { method: 'DELETE' });
}

// Synchronisation complète : envoie les changements locaux, puis récupère tout Google.
export async function syncAll({ pastDays = 60, futureDays = 365 } = {}) {
  const st = S();
  await getToken(true);
  st.settings.googleConnected = true;

  // 1. suppressions en attente
  for (const t of [...st.tombstones]) {
    try { await removeRemote(t.gid, t.calId); } catch { /* déjà supprimé */ }
    st.tombstones = st.tombstones.filter(x => x !== t);
  }
  // 2. créations / modifications locales
  for (const e of st.events.filter(e => e.dirty)) {
    try { await pushEvent(e); } catch (err) { console.warn('push', err); }
  }
  // 3. récupération de tous les agendas affichés
  const list = await api('/users/me/calendarList?minAccessRole=reader');
  const cals = (list?.items || []).filter(c => c.selected !== false);
  const a = new Date(startOfDay(new Date()).getTime() - pastDays * DAY).toISOString();
  const b = new Date(startOfDay(new Date()).getTime() + futureDays * DAY).toISOString();
  const fresh = [];
  for (const c of cals) {
    let pageToken = '';
    do {
      const q = new URLSearchParams({ timeMin: a, timeMax: b, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
      if (pageToken) q.set('pageToken', pageToken);
      const r = await api(`/calendars/${encId(c.id)}/events?${q}`);
      for (const g of r?.items || []) if (g.status !== 'cancelled' && g.start) fresh.push(fromGoogle(g, c.id, c.summary));
      pageToken = r?.nextPageToken || '';
    } while (pageToken);
  }
  // 4. fusion : on remplace les événements Google de la période, on garde les locaux
  const lo = Date.parse(a), hi = Date.parse(b);
  const old = new Map(st.events.filter(e => e.gid).map(e => [e.gid, e]));
  const keep = st.events.filter(e => !e.gid || e.start < lo || e.start > hi);
  const merged = fresh.map(f => {
    const o = old.get(f.gid);
    // conserve la catégorie et le rappel choisis dans l'appli
    return { id: o?.id || uid(), reminder: o?.reminder ?? null, ...f, cat: o?.catLocked ? o.cat : f.cat, catLocked: o?.catLocked || false };
  });
  st.events = [...keep, ...merged];
  st.settings.lastSync = Date.now();
  save();
  return { count: fresh.length, calendars: cals.length };
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  S().settings.googleConnected = false;
  save();
}
