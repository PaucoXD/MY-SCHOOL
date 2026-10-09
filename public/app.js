const $ = (sel) => document.querySelector(sel);
const state = { practiceTrack: "english", progressTrack: "english", exercise: null, chat: [] };

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Markdown mínimo: bloques de código, código en línea, negrita, cursiva, listas y párrafos.
function md(text) {
  const blocks = [];
  let s = escapeHtml(text).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const html = s
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
        const tag = /^\s*\d+\./.test(lines[0]) ? "ol" : "ul";
        return `<${tag}>${lines.map((l) => `<li>${l.replace(/^\s*([-*]|\d+\.)\s+/, "")}</li>`).join("")}</${tag}>`;
      }
      if (/^\u0000\d+\u0000$/.test(para.trim())) return para.trim();
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

function masteryColor(m) {
  return m >= 80 ? "var(--good)" : m >= 50 ? "var(--mid)" : "var(--bad)";
}

function busy(button, on, label) {
  button.disabled = on;
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = label;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

// ---------- Navegación ----------
document.querySelectorAll("nav button").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${btn.dataset.view}`));
    if (btn.dataset.view === "progress") loadProgress();
    if (btn.dataset.view === "profile") loadProfile();
  }),
);

document.querySelectorAll(".track-switch").forEach((sw) =>
  sw.querySelectorAll("button").forEach((btn) =>
    btn.addEventListener("click", () => {
      sw.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      if (sw.closest("#view-practice")) {
        state.practiceTrack = btn.dataset.track;
      } else {
        state.progressTrack = btn.dataset.track;
        $("#insights").classList.add("hidden");
        loadProgress();
      }
    }),
  ),
);

// ---------- Práctica ----------
$("#new-exercise").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  busy(btn, true, "Generando…");
  $("#result").classList.add("hidden");
  try {
    state.exercise = await api("/api/exercise", {
      method: "POST",
      body: { track: state.practiceTrack, focus: $("#focus").value },
    });
    renderExercise(state.exercise);
  } catch (err) {
    showError("#exercise", err);
  } finally {
    busy(btn, false);
  }
});

function renderExercise(ex) {
  const box = $("#exercise");
  box.classList.remove("hidden");
  const answerInput = ex.options.length
    ? `<div class="options">${ex.options
        .map((o) => `<label><input type="radio" name="answer" value="${escapeHtml(o)}">${md(o).replace(/^<p>|<\/p>$/g, "")}</label>`)
        .join("")}</div>`
    : `<textarea id="answer" rows="${["code", "fix_bug", "write"].includes(ex.kind) ? 10 : 3}" placeholder="Tu respuesta"></textarea>`;
  box.innerHTML = `
    <div><span class="tag">${escapeHtml(ex.skill)}</span><span class="tag">Dificultad ${ex.difficulty}/5</span></div>
    <p class="muted">${escapeHtml(ex.why_this_exercise)}</p>
    <h3>${escapeHtml(ex.instructions)}</h3>
    <div>${md(ex.content)}</div>
    <form id="answer-form">
      ${answerInput}
      <div class="row">
        <button type="submit">Comprobar</button>
        <button type="button" id="show-hint" style="background:transparent;color:var(--text);border-color:var(--border)">Pista</button>
      </div>
      <p id="hint" class="muted hidden">💡 ${escapeHtml(ex.hint)}</p>
    </form>`;
  $("#show-hint").addEventListener("click", () => $("#hint").classList.remove("hidden"));
  $("#answer-form").addEventListener("submit", submitAnswer);
}

async function submitAnswer(e) {
  e.preventDefault();
  const answer = state.exercise.options.length
    ? document.querySelector('input[name="answer"]:checked')?.value
    : $("#answer").value;
  if (!answer?.trim()) return;
  const btn = e.submitter;
  busy(btn, true, "Corrigiendo…");
  try {
    const r = await api("/api/answer", { method: "POST", body: { id: state.exercise.id, answer } });
    const box = $("#result");
    box.classList.remove("hidden");
    box.innerHTML = `
      <h3 class="verdict-${r.verdict}">${{ correcto: "✅ ¡Correcto!", casi: "🟡 Casi", incorrecto: "❌ Incorrecto" }[r.verdict]} — ${r.score}/100</h3>
      <div>${md(r.feedback)}</div>
      ${r.tip ? `<p><strong>Consejo:</strong> ${escapeHtml(r.tip)}</p>` : ""}
      <details><summary>Respuesta de referencia</summary>${md(r.reference_answer)}</details>
      <div class="row"><button id="next">Siguiente ejercicio</button></div>`;
    $("#next").addEventListener("click", () => $("#new-exercise").requestSubmit($("#new-exercise button")));
    btn.closest(".row").remove();
  } catch (err) {
    showError("#result", err);
    busy(btn, false);
  }
}

// ---------- Progreso ----------
async function loadProgress() {
  try {
    const data = await api("/api/progress");
    const t = data.tracks[state.progressTrack];
    const fmt = (v) => (v === null ? "—" : v);
    $("#stats").innerHTML = `
      <div class="stat"><span class="muted">Ejercicios</span><b>${t.totalAttempts}</b></div>
      <div class="stat"><span class="muted">Habilidades</span><b>${t.skillsPracticed}</b></div>
      <div class="stat"><span class="muted">Dominio medio</span><b>${fmt(t.averageMastery)}</b></div>
      <div class="stat"><span class="muted">Nota últimos 20</span><b>${fmt(t.recentAverageScore)}</b></div>`;
    const skills = [...t.skills].sort((a, b) => a.mastery - b.mastery);
    $("#skills").innerHTML = skills.length
      ? skills
          .map(
            (s) => `
        <div class="skill">
          <div class="skill-head"><strong>${escapeHtml(s.name)}</strong><span>${s.mastery}/100 · ${s.correct}/${s.attempts} bien</span></div>
          <div class="bar"><span style="width:${s.mastery}%;background:${masteryColor(s.mastery)}"></span></div>
          ${s.mistakes.length ? `<ul>${s.mistakes.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : ""}
        </div>`,
          )
          .join("")
      : `<p class="muted">Aún no hay datos. Haz algunos ejercicios en "Practicar".</p>`;
  } catch (err) {
    showError("#skills", err);
  }
}

