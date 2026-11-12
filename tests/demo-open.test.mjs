// node --experimental-strip-types --test tests/*.test.mjs
//
// The demo opens straight in; production keeps its front door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { demoOpenView } from "../lib/demoOpen.ts";

test("demo deployment: the view is open", () => {
  assert.equal(demoOpenView({ DEMO_MODE: "1" }), true);
  assert.equal(demoOpenView({ DEMO_MODE: " 1 " }), true);
  assert.equal(demoOpenView({ DEMO_MODE: '"1"' }), true);
});

test("production: the view is not opened", () => {
  for (const v of [undefined, "", "0", "true", "yes", "on"]) assert.equal(demoOpenView({ DEMO_MODE: v }), false, String(v));
});

test("the gate opens the demo before the company hand-off and the licence wall", () => {
  const src = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  const open = src.indexOf("if (demoOpenView()) return forward(req);");
  assert.ok(open > 0, "middleware calls demoOpenView()");
  assert.ok(open < src.indexOf("verifyCompanySession(req.cookies"), "before the company session");
  assert.ok(open < src.indexOf("licenseWallActive()) return"), "before the licence wall");
});
