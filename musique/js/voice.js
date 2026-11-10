// Mode vocal du Concierge : reconnaissance vocale + voix de synthèse (API du téléphone).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;

let rec = null;

// Écoute une phrase. onPartial reçoit le texte en direct. Résout avec le texte final ('' si rien).
export function listen({ onPartial, lang = 'fr-FR' } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('unsupported'));
    stopListening();
    rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onPartial?.((finalText + ' ' + interim).trim());
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      reject(new Error(e.error));
    };
    rec.onend = () => { rec = null; resolve(finalText.trim()); };
    try { rec.start(); } catch (e) { reject(e); }
  });
}

export function stopListening() {
  if (rec) { try { rec.stop(); } catch { /* ignore */ } }
}

let voice = null;
let prefs = { name: '', rate: 1.04 };
export function setVoicePrefs(p) { prefs = { ...prefs, ...p }; voice = null; }
export function frenchVoices() { return canSpeak ? speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang)) : []; }
function pickVoice() {
  if (voice) return voice;
  if (prefs.name) { voice = speechSynthesis.getVoices().find(v => v.name === prefs.name) || null; if (voice) return voice; }
  const vs = speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang));
  // privilégie les voix naturelles / de qualité si disponibles
  voice = vs.find(v => /natural|neural|premium|enhanced|amélioré/i.test(v.name))
    || vs.find(v => /fr-FR/i.test(v.lang) && /google|thomas|amelie|audrey|marie/i.test(v.name))
    || vs.find(v => /fr-FR/i.test(v.lang)) || vs[0] || null;
  return voice;
}
if (canSpeak) speechSynthesis.addEventListener?.('voiceschanged', () => { voice = null; });

export function speak(text) {
  return new Promise(resolve => {
    if (!canSpeak || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[«»✦♛◇◷]/g, ''));
    u.lang = 'fr-FR';
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = prefs.rate || 1.04;
    u.pitch = 1;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
    // sécurité : certains navigateurs n'envoient jamais onend
    setTimeout(resolve, Math.min(20000, 1500 + text.length * 90));
  });
}

export function stopSpeaking() { if (canSpeak) speechSynthesis.cancel(); }
