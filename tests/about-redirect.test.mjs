// The front door (proxy.ts): on the live host, a signed-out visitor at / whose
// browser has never signed in here goes (302) to https://aboutquality.pulsus.tech/.
// A browser marked pulsus_known (set on every signed-in response) gets today's
// sign-in page. Signed-in sessions still open the app, every other path, the API,
// the licence wall, demo and preview deployments are unchanged.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { NextRequest } from "next/server";

const APP = "quality";
const ABOUT = "https://aboutquality.pulsus.tech/";
const JWKS = "https://platform.test/api/jwks";
process.env.PLATFORM_JWKS_URL = JWKS;
process.env.PLATFORM_URL = "https://platform.test";
delete process.env.DEMO_MODE;
delete process.env.VERCEL;

const { proxy } = await import("../proxy.ts");

let key, jwk;
before(async () => {
  key = await generateKeyPair("RS256", { extractable: true });
  jwk = { ...(await exportJWK(key.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u === JWKS) return Response.json({ keys: [jwk] });
    if (u.endsWith("/api/session/status")) return Response.json({ active: true });
    throw new Error("unexpected fetch " + u);
  };
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.LICENSE_WALL; delete process.env.DEMO_MODE; delete process.env.DEMO_ACCESS_GATE; });

const now = () => Math.floor(Date.now() / 1000);
function session(claims) {
  return new SignJWT({ aud: "pulsus-suite", ...claims }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt().setExpirationTime(now() + 3600).sign(key.privateKey);
}
const staff = () => session({ iss: "pulsus-command-center", email: "staff@example.test" });
const company = () => session({ iss: "pulsus-company", email: "member@example.test", company_id: "acme", company_name: "Acme", role: "admin", modules: [APP], standing: "active" });

const LIVE = "quality.pulsus.tech";
function req(path, { session: tok, known = false, host = LIVE } = {}) {
  const headers = new Headers({ host });
  const c = [tok && `exec_auth=${tok}`, known && "pulsus_known=1"].filter(Boolean).join("; ");
  if (c) headers.set("cookie", c);
  return new NextRequest(new URL(path, `https://${host}`), { headers });
}
const loc = (r) => r.headers.get("location");
const passes = (r) => r.status === 200 && r.headers.get("x-middleware-next") === "1";
const marks = (r) => {
  const c = r.headers.get("set-cookie") || "";
  return /pulsus_known=1/.test(c) && /Path=\//i.test(c) && /Max-Age=34560000/i.test(c) && /Secure/i.test(c) && /SameSite=Lax/i.test(c);
};
const toLogin = (r) => [302, 307].includes(r.status) && new URL(loc(r)).pathname === "/login";

for (const wall of ["off", "on"]) {
  test(`wall ${wall}: never signed in on this browser, / (any query) → 302 to the product site`, async () => {
    process.env.LICENSE_WALL = wall;
    for (const path of ["/", "/?utm_source=x"]) {
      const r = await proxy(req(path));
      assert.equal(r.status, 302);
      assert.equal(loc(r), ABOUT);
    }
    const stale = await proxy(req("/", { session: "not-a-token" }));
    assert.equal(loc(stale), ABOUT);
  });
  test(`wall ${wall}: signed out but signed in here before (pulsus_known) → today's sign-in page`, async () => {
    process.env.LICENSE_WALL = wall;
    const r = await proxy(req("/", { known: true }));
    assert.ok(toLogin(r), `got ${r.status} ${loc(r)}`);
    assert.notEqual(loc(r), ABOUT);
  });
  test(`wall ${wall}: other pages still go to sign-in; /login and the API are untouched`, async () => {
    process.env.LICENSE_WALL = wall;
    const r = await proxy(req("/actions"));
    assert.match(loc(r), /\/login\?next=%2Factions$/);
    assert.ok(passes(await proxy(req("/login"))));
    const a = await proxy(req("/api/issues"));
    assert.ok(a.status === 401 || a.status === 403);
    assert.notEqual(loc(a), ABOUT);
    assert.match(a.headers.get("content-type") || "", /json/);
  });
  test(`wall ${wall}: a company session opens the app at / and marks the browser`, async () => {
    process.env.LICENSE_WALL = wall;
    const r = await proxy(req("/", { session: await company() }));
    assert.ok(passes(r));
    assert.ok(marks(r), r.headers.get("set-cookie"));
  });
  test(`wall ${wall}: preview (*.vercel.app) and demo- hosts never go to the product site`, async () => {
    process.env.LICENSE_WALL = wall;
    for (const host of ["defect-git-x.vercel.app", "demo-quality.pulsus.tech", "localhost:3000"]) {
      const r = await proxy(req("/", { host }));
      assert.notEqual(loc(r), ABOUT, host);
      assert.ok(toLogin(r), `${host}: ${r.status} ${loc(r)}`);
    }
  });
}

test("a staff session, wall off: / opens the app and marks the browser", async () => {
  process.env.LICENSE_WALL = "off";
  const r = await proxy(req("/", { session: await staff() }));
  assert.ok(passes(r));
  assert.ok(marks(r));
});

test("a staff session, wall on: / still gets the licence wall (and is marked), not the product site", async () => {
  process.env.LICENSE_WALL = "on";
  const r = await proxy(req("/", { session: await staff() }));
  assert.notEqual(loc(r), ABOUT);
  assert.ok(marks(r));
  assert.ok(r.status >= 400 || /licen/i.test(await r.text()));
});

test("signed-out responses never set pulsus_known", async () => {
  process.env.LICENSE_WALL = "off";
  for (const r of [await proxy(req("/")), await proxy(req("/actions")), await proxy(req("/login"))]) assert.ok(!/pulsus_known/.test(r.headers.get("set-cookie") || ""));
});

test("a demo deployment (DEMO_MODE=1) never redirects / to the product site, even on the live host", async () => {
  process.env.DEMO_MODE = "1";
  process.env.DEMO_ACCESS_GATE = "off";
  const r = await proxy(req("/"));
  assert.notEqual(loc(r), ABOUT);
  assert.ok(passes(r));
});
