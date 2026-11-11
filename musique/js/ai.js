// Le Concierge : l'IA intégrée qui apprend tes goûts et compose tes playlists.
// - Analyse audio locale de chaque titre (tempo, énergie, brillance) : fonctionne hors ligne.
// - Historique d'écoute (heures, jours, titres passés) pour savoir ce que tu aimes et quand.
// - Option : Claude (clé API perso) pour comprendre des demandes libres.

const HKEY = 'onde.history';
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------
let history = load();
function load() { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } }
function save() { try { localStorage.setItem(HKEY, JSON.stringify(history.slice(-3000))); } catch { /* plein */ } }

export function logListen(id, { skipped = false, ratio = 1 } = {}) {
  history.push({ id, at: Date.now(), s: skipped ? 1 : 0, r: Math.round(ratio * 100) / 100 });
  if (history.length > 3200) history = history.slice(-3000);
  save();
}
// Récap d'écoute sur N jours : écoutes, minutes, artistes les plus écoutés
export function listenStats(tracksMap, days = 7) {
  const since = Date.now() - days * 864e5;
  let count = 0, sec = 0;
  const art = new Map();
  for (const e of history) {
    if (e.at < since || e.s) continue;
    const t = tracksMap.get(e.id);
    count++;
    if (t) {
      sec += (t.duration || 0) * (e.r || 1);
      if (t.artist && t.source !== 'radio') art.set(t.artist, (art.get(t.artist) || 0) + 1);
    }
  }
  return { count, minutes: Math.round(sec / 60), topArtists: [...art.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]) };
}
export function clearHistory() { history = []; save(); }
export const historySize = () => history.length;

// ---------------------------------------------------------------------
// Analyse audio (tempo / énergie / brillance)
// ---------------------------------------------------------------------
let actx;
export async function analyzeBlob(blob, type = '') {
  actx = actx || new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 22050);
  let part = blob;
  const isMp3 = /mpeg|mp3/.test(type) || /\.mp3$/i.test(blob.name || '');
  if (isMp3 && blob.size > 2.5e6) {
    // un extrait du milieu du morceau suffit (les trames MP3 se resynchronisent)
    const start = Math.floor(blob.size * 0.3);
    part = blob.slice(start, start + 1.6e6, type);
  } else if (blob.size > 40e6) {
    return null;
  }
  const buf = await actx.decodeAudioData(await part.arrayBuffer());
  const sr = buf.sampleRate;
  const ch = buf.getChannelData(0);
  // fenêtre d'analyse : 40 s maximum au milieu
  const len = Math.min(ch.length, sr * 40);
  const off = Math.max(0, Math.floor((ch.length - len) / 2));
  const hop = Math.round(sr / 100); // 10 ms
  const frames = Math.floor(len / hop);
  if (frames < 300) return null;
  const env = new Float32Array(frames);
  let sumSq = 0, zc = 0, prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const base = off + f * hop;
    for (let i = 0; i < hop; i++) {
      const v = ch[base + i];
      e += v * v;
      if ((v >= 0) !== (prev >= 0)) zc++;
      prev = v;
    }
    sumSq += e;
    env[f] = Math.sqrt(e / hop);
  }
  const rms = Math.sqrt(sumSq / (frames * hop));
  // flux d'énergie (onsets)
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1]);
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= frames;
  for (let f = 0; f < frames; f++) onset[f] = Math.max(0, onset[f] - mean);
  // autocorrélation entre 60 et 190 BPM
  let best = 0, bestLag = 50;
  for (let lag = 32; lag <= 100; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
    // légère préférence pour 90-130 BPM
    const bpm = 6000 / lag;
    const w = 1 - Math.min(0.25, Math.abs(bpm - 115) / 400);
    if (s * w > best) { best = s * w; bestLag = lag; }
  }
  let peak = 0;
  for (const v of onset) peak += v * v;
  const pulse = peak ? best / peak : 0; // régularité rythmique
  const bpm = Math.round(6000 / bestLag);
  const energy = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 32) / 26)); // -32 dB → 0, -6 dB → 1
  const bright = Math.max(0, Math.min(1, (zc / (frames * hop / sr)) / 6000));
  return { bpm, energy: +energy.toFixed(3), bright: +bright.toFixed(3), pulse: +Math.min(1, pulse * 3).toFixed(3) };
}

