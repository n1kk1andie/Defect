// The Pulsus sign-in form standard (owner standard, Nov 2026): every Pulsus app's
// sign-in page is identical below the brand block — no visible heading (a hidden
// h1 names the page), "Work email" and "Password", the same inputs, one red
// button, "Forgot password?" then the trial line — and the subtitle on one line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { licenseWallResponse } from "../lib/licenseWall.ts";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the sign-in page has no visible heading, the standard labels and links, in order", () => {
  const s = src("app/login/SignIn.tsx");
  assert.match(s, /heading=\{forgot \? undefined : "Sign in to Pulsus Quality"\}/);
  assert.match(s, /className="pf-label">Work email</);
  assert.match(s, /className="sf-btn pf-btn"/);
  assert.ok(s.indexOf(">Forgot password?<") < s.indexOf(">Start a 14-day free trial<"));
  assert.doesNotMatch(s, /sf-or/);
  const f = src("components/SignInFrame.tsx");
  assert.match(f, /<h1 className="pf-sr">\{heading\}<\/h1>/);
  assert.match(f, /className="sf-sub pf-sub"/);
});

test("the standard block is in the stylesheet, and the subtitle stays on one line", async () => {
  const css = src("app/signin-standard.css");
  assert.match(css, /The Pulsus sign-in form standard/);
  assert.match(css, /\.pf \.pf-input \{[^}]*height: 52px !important/);
  assert.match(css, /\.pf \.pf-sub \{[^}]*font-size: clamp\(11px, 3\.1vw, 14px\) !important;[^}]*white-space: nowrap/);
  const html = await licenseWallResponse("/").text();
  assert.match(html, /\.sub\{font-size:clamp\(11px,3\.1vw,14px\);letter-spacing:\.12em;line-height:1\.35;white-space:nowrap\}/);
  assert.match(html, /\.cta\{[^}]*height:54px/);
});
