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
    function_name: { type: "string", description: "Solo ejercicios con tests: nombre de la función que debe escribir el alumno. Vacío si no hay tests." },
    starter_code: { type: "string", description: "Solo ejercicios con tests: código inicial (firma de la función, o el código con el bug en fix_bug). Vacío si no hay tests." },
    tests: {
      type: "array",
      description: "Solo ejercicios con tests: 3-6 casos. Vacío si no hay tests.",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "Qué comprueba, en español (p. ej. 'lista vacía')." },
          args_json: { type: "string", description: "Array JSON con los argumentos de la llamada, p. ej. '[[1, 2, 3], 2]'." },
          expected_json: { type: "string", description: "Valor JSON que debe devolver, p. ej. '6' o '\"hola\"' o '[1, 2]'." },
        },
        required: ["description", "args_json", "expected_json"],
        additionalProperties: false,
      },
    },
  },
  required: ["skill", "kind", "difficulty", "instructions", "content", "options", "hint", "reference_answer", "why_this_exercise", "function_name", "starter_code", "tests"],
  additionalProperties: false,
};

const RUNTIME_LABEL = { javascript: "JavaScript", python: "Python" };

// `runtime` ("javascript" | "python" | null) indica si el código del alumno se puede ejecutar con tests.
// `retryReason` explica por qué se descartó un intento anterior (tests incorrectos).
export function generateExercise({ track, context, focus, review, runtime, retryReason }) {
  const topic = track === "english"
    ? `inglés (gramática, vocabulario, traducción, comprensión, escritura). El alumno quiere poder hablar con nativos:
prioriza el inglés que se usa de verdad (phrasal verbs, expresiones, contracciones, registro coloquial vs. formal,
cómo reaccionar en conversación) frente al inglés de libro, y usa frases de situaciones reales`
    : "programación (en el lenguaje del perfil: lógica, sintaxis, estructuras de datos, depuración, conceptos)";
  let selection;
  if (focus) {
    selection = `El alumno pidió practicar: ${focus}`;
  } else if (review) {
    selection = `Este ejercicio es un REPASO programado (repetición espaciada) de la habilidad "${review.name}"
(dominio ${review.mastery}/100, último intervalo ${review.intervalDays} días).
Errores recientes en ella: ${review.mistakes.length ? review.mistakes.join(" | ") : "ninguno"}.
Usa exactamente "${review.name}" como skill. Si tuvo errores, ataca ese mismo punto desde un ángulo distinto
(no repitas un ejercicio idéntico). Si la domina, sube un poco la dificultad. En why_this_exercise di que es un repaso y por qué.`;
  } else {
    selection = `No hay repasos pendientes, así que toca avanzar: introduce una habilidad nueva adecuada a su nivel
(o el siguiente paso lógico de lo que ya domina). Si no hay historial, empieza por un diagnóstico de su nivel declarado.`;
  }
  return structured({
    system: TUTOR_SYSTEM,
    effort: "medium",
    schema: EXERCISE_SCHEMA,
    prompt: `Crea UN ejercicio de ${topic} para este alumno.

<learner>
${context}
</learner>

${selection}

Varía el tipo de ejercicio. Debe poder responderse en 1-5 minutos.
${runtime ? `
El código del alumno se EJECUTA con tests reales en ${RUNTIME_LABEL[runtime]}. Si eliges kind "code" o "fix_bug"
(hazlo en más o menos la mitad de los ejercicios de programación):
- Pide escribir (o arreglar) UNA función pura llamada function_name que recibe argumentos y DEVUELVE un valor
  (no que lo imprima). Los argumentos y el resultado deben ser JSON: números, strings, booleanos, null, listas, objetos/dicts.
- starter_code: la firma de la función con un cuerpo vacío para "code", o el código completo con el bug para "fix_bug".
- tests: 3-6 casos que cubran el caso normal y los bordes (vacío, cero, negativos...). args_json es SIEMPRE un array con
  los argumentos en orden. Calcula cada expected_json con cuidado: se comprueban ejecutando tu reference_answer.
- reference_answer: SOLO el código completo de la solución en ${RUNTIME_LABEL[runtime]}, sin explicaciones ni markdown.
Para cualquier otro kind, deja function_name, starter_code y tests vacíos.` : "Deja function_name, starter_code y tests vacíos."}
${retryReason ? `\nUn intento anterior se descartó: ${retryReason}. Asegúrate de que la solución pasa todos los tests.` : ""}`,
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

export function gradeAnswer({ exercise, answer, context, testRun }) {
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
</student_answer>
${testRun ? `
Se ejecutó el código del alumno con los tests: pasó ${testRun.passed} de ${testRun.total}.
${testRun.error ? `Error general: ${testRun.error}\n` : ""}<test_results>
${JSON.stringify(testRun.results.map(({ description, args_json, expected_json, passed, actual, error }) => ({ description, args_json, expected_json, passed, actual, error })), null, 2)}
</test_results>
Los resultados de los tests son la verdad: no digas que funciona si algún test falla. Si fallan, explica por qué
con el caso concreto. Si pasan todos, valora además la claridad y la calidad del código.` : ""}`,
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

// ---------- Conversación con un "nativo" ----------

const LEVEL_STYLE = {
  A1: "Habla despacio y con frases muy cortas y vocabulario básico, pero que suene natural (contracciones incluidas).",
  A2: "Frases cortas y vocabulario frecuente, natural, con alguna expresión coloquial muy común.",
  B1: "Habla como un nativo amable: contracciones, phrasal verbs y expresiones comunes, sin jerga rebuscada.",
  B2: "Habla como un nativo normal: ritmo natural, phrasal verbs, idioms comunes y algo de slang.",
  C1: "Habla exactamente como un nativo, con slang, idioms y humor, sin simplificar.",
  C2: "Habla exactamente como un nativo, con slang, idioms y humor, sin simplificar.",
};

function conversationSystem({ scenario, accent, level }) {
  return `${TUTOR_SYSTEM}

Ahora haces un ROLE-PLAY para que el alumno aprenda a hablar con nativos de verdad.
Personaje: ${scenario.character}
Situación para el alumno: ${scenario.goal}
Acento y vocabulario: ${accent} (usa palabras y expresiones típicas de esa variante).
Nivel del alumno: ${level}. ${LEVEL_STYLE[level] ?? LEVEL_STYLE.B1}

Reglas del personaje:
- Habla como lo haría esa persona en la vida real, no como un libro de texto: contracciones (gonna, wanna solo si encaja),
  muletillas naturales (well, so, oh nice, yeah), y respuestas cortas de 1-3 frases como en una conversación hablada.
- Mantente en el personaje y haz avanzar la situación (preguntas, pequeños imprevistos). Nunca corrijas dentro del personaje.
- Lo que dices se lee en voz alta: nada de emojis, listas, markdown ni acotaciones.`;
}

const TURN_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Lo que dice el personaje, en inglés hablado natural." },
    reply_es: { type: "string", description: "Traducción natural al español de reply." },
    feedback: {
      type: "object",
      description: "Corrección del ÚLTIMO mensaje del alumno. Si es la apertura (no hay mensaje del alumno), has_issue=false y el resto vacío.",
      properties: {
        has_issue: { type: "boolean", description: "true si hay un error o si un nativo lo diría de forma claramente distinta." },
        type: { type: "string", enum: ["", "gramática", "vocabulario", "naturalidad", "registro", "comprensión"] },
        native_version: { type: "string", description: "Cómo lo diría un nativo en esta situación (en inglés)." },
        explanation_es: { type: "string", description: "Explicación breve en español de qué cambia y por qué." },
        skill: { type: "string", description: "Habilidad concreta implicada, nombre corto en español (p. ej. 'Past simple', 'Phrasal verbs', 'Pedir con cortesía')." },
      },
      required: ["has_issue", "type", "native_version", "explanation_es", "skill"],
      additionalProperties: false,
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description: "2 respuestas posibles y naturales que el alumno podría decir ahora (en inglés), por si se bloquea.",
    },
    goal_completed: { type: "boolean", description: "true si el alumno ya ha conseguido el objetivo de la situación." },
  },
  required: ["reply", "reply_es", "feedback", "suggestions", "goal_completed"],
  additionalProperties: false,
};

function transcript(messages) {
  return messages.map((m) => `${m.role === "user" ? "STUDENT" : "YOU (character)"}: ${m.content}`).join("\n");
}

// `messages`: [{ role: "user" | "assistant", content }] — vacío para que el personaje abra la conversación.
// El alumno habla por voz, así que su texto viene de un reconocedor de voz: no corrijas mayúsculas ni puntuación.
export function conversationTurn({ scenario, accent, level, messages }) {
  const last = messages.at(-1);
  return structured({
    system: conversationSystem({ scenario, accent, level }),
    effort: "low",
    schema: TURN_SCHEMA,
    maxTokens: 4000,
    prompt: messages.length
      ? `<conversation>
${transcript(messages)}
</conversation>

Responde como el personaje al último mensaje del alumno y corrige ese mensaje ("${last.content}").
El texto del alumno puede venir de reconocimiento de voz: ignora mayúsculas y puntuación, y si una palabra parece
mal transcrita no lo cuentes como error. Señala solo lo que importa para sonar natural y que te entiendan
(no cada detalle); si su frase ya suena natural, has_issue=false.`
      : "Abre la conversación como el personaje (el alumno aún no ha dicho nada).",
  });
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    overall_es: { type: "string", description: "Valoración general en 2-3 frases, en español, honesta y motivadora." },
    fluency: { type: "integer", description: "0-100: fluidez y capacidad de mantener la conversación." },
    naturalness: { type: "integer", description: "0-100: cuánto suena como un nativo." },
    accuracy: { type: "integer", description: "0-100: corrección gramatical y de vocabulario." },
    strengths: { type: "array", items: { type: "string" } },
    to_improve: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Nombre corto en español." },
          you_said: { type: "string" },
          native_version: { type: "string" },
          tip_es: { type: "string" },
        },
        required: ["skill", "you_said", "native_version", "tip_es"],
        additionalProperties: false,
      },
    },
    skills: {
      type: "array",
      description: "Habilidades evaluadas en esta conversación con su nota (0-100). Incluye la habilidad de la situación (p. ej. 'Conversación: pedir en una cafetería') y las gramaticales/de vocabulario relevantes.",
      items: {
        type: "object",
        properties: { skill: { type: "string" }, score: { type: "integer" }, mistake: { type: "string", description: "Error concreto si la nota < 70; vacío si no." } },
        required: ["skill", "score", "mistake"],
        additionalProperties: false,
      },
    },
    native_phrases: {
      type: "array",
      description: "5-8 expresiones de nativo útiles para esta situación (usadas por el personaje o que el alumno debería haber usado).",
      items: {
        type: "object",
        properties: {
          phrase: { type: "string", description: "La expresión en inglés, tal cual se dice." },
          meaning_es: { type: "string" },
          when_to_use_es: { type: "string" },
        },
        required: ["phrase", "meaning_es", "when_to_use_es"],
        additionalProperties: false,
      },
    },
  },
  required: ["overall_es", "fluency", "naturalness", "accuracy", "strengths", "to_improve", "skills", "native_phrases"],
  additionalProperties: false,
};

export function conversationSummary({ scenario, accent, level, messages, context }) {
  return structured({
    system: TUTOR_SYSTEM,
    effort: "medium",
    schema: SUMMARY_SCHEMA,
    prompt: `El alumno acaba de practicar una conversación hablada (role-play) para aprender a hablar con nativos.
Situación: ${scenario.title} — objetivo: ${scenario.goal}
Acento: ${accent}. Nivel declarado: ${level}.
El texto del alumno viene de reconocimiento de voz: no penalices puntuación, mayúsculas ni palabras mal transcritas.

<learner>
${context}
</learner>

<conversation>
${transcript(messages)}
</conversation>

Evalúa la conversación. Usa en "skills" nombres de habilidad que ya existan en su progreso cuando sea la misma habilidad.`,
  });
}
