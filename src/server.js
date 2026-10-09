import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  Store, TRACKS, addPhrases, duePhrases, dueSkills, skillKey, learnerContext, recordAttempt, reviewPhrase, trackSummary, skillsForTrack,
} from "./progress.js";
import { AIError, analyzeProgress, chat, conversationSummary, conversationTurn, generateExercise, gradeAnswer } from "./ai.js";
import { ACCENTS, SCENARIOS, findScenario } from "./scenarios.js";
import { runTests, runtimeFor, validFunctionName } from "./runner.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = new Store(process.env.DATA_FILE || path.join(root, "data", "progress.json"));
// Ejercicios pendientes de respuesta (la respuesta de referencia no se envía al navegador).
const pending = new Map();

const app = express();

// Si publicas la app en internet, pon APP_PASSWORD para que nadie más use tu clave de la API
// ni ejecute código en tu servidor. El navegador pedirá usuario (cualquiera) y contraseña.
const password = process.env.APP_PASSWORD;
if (password) {
  const expected = crypto.createHash("sha256").update(password).digest();
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    const given = scheme === "Basic" ? Buffer.from(encoded ?? "", "base64").toString().split(":").slice(1).join(":") : "";
    if (crypto.timingSafeEqual(crypto.createHash("sha256").update(given).digest(), expected)) return next();
    res.set("WWW-Authenticate", 'Basic realm="MY-SCHOOL", charset="UTF-8"').status(401).send("Contraseña necesaria");
  });
}

app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(root, "public")));

function requireTrack(req, res) {
  const track = req.body?.track ?? req.query.track;
  if (!TRACKS.includes(track)) {
    res.status(400).json({ error: "track debe ser 'english' o 'programming'" });
    return null;
  }
  return track;
}

app.get("/api/progress", (req, res) => {
  const { profile } = store.state;
  res.json({
    profile,
    tracks: Object.fromEntries(
      TRACKS.map((t) => [t, { ...trackSummary(store.state, t), skills: skillsForTrack(store.state, t) }]),
    ),
    history: store.state.history.slice(-60),
  });
});

app.put("/api/profile", (req, res) => {
  const allowed = ["name", "englishLevel", "programmingLanguage", "programmingLevel", "goals"];
  for (const k of allowed) {
    if (typeof req.body?.[k] === "string") store.state.profile[k] = req.body[k].slice(0, 500);
  }
  store.save();
  res.json(store.state.profile);
});

// Elige el repaso más urgente, evitando repetir la habilidad del último ejercicio si hay otras pendientes.
function pickReview(track) {
  const due = dueSkills(store.state, track);
  const last = store.state.history.findLast((h) => h.track === track)?.skill;
  return due.find((s) => s.name !== last) ?? due[0] ?? null;
}

// Quita el bloque ```lenguaje ... ``` si la IA envolvió el código en markdown.
function stripFences(code) {
  const m = /^\s*```[\w+-]*\n([\s\S]*?)\n?```\s*$/.exec(code);
  return m ? m[1] : code;
}

function parsesAsJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Comprueba los tests ejecutando la solución de referencia de la IA y se queda solo con los que pasa.
// Devuelve null si el ejercicio no es válido para ejecutar (y hay que regenerarlo), con el motivo.
async function verifyTests(exercise, runtime) {
  exercise.reference_answer = stripFences(exercise.reference_answer);
  if (!validFunctionName(exercise.function_name)) return { reason: `nombre de función no válido "${exercise.function_name}"` };
  const tests = exercise.tests.filter(
    (t) => parsesAsJson(t.expected_json) && parsesAsJson(t.args_json) && Array.isArray(JSON.parse(t.args_json)),
  );
  const run = await runTests({ runtime, code: exercise.reference_answer, functionName: exercise.function_name, tests });
  const good = run.results.filter((r) => r.passed).map(({ description, args_json, expected_json }) => ({ description, args_json, expected_json }));
  if (good.length < 2) {
    const failed = run.results.find((r) => !r.passed);
    return { reason: run.error ?? `la solución de referencia no pasa sus propios tests (p. ej. "${failed?.description}": dio ${failed?.actual ?? failed?.error}, se esperaba ${failed?.expected_json})` };
  }
  return { tests: good };
}

