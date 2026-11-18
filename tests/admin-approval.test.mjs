// A Quality admin sets the programme up; approving, verifying and signing off
// belong to the supervisor role. An admin signs nothing off by being admin, only
// when also given the Supervisor role. Inspectors key and carry out the work,
// and nobody approves their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actor, setupCompany } from "./support/fixtures.mjs";
const { saveReview, decideReview, resolveItems, listReviews } = await import("@/lib/reviews");
const { createAction, stepAction } = await import("@/lib/actions");
const { can, isSupervisor, isLead, approveBlocker, verifyBlocker, ROLE_INFO } = await import("@/lib/roles");
const { allowedSteps, effectivenessBlocker } = await import("@/lib/actionRules");

const ids = await setupCompany("adm");
const inspector = actor("adm", "ian@adm.com", ["inspector"]);
const admin = actor("adm", "ada@adm.com", ["admin"]);
const adminSup = actor("adm", "abe@adm.com", ["admin", "supervisor"]);
const sup = actor("adm", "sue@adm.com", ["supervisor"]);
const bm = actor("adm", "bob@adm.com", ["branch_manager"]);
const items = [{ areaId: ids.payments, checks: { dual: "no", purpose: "yes", receipt: "yes" }, nature: "Missing approval" }];

test("the admin role alone approves, verifies and signs off nothing; it keeps set-up", () => {
  for (const k of ["approveReviews", "approveInspections", "verifyActions", "resolveDefects"]) {
    assert.equal(can[k](admin), false, `admin: ${k}`);
    assert.equal(can[k](adminSup), true, `admin + supervisor: ${k}`);
    assert.equal(can[k](inspector), false, `inspector: ${k}`);
  }
  assert.equal(isSupervisor(admin), false);
  assert.equal(isLead(admin), true);
  for (const k of ["manage", "buildTemplates", "raiseActions", "planActions", "deleteActions"]) assert.equal(can[k](admin), true, `admin keeps ${k}`);
  assert.match(approveBlocker(admin, { inspectorEmail: "ian@adm.com" }), /supervisor/);
  assert.match(verifyBlocker(admin, { raisedBy: "x@adm.com", ownerEmail: null, submittedBy: null }), /supervisor/);
  assert.match(effectivenessBlocker(admin, { ownerEmail: null, submittedBy: null }), /supervisor/);
  assert.doesNotMatch(ROLE_INFO.admin.blurb, /everything a supervisor/i);
});

test("reviews: an admin without the supervisor role is refused; with it, allowed; nobody approves their own", async () => {
  const a = await saveReview(inspector, { unitId: ids.harbour, period: "2026-09-01", items, submit: true });
  assert.ok(a.ok);
  assert.equal((await decideReview(inspector, a.value.id, "approve", "")).ok, false, "an inspector can't approve");
  assert.equal((await decideReview(admin, a.value.id, "approve", "")).ok, false, "admin alone can't approve");
  assert.equal((await decideReview(admin, a.value.id, "return", "Missing call-back")).ok, false, "admin alone can't return either");
  assert.ok((await decideReview(adminSup, a.value.id, "approve", "")).ok, "admin with the supervisor role can");
  // Their own work: keyed by the admin-supervisor, approved by someone else only.
  const own = await saveReview(adminSup, { unitId: ids.summit, period: "2026-09-01", items, submit: true });
  assert.ok(own.ok);
  assert.equal((await decideReview(adminSup, own.value.id, "approve", "")).ok, false, "nobody approves their own review");
  assert.ok((await decideReview(sup, own.value.id, "approve", "")).ok);
  const [rv] = (await listReviews(sup)).filter((x) => x.status === "published");
  assert.equal((await resolveItems(admin, [{ reviewId: rv.id, idx: 0 }], true)).ok, false, "admin alone can't resolve a defect");
  assert.ok((await resolveItems(adminSup, [{ reviewId: rv.id, idx: 0 }], true)).ok);
});

test("actions: an admin can raise one but verifies only with the supervisor role, and never their own", async () => {
  const c = await createAction(admin, { unitId: ids.harbour, title: "Dual authorisation skipped", priority: "high", ownerEmail: bm.email, ownerName: "Bob", dueDate: "2026-12-01" });
  assert.ok(c.ok, "an admin still raises actions");
  assert.ok((await stepAction(bm, c.value.id, "start", {})).ok);
  assert.ok((await stepAction(bm, c.value.id, "submit", { note: "Fixed, evidence attached" })).ok);
  assert.deepEqual(allowedSteps(admin, { ...c.value, status: "awaiting_verification", submittedBy: bm.email }), [], "admin alone: nothing to sign off");
  assert.equal((await stepAction(admin, c.value.id, "verify", {})).ok, false, "admin alone can't verify");
  assert.equal((await stepAction(admin, c.value.id, "return", { note: "More evidence" })).ok, false, "admin alone can't send back");
  assert.equal((await stepAction(inspector, c.value.id, "verify", {})).ok, false, "an inspector can't verify");
  assert.ok((await stepAction(adminSup, c.value.id, "verify", {})).ok, "admin with the supervisor role can");
  // Raised by the admin-supervisor: someone else verifies it.
  const d = await createAction(adminSup, { unitId: ids.harbour, title: "Receipts not issued", priority: "low", ownerEmail: bm.email, ownerName: "Bob", dueDate: "2026-12-01" });
  await stepAction(bm, d.value.id, "start", {});
  assert.ok((await stepAction(bm, d.value.id, "submit", { note: "Receipts issued and logged" })).ok);
  assert.equal((await stepAction(adminSup, d.value.id, "verify", {})).ok, false, "nobody verifies an action they raised");
  const v = await stepAction(sup, d.value.id, "verify", {});
  assert.ok(v.ok, v.error);
});
