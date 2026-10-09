# MY-SCHOOL

App web para aprender **inglés** y **programación** con un tutor IA (Claude) que sigue tu progreso,
detecta qué te falla y adapta los ejercicios a tus puntos débiles.

## Qué hace

- **Practicar**: la IA genera un ejercicio cada vez (opción múltiple, traducción, rellenar huecos, escribir código,
  predecir la salida, arreglar un bug...). *Siguiente ejercicio* empieza por tus repasos pendientes y, cuando no quedan,
  te enseña algo nuevo. *Aprender algo nuevo* salta los repasos. También puedes pedir un tema concreto.
- **Corrección con IA**: puntuación de 0 a 100, explicación del error, consejo y respuesta de referencia. Acepta respuestas
  equivalentes (otra traducción válida, otro código que funcione).
- **Mi progreso**: dominio (0-100) por habilidad, aciertos, y los últimos errores concretos de cada una.
  El botón *Analizar mis errores con IA* busca patrones en tus fallos y te da un plan de 7 días.
- **Tutor IA**: chat libre; el tutor ve tu perfil y tus errores recientes para responder de forma personalizada.
- **Perfil**: nivel de inglés (A1-C2), lenguaje de programación, nivel y objetivos.

## Cómo funciona el seguimiento

Cada respuesta corregida actualiza la habilidad practicada (`src/progress.js`):

- `mastery` es una media móvil de tus notas (el intento más reciente pesa un 35 %), así mejora cuando mejoras
  y baja si vuelves a fallar.
- Si la IA detecta fallos en otras habilidades dentro de la misma respuesta (p. ej. ortografía en un ejercicio de
  tiempos verbales), también se registran.
- **Repetición espaciada** (inspirada en SM-2): cada habilidad tiene una fecha de próximo repaso. Al acertar, el
  intervalo crece (1 día → 3 días → ×2,5 aprox., hasta 180 días); un acierto con dudas (70-84) crece más despacio.
  Al fallar, la habilidad queda pendiente para tu próxima sesión y su "facilidad" baja, así que luego crecerá más lento.
  Los repasos pendientes se hacen primero, empezando por los de menor dominio. Si fallas un ejercicio, la IA vuelve
  sobre ese mismo error desde otro ángulo.
- Se guardan los últimos 5 errores de cada habilidad. Ese resumen (perfil + habilidades más débiles + errores) se envía
  a la IA al generar ejercicios, corregir, analizar y chatear.

Los datos se guardan en `data/progress.json` (local, no se sube a git).

## Puesta en marcha

Requisitos: Node.js 22 o superior y una clave de la API de Claude (https://console.anthropic.com).

```bash
npm install
cp .env.example .env   # y pon tu ANTHROPIC_API_KEY
npm start              # abre http://localhost:3000
```

`npm run dev` reinicia el servidor al cambiar archivos. `npm test` ejecuta los tests.

## Estructura

```
src/server.js     API Express (ejercicios, respuestas, progreso, análisis, chat)
src/ai.js         Llamadas a Claude con salidas JSON estructuradas
src/progress.js   Cálculo del dominio por habilidad y almacenamiento
public/           Interfaz web (HTML, CSS y JS sin build)
test/             Tests de la lógica de progreso
```

Usa el modelo `claude-opus-5-5` por defecto (cámbialo con `CLAUDE_MODEL`). Tiene activado el *fallback* del servidor:
si un modelo rechaza una petición, la API la reintenta automáticamente con otro.

## Ideas para seguir

- Ejecutar el código del alumno en un sandbox para comprobarlo con tests reales.
- Práctica oral de inglés (voz a texto) y lecturas con preguntas de comprensión.
- Varios usuarios con login y base de datos.
