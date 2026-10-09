// Seguimiento de progreso: guarda cada intento y calcula el dominio por habilidad.
import fs from "node:fs";
import path from "node:path";

export const TRACKS = ["english", "programming"];

// Peso del intento más reciente en la media móvil de dominio (0-100).
const MASTERY_ALPHA = 0.35;
const MAX_HISTORY = 500;
const MAX_MISTAKES_PER_SKILL = 5;

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
    if (t.score >= 70) s.correct += 1;
    s.mastery = s.mastery === null ? t.score : Math.round(s.mastery * (1 - MASTERY_ALPHA) + t.score * MASTERY_ALPHA);
    s.lastSeen = date;
    if (t.score < 70 && t.mistake) {
      s.mistakes.unshift(t.mistake);
      s.mistakes = s.mistakes.slice(0, MAX_MISTAKES_PER_SKILL);
    }
    state.skills[key] = s;
  }

  state.history.push({ date, track, skill, score });
  if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
  return state;
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

export function trackSummary(state, track) {
  const skills = skillsForTrack(state, track);
  const recent = state.history.filter((h) => h.track === track).slice(-20);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    track,
    skillsPracticed: skills.length,
    totalAttempts: state.history.filter((h) => h.track === track).length,
    averageMastery: avg(skills.map((s) => s.mastery)),
    recentAverageScore: avg(recent.map((h) => h.score)),
    weakest: weakestSkills(state, track, 5).map(({ name, mastery, attempts, mistakes }) => ({ name, mastery, attempts, mistakes })),
    strongest: skills
      .sort((a, b) => b.mastery - a.mastery)
      .slice(0, 3)
      .map(({ name, mastery }) => ({ name, mastery })),
  };
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