// ---------------------------------------------------------------------
// Profil de goût
// ---------------------------------------------------------------------
export function profile(tracks) {
  const now = Date.now();
  const byId = new Map(tracks.map(t => [t.id, t]));
  const aff = new Map();      // affinité par titre
  const hourW = new Map();    // affinité selon l'heure actuelle
  const artistW = new Map();
  const genreW = new Map();
  const h = new Date().getHours();
  const dow = new Date().getDay();
  for (const e of history) {
    const t = byId.get(e.id);
    if (!t) continue;
    const ageDays = (now - e.at) / 864e5;
    const decay = Math.exp(-ageDays / 45);
    const v = (e.s ? -0.8 : 0.4 + e.r * 0.6) * decay;
    aff.set(e.id, (aff.get(e.id) || 0) + v);
    const d = new Date(e.at);
    const dh = Math.min(Math.abs(d.getHours() - h), 24 - Math.abs(d.getHours() - h));
    if (dh <= 2 && !e.s) hourW.set(e.id, (hourW.get(e.id) || 0) + (1 - dh * 0.3) * (d.getDay() === dow ? 1.3 : 1) * decay);
    const a = t.artist || '';
    artistW.set(a, (artistW.get(a) || 0) + v);
    if (t.genre) genreW.set(t.genre, (genreW.get(t.genre) || 0) + v);
  }
  for (const t of tracks) {
    let base = (aff.get(t.id) || 0) + (t.liked ? 2.5 : 0) + Math.log1p(t.plays || 0) * 0.6;
    base += (artistW.get(t.artist || '') || 0) * 0.08;
    if (t.genre) base += (genreW.get(t.genre) || 0) * 0.05;
    aff.set(t.id, base);
  }
  return { aff, hourW, artistW, genreW };
}

// ---------------------------------------------------------------------
// Ambiances
// ---------------------------------------------------------------------
const GENRE_HINTS = {
  chill: /chill|lo-?fi|ambient|acoust|jazz|soul|r&b|rnb|folk|classi|piano|bossa|indie/,
  energy: /rock|metal|edm|electro|house|techno|drill|trap|dance|drum|dubstep|punk|hard/,
  party: /dance|house|pop|reggaeton|afro|dancehall|funk|disco|club|edm|rap|hip/,
  focus: /lo-?fi|ambient|classi|piano|instrument|jazz|soundtrack|chill|study/,
};
export const MOODS = {
  ecole:   { label: 'École · Focus', emoji: '✎', desc: 'Calme et régulier pour bosser sans décrocher', energy: [0.15, 0.6], bpm: [60, 125], bright: [0, 0.55], genre: 'focus', favor: 0.6 },
  sport:   { label: 'Énergie · Sport', emoji: '⚡', desc: 'Du rythme et de la puissance', energy: [0.55, 1], bpm: [110, 190], genre: 'energy', favor: 0.5 },
  chill:   { label: 'Chill', emoji: '☾', desc: 'Pour décompresser', energy: [0, 0.55], bpm: [55, 115], genre: 'chill', favor: 0.6 },
  soiree:  { label: 'Soirée', emoji: '✦', desc: 'Ambiance, ça bouge', energy: [0.5, 1], bpm: [95, 135], genre: 'party', favor: 0.7 },
  matin:   { label: 'Réveil en douceur', emoji: '☀', desc: 'Pour bien commencer la journée', energy: [0.3, 0.75], bpm: [85, 125], genre: 'party', favor: 0.8 },
  nuit:    { label: 'Nuit · Dodo', emoji: '✧', desc: 'Doux et apaisant', energy: [0, 0.4], bpm: [50, 100], genre: 'chill', favor: 0.5 },
  trajet:  { label: 'Trajet', emoji: '➝', desc: 'Tes sons préférés pour la route', energy: [0.3, 0.9], bpm: [80, 150], favor: 1.2 },
  decouverte: { label: 'À redécouvrir', emoji: '◇', desc: 'Des titres que tu écoutes peu', discover: true },
  favoris: { label: 'Tes incontournables', emoji: '♛', desc: 'Ce que tu écoutes le plus', favor: 2 },
  moment:  { label: 'Ton mix du moment', emoji: '◷', desc: 'Ce que tu écoutes à cette heure-ci', moment: true, favor: 1 },
};

