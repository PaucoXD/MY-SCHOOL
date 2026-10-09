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
