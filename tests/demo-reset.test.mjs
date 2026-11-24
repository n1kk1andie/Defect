// The nightly demo reset (app/api/cron/demo-reset, scheduled in vercel.json at
// about 05:00 UTC, midnight in Jamaica): a demo deployment only (404 on live, so
// it does nothing there), only with Vercel Cron's Bearer CRON_SECRET, and it
// restores the published sample without touching anyone's sign-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { demoResetRefusal } = await import("../lib/demoResetGate.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the door: demo only, and only with CRON_SECRET", () => {
  assert.deepEqual(demoResetRefusal({ demo: false, secret: "s3cret", authorization: "Bearer s3cret" }), { status: 404, error: "Not found" }, "live: nothing happens");
  assert.equal(demoResetRefusal({ demo: true, secret: "s3cret", authorization: "Bearer s3cret" }), null);
  assert.equal(demoResetRefusal({ demo: true, secret: "s3cret", authorization: "Bearer wrong!" })?.status, 401);
  assert.equal(demoResetRefusal({ demo: true, secret: "s3cret", authorization: null })?.status, 401);
  assert.equal(demoResetRefusal({ demo: true, secret: "", authorization: "Bearer " })?.status, 401, "no CRON_SECRET: refused");
  assert.equal(demoResetRefusal({ demo: true, secret: undefined, authorization: "Bearer undefined" })?.status, 401);
});

test("scheduled nightly at about 05:00 UTC", () => {
  const cron = JSON.parse(read("vercel.json")).crons.find((c) => c.path === "/api/cron/demo-reset");
  assert.ok(cron, "in vercel.json");
  const [min, hour, dom, mon, dow] = cron.schedule.split(" ");
  assert.equal(hour, "5");
  assert.ok(Number(min) < 30);
  assert.deepEqual([dom, mon, dow], ["*", "*", "*"]);
});

test("the route uses the door and the reset, and never touches logins", () => {
  const src = read("app/api/cron/demo-reset/route.ts");
  assert.match(src, /export async function GET/);
  assert.match(src, /demoResetRefusal\(/);
  assert.ok(src.indexOf("demoResetRefusal(") < src.indexOf("await resetDemo("), "the door comes before the reset");
  assert.match(src, /await resetDemo\("nightly-reset"\)/);
  // resetDemo clears and re-seeds only the demo tenant; sign-in and demo access live on the platform.
  const seed = read("lib/demo/seed.ts");
  assert.match(seed, /tx\.delete\(t\)\.where\(sql`company_id = \$\{DEMO\}`\)/, "the demo tenant only");
});
