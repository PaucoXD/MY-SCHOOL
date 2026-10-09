// Seguimiento de progreso: guarda cada intento y calcula el dominio por habilidad.
import fs from "node:fs";
import path from "node:path";

export const TRACKS = ["english", "programming"];

// Peso del intento más reciente en la media móvil de dominio (0-100).
const MASTERY_ALPHA = 0.35;
const MAX_HISTORY = 500;
const MAX_MISTAKES_PER_SKILL = 5;

// Repetición espaciada (inspirada en SM-2): cada habilidad tiene un intervalo en
// días y una "facilidad" que lo multiplica tras cada acierto. Un fallo la deja
// para repasar ya mismo y reduce la facilidad.
const DAY_MS = 24 * 60 * 60 * 1000;
const PASS_SCORE = 70;
const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 180;

export function emptyState() {
  return {
    profile: {
      name: "",
      englishLevel: "A2",
      programmingLanguage: "JavaScript",
      programmingLevel: "principiante",
      goals: "",
    },
    skills: {},
    history: [],
    phrases: [],
  };
}

export function skillKey(track, skill) {
  return `${track}:${slugify(skill)}`;
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Registra el resultado de un ejercicio. `score` va de 0 a 100.
// `errorSkills` son habilidades adicionales donde el alumno falló (p. ej. un
// ejercicio de "past simple" donde además falló la ortografía).
export function recordAttempt(state, { track, skill, score, mistake, errorSkills = [] }, now = new Date()) {
  const date = now.toISOString();
  const touched = [{ skill, score, mistake }];
  for (const extra of errorSkills) {
    if (slugify(extra) !== slugify(skill)) touched.push({ skill: extra, score: Math.min(score, 40), mistake });
  }

  for (const t of touched) {
    const key = skillKey(track, t.skill);
    const s = state.skills[key] ?? {
      track,
      name: t.skill,
      attempts: 0,
      correct: 0,
      mastery: null,
      mistakes: [],
      lastSeen: null,
    };
    s.attempts += 1;
    if (t.score >= PASS_SCORE) s.correct += 1;
    s.mastery = s.mastery === null ? t.score : Math.round(s.mastery * (1 - MASTERY_ALPHA) + t.score * MASTERY_ALPHA);
    s.lastSeen = date;
    if (t.score < PASS_SCORE && t.mistake) {
      s.mistakes.unshift(t.mistake);
      s.mistakes = s.mistakes.slice(0, MAX_MISTAKES_PER_SKILL);
    }
    schedule(s, t.score, now);
    state.skills[key] = s;
  }

  state.history.push({ date, track, skill, score });
  if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
  return state;
}

// Calcula el próximo repaso de una habilidad según la nota obtenida.
export function schedule(s, score, now = new Date()) {
  let ease = s.ease ?? DEFAULT_EASE;
  let interval = s.intervalDays ?? 0;
  let streak = s.streak ?? 0;
  if (score >= PASS_SCORE) {
    streak += 1;
    // 85+ es un acierto claro; 70-84 un acierto con dudas, que crece más despacio.
    ease = Math.max(MIN_EASE, ease + (score >= 85 ? 0.1 : -0.15));
    if (streak === 1) interval = 1;
    else if (streak === 2) interval = score >= 85 ? 3 : 2;
    else interval = Math.round(interval * (score >= 85 ? ease : 1.2));
    interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, interval));
  } else {
    streak = 0;
    ease = Math.max(MIN_EASE, ease - 0.2);
    interval = 0;
    s.lapses = (s.lapses ?? 0) + 1;
  }
  s.ease = Math.round(ease * 100) / 100;
  s.intervalDays = interval;
  s.streak = streak;
  s.dueAt = new Date(now.getTime() + interval * DAY_MS).toISOString();
  return s;
}

// Una habilidad sin fecha de repaso (datos antiguos) cuenta como pendiente.
export function isDue(s, now = new Date()) {
  return !s.dueAt || new Date(s.dueAt) <= now;
}

// Repasos pendientes: primero los de menor dominio y, a igualdad, los más atrasados respecto a su intervalo.
export function dueSkills(state, track, now = new Date()) {
  const overdue = (s) => (s.dueAt ? (now - new Date(s.dueAt)) / DAY_MS / Math.max(1, s.intervalDays ?? 0) : Infinity);
  return skillsForTrack(state, track)
    .filter((s) => isDue(s, now))
    .sort((a, b) => a.mastery - b.mastery || overdue(b) - overdue(a));
}

export function skillsForTrack(state, track) {
  return Object.entries(state.skills)
    .filter(([, s]) => s.track === track)
    .map(([key, s]) => ({ key, ...s }));
}

// Habilidades más débiles primero; a igualdad, las que hace más tiempo que no se practican.
export function weakestSkills(state, track, limit = 5) {
  return skillsForTrack(state, track)
    .sort((a, b) => a.mastery - b.mastery || String(a.lastSeen).localeCompare(String(b.lastSeen)))
    .slice(0, limit);
}

