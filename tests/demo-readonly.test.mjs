// The demo's mode (lib/demoReadOnly.ts, wired into proxy.ts): a demo deployment
// (DEMO_MODE=1) is SHARED by default, as it always was. While the operator
// console (executive.pulsus.tech/api/demo-modes, key "quality") or DEMO_READONLY=1
// makes it read-only, writes to the API are refused with 403 and a pointer to
// the free trial; DEMO_READONLY=0 forces shared; any failure means shared.
// Reads, signing in and the posts that save nothing always work; a live
// deployment is untouched.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const saved = { DEMO_MODE: process.env.DEMO_MODE, DEMO_READONLY: process.env.DEMO_READONLY, DEMO_ACCESS_GATE: process.env.DEMO_ACCESS_GATE, VERCEL: process.env.VERCEL };
process.env.DEMO_ACCESS_GATE = "off";
delete process.env.VERCEL;
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const { demoReadOnly, demoWriteCandidate, demoWriteRefused, demoReadOnlyResponse, resetDemoModeCache, MODES_URL } = await import("../lib/demoReadOnly.ts");
const { proxy } = await import("../proxy.ts");

const r = (method, path, o = {}) => demoWriteRefused({ demo: true, readOnly: true, method, path, ...o });
const answer = (modes, ok = true) => async () => ({ ok, json: async () => ({ modes }) });

test("a read-only demo refuses API writes", () => {
  for (const p of ["/api/inspections", "/api/reviews", "/api/actions", "/api/actions/a1/step", "/api/evidence", "/api/settings", "/api/members", "/api/templates", "/api/templates/import", "/api/scorecards/s1", "/api/scorecard", "/api/sampling", "/api/sampling/p1", "/api/programmes", "/api/structure", "/api/risk", "/api/risk-model", "/api/import", "/api/migrate", "/api/setup", "/api/keys", "/api/alerts", "/api/issues/i1", "/api/issues/links/u1", "/api/reviews/resolve", "/api/admin/database", "/api/public/report/tok", "/api/v1/issues", "/api/demo-other"]) assert.equal(r("POST", p), true, p);
  assert.equal(r("DELETE", "/api/inspections/i1"), true);
  assert.equal(r("PATCH", "/api/settings"), true);
  assert.equal(r("PUT", "//api//inspections/"), true, "path tricks don't slip past");
});

test("reading, signing in and the read-type posts always work", () => {
  assert.equal(demoWriteCandidate({ demo: true, method: "GET", path: "/api/inspections" }), false);
  assert.equal(demoWriteCandidate({ demo: true, method: "HEAD", path: "/api/inspections" }), false);
  for (const p of ["/api/demo", "/api/logout", "/api/health", "/api/cron/notify", "/api/sampling/preview", "/api/table", "/api/bulk"]) assert.equal(r("POST", p), false, p);
  assert.equal(r("POST", "/login"), false, "pages aren't the API");
});

test("never on a live deployment, and nothing refused while the demo is shared", () => {
  assert.equal(r("POST", "/api/inspections", { demo: false }), false);
  assert.equal(r("POST", "/api/inspections", { readOnly: false }), false);
});

test("the mode: DEMO_READONLY decides when set, else the operator's setting, else shared", async () => {
  resetDemoModeCache();
  assert.equal(await demoReadOnly({ DEMO_READONLY: "1" }), true);
  assert.equal(await demoReadOnly({ DEMO_READONLY: "0" }, { fetchImpl: answer({ quality: "readonly" }) }), false);
  resetDemoModeCache();
  assert.equal(await demoReadOnly({}, { fetchImpl: answer({ quality: "readonly" }), now: 1e6 }), true);
  resetDemoModeCache();
  assert.equal(await demoReadOnly({}, { fetchImpl: answer({ quality: "shared" }), now: 1e6 }), false);
  resetDemoModeCache();
  assert.equal(await demoReadOnly({}, { fetchImpl: answer({ recon: "readonly" }), now: 1e6 }), false, "another app's mode isn't ours");
  resetDemoModeCache();
  assert.equal(await demoReadOnly({}, { fetchImpl: async () => { throw new Error("offline"); }, now: 1e6 }), false, "unreachable → shared");
  resetDemoModeCache();
  assert.equal(await demoReadOnly({}, { fetchImpl: answer({}, false), now: 1e6 }), false, "an error answer → shared");
  resetDemoModeCache();
  assert.equal(await demoReadOnly({}, { fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("not JSON"); } }), now: 1e6 }), false, "a garbled answer → shared");
  resetDemoModeCache();
});

