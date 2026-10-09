# MY-SCHOOL

App web para aprender **inglés que puedas usar con nativos** y **programación**, con un tutor IA (Claude) que sigue
tu progreso, detecta qué te falla y adapta los ejercicios a tus puntos débiles. Se puede instalar en el móvil.

## Dos formas de usarla

- **Sin instalar nada (recomendado si no tienes clave de API):** la versión de `claude-app/my-school.html` está publicada
  en claude.ai: https://claude.ai/artifact/WXb84YAKPXr5cFbhjvhihu. Se abre con ese enlace desde el móvil o el ordenador,
  usa Claude con tu cuenta (sin clave) y guarda tu progreso en tu cuenta. Incluye un camino de desarrollo web
  (HTML → CSS → JavaScript) con vista previa en vivo y comprobaciones automáticas de la página. Diferencias: para hablar se usa el dictado del
  teclado (la página no puede usar el micrófono directamente) y los tests reales de código son solo para JavaScript.
- **En tu ordenador, con clave de API:** la app Node de este repositorio (ver *Puesta en marcha*).

## Qué hace

- **🎙️ Conversar con nativos**: role-plays por voz en situaciones reales (cafetería, small talk, hacer amigos,
  restaurante, médico, llamada a atención al cliente, entrevista de trabajo, stand-up de un equipo de desarrollo...).
  - La IA hace de nativo: habla como en la vida real (contracciones, phrasal verbs, expresiones) adaptándose a tu nivel,
    con acento americano, británico o australiano, y te responde en voz alta.
  - Tú hablas con el micrófono (o escribes). Debajo de cada frase tuya ves **cómo lo diría un nativo** y por qué.
  - Herramientas: repetir o escuchar más lento, traducción, ideas de qué decir (💡) y un *modo escucha* que oculta
    el texto para entrenar el oído.
  - Al terminar: notas de fluidez, naturalidad y corrección, qué mejorar y expresiones de nativo para esa situación.
    Las notas cuentan en tu progreso de inglés (y en la repetición espaciada).
- **📒 Frases de nativo**: las expresiones de tus conversaciones se guardan en una libreta con repetición espaciada.
  Ves el significado y tienes que **decirla en voz alta** (o escribirla); se compara palabra por palabra.
- **Practicar**: la IA genera un ejercicio cada vez (opción múltiple, traducción, rellenar huecos, escribir código,
  predecir la salida, arreglar un bug...). *Siguiente ejercicio* empieza por tus repasos pendientes y, cuando no quedan,
  te enseña algo nuevo. *Aprender algo nuevo* salta los repasos. También puedes pedir un tema concreto.
- **Código con tests reales** (JavaScript y Python): en los ejercicios de escribir o arreglar código, la IA genera
  tests que se ejecutan de verdad. Puedes pulsar *Ejecutar tests* (o Ctrl+Enter) las veces que quieras antes de enviar.
  Al enviar, los tests mandan: si alguno falla no apruebas aunque la IA opine otra cosa, y si pasan todos apruebas
  como mínimo. Antes de enseñarte el ejercicio, el servidor ejecuta la solución de la IA y descarta los tests que
  esa solución no pasa (si quedan menos de 2, regenera el ejercicio).
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

## Voz y uso en el móvil

La voz usa las APIs del navegador (sin coste extra):

- **Hablar (reconocimiento de voz)** funciona en Chrome, Edge y Safari, no en Firefox (ahí puedes escribir).
  El navegador solo deja usar el micrófono en `https://` o en `localhost`.
- **Escuchar (voz del nativo)** funciona en todos. La calidad depende de las voces instaladas: en Chrome y Edge
  suelen sonar mejor las que se llaman "Google" o "Natural".
- El reconocimiento de voz transcribe lo que dices; no evalúa tu pronunciación sonido a sonido. Si te entiende,
  un nativo probablemente también.

Para usarla en el **móvil** (se puede instalar: "Añadir a pantalla de inicio"):

- **En tu Wi-Fi**: abre `http://IP-de-tu-ordenador:3000`. Funciona todo menos el micrófono, porque no es https.
- **Con micrófono**: publícala con https. Por ejemplo, un túnel temporal (`cloudflared tunnel --url http://localhost:3000`)
  o un hosting de Node (Render, Railway, Fly.io...).

  **Si la publicas, pon siempre `APP_PASSWORD` en el `.env`**: si no, cualquiera con la URL podría gastar tu clave de
  la API y ejecutar código en tu servidor.

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
src/runner.js     Ejecución del código con tests (JavaScript y Python) en un proceso aparte
src/scenarios.js  Situaciones de conversación con nativos
public/           Interfaz web (HTML, CSS y JS sin build); speech.js = voz, conversation.js = Conversar
test/             Tests del progreso, la libreta de frases y el ejecutor de código
```

Usa el modelo `claude-opus-5-5` por defecto (cámbialo con `CLAUDE_MODEL`). Tiene activado el *fallback* del servidor:
si un modelo rechaza una petición, la API la reintenta automáticamente con otro.

### Sobre la ejecución de código

El código se ejecuta en tu ordenador, en un proceso aparte con límite de tiempo (6 s) y de memoria:

- **JavaScript** corre con el modelo de permisos de Node: no puede escribir archivos, lanzar programas ni leer
  fuera de su carpeta temporal.
- **Python** necesita `python3` instalado. Tiene límites de CPU y memoria, pero puede acceder a tus archivos.

Para una app local con tu propio código es suficiente. **No publiques el servidor en internet** sin antes meter la
ejecución en un sandbox de verdad (un contenedor, por ejemplo).

## Ideas para seguir

- Más lenguajes con tests (TypeScript, Java...) y ejecución en contenedor para poder publicar la app.
- Evaluación real de pronunciación (por fonemas) y lecturas o vídeos con preguntas de comprensión.
- Situaciones personalizadas (escribes la tuya) y conversaciones en las que el nativo habla más rápido con el tiempo.
- Varios usuarios con login y base de datos.
