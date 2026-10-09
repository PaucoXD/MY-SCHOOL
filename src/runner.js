// Ejecuta el código del alumno contra los tests de un ejercicio, en un proceso aparte
// con límite de tiempo y memoria. Soporta JavaScript y Python.
//
// Aislamiento: JavaScript corre con el modelo de permisos de Node (sin escribir
// archivos, sin lanzar procesos, solo lectura de su carpeta temporal). Python corre
// con límites de CPU y memoria, pero puede leer/escribir archivos como tu usuario.
// Es suficiente para una app local donde el código es tuyo; no publiques el
// servidor en internet sin un sandbox de verdad (contenedor, gVisor, etc.).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 6000;
const MAX_OUTPUT = 1_000_000;
const RESULT_MARKER = "__RESULT__";

const JS_HARNESS = String.raw`
const fs = require("fs");
const { code, functionName, tests } = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const write = process.stdout.write.bind(process.stdout);
const logs = [];
const show = (v) => { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } };
console.log = console.info = console.warn = console.error = console.debug = (...a) => {
  if (logs.length < 200) logs.push(a.map(show).join(" ").slice(0, 2000));
};
const exit = process.exit.bind(process);
process.exit = () => { throw new Error("process.exit() no está permitido aquí"); };
const done = (o) => { write("\n${RESULT_MARKER}" + JSON.stringify({ ...o, logs })); exit(0); };
const fmt = (e) => (e && e.name ? e.name + ": " + e.message : String(e));

function normalize(v) {
  if (v === undefined) return null;
  try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
}
function eq(a, b) {
  if (typeof a === "number" && typeof b === "number") return a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && eq(a[k], b[k]));
  }
  return a === b;
}

(async () => {
  let fn;
  try {
    const module = { exports: {} };
    const src = code.replace(/^\s*export\s+(default\s+)?/gm, "");
    const found = new Function("module", "exports", "require",
      src + "\n;return typeof " + functionName + " !== 'undefined' ? " + functionName + " : undefined;")(module, module.exports, require);
    fn = found ?? module.exports[functionName] ?? (typeof module.exports === "function" ? module.exports : undefined);
  } catch (e) {
    done({ error: fmt(e), results: [] });
  }
  if (typeof fn !== "function") done({ error: "No encuentro la función " + functionName + ". ¿Le cambiaste el nombre?", results: [] });

  const results = [];
  for (const t of tests) {
    try {
      const args = JSON.parse(t.args_json);
      const expected = JSON.parse(t.expected_json);
      const value = await Promise.race([
        Promise.resolve(fn(...args)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Tiempo agotado")), 2000)),
      ]);
      const actual = normalize(value);
      results.push({ passed: eq(actual, expected), actual: show(actual) });
    } catch (e) {
      results.push({ passed: false, error: fmt(e) });
    }
  }
  done({ results });
})();
`;

const PY_HARNESS = String.raw`
import sys, os, json, io, contextlib, traceback
try:
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024,) * 2)
except Exception:
    pass

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
real_stdout = sys.stdout
buf = io.StringIO()

def done(o):
    o["logs"] = buf.getvalue()[-20000:].splitlines()[-200:]
    real_stdout.write("\n${RESULT_MARKER}" + json.dumps(o))
    real_stdout.flush()
    os._exit(0)

def fmt(e):
    line = next((fr.lineno for fr in reversed(traceback.extract_tb(e.__traceback__)) if fr.filename == "solucion.py"), None)
    msg = str(e)
    if isinstance(e, SyntaxError) and e.filename == "solucion.py":
        line, msg = e.lineno, e.msg
    return f"{type(e).__name__}: {msg}" + (f" (línea {line})" if line else "")

def to_json(o):
    if isinstance(o, (set, frozenset)):
        return sorted(o, key=repr)
    return repr(o)

def normalize(v):
    try:
        return json.loads(json.dumps(v, default=to_json))
    except Exception:
        return repr(v)

def eq(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b or abs(a - b) <= 1e-9 * max(1, abs(a), abs(b))
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(eq(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(eq(a[k], b[k]) for k in a)
    return a == b

ns = {"__name__": "__solucion__"}
with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
    try:
        exec(compile(data["code"], "solucion.py", "exec"), ns)
    except BaseException as e:
        done({"error": fmt(e), "results": []})
    fn = ns.get(data["functionName"])
    if not callable(fn):
        done({"error": f"No encuentro la función {data['functionName']}. ¿Le cambiaste el nombre?", "results": []})
    results = []
    for t in data["tests"]:
        try:
            actual = normalize(fn(*json.loads(t["args_json"])))
            results.append({"passed": eq(actual, json.loads(t["expected_json"])), "actual": json.dumps(actual, ensure_ascii=False)})
        except BaseException as e:
            results.append({"passed": False, "error": fmt(e)})
done({"results": results})
`;

function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return cmd;
  }
  return null;
}

const RUNTIMES = {
  javascript: {
    harness: "harness.cjs",
    source: JS_HARNESS,
    command: (dir) => [process.execPath, ["--permission", `--allow-fs-read=${dir}`, "--max-old-space-size=256", path.join(dir, "harness.cjs"), path.join(dir, "input.json")]],
  },
  python: {
    harness: "harness.py",
    source: PY_HARNESS,
    python: findPython(),
    command(dir) {
      return [this.python, ["-I", path.join(dir, "harness.py"), path.join(dir, "input.json")]];
    },
  },
};

// Nombre del perfil ("JavaScript", "Python"...) → runtime, o null si no se puede ejecutar.
export function runtimeFor(language) {
  const key = String(language).toLowerCase();
  if (key === "javascript") return "javascript";
  if (key === "python" && RUNTIMES.python.python) return "python";
  return null;
}

export function validFunctionName(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

// tests: [{ description, args_json, expected_json }]
// Devuelve { error?, logs, results: [{ description, args_json, expected_json, passed, actual?, error? }], passed, total }
export async function runTests({ runtime, code, functionName, tests }) {
  const rt = RUNTIMES[runtime];
  if (!rt) throw new Error(`Lenguaje no soportado: ${runtime}`);
  if (!validFunctionName(functionName)) throw new Error("Nombre de función no válido");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-school-run-"));
  try {
    await fs.writeFile(path.join(dir, rt.harness), rt.source);
    await fs.writeFile(path.join(dir, "input.json"), JSON.stringify({ code, functionName, tests }));
    const [cmd, args] = rt.command(dir);
    const { stdout, stderr, timedOut, signal } = await run(cmd, args, dir);

    const at = stdout.lastIndexOf(RESULT_MARKER);
    let out;
    if (at !== -1) {
      try {
        out = JSON.parse(stdout.slice(at + RESULT_MARKER.length));
      } catch {
        out = null;
      }
    }
    if (!out) {
      const reason = timedOut || signal === "SIGXCPU" || signal === "SIGKILL"
        ? "Tiempo agotado: tu código tardó demasiado (¿un bucle infinito?)."
        : `El programa terminó con un error.\n${stderr.trim().split("\n").slice(-5).join("\n")}`;
      out = { error: reason, results: [], logs: [] };
    }
    const results = tests.map((t, i) => ({ ...t, ...(out.results[i] ?? { passed: false, error: out.error ? "No se ejecutó" : "Sin resultado" }) }));
    return {
      error: out.error ?? null,
      logs: out.logs ?? [],
      results,
      passed: results.filter((r) => r.passed).length,
      total: results.length,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { PATH: process.env.PATH ?? "", PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
    });
    child.on("close", (_code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, signal });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: String(err), timedOut });
    });
  });
}
