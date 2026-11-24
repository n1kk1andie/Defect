// The read-only demo (lib/demoReadOnly.ts, wired into proxy.ts after the
// demo-access gate): on a demo deployment (DEMO_MODE=1) writes to the API are
// refused with 403 and a pointer to the free trial, unless DEMO_READONLY=0.
// Reads, persona switching, sign-out and the previews that save nothing still
// work; a live deployment is untouched.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const saved = { DEMO_MODE: process.env.DEMO_MODE, DEMO_READONLY: process.env.DEMO_READONLY, DEMO_ACCESS_GATE: process.env.DEMO_ACCESS_GATE, VERCEL: process.env.VERCEL };
process.env.DEMO_ACCESS_GATE = "off";
delete process.env.VERCEL;
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const { demoReadOnly, demoReadOnlyNow, demoWriteRefused, demoReadOnlyResponse } = await import("../lib/demoReadOnly.ts");
const { proxy } = await import("../proxy.ts");

const r = (method, path, o = {}) => demoWriteRefused({ demo: true, readOnly: true, method, path, ...o });

test("a read-only demo refuses API writes", () => {
  for (const p of ["/api/inspections", "/api/reviews", "/api/actions", "/api/actions/a1/step", "/api/evidence", "/api/settings", "/api/members", "/api/templates", "/api/templates/import", "/api/scorecards/s1", "/api/scorecard", "/api/sampling", "/api/sampling/p1", "/api/programmes", "/api/structure", "/api/risk", "/api/risk-model", "/api/import", "/api/migrate", "/api/setup", "/api/keys", "/api/alerts", "/api/issues/i1", "/api/issues/links/u1", "/api/reviews/resolve", "/api/admin/database", "/api/public/report/tok", "/api/v1/issues"]) assert.equal(r("POST", p), true, p);
  assert.equal(r("DELETE", "/api/inspections/i1"), true);
  assert.equal(r("PATCH", "/api/settings"), true);
  assert.equal(r("PUT", "//api//program/"), true, "path tricks don't slip past");
  assert.equal(r("POST", "/api/demo-other"), true, "only the exact open routes");
});

test("reading, switching persona, signing out and previews still work", () => {
  assert.equal(r("GET", "/api/inspections"), false);
  assert.equal(r("HEAD", "/api/data"), false);
  for (const p of ["/api/demo", "/api/logout", "/api/health", "/api/cron/notify", "/api/sampling/preview", "/api/table", "/api/bulk"]) assert.equal(r("POST", p), false, p);
  assert.equal(r("POST", "/login"), false, "pages aren't the API");
});

test("never on a live deployment, and off with DEMO_READONLY=0", () => {
  assert.equal(r("POST", "/api/inspections", { demo: false }), false);
  assert.equal(r("POST", "/api/inspections", { readOnly: false }), false);
  assert.equal(demoReadOnly({}), true, "read-only by default");
  assert.equal(demoReadOnly({ DEMO_READONLY: "1" }), true);
  assert.equal(demoReadOnly({ DEMO_READONLY: "0" }), false);
  assert.equal(demoReadOnly({ DEMO_READONLY: " \"0\" " }), false);
  assert.equal(demoReadOnlyNow({ DEMO_MODE: "1" }), true);
  assert.equal(demoReadOnlyNow({ DEMO_MODE: "1", DEMO_READONLY: "0" }), false);
  assert.equal(demoReadOnlyNow({}), false, "live: never");
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

test("the proxy refuses a demo write, and lets reads and DEMO_READONLY=0 through", async () => {
  process.env.DEMO_MODE = "1";
  delete process.env.DEMO_READONLY;
  const res = await proxy(req("POST", "/api/inspections"));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).readOnlyDemo, true);
  assert.notEqual((await proxy(req("GET", "/api/inspections"))).status, 403);
  assert.notEqual((await proxy(req("POST", "/api/demo"))).status, 403);
  process.env.DEMO_READONLY = "0";
  const open = await proxy(req("POST", "/api/inspections"));
  assert.notEqual(open.status, 403);
  assert.equal(open.headers.get("x-middleware-next"), "1", "DEMO_READONLY=0: on to the route as before");
  process.env.DEMO_MODE = "";
  delete process.env.DEMO_READONLY;
  const live = await proxy(req("POST", "/api/inspections"));
  assert.notEqual((await live.json().catch(() => ({}))).readOnlyDemo, true, "live: the usual checks, never the demo refusal");
});
