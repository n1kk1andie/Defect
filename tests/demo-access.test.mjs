// The demo-access gate (lib/demoAccess.ts, wired into proxy.ts): on a demo
// deployment (DEMO_MODE=1) a visitor needs the platform's pz_demo token, else
// pages go to the register page and APIs answer 401; a live deployment is
// untouched. Keys are generated here; the platform's JWKS and its webby check
// are served by a fetch stand-in.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { NextRequest } from "next/server";

// ── This app ──
const APP = "quality";
const ORIGIN = "https://quality-demo.pulsus.tech";
const PAGE = "/issues?status=open";
const API = "/api/issues";
const EXEMPT = ["/api/pulse", "/api/data", "/api/v1/issues", "/api/cron/daily", "/api/logout"];

const JWKS = "https://platform.test/api/jwks";
const CHECK = "https://platform.test/api/demo/access/check";
process.env.DEMO_ACCESS_JWKS_URL = JWKS;
delete process.env.DEMO_ACCESS_CHECK_URL;
delete process.env.DEMO_ACCESS_GATE;
delete process.env.VERCEL;
const savedDemo = process.env.DEMO_MODE;

const { demoAccessGate, verifyDemoAccess, resetDemoAccessCache, registerUrl } = await import("../lib/demoAccess.ts");
const { proxy: proxy } = await import("../proxy.ts");

