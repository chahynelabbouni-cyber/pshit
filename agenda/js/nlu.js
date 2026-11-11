// Mise au propre de l'oral avant la compréhension :
// « quatorze heures trente » → « 14h30 », « 8 heures du soir » → « 20h », « midi et demi » → « 12h30 »,
// « jeudi non vendredi » → « vendredi », « rendez vous » → « rendez-vous »…

const UNITS = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, 'dix-sept': 17, 'dix sept': 17,
  'dix-huit': 18, 'dix huit': 18, 'dix-neuf': 19, 'dix neuf': 19, vingt: 20, 'vingt et un': 21, 'vingt-et-un': 21, 'vingt et une': 21, 'vingt-et-une': 21,
  'vingt-deux': 22, 'vingt deux': 22, 'vingt-trois': 23, 'vingt trois': 23, trente: 30, 'trente-cinq': 35,
  quarante: 40, 'quarante-cinq': 45, 'quarante cinq': 45, cinquante: 50, 'cinquante-cinq': 55,
};
const WORDS = Object.keys(UNITS).sort((a, b) => b.length - a.length).map(w => w.replace(/-/g, '[- ]')).join('|');
const W = `(${WORDS})`;
const wn = w => UNITS[w.toLowerCase().replace(/ /g, ' ')] ?? UNITS[w.toLowerCase().replace(/ /g, '-')] ?? UNITS[w.toLowerCase().replace(/-/g, ' ')];

export function normalizeSpoken(input) {
  let s = ' ' + input.replace(/[’]/g, "'").replace(/\s+/g, ' ').trim() + ' ';
  const R = (re, by) => { s = s.replace(re, by); };

  // politesse et tics de langage
  R(/\b(bonjour|salut|coucou|hey)\b[ ,!]*/gi, ' ');
  R(/\b(euh+|bah|ben|du coup|en fait|genre)\b[ ,]*/gi, ' ');
  R(/\b(s'il (te|vous) pla[iî]t|stp|svp|merci( beaucoup)?)\b[ ,.!]*/gi, ' ');
  R(/\baujourdhui\b/gi, "aujourd'hui");
  R(/\brendez vous\b/gi, 'rendez-vous');
  R(/\bapr[eè]s midi\b/gi, 'après-midi');
  R(/\bapres-demain|apres demain\b/gi, 'après-demain');

  // corrections en cours de phrase : « jeudi non vendredi », « 3 heures non 4 heures »
  R(/\b([\wéèû']+(?:\s+heures?)?)\s+(?:non|pardon|enfin non|euh non)\s+(?=[\wéèû])/gi, ' ');

  // nombres en lettres devant heures/minutes/jours
  R(new RegExp(`\\b${W}\\s+(heures?|minutes?|min|jours?|semaines?)\\b`, 'gi'), (m, w, u) => `${wn(w)} ${u}`);
  R(new RegExp(`\\b(\\d{1,2})\\s+heures?\\s+${W}\\b`, 'gi'), (m, h, w) => `${h}h${String(wn(w)).padStart(2, '0')}`);
  R(/\bune demi[- ]heure\b/gi, '30 minutes');
  R(/\bun quart d'heure\b/gi, '15 minutes');
  R(/\btrois quarts? d'heure\b/gi, '45 minutes');
  R(/\b(1|une) heure et demie?\b/gi, '1h30');
  R(/\b(\d+) heures? et demie?\b/gi, '$1h30');

  // midi / minuit
  R(/\bmidi et demie?\b/gi, '12h30');
  R(/\bmidi et quart\b/gi, '12h15');
  R(/\bmidi moins le quart\b/gi, '11h45');
  R(/\bce midi\b/gi, "aujourd'hui 12h");
  R(/(?<!apr[eè]s-)\bmidi\b/gi, '12h');
  R(/\bminuit\b/gi, '23h59');

  // « 14 heures 30 », « 9 heures »
  R(/\b(\d{1,2})\s?(?:heures?|h)\s?(\d{2})\b/gi, '$1h$2');
  R(/\b(\d{1,2})\s?heures?\b/gi, '$1h');
  R(/\b(\d{1,2})h\s?et demie?\b/gi, '$1h30');
  R(/\b(\d{1,2})h\s?et quart\b/gi, '$1h15');
  R(/\b(\d{1,2})h\s?moins le quart\b/gi, (m, h) => `${(+h + 23) % 24}h45`);
  R(/\b(\d{1,2})h\s?moins (\d{1,2})\b/gi, (m, h, mm) => `${(+h + 23) % 24}h${String(60 - +mm).padStart(2, '0')}`);

  // soir / après-midi / matin
  R(/\b(\d{1,2})h(\d{2})?\s+(du soir|de l'apr[eè]s-midi|de l'aprem|de l'apr[eè]m)\b/gi, (m, h, mm) => `${+h < 12 ? +h + 12 : h}h${mm || ''}`);
  R(/\b(\d{1,2})h(\d{2})?\s+(du matin|du mat)\b/gi, '$1h$2');

  // jours : « le jeudi », « ce vendredi », « vendredi qui vient », « jeudi 19 » → « le 19 »
  const J = '(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)';
  R(new RegExp(`\\b${J}\\s+(\\d{1,2})\\b(?!\\s?h|\\s?:|\\s?min)`, 'gi'), (m, d, n) => `le ${n}`);
  R(new RegExp(`\\b(?:le|ce)\\s+${J}\\b`, 'gi'), '$1');
  R(new RegExp(`\\b${J}\\s+qui vient\\b`, 'gi'), '$1');
  R(/\ble premier\b/gi, 'le 1er');

  return s.replace(/\s+/g, ' ').replace(/^[\s,.]+|[\s,.]+$/g, '').trim();
}

// Synonymes pour retrouver un événement existant à partir de ce qu'on dit
export const SYNONYMS = {
  medecin: ['dr', 'medecin', 'docteur', 'consultation', 'medecine'], docteur: ['dr', 'medecin', 'docteur', 'consultation'],
  doc: ['dr', 'medecin', 'docteur'], toubib: ['dr', 'medecin'], medical: ['dr', 'medecin', 'consultation'],
  compta: ['comptabilite', 'compta'], stats: ['statistiques'], stat: ['statistiques'], info: ['informatique', 'info'],
  infos: ['informatique'], conf: ['conference'], conference: ['conference'], marketing: ['marketing', 'marche'],
  controle: ['cc', 'controle', 'partiel', 'exam'], cc: ['cc', 'controle', 'partiel'], partiel: ['partiel', 'cc', 'examen'],
  exam: ['exam', 'cc', 'partiel', 'controle'], examen: ['exam', 'cc', 'partiel', 'controle'],
  entrainement: ['boxe', 'seance', 'entrainement'], sport: ['boxe', 'sport', 'muscu'], boxe: ['boxe'],
  droit: ['droit'], anglais: ['anglais'], bourse: ['bourse'], entrepreneuriat: ['entrepreneuriat'],
  dentiste: ['dentiste'], kine: ['kine'], ophtalmo: ['ophtalmo'], coiffeur: ['coiffeur'],
};
// mots qui ne suffisent pas à eux seuls à identifier un événement
export const WEAK = new Set(['td', 'cm', 'tp', 'cours', 'rdv', 'rendez', 'vous', 'seance', 'mon', 'ma', 'mes', 'le', 'la', 'les', 'de', 'du', 'des']);