async function createExercise({ track, focus, review }) {
  const runtime = track === "programming" ? runtimeFor(store.state.profile.programmingLanguage) : null;
  let retryReason;
  for (let attempt = 0; attempt < 2; attempt++) {
    const exercise = await generateExercise({ track, focus, review, runtime, retryReason, context: learnerContext(store.state, track) });
    if (!runtime || exercise.tests.length === 0) {
      return { ...exercise, function_name: "", starter_code: "", tests: [], runtime: null };
    }
    const verified = await verifyTests(exercise, runtime);
    if (verified.tests) return { ...exercise, tests: verified.tests, runtime };
    retryReason = verified.reason;
    console.warn(`Ejercicio descartado: ${retryReason}`);
  }
  throw new AIError("La IA generó un ejercicio con tests incorrectos. Inténtalo de nuevo.");
}

app.post("/api/exercise", async (req, res, next) => {
  const track = requireTrack(req, res);
  if (!track) return;
  try {
    const focus = typeof req.body.focus === "string" ? req.body.focus.trim().slice(0, 200) : "";
    // Sin tema pedido, primero van los repasos pendientes; `mode: "new"` los salta para aprender algo nuevo.
    const review = focus || req.body.mode === "new" ? null : pickReview(track);
    const exercise = await createExercise({ track, focus, review });
    if (review) exercise.skill = review.name;
    const id = crypto.randomUUID();
    pending.set(id, { ...exercise, track });
    if (pending.size > 50) pending.delete(pending.keys().next().value);
    const { reference_answer, ...visible } = exercise;
    res.json({ id, track, isReview: Boolean(review), ...visible });
  } catch (err) {
    next(err);
  }
});

// Ejecuta el código del alumno con los tests del ejercicio (para probar antes de enviar).
app.post("/api/run", async (req, res, next) => {
  const exercise = pending.get(req.body?.id);
  if (!exercise) return res.status(404).json({ error: "Ejercicio no encontrado o ya respondido." });
  if (!exercise.runtime) return res.status(400).json({ error: "Este ejercicio no tiene tests." });
  try {
    res.json(await runStudentCode(exercise, String(req.body.code ?? "").slice(0, 20000)));
  } catch (err) {
    next(err);
  }
});

function runStudentCode(exercise, code) {
  return runTests({ runtime: exercise.runtime, code, functionName: exercise.function_name, tests: exercise.tests });
}

// Los tests mandan: si pasan todos, al menos aprobado; si falla alguno, no puede aprobar.
function applyTestResults(grade, testRun) {
  if (!testRun) return grade;
  const allPassed = !testRun.error && testRun.passed === testRun.total;
  const score = allPassed ? Math.max(grade.score, 70) : Math.min(grade.score, 69);
  let verdict = grade.verdict;
  if (allPassed && verdict === "incorrecto") verdict = "casi";
  if (!allPassed && verdict === "correcto") verdict = "casi";
  return { ...grade, score, verdict };
}

app.post("/api/answer", async (req, res, next) => {
  const exercise = pending.get(req.body?.id);
  if (!exercise) return res.status(404).json({ error: "Ejercicio no encontrado o ya respondido." });
  const answer = String(req.body.answer ?? "").slice(0, 20000);
  if (!answer.trim()) return res.status(400).json({ error: "Escribe una respuesta." });
  try {
    const testRun = exercise.runtime ? await runStudentCode(exercise, answer) : null;
    const grade = applyTestResults(
      await gradeAnswer({ exercise, answer, testRun, context: learnerContext(store.state, exercise.track) }),
      testRun,
    );
    pending.delete(req.body.id);
    recordAttempt(store.state, {
      track: exercise.track,
      skill: exercise.skill,
      score: Math.max(0, Math.min(100, grade.score)),
      mistake: grade.mistake_summary,
      errorSkills: grade.other_weak_skills,
    });
    store.save();
    const { dueAt, intervalDays } = store.state.skills[skillKey(exercise.track, exercise.skill)];
    res.json({
      ...grade,
      reference_answer: exercise.reference_answer,
      skill: exercise.skill,
      testRun,
      nextReview: { dueAt, intervalDays },
      dueCount: dueSkills(store.state, exercise.track).length,
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/insights", async (req, res, next) => {
  const track = requireTrack(req, res);
  if (!track) return;
  try {
    res.json(await analyzeProgress({ track, context: learnerContext(store.state, track) }));
  } catch (err) {
    next(err);
  }
});

// Historial que llega del navegador → solo mensajes user/assistant con texto.
function cleanMessages(messages, limit = 30) {
  return (Array.isArray(messages) ? messages.slice(-limit) : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 10000) }));
}

