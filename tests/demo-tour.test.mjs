// The demo's guided tour and Getting started card: demo only, in step with
// their recording, and within the content rules (a fictional financial
// institution, no currency prefix, no prices).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { STOPS } from "../components/demoTourStops.ts";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const words = (s) => `${s.title} ${s.text} ${s.say ?? ""}`;

test("the tour opens with the welcome and the Getting started card, and ends handing over", () => {
  assert.equal(STOPS[0].id, "welcome");
  assert.equal(STOPS[1].id, "start");
  assert.deepEqual(STOPS[1].target, ['[data-tour="start"]']);
  assert.equal(STOPS.at(-1).id, "end");
  assert.ok(STOPS.length >= 12 && STOPS.length <= 15, `${STOPS.length} stops`);
  assert.equal(new Set(STOPS.map((s) => s.id)).size, STOPS.length);
  assert.match(words(STOPS[0]), /Meridian Financial Group, a fictional financial institution/);
});

test("the narration keeps to the content rules", () => {
  for (const s of STOPS) {
    const w = words(s);
    assert.doesNotMatch(w, /J\$/, s.id);
    assert.doesNotMatch(w, /\bbank\b/i, s.id);
    assert.doesNotMatch(w, /\bprice|pricing|per seat|per month\b/i, s.id);
  }
});

test("the recording matches the stops and the length the welcome promises", () => {
  const m = JSON.parse(read("public/tour/manifest.json"));
  assert.deepEqual(m.marks.map((x) => x.id), STOPS.map((s) => s.id));
  assert.ok(existsSync(new URL(`../public/tour/${m.file}`, import.meta.url)), m.file);
  const minutes = Math.round(m.duration / 60);
  const said = { three: 3, four: 4, five: 5 }[(STOPS[0].say ?? "").match(/about (\w+) minutes/)?.[1]];
  assert.equal(said, minutes, `the welcome says about ${said} minutes; the recording is ${m.duration} s`);
});

test("the tour and the card show only on a demo build", () => {
  const shell = read("components/Shell.tsx");
  assert.match(shell, /const DEMO_UI = \(process\.env\.NEXT_PUBLIC_DEMO_MODE \|\| ""\) === "1";/);
  assert.match(shell, /const tourOn = DEMO_UI && app\.demo;/);
  assert.match(shell, /\{tourOn && <DemoTour /);
  assert.match(shell, /\{tourOn && <GettingStarted /);
  const card = read("components/GettingStarted.tsx");
  assert.equal((card.match(/\{ path: "/g) || []).length, 6);
});
