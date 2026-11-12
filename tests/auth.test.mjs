// node --experimental-strip-types --test tests/*.test.mjs
//
// Sign-in fails closed: no built-in passwords, and no session secret fallback in
// production.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

register("./_ts-resolve.mjs", import.meta.url);

const KEYS = ["ADMIN_PASSWORD", "SUPERVISOR_PASSWORD", "OFFICER_PASSWORD", "SESSION_SECRET", "NODE_ENV", "DATA_DIR", "BLOB_READ_WRITE_TOKEN"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let dataDir;
let auth;

function setEnv(env) {
  for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "quality-auth-"));
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string" && v.startsWith("vercel_blob_rw_")) delete process.env[k];
  setEnv({ DATA_DIR: dataDir, BLOB_READ_WRITE_TOKEN: null });
  auth = await import("../lib/auth.ts");
});
after(() => { setEnv(saved); rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => {
  // A clean store and no passwords configured.
  rmSync(dataDir, { recursive: true, force: true });
  setEnv({ ADMIN_PASSWORD: null, SUPERVISOR_PASSWORD: null, OFFICER_PASSWORD: null, SESSION_SECRET: "test-secret", NODE_ENV: "test" });
});

const OLD_DEFAULTS = ["pa55w0rd", "0ff1cer", "5uperv1sor"];

test("no admin password configured: nobody signs in as admin, not even with the old default", async () => {
  assert.equal(await auth.adminConfigured(), false);
  assert.equal(await auth.rolePasswordConfigured("admin"), false);
  for (const pw of [...OLD_DEFAULTS, "", " "]) {
    assert.equal(await auth.checkPassword(pw), false, pw);
    assert.equal(await auth.checkLogin("", pw), null, pw);
    assert.equal(await auth.checkLogin("admin", pw), null, pw);
  }
});

test("no role passwords configured: Officer and Supervisor cannot sign in", async () => {
  for (const role of ["inspector", "supervisor"]) {
    assert.equal(await auth.rolePasswordConfigured(role), false, role);
    for (const pw of [...OLD_DEFAULTS, ""]) assert.equal(await auth.checkRoleLogin(role, pw), false, `${role}/${pw}`);
  }
});

test("the env vars enable exactly their own role", async () => {
  setEnv({ ADMIN_PASSWORD: "admin-pass-123", SUPERVISOR_PASSWORD: "sup-pass-123", OFFICER_PASSWORD: "off-pass-123" });
  assert.equal(await auth.adminConfigured(), true);
  assert.deepEqual(await auth.checkLogin("admin", "admin-pass-123"), { role: "admin", username: "admin", branch: null });
  assert.equal(await auth.checkLogin("admin", "pa55w0rd"), null);
  assert.equal(await auth.checkRoleLogin("supervisor", "sup-pass-123"), true);
  assert.equal(await auth.checkRoleLogin("inspector", "off-pass-123"), true);
  // No cross-over: one role's password never opens another.
  assert.equal(await auth.checkRoleLogin("inspector", "sup-pass-123"), false);
  assert.equal(await auth.checkRoleLogin("supervisor", "admin-pass-123"), false);
  // Only the officer one set: the supervisor stays closed (no fallback to admin's).
  setEnv({ SUPERVISOR_PASSWORD: null });
  assert.equal(await auth.rolePasswordConfigured("supervisor"), false);
  assert.equal(await auth.checkRoleLogin("supervisor", "admin-pass-123"), false);
});

test("an in-app password opens its role and takes precedence over the env var", async () => {
  setEnv({ OFFICER_PASSWORD: "env-officer-pw" });
  await auth.setRolePassword("inspector", "in-app-officer-pw");
  assert.equal(await auth.rolePasswordConfigured("inspector"), true);
  assert.equal(await auth.checkRoleLogin("inspector", "in-app-officer-pw"), true);
  assert.equal(await auth.checkRoleLogin("inspector", "env-officer-pw"), false);
  await auth.setPassword("in-app-admin-pw");
  assert.equal(await auth.adminConfigured(), true);
  assert.equal(await auth.checkPassword("in-app-admin-pw"), true);
});

test("the message tells the user to ask their administrator", () => {
  assert.match(auth.NO_PASSWORD_MESSAGE, /Ask your administrator to set a password/);
});

test("production without SESSION_SECRET: no sign-in, no signing, no fallback secret", () => {
  setEnv({ NODE_ENV: "production", SESSION_SECRET: null });
  assert.equal(auth.sessionSecretConfigured(), false);
  assert.throws(() => auth.createSessionToken(Date.now(), { role: "admin", username: "admin", branch: null }), /SESSION_SECRET/);
  setEnv({ SESSION_SECRET: "a-real-secret" });
  assert.equal(auth.sessionSecretConfigured(), true);
  const t = auth.createSessionToken(Date.now(), { role: "inspector", username: "amy", branch: null });
  assert.equal(auth.readSessionToken(t, Date.now())?.username, "amy");
});

test("development without SESSION_SECRET still works, and its tokens don't verify under a real secret", () => {
  setEnv({ NODE_ENV: "development", SESSION_SECRET: null });
  assert.equal(auth.sessionSecretConfigured(), true);
  const t = auth.createSessionToken(Date.now(), { role: "admin", username: "admin", branch: null });
  assert.ok(auth.readSessionToken(t, Date.now()));
  setEnv({ NODE_ENV: "production", SESSION_SECRET: "a-real-secret" });
  assert.equal(auth.readSessionToken(t, Date.now()), null);
});
