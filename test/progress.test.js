import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, recordAttempt, weakestSkills, trackSummary, skillKey, dueSkills, isDue } from "../src/progress.js";

test("el primer intento fija el dominio y los siguientes lo suavizan", () => {
  const s = emptyState();
  recordAttempt(s, { track: "english", skill: "Past simple", score: 40, mistake: "Usó 'goed'" });
  assert.equal(s.skills[skillKey("english", "Past simple")].mastery, 40);
  recordAttempt(s, { track: "english", skill: "Past simple", score: 100 });
  const sk = s.skills[skillKey("english", "Past simple")];
  assert.equal(sk.mastery, 61);
  assert.equal(sk.attempts, 2);
  assert.equal(sk.correct, 1);
  assert.deepEqual(sk.mistakes, ["Usó 'goed'"]);
});

test("los fallos en otras habilidades también se registran", () => {
  const s = emptyState();
  recordAttempt(s, { track: "english", skill: "Present perfect", score: 80, mistake: "ortografía", errorSkills: ["Ortografía", "present perfect"] });
  assert.equal(Object.keys(s.skills).length, 2);
  assert.equal(s.skills[skillKey("english", "Ortografía")].mastery, 40);
});

test("weakestSkills ordena por dominio y separa por track", () => {
  const s = emptyState();
  recordAttempt(s, { track: "programming", skill: "Bucles", score: 90 });
  recordAttempt(s, { track: "programming", skill: "Recursión", score: 20 });
  recordAttempt(s, { track: "english", skill: "Phrasal verbs", score: 10 });
  assert.deepEqual(weakestSkills(s, "programming").map((x) => x.name), ["Recursión", "Bucles"]);
  const sum = trackSummary(s, "programming");
  assert.equal(sum.totalAttempts, 2);
  assert.equal(sum.averageMastery, 55);
});

const DAY = 24 * 60 * 60 * 1000;
const at = (days) => new Date(Date.UTC(2026, 0, 1) + days * DAY);

test("los aciertos alargan el intervalo de repaso: 1, 3 y luego multiplica", () => {
  const s = emptyState();
  const k = skillKey("english", "Past simple");
  recordAttempt(s, { track: "english", skill: "Past simple", score: 90 }, at(0));
  assert.equal(s.skills[k].intervalDays, 1);
  assert.equal(s.skills[k].dueAt, at(1).toISOString());
  recordAttempt(s, { track: "english", skill: "Past simple", score: 90 }, at(1));
  assert.equal(s.skills[k].intervalDays, 3);
  recordAttempt(s, { track: "english", skill: "Past simple", score: 90 }, at(4));
  assert.equal(s.skills[k].intervalDays, 8); // 3 × 2.7
});

test("un acierto con dudas crece más despacio que uno claro", () => {
  const s = emptyState();
  for (const [d, score] of [[0, 75], [1, 75], [3, 75]]) recordAttempt(s, { track: "english", skill: "A", score }, at(d));
  assert.equal(s.skills[skillKey("english", "A")].intervalDays, 2); // 1 → 2 → round(2 × 1.2)
});

test("un fallo deja la habilidad pendiente ya y reinicia la racha", () => {
  const s = emptyState();
  const k = skillKey("programming", "Recursión");
  recordAttempt(s, { track: "programming", skill: "Recursión", score: 95 }, at(0));
  recordAttempt(s, { track: "programming", skill: "Recursión", score: 95 }, at(1));
  recordAttempt(s, { track: "programming", skill: "Recursión", score: 30 }, at(4));
  const sk = s.skills[k];
  assert.equal(sk.intervalDays, 0);
  assert.equal(sk.streak, 0);
  assert.equal(sk.lapses, 1);
  assert.equal(sk.ease, 2.5); // 2.7 tras dos aciertos claros, −0.2 por el fallo
  assert.ok(isDue(sk, at(4)));
  recordAttempt(s, { track: "programming", skill: "Recursión", score: 95 }, at(4));
  assert.equal(s.skills[k].intervalDays, 1);
});

test("dueSkills devuelve solo lo pendiente, lo más débil primero", () => {
  const s = emptyState();
  recordAttempt(s, { track: "english", skill: "Fácil", score: 100 }, at(0));
  recordAttempt(s, { track: "english", skill: "Difícil", score: 20 }, at(0));
  recordAttempt(s, { track: "english", skill: "Media", score: 50 }, at(0));
  assert.deepEqual(dueSkills(s, "english", at(0)).map((x) => x.name), ["Difícil", "Media"]);
  assert.deepEqual(dueSkills(s, "english", at(1)).map((x) => x.name), ["Difícil", "Media", "Fácil"]);
  assert.deepEqual(trackSummary(s, "english", at(0)).dueForReview, ["Difícil", "Media"]);
});

test("habilidades guardadas antes de la repetición espaciada cuentan como pendientes", () => {
  assert.ok(isDue({ mastery: 80 }));
});

import { comparePhrase, addPhrases, duePhrases, reviewPhrase } from "../src/progress.js";

test("comparePhrase ignora puntuación, mayúsculas y contracciones", () => {
  assert.equal(comparePhrase("Could I get a latte to go?", "could i get a latte to go").score, 100);
  assert.equal(comparePhrase("I'm gonna grab a coffee", "I am going to grab a coffee").score, 100);
  assert.equal(comparePhrase("I'm gonna grab a coffee", "im going to grab a coffee").score, 100);
  const r = comparePhrase("Hang a left at the lights", "turn left at the light");
  assert.ok(r.score < 70);
  assert.deepEqual(r.words.filter((w) => !w.ok).map((w) => w.word), ["hang", "a", "lights"]);
  assert.equal(comparePhrase("Hello there", "").score, 0);
});

test("la libreta no duplica frases y las programa para repaso", () => {
  const s = emptyState();
  const now = at(0);
  const added = addPhrases(s, [
    { phrase: "No worries!", meaning_es: "No pasa nada", when_to_use_es: "Al quitar importancia" },
    { phrase: "no worries", meaning_es: "dup", when_to_use_es: "" },
    { phrase: "I'm good, thanks", meaning_es: "Estoy bien", when_to_use_es: "Al responder" },
  ], { scenario: "coffee" }, now);
  assert.equal(added.length, 2);
  assert.equal(duePhrases(s, now).length, 2);
  const r = reviewPhrase(s, added[0].id, "no worries", now);
  assert.equal(r.score, 100);
  assert.equal(duePhrases(s, now).length, 1);
  assert.equal(duePhrases(s, at(1)).length, 2);
  assert.equal(reviewPhrase(s, "no-existe", "x", now), null);
});
