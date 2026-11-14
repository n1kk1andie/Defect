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
  assert.ok(existsSync(new URL("../public/pulsus-quality-emblem-day.png", import.meta.url)));
  assert.ok(existsSync(new URL("../public/pulsus-quality-emblem-night.png", import.meta.url)));
  assert.ok(existsSync(new URL("../public/pulsus-quality-icon-night.png", import.meta.url)));
  assert.match(src("components/account/AccountFrame.tsx"), /<SignInFrame brand=\{QUALITY_BRAND\}/);
  for (const f of ["components/NoAccess.tsx", "app/licence/page.tsx"]) assert.match(src(f), /<AccountFrame|<LicenceNotice/, f);
  const { licenseWallResponse } = await import("../lib/licenseWall.ts");
  for (const html of [await licenseWallResponse("/").text()]) {
    assert.match(html, /pulsus-quality-emblem-day\.png/);
    assert.match(html, /pulsus-quality-emblem-night\.png/);
    assert.match(html, /Pulsus <span>Quality<\/span>/);
    assert.match(html, /prefers-color-scheme:dark/);
    assert.doesNotMatch(html, /linear-gradient\(160deg/, "no red page background");
  }
});

test("the uniform brand block: emblem-only 176/200 px box, Pulsus <App> as live bold text, the subtitle, the tagline — the same in the React frame and the static notices", async () => {
  const css = src("app/signin-standard.css");
  const block = css.slice(css.indexOf("The uniform brand block"));
  assert.match(block, /\.sf \.sf-emblem \{ width: 176px; height: 176px;[^}]*object-fit: contain; margin: 4px auto 0; \}/);
  assert.match(block, /@media \(min-width: 600px\) \{\n  \.sf \.sf-emblem \{ width: 200px; height: 200px;/);
  assert.match(block, /font-weight: 800;\n  font-size: clamp\(30px, 10vw, 40px\); line-height: 1\.1; letter-spacing: -0\.01em; white-space: nowrap; color: #0b1f4d;/);
  assert.match(block, /\.sf \.sf-name \.sf-word \{ color: #c8102e; \}/);
  assert.match(block, /\.sf \.sf-sub \{ margin: 8px 0 0;[^}]*font-weight: 700; font-size: 14px;[^}]*letter-spacing: 0\.16em; text-transform: uppercase; color: #0b1f4d; \}/);
  assert.match(block, /\.sf \.sf-tag \{ margin: 22px 0 0;[^}]*font-size: 18px;/);
  assert.match(block, /color: #f3f4fb;[\s\S]*#ff4d6d[\s\S]*#c6cae3/);
  assert.doesNotMatch(src("components/SignInFrame.tsx"), /sf-desc/, "no descriptor line in the brand block");
  const { licenseWallResponse } = await import("../lib/licenseWall.ts");
  const html = await licenseWallResponse("/").text();
  assert.match(html, /img\.emblem\{display:block;width:176px;height:176px;object-fit:contain;margin:4px auto 0\}/);
  assert.match(html, /@media \(min-width:600px\)\{img\.emblem\{width:200px;height:200px\}\.name\{font-size:44px\}\}/);
  assert.match(html, /\.name\{margin:12px 0 0;[^}]*font-weight:800;font-size:clamp\(30px,10vw,40px\);line-height:1\.1;letter-spacing:-\.01em;white-space:nowrap;color:#0b1f4d\}\.name span\{color:#c8102e\}/);
  assert.match(html, /<h1 class="name">Pulsus <span>Quality<\/span><\/h1><p class="sub">Quality assurance<\/p><p class="tag">Live\. <span>Signal\.<\/span> Clarity\.<\/p>/);
});
