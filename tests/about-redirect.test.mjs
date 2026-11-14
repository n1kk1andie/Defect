// The front door (proxy.ts): a signed-out visitor at / goes (302) to the
// product's own site, https://aboutquality.pulsus.tech/. Signed-in sessions still
// open the app, every other path still goes to the sign-in page, the licence
// wall still stops a staff session, and a demo deployment never redirects.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { NextRequest } from "next/server";

const APP = "quality";
const ABOUT = "https://aboutquality.pulsus.tech/";
const ORIGIN = "https://app.test";
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

function req(path, cookie) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `exec_auth=${cookie}`);
  return new NextRequest(new URL(path, ORIGIN), { headers });
}
const loc = (r) => r.headers.get("location");
const passes = (r) => r.status === 200 && r.headers.get("x-middleware-next") === "1";

for (const wall of ["off", "on"]) {
  test(`signed out, wall ${wall}: / → 302 to the product site`, async () => {
    process.env.LICENSE_WALL = wall;
    const r = await proxy(req("/"));
    assert.equal(r.status, 302);
    assert.equal(loc(r), ABOUT);
  });
  test(`signed out, wall ${wall}: a stale session at / → the product site`, async () => {
    process.env.LICENSE_WALL = wall;
    const r = await proxy(req("/", "not-a-token"));
    assert.equal(r.status, 302);
    assert.equal(loc(r), ABOUT);
  });
  test(`signed out, wall ${wall}: other pages still go to sign-in; /login is untouched`, async () => {
    process.env.LICENSE_WALL = wall;
    const r = await proxy(req("/actions"));
    assert.ok([302, 307].includes(r.status));
    assert.match(loc(r), /\/login\?next=%2Factions$/);
    assert.ok(passes(await proxy(req("/login"))));
  });
  test(`signed in (company), wall ${wall}: / opens the app`, async () => {
    process.env.LICENSE_WALL = wall;
    assert.ok(passes(await proxy(req("/", await company()))));
  });
}

test("signed in (staff), wall off: / opens the app", async () => {
  process.env.LICENSE_WALL = "off";
  assert.ok(passes(await proxy(req("/", await staff()))));
});

test("signed in (staff), wall on: / still gets the licence wall, not the product site", async () => {
  process.env.LICENSE_WALL = "on";
  const r = await proxy(req("/", await staff()));
  assert.notEqual(loc(r), ABOUT);
  assert.ok(r.status >= 400 || /licen/i.test(await r.text()));
});

test("a demo deployment never redirects / to the product site", async () => {
  process.env.DEMO_MODE = "1";
  process.env.DEMO_ACCESS_GATE = "off";
  const r = await proxy(req("/"));
  assert.notEqual(loc(r), ABOUT);
});