$("#analyze").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  busy(btn, true, "Analizando…");
  try {
    const r = await api("/api/insights", { method: "POST", body: { track: state.progressTrack } });
    const box = $("#insights");
    box.classList.remove("hidden");
    box.innerHTML = `
      <h3>Diagnóstico</h3><p>${escapeHtml(r.summary)}</p>
      ${r.strengths.length ? `<h3>Puntos fuertes</h3><ul>${r.strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
      ${
        r.weaknesses.length
          ? `<h3>Lo que te falla</h3>${r.weaknesses
              .map((w) => `<p><strong>${escapeHtml(w.skill)}:</strong> ${escapeHtml(w.pattern)}<br><span class="muted">Cómo mejorar: ${escapeHtml(w.how_to_fix)}</span></p>`)
              .join("")}`
          : ""
      }
      <h3>Plan de 7 días</h3><ol>${r.plan.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ol>`;
  } catch (err) {
    showError("#insights", err);
  } finally {
    busy(btn, false);
  }
});

// ---------- Tutor ----------
function renderChat() {
  $("#chat-log").innerHTML = state.chat.map((m) => `<div class="msg ${m.role}">${md(m.content)}</div>`).join("");
}

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  state.chat.push({ role: "user", content: text });
  input.value = "";
  renderChat();
  const btn = e.submitter;
  busy(btn, true, "…");
  try {
    const { reply } = await api("/api/chat", { method: "POST", body: { messages: state.chat } });
    state.chat.push({ role: "assistant", content: reply });
  } catch (err) {
    state.chat.pop();
    input.value = text;
    alert(err.message);
  } finally {
    renderChat();
    busy(btn, false);
  }
});

$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit($("#chat-form button"));
  }
});

// ---------- Perfil ----------
async function loadProfile() {
  const { profile } = await api("/api/progress");
  const form = $("#profile-form");
  for (const [k, v] of Object.entries(profile)) if (form.elements[k]) form.elements[k].value = v;
}

$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api("/api/profile", { method: "PUT", body: Object.fromEntries(new FormData(e.target)) });
  $("#profile-saved").classList.remove("hidden");
  setTimeout(() => $("#profile-saved").classList.add("hidden"), 2000);
});

function showError(sel, err) {
  const box = $(sel);
  box.classList.remove("hidden");
  box.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
}
