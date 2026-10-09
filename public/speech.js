// Voz en el navegador: reconocimiento (tú hablas) y síntesis (el nativo habla).
// Usa las APIs del navegador, sin coste: el reconocimiento funciona en Chrome, Edge y Safari
// (en Firefox no; ahí se escribe). Necesita HTTPS o localhost para usar el micrófono.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = Boolean(Recognition);
export const canSpeak = "speechSynthesis" in window;

export const ACCENT_LANG = { us: "en-US", uk: "en-GB", au: "en-AU" };

const RECOGNITION_ERRORS = {
  "not-allowed": "No hay permiso para usar el micrófono. Actívalo en el navegador (y abre la app con https o en localhost).",
  "service-not-allowed": "El navegador no permite el reconocimiento de voz aquí. Prueba en Chrome o escribe tu respuesta.",
  "no-speech": "No te he oído. Pulsa el micrófono y habla.",
  "audio-capture": "No encuentro ningún micrófono.",
  network: "El reconocimiento de voz necesita conexión a internet.",
};

// Escucha una intervención. `onInterim` recibe el texto parcial mientras hablas.
// Devuelve { promise, stop }: la promesa se resuelve con el texto final ("" si no dijiste nada).
export function listen({ lang = "en-US", onInterim } = {}) {
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      onInterim?.((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "aborted" || (e.error === "no-speech" && finalText)) return;
      reject(new Error(RECOGNITION_ERRORS[e.error] ?? `Error del micrófono: ${e.error}`));
    };
    rec.onend = () => resolve(finalText.trim());
  });
  rec.start();
  return { promise, stop: () => rec.stop() };
}

let voicesReady;
function voices() {
  voicesReady ??= new Promise((resolve) => {
    const list = speechSynthesis.getVoices();
    if (list.length) return resolve(list);
    speechSynthesis.addEventListener("voiceschanged", () => resolve(speechSynthesis.getVoices()), { once: true });
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
  });
  return voicesReady;
}

// Prefiere voces de calidad ("Natural", "Google", "Premium"...) del acento elegido.
async function pickVoice(lang) {
  const list = (await voices()).filter((v) => v.lang.replace("_", "-").startsWith(lang));
  const rank = (v) => (/natural|neural|premium|enhanced/i.test(v.name) ? 0 : /google|samantha|daniel|karen|siri/i.test(v.name) ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export async function speak(text, { accent = "us", rate = 1 } = {}) {
  if (!canSpeak || !text) return;
  speechSynthesis.cancel();
  const lang = ACCENT_LANG[accent] ?? "en-US";
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const voice = await pickVoice(lang);
  if (voice) u.voice = voice;
  return new Promise((resolve) => {
    // Algunos navegadores no emiten "end" en textos largos: margen de seguridad según la longitud.
    const timer = setTimeout(resolve, 3000 + (text.length * 120) / rate);
    u.onend = u.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
}
