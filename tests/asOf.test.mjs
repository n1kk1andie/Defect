// node --experimental-strip-types --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { appNow, appTodayISO, demoAsOf } from "../lib/asOf.ts";

function withEnv(env, fn) {
  const saved = { DEMO_MODE: process.env.DEMO_MODE, DEMO_AS_OF: process.env.DEMO_AS_OF };
  for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
}

const REAL = new Date("2026-11-08T14:25:36.123Z");

test("demo: business date is locked to 30 Oct 2026", () => {
  withEnv({ DEMO_MODE: "1", DEMO_AS_OF: null }, () => {
    assert.equal(demoAsOf(), "2026-10-30");
    assert.equal(appTodayISO(REAL), "2026-10-30");
    // Locked date, real time of day.
    assert.equal(appNow(REAL).toISOString(), "2026-10-30T14:25:36.123Z");
    assert.equal(appTodayISO(), "2026-10-30");
    assert.equal(appNow().toISOString().slice(0, 10), "2026-10-30");
  });
});

test("demo: DEMO_AS_OF overrides, and a malformed one falls back", () => {
  withEnv({ DEMO_MODE: "1", DEMO_AS_OF: "2026-09-15" }, () => assert.equal(appTodayISO(REAL), "2026-09-15"));
  withEnv({ DEMO_MODE: "1", DEMO_AS_OF: "soon" }, () => assert.equal(appTodayISO(REAL), "2026-10-30"));
});

test("production: the real date", () => {
  withEnv({ DEMO_MODE: null, DEMO_AS_OF: "2026-10-30" }, () => {
    assert.equal(demoAsOf(), null);
    assert.equal(appNow(REAL), REAL);
    assert.equal(appTodayISO(REAL), "2026-11-08");
    const t = Date.now();
    assert.ok(Math.abs(appNow().getTime() - t) < 1000);
  });
});
