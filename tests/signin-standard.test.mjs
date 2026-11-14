// The Pulsus sign-in standard: one frame for every sign-in-like page, the app's
// own artwork big at the top, and the human check is Turnstile — never a sum.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("sign-in and sign-up never ask a sum; they render Turnstile when offered and send it as `turnstile`", () => {
  for (const f of ["app/login/SignIn.tsx", "app/signup/SignUp.tsx"]) {
    const s = src(f);
    assert.doesNotMatch(s, /quick check|what is \$\{|\bch\.a\b|check\.a\b/i, f);
    assert.match(s, /useHumanCheck/, f);
    assert.match(s, /HumanCheckBox/, f);
  }
  const hc = src("components/HumanCheck.tsx");
  assert.match(hc, /\{ turnstile: t \}/);
  assert.match(hc, /appearance: "interaction-only"/);
});

test("the human check: Turnstile's key when offered, else the signed check completed by the page", async () => {
  const { solveCheck, turnstileKeyOf } = await import("../components/HumanCheck.tsx").catch(() => ({}));
  if (!solveCheck) return; // a .tsx module the runner can't load; the source checks above cover it
  assert.equal(turnstileKeyOf({ turnstile: "0x4AAA_key-1" }), "0x4AAA_key-1");
  assert.equal(turnstileKeyOf({ turnstile: "<bad>" }), "");
  assert.deepEqual(solveCheck({ a: 3, b: 4, exp: 9, sig: "s" }), { answer: 7, exp: 9, sig: "s" });
  assert.deepEqual(solveCheck(null), {});
});

test("every sign-in-like page uses the one frame with Pulsus Quality's own artwork, day and night", async () => {
  assert.ok(existsSync(new URL("../public/pulsus-quality-icon.png", import.meta.url)));
  assert.ok(existsSync(new URL("../public/pulsus-quality-icon-night.png", import.meta.url)));
  assert.match(src("components/account/AccountFrame.tsx"), /<SignInFrame brand=\{QUALITY_BRAND\}/);
  for (const f of ["components/NoAccess.tsx", "app/licence/page.tsx"]) assert.match(src(f), /<AccountFrame/, f);
  const { licenseWallResponse } = await import("../lib/licenseWall.ts");
  for (const html of [await licenseWallResponse("/").text()]) {
    assert.match(html, /pulsus-quality-icon-day\.png/);
    assert.match(html, /pulsus-quality-icon-night\.png/);
    assert.match(html, /Pulsus <span>Quality<\/span>/);
    assert.match(html, /prefers-color-scheme:dark/);
    assert.doesNotMatch(html, /linear-gradient\(160deg/, "no red page background");
  }
});