app.post("/api/chat", async (req, res, next) => {
  const clean = cleanMessages(req.body?.messages);
  if (clean.at(-1)?.role !== "user") return res.status(400).json({ error: "Falta tu mensaje." });
  try {
    res.json({ reply: await chat({ messages: clean, context: learnerContext(store.state) }) });
  } catch (err) {
    next(err);
  }
});

// ---------- Conversación con nativos ----------

app.get("/api/scenarios", (req, res) => {
  res.json({ scenarios: SCENARIOS.map(({ id, emoji, title, goal }) => ({ id, emoji, title, goal })), accents: ACCENTS });
});

function conversationParams(req, res) {
  const scenario = findScenario(req.body?.scenarioId);
  if (!scenario) {
    res.status(400).json({ error: "Situación no válida." });
    return null;
  }
  const accent = ACCENTS[req.body.accent] ?? ACCENTS.us;
  return { scenario, accent, level: store.state.profile.englishLevel, messages: cleanMessages(req.body.messages, 60) };
}

app.post("/api/conversation/turn", async (req, res, next) => {
  const params = conversationParams(req, res);
  if (!params) return;
  if (params.messages.length && params.messages.at(-1).role !== "user") return res.status(400).json({ error: "Falta tu mensaje." });
  try {
    res.json(await conversationTurn(params));
  } catch (err) {
    next(err);
  }
});

app.post("/api/conversation/end", async (req, res, next) => {
  const params = conversationParams(req, res);
  if (!params) return;
  if (params.messages.filter((m) => m.role === "user").length < 2) {
    return res.status(400).json({ error: "Habla un poco más (al menos 2 intervenciones) para poder evaluarte." });
  }
  try {
    const summary = await conversationSummary({ ...params, context: learnerContext(store.state, "english") });
    for (const s of summary.skills) {
      recordAttempt(store.state, { track: "english", skill: s.skill, score: Math.max(0, Math.min(100, s.score)), mistake: s.mistake });
    }
    const added = addPhrases(store.state, summary.native_phrases, { scenario: params.scenario.id });
    store.save();
    res.json({ ...summary, phrasesAdded: added.length });
  } catch (err) {
    next(err);
  }
});

app.get("/api/phrases", (req, res) => {
  const all = store.state.phrases ?? [];
  res.json({ total: all.length, due: duePhrases(store.state) });
});

app.post("/api/phrases/review", (req, res) => {
  const answer = String(req.body?.answer ?? "").slice(0, 1000);
  if (!answer.trim()) return res.status(400).json({ error: "Di o escribe la frase." });
  const result = reviewPhrase(store.state, req.body?.id, answer);
  if (!result) return res.status(404).json({ error: "Frase no encontrada." });
  store.save();
  res.json(result);
});

app.use((err, req, res, _next) => {
  console.error(err);
  if (err instanceof AIError) return res.status(502).json({ error: err.message });
  if (err instanceof Anthropic.AuthenticationError) {
    return res.status(500).json({ error: "Falta o no es válida la clave ANTHROPIC_API_KEY." });
  }
  if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Demasiadas peticiones. Espera un momento." });
  if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `Error de la API de Claude (${err.status}).` });
  res.status(500).json({ error: "Error interno. Revisa la consola del servidor." });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`MY-SCHOOL en http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Aviso: no hay ANTHROPIC_API_KEY. Crea un archivo .env (ver .env.example) o la IA no funcionará.");
  }
});
