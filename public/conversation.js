import { $, api, busy, escapeHtml, showError } from "./util.js";
import { ACCENT_LANG, canListen, canSpeak, listen, speak, stopSpeaking } from "./speech.js";

const talk = {
  scenario: null,
  messages: [], // [{ role, content }] que se envían al servidor
  turns: [], // lo que se pinta: { role, text, es, feedback }
  listener: null,
  busy: false,
};

const settings = () => ({
  accent: $("#talk-accent").value,
  rate: Number($("#talk-rate").value),
  listenMode: $("#talk-listen-mode").checked,
  autoSend: $("#talk-autosend").checked,
});

const say = (text, slower = false) => {
  const { accent, rate } = settings();
  return speak(text, { accent, rate: slower ? Math.min(rate, 0.8) : rate });
};

const sayButton = (text, label = "🔊") =>
  canSpeak ? `<button type="button" class="say" data-say="${escapeHtml(text)}" title="Escuchar">${label}</button>` : "";

// Cualquier botón con data-say lo lee en voz alta.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-say]");
  if (btn) say(btn.dataset.say, btn.dataset.slow === "1");
});

// ---------- Elegir situación ----------
async function loadScenarios() {
  try {
    const { scenarios } = await api("/api/scenarios");
    $("#scenario-list").innerHTML = scenarios
      .map((s) => `<button class="scenario" data-id="${s.id}"><strong>${s.emoji} ${escapeHtml(s.title)}</strong><span>${escapeHtml(s.goal)}</span></button>`)
      .join("");
    $("#scenario-list").querySelectorAll(".scenario").forEach((btn) =>
      btn.addEventListener("click", () => start(scenarios.find((s) => s.id === btn.dataset.id))),
    );
  } catch (err) {
    showError("#scenario-list", err);
  }
  if (!canListen) {
    $("#talk-autosend").closest("label").innerHTML =
      "⚠️ Tu navegador no reconoce voz (usa Chrome, Edge o Safari para hablar). Puedes escribir tus respuestas.";
  }
}

async function start(scenario) {
  Object.assign(talk, { scenario, messages: [], turns: [] });
  $("#talk-setup").classList.add("hidden");
  $("#talk-summary").classList.add("hidden");
  $("#talk-session").classList.remove("hidden");
  $("#talk-goal-done").classList.add("hidden");
  $("#talk-title").textContent = `${scenario.emoji} ${scenario.title}`;
  $("#talk-goal").textContent = `Tu objetivo: ${scenario.goal}`;
  $("#talk-mic").classList.toggle("hidden", !canListen);
  render();
  await turn();
}

// ---------- Turnos ----------
async function turn() {
  talk.busy = true;
  setStatus("El nativo está pensando…");
  $("#talk-suggestions").classList.add("hidden");
  try {
    const r = await api("/api/conversation/turn", {
      method: "POST",
      body: { scenarioId: talk.scenario.id, accent: settings().accent, messages: talk.messages },
    });
    const lastMine = talk.turns.findLast((t) => t.role === "user");
    if (lastMine) lastMine.feedback = r.feedback;
    talk.messages.push({ role: "assistant", content: r.reply });
    talk.turns.push({ role: "assistant", text: r.reply, es: r.reply_es, revealed: !settings().listenMode });
    talk.suggestions = r.suggestions;
    if (r.goal_completed) $("#talk-goal-done").classList.remove("hidden");
    render();
    setStatus("");
    say(r.reply);
  } catch (err) {
    setStatus(err.message, true);
    // Si falló la respuesta, quitamos el último mensaje para que puedas reenviarlo.
    if (talk.messages.at(-1)?.role === "user") {
      $("#talk-text").value = talk.messages.pop().content;
      talk.turns.pop();
      render();
    }
  } finally {
    talk.busy = false;
  }
}

async function send(text) {
  text = text.trim();
  if (!text || talk.busy) return;
  stopSpeaking();
  $("#talk-text").value = "";
  talk.messages.push({ role: "user", content: text });
  talk.turns.push({ role: "user", text });
  render();
  await turn();
}