let key, other, jwk;
before(async () => {
  key = await generateKeyPair("RS256", { extractable: true });
  other = await generateKeyPair("RS256", { extractable: true });
  jwk = { ...(await exportJWK(key.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

const now = () => Math.floor(Date.now() / 1000);
async function token({ iss = "pulsus-demo-access", aud = "pulsus-demo", kind = "visitor", sub = "reg_1", exp = now() + 3600, signer, kid = "k1" } = {}) {
  const t = new SignJWT({ kind }).setProtectedHeader({ alg: "RS256", kid }).setIssuedAt().setSubject(sub).setExpirationTime(exp);
  if (iss) t.setIssuer(iss);
  if (aud) t.setAudience(aud);
  return t.sign(signer ?? key.privateKey);
}

let realFetch, checkCalls, revoked, checkDown;
beforeEach(() => {
  resetDemoAccessCache();
  checkCalls = 0; revoked = new Set(); checkDown = false;
  realFetch = globalThis.fetch;
  process.env.DEMO_MODE = "1";
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === JWKS) return Response.json({ keys: [jwk] });
    if (u === CHECK) {
      checkCalls++;
      if (checkDown) throw new TypeError("fetch failed");
      const h = new Headers(init.headers);
      const t = (h.get("authorization") || "").replace(/^Bearer /, "");
      const sub = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub;
      return Response.json({ ok: !revoked.has(sub) });
    }
    return new Response("not found", { status: 404 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedDemo === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = savedDemo;
  delete process.env.DEMO_ACCESS_GATE;
  delete process.env.VERCEL;
});

const req = (path, { cookie, headers = {}, method = "GET" } = {}) =>
  new NextRequest(ORIGIN + path, { method, headers: { ...(cookie ? { cookie: `pz_demo=${cookie}` } : {}), ...headers } });
const expectRegister = (res, path) => {
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"),
    `https://executive.pulsus.tech/demo/register?app=${APP}&next=${encodeURIComponent(ORIGIN + path)}`);
};
const passes = (res) => {
  const loc = res?.headers.get("location") || "";
  assert.ok(!loc.startsWith("https://executive.pulsus.tech/demo/register"), `redirected to register: ${loc}`);
  assert.notEqual(res?.status, 401);
};

test("no cookie: a page goes to the register page with this app's key and the full current url", async () => {
  expectRegister(await proxy(req(PAGE)), PAGE);
  expectRegister(await proxy(req("/")), "/");
});

test("the register url is built exactly", () => {
  assert.equal(registerUrl(APP, "https://x.pulsus.tech/a?b=1&c=2"),
    `https://executive.pulsus.tech/demo/register?app=${APP}&next=https%3A%2F%2Fx.pulsus.tech%2Fa%3Fb%3D1%26c%3D2`);
});

test("behind the proxy: next is the address the visitor sees", async () => {
  const res = await demoAccessGate(new NextRequest("http://localhost:3000" + PAGE, { headers: { "x-forwarded-host": `${APP}-demo.pulsus.tech`, "x-forwarded-proto": "https" } }), { app: APP });
  expectRegister(res, PAGE);
});

test("a valid visitor token opens the app", async () => {
  passes(await proxy(req(PAGE, { cookie: await token() })));
  passes(await proxy(req(API, { cookie: await token() })));
  assert.deepEqual((await verifyDemoAccess(await token({ sub: "reg_9" })))?.sub, "reg_9");
});

test("expired, wrong issuer, wrong audience, wrong kind, bad signature, unknown key, garbage: register page", async () => {
  const bad = [
    await token({ exp: now() - 10 }),
    await token({ iss: "pulsus-command-center" }),
    await token({ iss: "" }),
    await token({ aud: "pulsus-suite" }),
    await token({ aud: "" }),
    await token({ kind: "staff" }),
    await token({ signer: other.privateKey }),
    await token({ signer: other.privateKey, kid: "k2" }),
    "not.a.jwt",
    "x",
  ];
  for (const t of bad) expectRegister(await proxy(req(PAGE, { cookie: t })), PAGE);
  // alg "none" is never accepted
  const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: "pulsus-demo-access", aud: "pulsus-demo", kind: "visitor", sub: "a", exp: now() + 60 })).toString("base64url")}.`;
  expectRegister(await proxy(req(PAGE, { cookie: none })), PAGE);
});

test("a webby token passes; a revoked one goes to register; the check is cached per token", async () => {
  const w = await token({ kind: "webby", sub: "webby_1" });
  passes(await proxy(req(PAGE, { cookie: w })));
  passes(await proxy(req(PAGE, { cookie: w })));
  assert.equal(checkCalls, 1);
  revoked.add("webby_2");
  const r = await token({ kind: "webby", sub: "webby_2" });
  expectRegister(await proxy(req(PAGE, { cookie: r })), PAGE);
  // visitor tokens are not checked with the platform
  const before = checkCalls;
  passes(await proxy(req(PAGE, { cookie: await token() })));
  assert.equal(checkCalls, before);
});

test("a webby token is accepted when the platform's check can't be reached", async () => {
  checkDown = true;
  passes(await proxy(req(PAGE, { cookie: await token({ kind: "webby", sub: "webby_3" }) })));
});

test("an API call without a token: 401 JSON", async () => {
  const res = await proxy(req(API));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "demo_registration_required");
  const bad = await proxy(req(API, { cookie: await token({ aud: "nope" }) }));
  assert.equal(bad.status, 401);
});

test("static assets, icons, manifest, robots, health and this app's machine endpoints are exempt", async () => {
  for (const p of ["/_next/static/chunks/app.js", "/_next/image?url=%2Fa.png&w=64&q=75", "/favicon.ico", "/icon.png", "/apple-icon.png", "/apple-touch-icon.png",
    "/manifest.webmanifest", "/robots.txt", "/api/health", "/fonts/a.woff2", "/brand/logo.svg", ...EXEMPT]) {
    const res = await proxy(req(p));
    const loc = res?.headers.get("location") || "";
    assert.ok(!loc.startsWith("https://executive.pulsus.tech/demo/register"), `${p} redirected to register`);
    assert.ok(!(res?.status === 401 && (await res.clone().json().catch(() => ({}))).error === "demo_registration_required"), `${p} got the demo 401`);
  }
});

test("live deployment (DEMO_MODE unset): no gate at all", async () => {
  delete process.env.DEMO_MODE;
  assert.equal(await demoAccessGate(req(PAGE), { app: APP }), null);
  assert.equal(await demoAccessGate(req(API), { app: APP }), null);
  for (const p of [PAGE, API, "/"]) {
    const res = await proxy(req(p));
    const loc = res?.headers.get("location") || "";
    assert.ok(!loc.includes("/demo/register"), `${p} went to the demo register page in live mode`);
    if (res?.status === 401) assert.notEqual((await res.clone().json().catch(() => ({}))).error, "demo_registration_required");
  }
});

test("DEMO_ACCESS_GATE=off switches the gate off for local runs, never on Vercel", async () => {
  process.env.DEMO_ACCESS_GATE = "off";
  assert.equal(await demoAccessGate(req(PAGE), { app: APP }), null);
  process.env.VERCEL = "1";
  expectRegister(await demoAccessGate(req(PAGE), { app: APP }), PAGE);
});