function inRange(v, [a, b]) {
  if (v == null) return 0.5;
  if (v >= a && v <= b) return 1;
  const d = v < a ? a - v : v - b;
  return Math.max(0, 1 - d / ((b - a) || 1) * 2);
}

function moodScore(t, m, P) {
  const f = t.features;
  let s = 0;
  if (m.energy) s += inRange(f?.energy, m.energy) * 2;
  if (m.bpm) {
    let b = f?.bpm;
    if (b && m.bpm[1] < 120 && b > 140) b /= 2; // demi-tempo
    s += inRange(b, m.bpm) * 1.2;
  }
  if (m.bright) s += inRange(f?.bright, m.bright) * 0.6;
  if (m.genre && t.genre && GENRE_HINTS[m.genre].test(norm(t.genre))) s += 1.4;
  const a = P.aff.get(t.id) || 0;
  if (m.discover) s += 2 / (1 + (t.plays || 0)) + (t.liked ? 0.5 : 0) - Math.max(0, a) * 0.1;
  else s += Math.tanh(a / 3) * (m.favor ?? 0.6) * 2;
  if (m.moment) s += Math.tanh((P.hourW.get(t.id) || 0) / 2) * 3;
  return s + Math.random() * 0.6; // un peu de variété à chaque génération
}

