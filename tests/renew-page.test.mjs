// Pulsus Quality's own "Renew and pay" page: /renew (public/renew.html, with
// pulsus-renew.js and pulsus-renew.css) pays for Pulsus Quality alone, straight
// to Stripe, through Pulsus Platform's billing service. It is served without a
// session (past the licence wall and the licence page), and every renewal
// button in the app points at it, never at Pulsus Platform's /company?renew=.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { NextRequest } from "next/server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");
const JWKS = "https://platform.test/api/jwks";
delete process.env.DEMO_MODE;
delete process.env.PLATFORM_URL;
process.env.PLATFORM_JWKS_URL = JWKS;
const { proxy } = await import("../proxy.ts");

let key, jwk, realFetch;
before(async () => {
  key = await generateKeyPair("RS256", { extractable: true });
  jwk = { ...(await exportJWK(key.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u === JWKS) return Response.json({ keys: [jwk] });
    if (u.endsWith("/api/session/status")) return Response.json({ active: true });
    return new Response("not found", { status: 404 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.LICENSE_WALL; });

const sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt().setAudience("pulsus-suite").setExpirationTime("1h").sign(key.privateKey);
const staff = () => sign({ iss: "pulsus-command-center", email: "staff@institution.test" });
const company = (extra) => sign({ iss: "pulsus-company", email: "owner@acme.test", company_id: "acme", company_name: "Acme", role: "owner", modules: ["quality"], standing: "active", ...extra });
const req = (p, token) => new NextRequest("https://quality.pulsus.tech" + p, { headers: token ? { cookie: `exec_auth=${token}` } : {} });
const through = (res) => res.headers.get("x-middleware-next") === "1";

test("/renew is rewritten to public/renew.html, and the page's files are there", async () => {
  const cfg = (await import("../next.config.mjs")).default;
  assert.deepEqual(await cfg.rewrites(), [{ source: "/renew", destination: "/renew.html" }]);
  for (const f of ["public/renew.html", "public/pulsus-renew.js", "public/pulsus-renew.css", "public/pulsus-quality-emblem-day.png", "public/pulsus-quality-icon.png"]) assert.ok(existsSync(path.join(ROOT, f)), f);
});

test("the page: Pulsus Quality, product quality, its own sign-in back to /renew, no inline script", () => {
  const h = read("public/renew.html");
  assert.ok(h.includes("<title>Renew and pay · Pulsus Quality</title>"));
  assert.ok(h.includes('data-product="quality"') && h.includes('data-name="Pulsus Quality"'));
  assert.ok(h.includes('data-signin="/login?next=%2Frenew"'));
  assert.ok(h.includes('data-plans="https://aboutquality.pulsus.tech/plans/"') && h.includes('data-home="/"'));
  assert.ok(!h.includes("data-api"), "the script picks the platform by host");
  assert.ok(h.includes('<img src="/pulsus-quality-emblem-day.png" alt="">'));
  assert.ok(h.includes("Pulsus Quality · Part of the Pulsus Intelligence Suite<br>A product of Tumblehill Labs, a product studio of Tumblehill Holdings LLC."));
  assert.deepEqual([...h.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]), ['<script src="/pulsus-renew.js">']);
  const js = read("public/pulsus-renew.js");
  assert.ok(js.includes("/api/billing/renew") && js.includes("demo-executive.pulsus.tech"));
  // The sign-in page takes /renew as its return path.
  const m = read("app/login/page.tsx").match(/const to = (.+?) \? next : "\/";/);
  const ok = (next) => new Function("next", `return ${m[1]};`)(next);
  assert.equal(ok("/renew"), true);
  assert.equal(ok("//evil.example"), false);
});

test("the proxy lets /renew and its files through: signed out, walled, lapsed company, Quality not switched on", async () => {
  process.env.LICENSE_WALL = "on";
  const visitors = [null, await staff(), await company({ standing: "suspended" }), await company({ modules: ["risk"] })];
  for (const t of visitors) for (const p of ["/renew", "/renew.html", "/pulsus-renew.js", "/pulsus-renew.css"]) {
    assert.ok(through(await proxy(req(p, t))), `${p} ${t ? "signed in" : "signed out"}`);
  }
  // The rest of the app stays walled.
  assert.equal((await proxy(req("/issues"))).status, 307);
  assert.equal((await proxy(req("/renewals"))).status, 307);
});

test("the CSP lets the page load its script and call Pulsus Platform's billing service", async () => {
  const { securityHeaders } = await import("../security-headers.mjs");
  const csp = securityHeaders.find((h) => h.key === "Content-Security-Policy").value;
  const dir = (n) => csp.split("; ").find((d) => d.startsWith(n + " ")) || "";
  assert.match(dir("script-src"), /'self'/);
  assert.match(dir("connect-src"), /https:\/\/executive\.pulsus\.tech/);
  assert.match(dir("connect-src"), /https:\/\/demo-executive\.pulsus\.tech/);
  assert.match(dir("style-src"), /https:\/\/fonts\.googleapis\.com/);
  assert.match(dir("font-src"), /https:\/\/fonts\.gstatic\.com/);
  assert.match(dir("img-src"), /'self'/);
});

test("every renewal button points at /renew, none at Pulsus Platform's /company?renew=", async () => {
  process.env.LICENSE_WALL = "on";
  const html = await (await proxy(req("/", await staff()))).text();
  assert.match(html, /<a class="cta" href="\/renew"[^>]*>Renew and pay<\/a>/);
  assert.equal((await (await proxy(req("/api/issues", await staff()))).json()).renew, "/renew");
  assert.equal((await (await proxy(req("/api/issues", await company({ standing: "suspended" })))).json()).renew, "/renew");
  assert.match(read("app/licence/page.tsx"), /href=\{renewUrl\(\)\} label=\{RENEW_LABEL\}/);
  for (const f of ["lib/licenseWall.ts", "app/licence/page.tsx", "proxy.ts", "lib/turnstile.ts", "lib/planStatus.ts", "lib/restApi.ts"]) assert.ok(!read(f).includes("company?renew"), f);
});
