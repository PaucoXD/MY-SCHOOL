// Utilidades compartidas por las distintas pantallas.
export const $ = (sel) => document.querySelector(sel);
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Markdown mínimo: bloques de código, código en línea, negrita, cursiva, listas y párrafos.
export function md(text) {
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

export function busy(button, on, label) {
  button.disabled = on;
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = label;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

export function showError(sel, err) {
  const box = $(sel);
  box.classList.remove("hidden");
  box.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
}
