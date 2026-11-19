// The suite's licence screen standard: the deployment's own tenant (licence
// wall) renews self-service — "View plans & billing" opens Pulsus Quality's
// plans page, with Pulsus support's address in the note for questions; a customer
// company whose own subscription isn't active is offered "View plan & billing"
// on Pulsus Platform. Both carry the suite's two footer lines.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { NextRequest } from "next/server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JWKS = "https://platform.test/api/jwks";
const BILLING = "https://platform.test/company#billing";
const MAILTO = "mailto:support@pulsus.tech?subject=Pulsus%20Quality%20licence%20renewal";
const PLANS = "https://aboutquality.pulsus.tech/plans/";
const NOTE = "Questions about renewing? Write to support@pulsus.tech.";
const FOOT = ["Pulsus Quality · Part of the Pulsus Intelligence Suite", "A product of Tumblehill Labs, a product studio of Tumblehill Holdings LLC."];
delete process.env.DEMO_MODE;
delete process.env.PLATFORM_URL;
process.env.PLATFORM_JWKS_URL = JWKS;

const { proxy } = await import("../proxy.ts");
const wall = await import("../lib/licenseWall.ts");
const { platformUrl } = await import("../lib/platform-jwt.ts");

const unesc = (h) => h.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
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
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.LICENSE_WALL;
  delete process.env.DEMO_MODE;
});

const sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt().setAudience("pulsus-suite").setExpirationTime("1h").sign(key.privateKey);
const staff = () => sign({ iss: "pulsus-command-center", email: "staff@institution.test" });
const company = (extra) => sign({ iss: "pulsus-company", email: "owner@acme.test", company_id: "acme", company_name: "Acme", role: "owner", modules: ["quality"], standing: "active", ...extra });
const req = (p, token) => new NextRequest("https://quality.pulsus.tech" + p, { headers: token ? { cookie: `exec_auth=${token}` } : {} });

function footerExact(html) {
  const foot = html.match(/<footer class="foot">([\s\S]*?)<\/footer>/)?.[1] || "";
  const lines = [...foot.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => unesc(m[1]));
  assert.deepEqual(lines, FOOT);
}

test("own-tenant licence wall: License Required, View plans & billing (the plans page), never Platform billing", async () => {
  process.env.LICENSE_WALL = "on";
  const res = await proxy(req("/", await staff()));
  assert.equal(res.status, 403);
  const html = await res.text();
  const text = unesc(html);
  assert.match(text, /<h2>License Required<\/h2>/);
  assert.ok(text.includes("This organisation's licence has ended. Your records are kept."));
  assert.ok(text.includes(`<a class="cta" href="${PLANS}" target="_top">View plans & billing</a>`));
  assert.ok(text.includes(`<p class="note">${NOTE}</p>`));
  assert.equal(wall.RENEW_LABEL, "View plans & billing");
  assert.equal(wall.PLANS_URL, PLANS);
  assert.equal(wall.RENEW_NOTE, NOTE);
  assert.doesNotMatch(text, /mailto:|ontact us to renew/);
  assert.doesNotMatch(text, /company#billing|View plan &/);
  footerExact(html);
  assert.doesNotMatch(html, /Tumblehill Holdings LLC Product/);
});

test("own-tenant licence wall: an API call gets JSON (403) with the plans page and the contact", async () => {
  process.env.LICENSE_WALL = "on";
  const res = await proxy(req("/api/issues", await staff()));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "License Required");
  assert.equal(body.plans, PLANS);
  assert.equal(body.contact, MAILTO);
  assert.equal(body.plan, undefined);
});

test("a customer company whose subscription isn't active goes to the licence page; its API gets 402 with the plan", async () => {
  process.env.LICENSE_WALL = "on"; // the own tenant's wall doesn't touch a customer company
  const t = await company({ standing: "suspended" });
  const res = await proxy(req("/issues", t));
  assert.equal(res.status, 307);
  assert.match(res.headers.get("location"), /\/licence\?reason=suspended$/);
  const api = await proxy(req("/api/issues", t));
  assert.equal(api.status, 402);
  assert.equal((await api.json()).plan, BILLING);
});

test("the licence page (customer company): License Required, View plan & billing on Platform, the two footer lines", () => {
  assert.equal(wall.PAUSED_MESSAGE, "Your organisation's Pulsus subscription is not active. Your records are kept.");
  assert.equal(wall.BILLING_LABEL, "View plan & billing");
  assert.equal(wall.BILLING_NOTE, "Only your organisation's owner can pay. Ask them, or your administrator, if you can't.");
  const page = readFileSync(path.join(ROOT, "app/licence/page.tsx"), "utf8");
  assert.match(page, /<LicenceNotice title=\{LICENSE_WALL_TITLE\} body=\{PAUSED_MESSAGE\} href=\{`\$\{platformUrl\(\)\}\/company#billing`\} label=\{BILLING_LABEL\} note=\{BILLING_NOTE\} \/>/);
  assert.match(readFileSync(path.join(ROOT, "components/account/AccountFrame.tsx"), "utf8"), /function LicenceNotice[\s\S]*foot=\{<SuiteFoot \/>\}/);
  assert.doesNotMatch(page, /mailto:/);
});

test("Quality not switched on for a customer company: the frame, View plan & billing, the two footer lines", async () => {
  const res = await proxy(req("/", await company({ modules: ["risk"] })));
  assert.equal(res.status, 403);
  const html = await res.text();
  const text = unesc(html);
  assert.ok(text.includes(`<a class="cta" href="${BILLING}" target="_top">View plan & billing</a>`));
  assert.ok(text.includes(wall.BILLING_NOTE));
  assert.doesNotMatch(text, /mailto:/);
  footerExact(html);
});

test("Plan & billing follows the hub: the demo hub on a demo", () => {
  delete process.env.PLATFORM_JWKS_URL;
  process.env.DEMO_MODE = "1";
  assert.equal(platformUrl(), "https://demo-executive.pulsus.tech");
  delete process.env.DEMO_MODE;
  assert.equal(platformUrl(), "https://executive.pulsus.tech");
  process.env.PLATFORM_JWKS_URL = JWKS;
});

test("sign-in: the walled message points to the plans, not \"contact us to renew\"", async () => {
  const { SIGNIN_ERRORS } = await import("../lib/turnstile.ts");
  assert.equal(SIGNIN_ERRORS.license_required, "License Required. This organisation's licence has ended. Your records are kept. Choose a plan to renew; questions to support@pulsus.tech.");
});

test("no \"Tumblehill Holdings LLC Product\" anywhere a user can see it", () => {
  const hits = [];
  const walk = (d) => { for (const f of readdirSync(d)) { if (["node_modules", ".next", ".git", "tests"].includes(f)) continue; const p = path.join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(tsx?|mjs|js|css|html|json|md)$/.test(f) && readFileSync(p, "utf8").includes("Tumblehill Holdings LLC Product")) hits.push(p); } };
  walk(ROOT);
  assert.deepEqual(hits, []);
});