export function trackSummary(state, track, now = new Date()) {
  const due = dueSkills(state, track, now);
  const skills = skillsForTrack(state, track);
  const recent = state.history.filter((h) => h.track === track).slice(-20);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    track,
    skillsPracticed: skills.length,
    totalAttempts: state.history.filter((h) => h.track === track).length,
    averageMastery: avg(skills.map((s) => s.mastery)),
    recentAverageScore: avg(recent.map((h) => h.score)),
    dueForReview: due.map((s) => s.name),
    weakest: weakestSkills(state, track, 5).map(({ name, mastery, attempts, mistakes }) => ({ name, mastery, attempts, mistakes })),
    strongest: skills
      .sort((a, b) => b.mastery - a.mastery)
      .slice(0, 3)
      .map(({ name, mastery }) => ({ name, mastery })),
  };
}

// ---------- Libreta de frases de nativo ----------

const CONTRACTIONS = {
  "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are", "he's": "he is", "she's": "she is",
  "it's": "it is", "that's": "that is", "what's": "what is", "there's": "there is", "here's": "here is",
  "i've": "i have", "you've": "you have", "we've": "we have", "they've": "they have",
  "i'll": "i will", "you'll": "you will", "we'll": "we will", "they'll": "they will", "it'll": "it will",
  "i'd": "i would", "you'd": "you would", "we'd": "we would", "they'd": "they would",
  "don't": "do not", "doesn't": "does not", "didn't": "did not", "can't": "can not", "cannot": "can not",
  "won't": "will not", "isn't": "is not", "aren't": "are not", "wasn't": "was not", "weren't": "were not",
  "haven't": "have not", "hasn't": "has not", "wouldn't": "would not", "couldn't": "could not", "shouldn't": "should not",
  "let's": "let us", "gonna": "going to", "wanna": "want to", "gotta": "got to",
  // Sin apóstrofo, como se suele teclear en el móvil.
  im: "i am", youre: "you are", theyre: "they are", thats: "that is", whats: "what is", ive: "i have",
  dont: "do not", doesnt: "does not", didnt: "did not", cant: "can not", isnt: "is not", arent: "are not",
  wasnt: "was not", havent: "have not", wouldnt: "would not", couldnt: "could not", shouldnt: "should not",
};

// Palabras normalizadas: minúsculas, sin puntuación y con contracciones expandidas,
// para que "I'm gonna" y "I am going to" cuenten igual.
export function phraseWords(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (CONTRACTIONS[w] ?? w.replace(/^'+|'+$/g, "")).split(" "))
    .filter(Boolean);
}

// Compara lo que dijo/escribió el alumno con la frase esperada (subsecuencia común más larga).
// Devuelve la nota 0-100 y, para cada palabra esperada, si la dijo.
export function comparePhrase(expected, answer) {
  const a = phraseWords(expected);
  const b = phraseWords(answer);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const words = [];
  for (let i = 0, j = 0; i < a.length; ) {
    if (j < b.length && a[i] === b[j]) {
      words.push({ word: a[i], ok: true });
      i++;
      j++;
    } else if (j < b.length && dp[i][j + 1] >= dp[i + 1][j]) {
      j++;
    } else {
      words.push({ word: a[i], ok: false });
      i++;
    }
  }
  const total = a.length + b.length;
  const score = total ? Math.round((200 * dp[0][0]) / total) : 0;
  return { score, words };
}

export function addPhrases(state, phrases, { scenario } = {}, now = new Date()) {
  state.phrases ??= [];
  const known = new Set(state.phrases.map((p) => phraseWords(p.phrase).join(" ")));
  const added = [];
  for (const p of phrases) {
    const norm = phraseWords(p.phrase).join(" ");
    if (!norm || known.has(norm)) continue;
    known.add(norm);
    const entry = {
      id: `${now.getTime().toString(36)}-${state.phrases.length}`,
      phrase: p.phrase,
      meaning_es: p.meaning_es,
      when_to_use_es: p.when_to_use_es,
      scenario: scenario ?? null,
      addedAt: now.toISOString(),
      dueAt: now.toISOString(),
      intervalDays: 0,
    };
    state.phrases.push(entry);
    added.push(entry);
  }
  return added;
}

export function duePhrases(state, now = new Date()) {
  return (state.phrases ?? []).filter((p) => isDue(p, now)).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
}

export function reviewPhrase(state, id, answer, now = new Date()) {
  const p = (state.phrases ?? []).find((x) => x.id === id);
  if (!p) return null;
  const result = comparePhrase(p.phrase, answer);
  p.reviews = (p.reviews ?? 0) + 1;
  schedule(p, result.score, now);
  return { ...result, phrase: p };
}

// Texto compacto con el perfil y el estado del alumno, para dárselo a la IA.
export function learnerContext(state, track) {
  const tracks = track ? [track] : TRACKS;
  return JSON.stringify({ profile: state.profile, progress: tracks.map((t) => trackSummary(state, t)) }, null, 2);
}

export class Store {
  constructor(file) {
    this.file = file;
    this.state = this.#load();
  }

  #load() {
    try {
      return { ...emptyState(), ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
    } catch {
      return emptyState();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
