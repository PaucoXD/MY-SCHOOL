import { test } from "node:test";
import assert from "node:assert/strict";
import { runTests, runtimeFor } from "../src/runner.js";

const tests = [
  { description: "normal", args_json: "[[1, 2, 3]]", expected_json: "6" },
  { description: "vacía", args_json: "[[]]", expected_json: "0" },
];
const run = (runtime, code) => runTests({ runtime, code, functionName: "suma", tests });

test("JavaScript: pasa, falla y captura console.log", async () => {
  const ok = await run("javascript", "function suma(xs) { console.log('n', xs.length); return xs.reduce((a, b) => a + b, 0); }");
  assert.equal(ok.passed, 2);
  assert.deepEqual(ok.logs, ["n 3", "n 0"]);
  const bad = await run("javascript", "const suma = (xs) => xs[0];");
  assert.equal(bad.passed, 0);
  assert.equal(bad.results[1].actual, "null");
});

test("JavaScript: errores de sintaxis y función inexistente", async () => {
  assert.match((await run("javascript", "function suma(xs) { return }}")).error, /SyntaxError/);
  assert.match((await run("javascript", "function total() {}")).error, /No encuentro la función suma/);
});

test("JavaScript: no puede escribir archivos ni lanzar procesos", async () => {
  const r = await run("javascript", "function suma() { require('child_process').execSync('ls'); return 6; }");
  assert.equal(r.passed, 0);
  assert.match(r.results[0].error, /restricted|ERR_ACCESS_DENIED/i);
});

test("JavaScript: bucle infinito se corta por tiempo", { timeout: 15000 }, async () => {
  const r = await run("javascript", "function suma() { while (true) {} }");
  assert.match(r.error, /Tiempo agotado/);
});

test("Python: pasa, compara int/float y reporta la línea del error", { skip: !runtimeFor("python") }, async () => {
  assert.equal((await run("python", "def suma(xs):\n    print('hola')\n    return float(sum(xs))")).passed, 2);
  const err = await run("python", "def suma(xs):\n    return xs[0]");
  assert.equal(err.passed, 0);
  assert.match(err.results[1].error, /IndexError.*línea 2/);
});

test("Python: True no cuenta como 1", { skip: !runtimeFor("python") }, async () => {
  const r = await runTests({
    runtime: "python",
    code: "def es_par(n):\n    return 1 if n % 2 == 0 else 0",
    functionName: "es_par",
    tests: [{ description: "par", args_json: "[2]", expected_json: "true" }],
  });
  assert.equal(r.passed, 0);
});
