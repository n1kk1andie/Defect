// An officer keys, a supervisor signs off. An admin approves, returns and resolves
// nothing by being admin; only an admin account also made a supervisor does. And
// nobody approves the work they keyed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canSignOff, resolveBlocker, reviewBlocker } from "../lib/approval.ts";

const admin = { role: "admin", username: "admin" };
const adminSup = { role: "admin", username: "ada", supervisor: true };
const sup = { role: "supervisor", username: "Sue Smith" };
const officer = { role: "inspector", username: "Ian Jones" };
const sub = { inspector: "Ian Jones" };

test("an admin without the supervisor right is refused approval and resolution", () => {
  assert.equal(canSignOff(admin), false);
  assert.match(reviewBlocker(admin, sub), /admin/i);
  assert.match(resolveBlocker(admin), /admin/i);
});

test("an admin account also made a supervisor is allowed", () => {
  assert.equal(canSignOff(adminSup), true);
  assert.equal(reviewBlocker(adminSup, sub), null);
  assert.equal(resolveBlocker(adminSup), null);
});

test("an officer (inspector) can't approve or resolve; a supervisor can", () => {
  assert.notEqual(reviewBlocker(officer, sub), null);
  assert.notEqual(resolveBlocker(officer), null);
  assert.equal(reviewBlocker(sup, sub), null);
  assert.equal(resolveBlocker(sup), null);
  assert.equal(canSignOff(null), false);
});

test("nobody approves their own work", () => {
  assert.match(reviewBlocker({ ...sup, username: "ian jones" }, sub), /keyed/);
  assert.match(reviewBlocker({ ...adminSup, username: "Ian Jones" }, sub), /keyed/);
});

test("the supervisor right is a flag only an admin account carries, asked for explicitly", () => {
  const auth = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /input\.role === "admin" && input\.supervisor === true/);
  assert.match(auth, /p\.role === "admin" && p\.sup === true/);
  assert.doesNotMatch(auth, /admin\s+— full access/);
  const subs = readFileSync(new URL("../lib/submissions.ts", import.meta.url), "utf8");
  assert.match(subs, /reviewBlocker\(session, sub\)/);
  assert.match(subs, /resolveBlocker\(session\)/);
  assert.doesNotMatch(subs, /s\.role === "admin" \|\| s\.role === "supervisor";\n\}/);
});
