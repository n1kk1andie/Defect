// Two-step sign-in backstop (Pulsus Platform lib/mfaClaim.ts mfaSatisfied):
// a person's session is accepted only if mfa_req isn't true or amr names a
// second factor ("otp" or "mfa"). Sessions without the claims are accepted as
// before. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const published = [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }];
globalThis.fetch = async (url) => {
  if (String(url).endsWith("/api/session/status")) return new Response(JSON.stringify({ active: true }), { status: 200 });
  return new Response(JSON.stringify({ keys: published }), { status: 200 });
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
let n = 0;
function token(claims = {}) {
  const h = b64({ alg: "RS256", typ: "JWT", kid: "k1" });
  const p = b64({ iss: "pulsus-company", company_id: "acme", aud: "pulsus-suite", email: "pat@example.com", exp: Math.floor(Date.now() / 1000) + 600, n: n++, ...claims });
  return `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url")}`;
}
const jwt = await import("../lib/platform-jwt.ts");
const verify = (t) => jwt.currentSession(t);

const ACCEPT = [
  ["no MFA claims", {}],
  ["mfa_req false", { mfa_req: false, amr: ["pwd"] }],
  ["mfa_req true + otp", { mfa_req: true, amr: ["pwd", "otp"] }],
  ["mfa_req true + mfa (identity provider)", { mfa_req: true, amr: ["sso", "mfa"] }],
  ["mfa_req true + sso then otp", { mfa_req: true, amr: ["sso", "otp"] }],
];
const REJECT = [
  ["mfa_req true + pwd only", { mfa_req: true, amr: ["pwd"] }],
  ["mfa_req true + sso only", { mfa_req: true, amr: ["sso"] }],
  ["mfa_req true + no amr", { mfa_req: true }],
];

for (const [name, claims] of ACCEPT) {
  test(`accepts a session with ${name}`, async () => {
    assert.equal(jwt.mfaSatisfied(claims), true);
    assert.ok(await verify(token(claims)), "a signed session passes");
    assert.equal(jwt.mfaShortfall(token(claims)), false);
  });
}
for (const [name, claims] of REJECT) {
  test(`refuses a session with ${name}`, async () => {
    assert.equal(jwt.mfaSatisfied(claims), false);
    assert.equal(jwt.sessionClaimsOk({ iss: "pulsus-company", company_id: "acme", aud: "pulsus-suite", ...claims }), false);
    assert.equal(await verify(token(claims)), null, "a correctly signed session is still refused");
    assert.equal(jwt.mfaShortfall(token(claims)), true, "the refusal can say why");
  });
}

test("mfaShortfall never calls a malformed or ordinary token a shortfall", () => {
  assert.equal(jwt.mfaShortfall(undefined), false);
  assert.equal(jwt.mfaShortfall("not-a-jwt"), false);
  assert.equal(jwt.mfaShortfall("a.b.c"), false);
});

test("the front door answers an API call with the two-step message", () => {
  const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(src, /MFA_REQUIRED_MESSAGE/);
  assert.equal(jwt.MFA_REQUIRED_MESSAGE, "Your organisation requires two-step sign-in. Please sign in again.");
});