// Ordonne la playlist pour un enchaînement fluide (montée progressive d'énergie)
function sequence(list, arc = 'flat') {
  if (list.length < 4 || !list.every(t => t.features)) return list;
  const sorted = list.slice().sort((a, b) => a.features.energy - b.features.energy);
  if (arc === 'rise') {
    // 2/3 montée puis redescente
    const up = sorted.filter((_, i) => i % 3 !== 2);
    const down = sorted.filter((_, i) => i % 3 === 2).reverse();
    return [...up, ...down];
  }
  if (arc === 'down') return sorted.reverse();
  // flat : évite deux titres du même artiste à la suite
  const out = [];
  const rest = list.slice();
  while (rest.length) {
    const i = rest.findIndex(t => t.artist !== out.at(-1)?.artist);
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

export function buildMix(tracks, moodKey, { minutes = 60, filter = null, P = profile(tracks) } = {}) {
  const m = MOODS[moodKey] || MOODS.moment;
  let pool = filter ? tracks.filter(filter) : tracks.slice();
  if (!pool.length) pool = tracks.slice();
  const scored = pool.map(t => ({ t, s: moodScore(t, m, P) })).sort((a, b) => b.s - a.s);
  const out = [];
  let total = 0;
  const perArtist = new Map();
  const maxPerArtist = Math.max(3, Math.ceil(pool.length / 8));
  for (const { t } of scored) {
    const n = perArtist.get(t.artist) || 0;
    if (n >= maxPerArtist && scored.length > 15) continue;
    out.push(t);
    perArtist.set(t.artist, n + 1);
    total += t.duration || 180;
    if (total >= minutes * 60) break;
  }
  const arc = moodKey === 'sport' || moodKey === 'soiree' ? 'rise' : moodKey === 'nuit' ? 'down' : 'flat';
  return { key: moodKey, name: m.label, desc: m.desc, emoji: m.emoji, tracks: sequence(out, arc) };
}

// ---------------------------------------------------------------------
// Compréhension des demandes (mode local)
// ---------------------------------------------------------------------
const INTENTS = [
  ['ecole', /ecole|cours|devoir|revis|exam|bac|brevet|etud|biblio|travail|taf|bosser|focus|concentr|lecture|lire|study/],
  ['sport', /sport|muscu|salle|gym|courir|course|run|footing|jogging|entrain|cardio|velo|boxe|foot|motiv|energ|hype|pump/],
  ['nuit', /dorm|dodo|sommeil|coucher|nuit|endorm|sieste|sleep/],
  ['chill', /chill|calme|detent|relax|repos|pluie|tranquil|doux|douce|apais|zen|pos(e|é)|cool/],
  ['soiree', /soiree|fete|party|danse|danser|ambiance|club|apero|anniv|teuf|son qui bouge/],
  ['matin', /matin|reveil|lever|petit[- ]dej|douche/],
  ['trajet', /trajet|voiture|route|bus|metro|train|transport|marche/],
  ['decouverte', /decouv|redecouv|nouveau|jamais|oubli|peu ecout/],
  ['favoris', /prefer|favori|meilleur|top|plus ecout|incontourn|classique/],
  ['moment', /maintenant|moment|en ce moment|tout de suite|ce soir|aujourd/],
];

export function hasIntent(text, tracks) {
  const n = norm(text);
  if (INTENTS.some(([, re]) => re.test(n))) return true;
  if (/\b(playlist|mix|son|sons|musique|ecouter)\b/.test(n)) return true;
  return tracks.some(t => (t.artist && t.artist.length > 2 && n.includes(norm(t.artist))) || (t.genre && t.genre.length > 2 && n.includes(norm(t.genre))));
}

export function understand(text, tracks) {
  const n = norm(text);
  let mood = null;
  for (const [k, re] of INTENTS) if (re.test(n)) { mood = k; break; }
  if (!mood) {
    const h = new Date().getHours();
    mood = h < 10 ? 'matin' : h >= 22 || h < 5 ? 'nuit' : 'moment';
  }
  let minutes = 60;
  const mm = n.match(/(\d+)\s*(h|heure|min)/);
  if (mm) minutes = mm[2].startsWith('h') ? +mm[1] * 60 : +mm[1];
  const nTitles = n.match(/(\d+)\s*(titre|son|morceau|chanson)/);
  // artistes / genres cités
  const artists = new Set(tracks.map(t => t.artist).filter(Boolean));
  const named = [...artists].filter(a => a.length > 2 && n.includes(norm(a)));
  const genres = new Set(tracks.map(t => t.genre).filter(Boolean));
  const namedG = [...genres].filter(g => g.length > 2 && n.includes(norm(g)));
  const only = /que|uniquement|seulement|juste/.test(n);
  let filter = null;
  if (named.length || namedG.length) {
    const set = new Set(named), gset = new Set(namedG);
    filter = t => set.has(t.artist) || gset.has(t.genre);
  }
  const play = /\b(lance|joue|mets|met|ecouter|play)\b/.test(n);
  const mix = buildMix(tracks, mood, { minutes, filter: only || named.length ? filter : null });
  if (nTitles) mix.tracks = mix.tracks.slice(0, +nTitles[1]);
  if (named.length && !only) {
    // ajoute en priorité les artistes cités
    const extra = tracks.filter(t => named.includes(t.artist) && !mix.tracks.includes(t)).slice(0, 8);
    mix.tracks = [...extra, ...mix.tracks].slice(0, Math.max(mix.tracks.length, extra.length));
  }
  if (named.length) mix.name = `${mix.name} · ${named.slice(0, 2).join(' & ')}`;
  return { mix, play, mood };
}

// ---------------------------------------------------------------------
// Mode Claude (optionnel, avec ta propre clé API)
// ---------------------------------------------------------------------
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const MODEL = 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'playlist_name', 'playlist_description', 'track_numbers', 'play_now'],
  properties: {
    reply: { type: 'string', description: 'Réponse courte et chaleureuse à l\'utilisateur, en français.' },
    playlist_name: { type: 'string', description: 'Nom stylé de la playlist (vide si aucune playlist demandée).' },
    playlist_description: { type: 'string' },
    track_numbers: { type: 'array', items: { type: 'integer' }, description: 'Numéros des titres du catalogue, dans l\'ordre de lecture.' },
    play_now: { type: 'boolean', description: 'true si l\'utilisateur demande de lancer la lecture tout de suite.' },
  },
};