test("the operator's setting is cached for half a minute", async () => {
  resetDemoModeCache();
  let calls = 0;
  const f = async () => { calls++; return { ok: true, json: async () => ({ modes: { quality: "readonly" } }) }; };
  await demoReadOnly({}, { fetchImpl: f, now: 1e6 });
  await demoReadOnly({}, { fetchImpl: f, now: 1e6 + 20000 });
  assert.equal(calls, 1);
  await demoReadOnly({}, { fetchImpl: f, now: 1e6 + 31000 });
  assert.equal(calls, 2);
  resetDemoModeCache();
});

test("the refusal points to the free trial", async () => {
  const res = demoReadOnlyResponse();
  assert.equal(res.status, 403);
  const j = await res.json();
  assert.equal(j.readOnlyDemo, true);
  assert.equal(j.trial, "https://quality.pulsus.tech/signup");
  assert.match(j.error, /read-only demo/);
  assert.match(j.error, /Pulsus Quality/);
  assert.match(j.error, /14-day free trial at quality\.pulsus\.tech\/signup/);
});

const req = (method, path) => new NextRequest(`https://demo-quality.pulsus.tech${path}`, { method, headers: { origin: "https://demo-quality.pulsus.tech", host: "demo-quality.pulsus.tech", "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
const refused = async (res) => res.status === 403 && (await res.clone().json().catch(() => ({}))).readOnlyDemo === true;

test("the proxy: shared by default, refuses only while read-only, asks the platform only for a candidate write", async () => {
  const realFetch = globalThis.fetch;
  let asked = 0;
  let mode = "shared";
  globalThis.fetch = async (url, init) => {
    if (String(url) === MODES_URL) { asked++; return new Response(JSON.stringify({ modes: { quality: mode } }), { status: 200 }); }
    return realFetch(url, init);
  };
  try {
    process.env.DEMO_MODE = "1";
    delete process.env.DEMO_READONLY;
    resetDemoModeCache();
    assert.equal(await refused(await proxy(req("POST", "/api/inspections"))), false, "shared: as before");
    assert.equal(asked, 1);
    resetDemoModeCache();
    mode = "readonly";
    assert.equal(await refused(await proxy(req("POST", "/api/inspections"))), true, "the operator made it read-only");
    asked = 0;
    resetDemoModeCache();
    assert.equal(await refused(await proxy(req("GET", "/api/inspections"))), false);
    assert.equal(await refused(await proxy(req("POST", "/api/demo"))), false);
    assert.equal(asked, 0, "reads and open writes never ask the platform");
    resetDemoModeCache();
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await refused(await proxy(req("POST", "/api/inspections"))), false, "platform unreachable → shared");
    process.env.DEMO_READONLY = "1";
    assert.equal(await refused(await proxy(req("POST", "/api/inspections"))), true, "DEMO_READONLY=1 forces read-only");
    process.env.DEMO_READONLY = "0";
    resetDemoModeCache();
    globalThis.fetch = async () => new Response(JSON.stringify({ modes: { quality: "readonly" } }), { status: 200 });
    assert.equal(await refused(await proxy(req("POST", "/api/inspections"))), false, "DEMO_READONLY=0 forces shared");
    process.env.DEMO_MODE = "";
    process.env.DEMO_READONLY = "1";
    assert.equal(await refused(await proxy(req("POST", "/api/inspections"))), false, "live: never");
  } finally {
    globalThis.fetch = realFetch;
    resetDemoModeCache();
  }
});
