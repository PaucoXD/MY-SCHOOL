// Situaciones reales para practicar conversación con un "nativo".
// `character` describe a quién interpreta la IA; `goal` es lo que el alumno debe conseguir.
export const SCENARIOS = [
  {
    id: "coffee",
    emoji: "☕",
    title: "Pedir en una cafetería",
    goal: "Pide una bebida y algo de comer a tu gusto, pregunta algo sobre el menú y paga.",
    character: "a friendly, fast-talking barista at a busy coffee shop. Ask the usual questions (size, milk, for here or to go, name for the cup).",
  },
  {
    id: "small-talk",
    emoji: "👋",
    title: "Small talk con un desconocido",
    goal: "Mantén una charla ligera: el tiempo, de dónde eres, a qué te dedicas, planes del fin de semana.",
    character: "a chatty local waiting next to the student (at a bus stop, in a line or at a party). Keep it casual and curious.",
  },
  {
    id: "new-friend",
    emoji: "🍻",
    title: "Hacer amigos",
    goal: "Conoce a alguien en una quedada, encontrad cosas en común y quedad para otro día.",
    character: "an easygoing person in their late twenties met at a meetup. Uses casual slang, jokes a bit, shares opinions and asks back.",
  },
  {
    id: "directions",
    emoji: "🗺️",
    title: "Pedir indicaciones",
    goal: "Pregunta cómo llegar a un sitio, entiende las indicaciones y confirma que lo has entendido.",
    character: "a local who gives directions naturally, with landmarks and expressions like 'hang a left', 'you can't miss it'.",
  },
  {
    id: "restaurant",
    emoji: "🍽️",
    title: "En un restaurante",
    goal: "Pide mesa, pregunta recomendaciones, pide con alguna alergia o cambio, y resuelve un problema con el plato.",
    character: "a server at a casual restaurant. Natural and polite, checks in during the meal, handles a mix-up with the order.",
  },
  {
    id: "job-interview",
    emoji: "💼",
    title: "Entrevista de trabajo",
    goal: "Preséntate, habla de tu experiencia y responde preguntas típicas de entrevista con seguridad.",
    character: "a hiring manager at a tech company running a friendly but real job interview (behavioral questions, follow-ups).",
  },
  {
    id: "doctor",
    emoji: "🩺",
    title: "En el médico",
    goal: "Explica tus síntomas, responde a las preguntas y entiende las instrucciones del tratamiento.",
    character: "a family doctor asking about symptoms, history and giving advice in plain everyday language.",
  },
  {
    id: "phone-call",
    emoji: "📞",
    title: "Llamada para resolver un problema",
    goal: "Llama a atención al cliente por un problema (internet, un pedido, una reserva) y consigue una solución.",
    character: "a customer service agent on the phone. Follows a script at first, asks to verify details, puts the student 'on hold'.",
  },
  {
    id: "work-meeting",
    emoji: "🧑‍💻",
    title: "Reunión de trabajo (dev)",
    goal: "Participa en un stand-up: cuenta qué hiciste, en qué estás bloqueado y opina sobre una decisión técnica.",
    character: "a teammate leading a software team stand-up. Uses workplace English: 'blocker', 'circle back', 'ship it', 'sync up'.",
  },
];

export function findScenario(id) {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

export const ACCENTS = {
  us: "American (US) English",
  uk: "British (UK) English",
  au: "Australian English",
};