function catalog(tracks, P) {
  return tracks.slice(0, 4000).map((t, i) => {
    const f = t.features;
    const bits = [`${i + 1}`, t.title, t.artist || '?'];
    if (t.genre) bits.push(t.genre);
    if (f) bits.push(`${f.bpm}bpm`, `E${Math.round(f.energy * 10)}`);
    const a = P.aff.get(t.id) || 0;
    if (a > 0.5) bits.push(`aime${Math.min(9, Math.round(a))}`);
    if (P.hourW.get(t.id)) bits.push('heure');
    if (t.liked) bits.push('♥');
    return bits.join(' | ');
  }).join('\n');
}

export async function askClaude(apiKey, userText, tracks, chat = []) {
  const { default: Anthropic } = await import(SDK_URL);
  // L'appel part directement du téléphone avec la clé de l'utilisateur : rien ne transite ailleurs.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const P = profile(tracks);
  const now = new Date();
  const system = [
    'Tu es « le Concierge », l\'assistant musical intégré au lecteur de musique personnel de l\'utilisateur.',
    'Tu connais toute sa bibliothèque (ci-dessous) et ses habitudes d\'écoute. Tu composes des playlists uniquement avec les titres du catalogue, en citant leurs numéros.',
    'Pense ambiance, énergie (E0 calme → E10 intense), tempo, genre et goûts (« aime » = souvent écouté, « heure » = écouté à cette heure-ci, ♥ = liké).',
    'Ordonne les titres pour un bel enchaînement. Vise environ 45-60 minutes sauf demande contraire. Si la demande n\'est pas une playlist, réponds simplement et laisse track_numbers vide.',
    'Ton : élégant, complice, bref (2 phrases max), en français.',
    '',
    'Catalogue (numéro | titre | artiste | genre | tempo | énergie | signaux) :',
    catalog(tracks, P),
  ].join('\n');
  const messages = [
    ...chat.slice(-6),
    { role: 'user', content: `[${now.toLocaleDateString('fr-FR', { weekday: 'long' })} ${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}] ${userText}` },
  ];
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  });
  if (res.stop_reason === 'refusal') throw new Error('Le Concierge ne peut pas répondre à cette demande.');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const out = JSON.parse(text);
  const list = (out.track_numbers || []).map(n => tracks[n - 1]).filter(Boolean);
  return {
    reply: out.reply,
    play: !!out.play_now,
    mix: list.length ? { key: 'ai', name: out.playlist_name || 'Sélection du Concierge', desc: out.playlist_description || '', emoji: '✦', tracks: [...new Set(list)] } : null,
  };
}


