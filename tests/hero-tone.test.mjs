// The headline card's colour carries meaning, the same across the suite:
// black = good, amber = mixed, red = not good, black + "No reading yet" = none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heroTone, heroToneOf, heroToneClass, HERO_TONE_LABEL } from "../lib/hero-tone.ts";

test("each suite band maps to one tone", () => {
  for (const b of ["worldClass", "strong", "healthy", "World class", "Strong", "Healthy"]) assert.equal(heroTone(b), "good", b);
  for (const b of ["watch", "Watch"]) assert.equal(heroTone(b), "mixed", b);
  for (const b of ["attention", "escalate", "Attention", "Escalate"]) assert.equal(heroTone(b), "bad", b);
});

test("no band, or one we don't know, is 'no reading yet', never red", () => {
  for (const b of [null, undefined, "", "none", "bogus"]) assert.equal(heroTone(b), "none");
  assert.equal(HERO_TONE_LABEL.none, "No reading yet");
});

test("a summary card: all fine is black, all not-good is red, anything between is amber", () => {
  assert.equal(heroToneOf(["strong", "healthy", "worldClass"]), "good");
  assert.equal(heroToneOf(["attention", "escalate"]), "bad");
  assert.equal(heroToneOf(["strong", "escalate"]), "mixed");
  assert.equal(heroToneOf(["strong", "watch"]), "mixed");
  assert.equal(heroToneOf(["watch"]), "mixed");
  assert.equal(heroToneOf(["strong", null, undefined]), "good", "measures with no reading are left out");
  assert.equal(heroToneOf([]), "none");
  assert.equal(heroToneOf([null, null]), "none");
});

test("the class and the words", () => {
  assert.equal(heroToneClass("good"), "tone-good");
  assert.equal(heroToneClass("bad"), "tone-bad");
  assert.deepEqual(Object.keys(HERO_TONE_LABEL).sort(), ["bad", "good", "mixed", "none"]);
});
