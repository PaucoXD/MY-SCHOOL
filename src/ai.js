// Todas las llamadas a Claude: generar ejercicios, corregir, analizar progreso y chatear.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const client = new Anthropic();

// `fallbacks: "default"` hace que, si el modelo rechaza una petición por sus
// filtros de seguridad, la API la reintente en otro modelo automáticamente.
const BASE = {
  model: MODEL,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

const TRACK_LABEL = { english: "inglés", programming: "programación" };

const TUTOR_SYSTEM = `Eres el tutor personal de MY-SCHOOL, una app para aprender inglés y programación.
El alumno habla español. Explica en español; usa inglés en los ejemplos y ejercicios de inglés.
Recibes el perfil del alumno y su progreso (habilidades, dominio de 0 a 100 y errores recientes).
Úsalo para personalizar: refuerza lo que falla, no repitas lo que ya domina y sube la dificultad poco a poco.
Sé claro, motivador y concreto. Nada de relleno.`;

export class AIError extends Error {}

async function structured({ system, prompt, schema, effort = "medium", maxTokens = 8000 }) {
  const response = await client.beta.messages.create({
    ...BASE,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new AIError("La IA no pudo responder a esta petición.");
  if (response.stop_reason === "max_tokens") throw new AIError("La respuesta de la IA quedó cortada. Inténtalo de nuevo.");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new AIError("La IA no devolvió contenido.");
  return JSON.parse(text);
}

const EXERCISE_SCHEMA = {
  type: "object",
  properties: {
    skill: { type: "string", description: "Habilidad concreta que se practica, nombre corto en español (p. ej. 'Past simple', 'Bucles for', 'Phrasal verbs')." },
    kind: { type: "string", enum: ["multiple_choice", "fill_blank", "translate", "write", "code", "predict_output", "fix_bug", "concept"] },
    difficulty: { type: "integer", description: "1 (muy fácil) a 5 (difícil)" },
    instructions: { type: "string", description: "Instrucción breve en español." },
    content: { type: "string", description: "El enunciado/frase/código del ejercicio. Markdown permitido." },
    options: { type: "array", items: { type: "string" }, description: "Opciones si es multiple_choice; vacío en otro caso." },
    hint: { type: "string" },
    reference_answer: { type: "string", description: "Respuesta correcta o modelo de solución (oculta al alumno)." },
    why_this_exercise: { type: "string", description: "Una frase al alumno explicando por qué se eligió este ejercicio según su progreso." },
  },
  required: ["skill", "kind", "difficulty", "instructions", "content", "options", "hint", "reference_answer", "why_this_exercise"],
  additionalProperties: false,
};

export function generateExercise({ track, context, focus }) {
  const topic = track === "english"
    ? "inglés (gramática, vocabulario, traducción, comprensión, escritura)"
    : "programación (en el lenguaje del perfil: lógica, sintaxis, estructuras de datos, depuración, conceptos)";
  return structured({
    system: TUTOR_SYSTEM,
    effort: "medium",
    schema: EXERCISE_SCHEMA,
    prompt: `Crea UN ejercicio de ${topic} para este alumno.

<learner>
${context}
</learner>
${focus ? `\nEl alumno pidió practicar: ${focus}\n` : ""}
Elige la habilidad así: si hay habilidades débiles (dominio < 70), practica una de ellas la mayoría de las veces;
de vez en cuando introduce una habilidad nueva adecuada a su nivel para ampliar. Si no hay historial, empieza por un
diagnóstico de su nivel declarado. Varía el tipo de ejercicio. Debe poder responderse en 1-5 minutos.`,
  });
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", description: "0-100. 100 = perfecto; 70+ = aceptable." },
    verdict: { type: "string", enum: ["correcto", "casi", "incorrecto"] },
    feedback: { type: "string", description: "Corrección en español, en markdown: qué estuvo bien, qué falló y por qué, y la versión correcta." },
    mistake_summary: { type: "string", description: "Resumen de una línea del error concreto (vacío si no hubo error). Ej: 'Usa did + verbo en pasado en preguntas'." },
    other_weak_skills: { type: "array", items: { type: "string" }, description: "Otras habilidades (nombres cortos en español) donde la respuesta mostró fallos, distintas de la habilidad principal." },
    tip: { type: "string", description: "Un consejo práctico para no repetir el error." },
  },
  required: ["score", "verdict", "feedback", "mistake_summary", "other_weak_skills", "tip"],
  additionalProperties: false,
};

export function gradeAnswer({ exercise, answer, context }) {
  return structured({
    system: TUTOR_SYSTEM,
    effort: "medium",
    schema: GRADE_SCHEMA,
    prompt: `Corrige la respuesta del alumno. Sé justo: acepta respuestas equivalentes a la de referencia
(otra traducción válida, otro código que funcione). Si el código tiene errores, explica cuáles.

<learner>
${context}
</learner>

<exercise>
${JSON.stringify(exercise, null, 2)}
</exercise>

<student_answer>
${answer}
</student_answer>`,
  });
}

const INSIGHTS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Diagnóstico general en 2-3 frases." },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: { type: "string" },
          pattern: { type: "string", description: "Qué patrón de error se repite." },
          how_to_fix: { type: "string" },
        },
        required: ["skill", "pattern", "how_to_fix"],
        additionalProperties: false,
      },
    },
    plan: { type: "array", items: { type: "string" }, description: "Plan para los próximos 7 días, un paso por día." },
  },
  required: ["summary", "strengths", "weaknesses", "plan"],
  additionalProperties: false,
};

export function analyzeProgress({ track, context }) {
  return structured({
    system: TUTOR_SYSTEM,
    effort: "medium",
    schema: INSIGHTS_SCHEMA,
    prompt: `Analiza el progreso del alumno en ${TRACK_LABEL[track]}. Detecta patrones en sus errores
(no te limites a repetir los números) y propone un plan concreto. Si casi no hay datos, dilo y sugiere cómo empezar.

<learner>
${context}
</learner>`,
  });
}

// Chat libre con el tutor. `messages` es el historial [{role, content}] del navegador.
export async function chat({ messages, context }) {
  const response = await client.beta.messages.create({
    ...BASE,
    max_tokens: 8000,
    output_config: { effort: "low" },
    system: [
      { type: "text", text: TUTOR_SYSTEM },
      { type: "text", text: `Progreso actual del alumno:\n${context}` },
    ],
    messages,
  });
  if (response.stop_reason === "refusal") throw new AIError("La IA no pudo responder a este mensaje.");
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
