// Compréhension locale (sans internet) des phrases en français :
// « ajoute boxe jeudi de 20h30 à 22h », « rdv dentiste le 15 novembre à 10h »,
// « rappelle-moi d'envoyer le dossier avant vendredi », « qu'est-ce que j'ai demain ? »
import { norm } from './store.js';
import { normalizeSpoken } from './nlu.js';
import { addDays, startOfDay, DAY, MIN } from './dates.js';

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const MOIS_RE = '(janv(?:ier)?|fev(?:rier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|aout|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|dec(?:embre)?)\\.?';
const monthIdx = s => MOIS.findIndex(m => m.startsWith(s.replace('.', '').slice(0, 3)));

const NUM = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30 };
const num = s => (s in NUM ? NUM[s] : parseInt(s, 10));
const startOfWeekN = d => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); };
const dayDiffN = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

// Retire les formules d'oral : « je voudrais que tu mettes… », « est-ce que tu peux ajouter… »
export function stripPreamble(input) {
  let s = input.trim().replace(/[’]/g, "'"), prev;
  let guard = 0;
  do {
    prev = s;
    s = s
      .replace(/^(alors|euh+|bon|ok|okay|ben|du coup|hey|salut|dis|écoute|ecoute|s'il te pla[iî]t|stp)[ ,!.]+/i, '')
      .replace(/^(est[- ]ce (que|qu')\s*)?(tu (peux|pourrais|veux|voudrais) ?(bien)?|peux[- ]tu|pourrais[- ]tu|j'aimerais|je voudrais|je veux|je souhaite|il faudrait|il faut|faudrait|j'ai besoin|merci de|n'oublie pas de)( bien)?( (que|qu'))?( tu| je| j'|\s)?\s*/i, '')
      .replace(/^(me |m')?(mettre|mette|mettes|mets|met|ajouter|ajoute|ajoutes|rajouter|rajoute|programmer|programme|programmes|cr[ée]er|cr[ée]e|cr[ée]es|planifier|planifie|noter|note|notes|inscrire|inscris|placer|place|caler|cale|bloquer|bloque|enregistrer|enregistre|r[ée]server|r[ée]serve)(-moi| moi)?\b\s*/i, '')
      .replace(/^(pour |dans (mon |l'|le )?(agenda|calendrier|planning)\s*)/i, '')
      .replace(/^(que |qu')?(je dois|je devrai|il faut que je|faut que je|je dois aller|je vais)\s+/i, '')
      .trim();
  } while (s !== prev && guard++ < 6);
  return s || input.trim();
}

export function parseFr(input, now = new Date()) {
  const src = stripPreamble(normalizeSpoken(input));
  let t = norm(src);
  const full = t;
  const spans = [];
  const take = (re, fn) => {
    const m = re.exec(t);
    if (!m) return false;
    const a = m.index, b = m.index + m[0].length;
    spans.push([a, b]);
    t = t.slice(0, a) + '\u0001'.repeat(b - a) + t.slice(b); // masque la partie déjà comprise
    fn(m);
    return true;
  };
  const today = startOfDay(now);
  let day = null, time = null, endTime = null, dur = null, part = null, weekRange = false, explicitDay = false, allDayExplicit = false, relTime = false;

  // « dans 2 heures », « dans 20 minutes » : un moment précis à partir de maintenant
  take(/\bdans (\d+) ?(h|heures?|minutes?|min)\b/, m => {
    const at = new Date(now.getTime() + (+m[1]) * (m[2].startsWith('h') ? 60 : 1) * MIN);
    day = startOfDay(at); time = [at.getHours(), at.getMinutes()]; explicitDay = true; relTime = true;
  });
  take(/\b(toute la journee|journee entiere|toute la journ)\b/, () => { allDayExplicit = true; });

  // ----- jour -----
  take(/\b(aujourd'hui|aujourdhui|ce soir|ce matin|cet apres[- ]?midi|cet aprem|cette nuit|ce midi)\b/, m => {
    day = today; explicitDay = true;
    if (m[1].includes('soir')) part = 19; else if (m[1].includes('matin')) part = 9;
    else if (m[1].includes('apres') || m[1].includes('aprem')) part = 14; else if (m[1].includes('midi')) part = 12; else if (m[1].includes('nuit')) part = 22;
  }) ||
  take(/\bapres[- ]demain\b/, () => { day = addDays(today, now.getHours() < 4 ? 1 : 2); explicitDay = true; }) ||
  take(/\bdemain( (matin|soir|apres[- ]?midi|aprem|midi))?\b/, m => {
    day = addDays(today, now.getHours() < 4 ? 0 : 1); explicitDay = true; // à 1h du matin, « demain » = la journée qui commence
    if (m[2]) part = m[2] === 'matin' ? 9 : m[2] === 'soir' ? 19 : m[2] === 'midi' ? 12 : 14;
  }) ||
  take(/\bdans (\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|quinze) (jours?|semaines?|mois)\b/, m => {
    const n = num(m[1]);
    day = m[2].startsWith('jour') ? addDays(today, n) : m[2].startsWith('sem') ? addDays(today, 7 * n) : new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
    explicitDay = true;
  }) ||
  take(/\b(?:le |ce )?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)( prochain| d'apres| en huit)?( (matin|soir|apres[- ]?midi|aprem|midi))?\b/, m => {
    const target = JOURS.indexOf(m[1]);
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    if (m[2] && /prochain/.test(m[2])) diff = dayDiffN(today, addDays(startOfWeekN(today), 7 + (target + 6) % 7)); // « jeudi prochain » = jeudi de la semaine prochaine
    if (m[2] && /apres|huit/.test(m[2])) diff += 7;
    day = addDays(today, diff); explicitDay = true;
    if (m[4]) part = m[4] === 'matin' ? 9 : m[4] === 'soir' ? 19 : m[4] === 'midi' ? 12 : 14;
  }) ||
  take(new RegExp(`\\b(?:le |du )?(1er|\\d{1,2}) ${MOIS_RE}(?: (\\d{4}))?\\b`), m => {
    const d = m[1] === '1er' ? 1 : +m[1];
    const mo = monthIdx(m[2]);
    let y = m[3] ? +m[3] : today.getFullYear();
    let x = new Date(y, mo, d);
    if (!m[3] && x < addDays(today, -1)) x = new Date(y + 1, mo, d);
    day = x; explicitDay = true;
  }) ||
  take(/\b(?:le )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, m => {
    let y = m[3] ? +m[3] : today.getFullYear();
    if (y < 100) y += 2000;
    let x = new Date(y, +m[2] - 1, +m[1]);
    if (!m[3] && x < addDays(today, -1)) x = new Date(y + 1, +m[2] - 1, +m[1]);
    day = x; explicitDay = true;
  }) ||
  take(/\b(?:le )(1er|\d{1,2})\b(?! ?h)(?! ?:)(?! ?min)/, m => {
    const d = m[1] === '1er' ? 1 : +m[1];
    if (d < 1 || d > 31) return;
    let x = new Date(today.getFullYear(), today.getMonth(), d);
    if (x < today) x = new Date(today.getFullYear(), today.getMonth() + 1, d);
    day = x; explicitDay = true;
  });
  if (/\b(cette semaine|la semaine)\b/.test(full)) weekRange = 'week';
  take(/\bsemaine prochaine\b/, () => { weekRange = 'next'; });

  // ----- heures -----
  const H = '(\\d{1,2})(?:\\s?h\\s?|:)(\\d{2})?';
  take(new RegExp(`\\b(?:de |entre )?${H}\\s?(?:a|-|et|jusqu'a)\\s?${H}`), m => {
    time = [+m[1], +(m[2] || 0)]; endTime = [+m[3], +(m[4] || 0)];
  }) ||
  (!time && take(new RegExp(`\\b(?:a |vers |des |pour )?${H}(?!\\d)`), m => { time = [+m[1], +(m[2] || 0)]; })) ||
  take(/\b(?:a |vers )?midi\b/, () => { time = [12, 0]; }) ||
  take(/\b(?:a )?minuit\b/, () => { time = [23, 59]; });
  if (time && !endTime) {
    take(new RegExp(`\\b(?:a|jusqu'a|-)\\s?${H}`), m => { endTime = [+m[1], +(m[2] || 0)]; });
  }
  if (!endTime) take(/\b(?:pendant|pour|durant|duree de|duree)\s+(\d+)h(\d{2})?\b/, m => { dur = +m[1] * 60 + +(m[2] || 0); }) ||
    take(/\b(?:pendant|pour|durant|duree)?\s?(\d+(?:[.,]\d)?|une|deux|trois)\s?(h|heures?|min|minutes?)\b(?!\s?\d)/, m => {
      const n = m[1] === 'une' ? 1 : m[1] === 'deux' ? 2 : m[1] === 'trois' ? 3 : parseFloat(m[1].replace(',', '.'));
      dur = m[2].startsWith('h') ? n * 60 : n;
    });
  if (time && part === 19 && time[0] < 12) time[0] += 12; // « ce soir à 8h » = 20h
  const partTime = !time && part != null;
  if (!time && part != null) time = [part, 0];

  // ----- intention -----
  t = full;
  let intent = 'event';
  if (/^(dis[- ]moi|je fais quoi|j'ai (quelque chose|des trucs|un truc|cours|quoi)|j'ai de prevu|quel est mon|c'est quoi mon|qu'?est[- ]ce (que|qu')|qu'ai[- ]je|j'ai quoi|c'est quoi|quoi de prevu|montre|affiche|liste|quel(le)?s? |quand |combien |ai[- ]je |est[- ]ce que j'ai|mon programme|mes (examens|echeances|devoirs|rdv|rendez|cours|notes|taches))/.test(t) ||
      (/\?$/.test(t) && !/^(ajoute|mets|programme|planifie|cree|note|rappelle)/.test(t))) intent = 'query';
  else if (/\b(a rendre|rendre|deadline|date limite|echeance|avant (le |lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|\d)|tache|devoir|a faire|to ?do)\b/.test(t)) intent = 'task';
  else if (/^(note|noter|notes?\b|retiens|n'oublie pas|rappelle[- ]moi|pense a|souviens[- ]toi|idee)/.test(t) && !time) intent = explicitDay ? 'task' : 'note';
  else if (!time && !explicitDay) intent = 'note';

  // ----- titre : on retire les dates/heures et les verbes de commande -----
  let chars = src.split('');
  for (const [a, b] of spans) for (let i = a; i < b && i < chars.length; i++) chars[i] = '\u0000';
  let title = chars.join('').replace(/\u0000+/g, ' ');
  title = title
    .replace(/^\s*(peux[- ]tu|tu peux|stp|s'il te pla[iî]t)\s*/i, '')
    .replace(/^\s*(ajoute[rz]?|mets|mettre|met|programme[rz]?|planifie[rz]?|cr[ée]e[rz]?|cale[rz]?|bloque[rz]?|r[ée]serve[rz]?|inscris|note[rz]?|retiens|rappelle[- ]moi|n'oublie pas|pense [àa]|souviens[- ]toi)\s*(qu[e']\s*|de |d'|à |a )?/i, '')
    .replace(/\b(dans (mon|l'|le) (calendrier|agenda|planning)|sur (mon|l') ?(agenda|calendrier)|au calendrier|à l'agenda|stp|s'il te pla[iî]t)\b/gi, '')
    .replace(/^\s*(un|une|le|la|les|mon|ma|mes)\s+(?=(rdv|rendez|r[ée]union|cours|s[ée]ance|entra[iî]nement|appel|t[âa]che|note|rappel|exam))/i, '')
    .replace(/^\s*(rappel|note|t[âa]che)\s*:?\s*/i, '')
    .replace(/\b(avant|pour|le|à|a|de|du|vers|pendant|entre|et|ce|cet|cette)\s*$/i, '')
    .replace(/\s+(avant|pour|le|à|vers|de|du)\s+(?=[,.]|$)/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '')
    .trim();
  title = title.replace(/\b(avant|pour|le|à|a|de|du|vers|ce|cet|cette|et)\s*$/i, '').trim();
  // « … qui s'appelle Test » → le titre, c'est « Test »
  const named = /(?:qui s'appelle(?:ra)?|qui s'intitule|intitul[ée]e?s?|nomm[ée]e?s?|appel[ée]e?s?|avec (?:le|comme) (?:titre|nom))(?:\s*:\s*|\s+)(.+)$/i.exec(title);
  if (named) title = named[1];
  title = title
    .replace(/^(pour |un |une |le |la )+/i, '')
    .replace(/\b(un |une )?(nouvel(le)? |nouveau )?(événement|évènement|evenement|truc|chose|activité|activite|créneau|creneau)\b\s*/gi, '')
    .replace(/^(pour |un |une |de |d')+/i, '')
    .replace(/\s{2,}/g, ' ').replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '').trim();
  if (title) title = title[0].toUpperCase() + title.slice(1);

  // ----- construction -----
  let start = null, end = null, allDay = false;
  if (day || time) {
    let d = day ? new Date(day) : new Date(today);
    if (time) {
      d.setHours(time[0] % 24, time[1], 0, 0);
      if (!day && d < now) d = addDays(d, 1); // heure déjà passée → demain
      start = d.getTime();
      if (endTime) { const e = new Date(d); e.setHours(endTime[0] % 24, endTime[1], 0, 0); if (e <= d) e.setTime(e.getTime() + DAY); end = e.getTime(); }
      else end = start + (dur || 60) * MIN;
    } else {
      allDay = true; start = startOfDay(d).getTime(); end = start + DAY;
    }
  }
  return { intent, title, start, end, allDay, day, explicitDay, weekRange, hasTime: !!time, partTime, dur, allDayExplicit, relTime, src };
}
