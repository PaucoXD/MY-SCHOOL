import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, recordAttempt, weakestSkills, trackSummary, skillKey } from "../src/progress.js";

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