function render() {
  $("#talk-log").innerHTML = talk.turns
    .map((t, i) => {
      if (t.role === "assistant") {
        return `
          <div class="bubble native">
            <div class="${t.revealed ? "" : "hidden-text"}" data-reveal="${i}" title="${t.revealed ? "" : "Toca para ver el texto"}">${escapeHtml(t.text)}</div>
            ${t.showEs ? `<div class="es">${escapeHtml(t.es)}</div>` : ""}
            <div class="tools">
              ${sayButton(t.text, "🔊 Repetir")}
              ${canSpeak ? `<button type="button" class="say" data-say="${escapeHtml(t.text)}" data-slow="1">🐢 Más lento</button>` : ""}
              <button type="button" data-translate="${i}">${t.showEs ? "Ocultar traducción" : "Traducir"}</button>
            </div>
          </div>`;
      }
      const f = t.feedback;
      const fb = !f
        ? ""
        : f.has_issue
        ? `<div class="feedback">💬 Un nativo diría: <span class="native-line">${escapeHtml(f.native_version)}</span> ${sayButton(f.native_version)}
             <div class="muted">${f.type ? `<span class="tag">${escapeHtml(f.type)}</span>` : ""}${escapeHtml(f.explanation_es)}</div></div>`
        : `<div class="feedback ok">✅ Suena natural</div>`;
      return `<div class="bubble me">${escapeHtml(t.text)}</div>${fb}`;
    })
    .join("");
  $("#talk-log").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("#talk-log").addEventListener("click", (e) => {
  const reveal = e.target.closest("[data-reveal]");
  if (reveal) {
    talk.turns[reveal.dataset.reveal].revealed = true;
    render();
  }
  const tr = e.target.closest("[data-translate]");
  if (tr) {
    const t = talk.turns[tr.dataset.translate];
    t.showEs = !t.showEs;
    render();
  }
});

function setStatus(text, isError = false) {
  const el = $("#talk-status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

$("#talk-form").addEventListener("submit", (e) => {
  e.preventDefault();
  send($("#talk-text").value);
});

$("#talk-help").addEventListener("click", () => {
  const box = $("#talk-suggestions");
  if (!talk.suggestions?.length) return;
  box.innerHTML =
    `<span class="muted">Podrías decir:</span>` +
    talk.suggestions.map((s) => `<button type="button" data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("");
  box.classList.toggle("hidden");
});

$("#talk-suggestions").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-suggest]");
  if (!btn) return;
  $("#talk-text").value = btn.dataset.suggest;
  say(btn.dataset.suggest);
  $("#talk-text").focus();
});

// ---------- Micrófono ----------
$("#talk-mic").addEventListener("click", async () => {
  const mic = $("#talk-mic");
  if (talk.listener) {
    talk.listener.stop();
    return;
  }
  if (talk.busy) return;
  stopSpeaking();
  mic.classList.add("listening");
  setStatus("Te escucho… (pulsa otra vez para terminar)");
  talk.listener = listen({
    lang: ACCENT_LANG[settings().accent],
    onInterim: (text) => ($("#talk-text").value = text),
  });
  try {
    const text = await talk.listener.promise;
    setStatus(text ? "" : "No te he oído. Pulsa el micrófono y habla.");
    if (text) {
      $("#talk-text").value = text;
      if (settings().autoSend) await send(text);
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    talk.listener = null;
    mic.classList.remove("listening");
  }
});

// ---------- Terminar y evaluar ----------
$("#talk-end").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  stopSpeaking();
  busy(btn, true, "Evaluando…");
  try {
    const r = await api("/api/conversation/end", {
      method: "POST",
      body: { scenarioId: talk.scenario.id, accent: settings().accent, messages: talk.messages },
    });
    renderSummary(r);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    busy(btn, false);
  }
});

const scoreBox = (label, v) => `
  <div class="stat"><span class="muted">${label}</span><b>${v}</b>
    <div class="bar"><span style="width:${v}%;background:${v >= 80 ? "var(--good)" : v >= 50 ? "var(--mid)" : "var(--bad)"}"></span></div></div>`;

function renderSummary(r) {
  $("#talk-session").classList.add("hidden");
  const box = $("#talk-summary");
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="card">
      <h3>${escapeHtml(talk.scenario.emoji + " " + talk.scenario.title)} — evaluación</h3>
      <div class="scores">${scoreBox("Fluidez", r.fluency)}${scoreBox("Naturalidad", r.naturalness)}${scoreBox("Corrección", r.accuracy)}</div>
      <p>${escapeHtml(r.overall_es)}</p>
      ${r.strengths.length ? `<h4>Lo que hiciste bien</h4><ul>${r.strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
      ${
        r.to_improve.length
          ? `<h4>Para sonar como un nativo</h4>${r.to_improve
              .map(
                (t) => `<p><span class="tag">${escapeHtml(t.skill)}</span><br>
                  Dijiste: <em>${escapeHtml(t.you_said)}</em><br>
                  Nativo: <strong>${escapeHtml(t.native_version)}</strong> ${sayButton(t.native_version)}<br>
                  <span class="muted">${escapeHtml(t.tip_es)}</span></p>`,
              )
              .join("")}`
          : ""
      }
      <h4>Expresiones de nativo para esta situación</h4>
      <ul>${r.native_phrases
        .map((p) => `<li><strong>${escapeHtml(p.phrase)}</strong> ${sayButton(p.phrase)} — ${escapeHtml(p.meaning_es)} <span class="muted">(${escapeHtml(p.when_to_use_es)})</span></li>`)
        .join("")}</ul>
      <p class="muted">📒 ${r.phrasesAdded} frase${r.phrasesAdded === 1 ? "" : "s"} nueva${r.phrasesAdded === 1 ? "" : "s"} en tu libreta. Tus resultados ya cuentan en tu progreso de inglés.</p>
      <div class="row">
        <button id="talk-again">Repetir esta situación</button>
        <button id="talk-back" class="secondary">Elegir otra</button>
      </div>
    </div>`;
  $("#talk-again").addEventListener("click", () => start(talk.scenario));
  $("#talk-back").addEventListener("click", backToSetup);
  loadPhrases();
}

function backToSetup() {
  stopSpeaking();
  talk.listener?.stop();
  $("#talk-summary").classList.add("hidden");
  $("#talk-session").classList.add("hidden");
  $("#talk-setup").classList.remove("hidden");
  loadPhrases();
}

$("#talk-exit").addEventListener("click", () => {
  if (talk.messages.some((m) => m.role === "user") && !confirm("¿Salir sin evaluar esta conversación?")) return;
  backToSetup();
});

// ---------- Libreta de frases ----------
const phrases = { due: [], current: null };

async function loadPhrases() {
  try {
    const { total, due } = await api("/api/phrases");
    phrases.due = due;
    $("#phrase-status").textContent = total
      ? `Tienes ${total} frase${total === 1 ? "" : "s"}; ${due.length} para repasar hoy.`
      : "Las expresiones útiles de tus conversaciones se guardan aquí para repasarlas.";
    $("#phrase-start").classList.toggle("hidden", due.length === 0);
  } catch {
    /* sin libreta no pasa nada */
  }
}

$("#phrase-start").addEventListener("click", () => {
  $("#phrase-start").classList.add("hidden");
  nextPhrase();
});

function nextPhrase() {
  const p = (phrases.current = phrases.due.shift());
  const card = $("#phrase-card");
  if (!p) {
    card.innerHTML = `<p>✅ ¡Repaso terminado!</p>`;
    loadPhrases();
    return;
  }
  card.innerHTML = `
    <p><strong>${escapeHtml(p.meaning_es)}</strong><br><span class="muted">${escapeHtml(p.when_to_use_es)}</span></p>
    <p class="muted">¿Cómo lo diría un nativo? Dilo en voz alta o escríbelo.</p>
    <form id="phrase-form" class="talk-input">
      ${canListen ? `<button type="button" id="phrase-mic" class="mic" title="Hablar">🎤</button>` : ""}
      <input id="phrase-answer" autocomplete="off" placeholder="En inglés…">
      <button type="submit">Comprobar</button>
    </form>
    <div id="phrase-result"></div>`;
  $("#phrase-form").addEventListener("submit", (e) => {
    e.preventDefault();
    checkPhrase($("#phrase-answer").value);
  });
  $("#phrase-mic")?.addEventListener("click", async (e) => {
    const mic = e.currentTarget;
    mic.classList.add("listening");
    try {
      const text = await listen({ lang: ACCENT_LANG[settings().accent], onInterim: (t) => ($("#phrase-answer").value = t) }).promise;
      if (text) await checkPhrase(text);
    } catch (err) {
      showError("#phrase-result", err);
    } finally {
      mic.classList.remove("listening");
    }
  });
  $("#phrase-answer").focus();
}

async function checkPhrase(answer) {
  if (!answer.trim()) return;
  try {
    const r = await api("/api/phrases/review", { method: "POST", body: { id: phrases.current.id, answer } });
    $("#phrase-result").innerHTML = `
      <p>${r.score >= 85 ? "✅" : r.score >= 70 ? "🟡" : "❌"} ${r.score}/100 — <strong>${escapeHtml(r.phrase.phrase)}</strong> ${sayButton(r.phrase.phrase)}</p>
      <p class="words">${r.words.map((w) => `<span class="${w.ok ? "ok" : "miss"}">${escapeHtml(w.word)}</span>`).join("")}</p>
      <p class="muted">Dijiste: ${escapeHtml(answer)}</p>
      <button id="phrase-next">Siguiente</button>`;
    say(r.phrase.phrase);
    $("#phrase-form").remove();
    $("#phrase-next").addEventListener("click", nextPhrase);
  } catch (err) {
    showError("#phrase-result", err);
  }
}

// Al entrar en la pestaña, vuelve a la elección de situación si no hay conversación en marcha.
document.querySelector('nav button[data-view="talk"]').addEventListener("click", () => {
  if (!talk.scenario || $("#talk-session").classList.contains("hidden")) loadPhrases();
});

loadScenarios();
loadPhrases();