// ---------------------------------------------------------------------
// Mode agent : Claude pilote toute l'application avec des outils
// ---------------------------------------------------------------------
const obj = (props, req = Object.keys(props)) => ({ type: 'object', additionalProperties: false, properties: props, required: req });
export const AGENT_TOOLS = [
  { name: 'play', description: 'Cherche et lance de la musique, une radio ou un podcast. source=auto essaie la bibliothèque, puis YouTube, puis les radios.', input_schema: obj({ query: { type: 'string', description: 'Titre, artiste, album, genre, nom de radio ou de podcast' }, source: { type: 'string', enum: ['auto', 'library', 'youtube', 'radio', 'podcast'] } }) },
  { name: 'control', description: 'Contrôle la lecture en cours.', input_schema: obj({ action: { type: 'string', enum: ['pause', 'resume', 'next', 'previous', 'restart', 'shuffle_on', 'shuffle_off', 'repeat_one', 'repeat_off', 'like', 'open_player', 'show_lyrics', 'show_queue'] } }) },
  { name: 'set_volume', description: 'Règle le volume (0 à 100).', input_schema: obj({ percent: { type: 'integer' } }) },
  { name: 'set_equalizer', description: 'Choisit un préréglage d\'égaliseur (fichiers importés).', input_schema: obj({ preset: { type: 'string', enum: ['normal', 'basses', 'basses2', 'voix', 'aigus', 'soiree', 'douce'] } }) },
  { name: 'seek', description: 'Avance (secondes positives) ou recule (négatives) dans le morceau en cours.', input_schema: obj({ seconds: { type: 'integer' } }) },
  { name: 'sleep_timer', description: 'Arrête la musique après X minutes (0 = annuler).', input_schema: obj({ minutes: { type: 'integer' } }) },
  { name: 'play_news', description: 'Lance les infos : dernier journal (live=false) ou radio d\'info en direct (live=true).', input_schema: obj({ station: { type: 'string', enum: ['franceinfo', 'inter', 'rfi'] }, live: { type: 'boolean' } }) },
  { name: 'make_playlist', description: 'Crée une playlist à partir des numéros du catalogue de la bibliothèque, la lance et/ou l\'enregistre.', input_schema: obj({ name: { type: 'string' }, track_numbers: { type: 'array', items: { type: 'integer' } }, play: { type: 'boolean' }, save: { type: 'boolean' } }) },
  { name: 'queue_add', description: 'Cherche un son (bibliothèque puis YouTube) et l\'ajoute à la file d\'attente, en prochain ou à la fin.', input_schema: obj({ query: { type: 'string' }, next: { type: 'boolean' } }) },
  { name: 'add_current_to_playlist', description: 'Ajoute le son en cours à une playlist (créée si elle n\'existe pas).', input_schema: obj({ playlist: { type: 'string' } }) },
  { name: 'now_playing', description: 'Infos sur ce qui joue, la file d\'attente et le volume.', input_schema: obj({}) },
  { name: 'navigate', description: 'Ouvre un écran de l\'application.', input_schema: obj({ screen: { type: 'string', enum: ['home', 'search', 'library', 'concierge', 'settings', 'liked'] } }) },
];

export async function runAgent(apiKey, userText, { tracks, chat = [], context = '', exec }) {
  const { default: Anthropic } = await import(SDK_URL);
  // Appel direct depuis le téléphone avec la clé de l'utilisateur
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const P = profile(tracks);
  const now = new Date();
  const system = [
    'Tu es « le Concierge », l\'assistant intégré à l\'application de musique personnelle de l\'utilisateur (son prénom et le nom de l\'app sont dans le contexte). Tu parles français, avec élégance et complicité, en une ou deux phrases courtes (ta réponse est souvent lue à voix haute).',
    'Tu as la main sur toute l\'application grâce à tes outils : lancer n\'importe quel son (bibliothèque, YouTube, radios, podcasts), contrôler la lecture, le volume, l\'égaliseur, le minuteur, les infos, la file d\'attente, les playlists et la navigation. Agis directement avec les outils plutôt que de demander confirmation, sauf si la demande est vraiment ambiguë.',
    'Tu connais aussi la musique en général : tu peux parler des artistes, des albums, de l\'histoire d\'un morceau, recommander des sons similaires et les lancer.',
    'Pour un style (« de la musique classique », « du rap US des années 90 »), choisis toi-même de bons titres ou artistes et lance-les avec play (source youtube ou auto). Pour une ambiance, compose une playlist depuis le catalogue si la bibliothèque convient, sinon utilise YouTube ou une radio.',
    `Contexte : ${context}`,
    '',
    'Catalogue de la bibliothèque (numéro | titre | artiste | genre | tempo | énergie | signaux) :',
    catalog(tracks, P) || '(vide)',
  ].join('\n');
  const messages = [
    ...chat.slice(-8),
    { role: 'user', content: `[${now.toLocaleDateString('fr-FR', { weekday: 'long' })} ${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}] ${userText}` },
  ];
  const tools = AGENT_TOOLS.map(t => ({ ...t, strict: true }));
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 4000, system, messages, tools, tool_choice: { type: 'auto' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low' },
    });
    if (res.stop_reason === 'refusal') return 'Je ne peux pas faire ça.';
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter(b => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      return res.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim() || 'C\'est fait.';
    }
    const results = [];
    for (const u of uses) {
      let out;
      try { out = await exec(u.name, u.input || {}); } catch (e) { out = { error: String(e.message || e) }; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
  }
  return 'C\'est fait.';
}
