// Admins set things up; everything else needs a role. A Quality admin
// configures the programme and reads every record, but keys, inspects, raises,
// works, approves, verifies and triages nothing by being admin. An admin who is
// also given a role does that role's work, and nobody approves their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actor, setupCompany } from "./support/fixtures.mjs";
const { saveReview, decideReview, resolveItems, listReviews } = await import("@/lib/reviews");
const { createAction, stepAction, editAction, deleteAction } = await import("@/lib/actions");
const { can, isSupervisor, approveBlocker, verifyBlocker, ROLE_INFO } = await import("@/lib/roles");
const { allowedSteps, effectivenessBlocker } = await import("@/lib/actionRules");

const ids = await setupCompany("adm");
const inspector = actor("adm", "ian@adm.com", ["inspector"]);
const admin = actor("adm", "ada@adm.com", ["admin"]);
const adminSup = actor("adm", "abe@adm.com", ["admin", "supervisor"]);
const adminInsp = actor("adm", "aim@adm.com", ["admin", "inspector"]);
const adminBm = actor("adm", "abm@adm.com", ["admin", "branch_manager"]);
const sup = actor("adm", "sue@adm.com", ["supervisor"]);
const bm = actor("adm", "bob@adm.com", ["branch_manager"]);
const items = [{ areaId: ids.payments, checks: { dual: "no", purpose: "yes", receipt: "yes" }, nature: "Missing approval" }];

test("an admin with no other role keeps set-up only", () => {
  for (const k of ["manage", "buildTemplates", "view"]) assert.equal(can[k](admin), true, `admin keeps ${k}`);
  for (const k of ["keyReviews", "inspect", "workActions", "raiseActions", "planActions", "deleteActions", "sendToRisk", "planSamples", "triageIssues", "approveReviews", "approveInspections", "verifyActions", "resolveDefects"]) {
    assert.equal(can[k](admin), false, `admin alone: ${k}`);
  }
  assert.equal(isSupervisor(admin), false);
  assert.match(approveBlocker(admin, { inspectorEmail: "ian@adm.com" }), /supervisor/);
  assert.match(verifyBlocker(admin, { raisedBy: "x@adm.com", ownerEmail: null, submittedBy: null }), /supervisor/);
  assert.match(effectivenessBlocker(admin, { ownerEmail: null, submittedBy: null }), /supervisor/);
  assert.match(ROLE_INFO.admin.blurb, /Everything else needs a role/);
});

test("an admin given a role does that role's work, and only that", () => {
  for (const k of ["approveReviews", "approveInspections", "verifyActions", "resolveDefects", "raiseActions", "planSamples", "triageIssues", "sendToRisk"]) assert.equal(can[k](adminSup), true, `admin + supervisor: ${k}`);
  assert.equal(can.inspect(adminInsp), true); assert.equal(can.keyReviews(adminInsp), true);
  for (const k of ["approveReviews", "raiseActions", "verifyActions"]) assert.equal(can[k](adminInsp), false, `admin + inspector: ${k}`);
  assert.equal(can.workActions(adminBm), true);
  for (const k of ["inspect", "keyReviews", "raiseActions"]) assert.equal(can[k](adminBm), false, `admin + branch manager: ${k}`);
});

test("reviews: an admin alone can't key or approve; with a role, can; nobody approves their own", async () => {
  assert.equal((await saveReview(admin, { unitId: ids.harbour, period: "2026-09-01", items })).ok, false, "admin alone can't key a review");
  const a = await saveReview(inspector, { unitId: ids.harbour, period: "2026-09-01", items, submit: true });
  assert.ok(a.ok);
  assert.equal((await saveReview(admin, { id: a.value.id, unitId: ids.harbour, period: "2026-09-01", items })).ok, false, "nor edit someone else's");
  assert.equal((await decideReview(inspector, a.value.id, "approve", "")).ok, false, "an inspector can't approve");
  assert.equal((await decideReview(admin, a.value.id, "approve", "")).ok, false, "admin alone can't approve");
  assert.equal((await decideReview(admin, a.value.id, "return", "Missing call-back")).ok, false, "or return");
  assert.ok((await decideReview(adminSup, a.value.id, "approve", "")).ok, "admin with the supervisor role can");
  const own = await saveReview(adminInsp, { unitId: ids.summit, period: "2026-09-01", items, submit: true });
  assert.ok(own.ok, "admin with the inspector role keys reviews");
  const ownSup = await saveReview(adminSup, { unitId: ids.summit, period: "2026-08-01", items, submit: true });
  assert.ok(ownSup.ok);
  assert.equal((await decideReview(adminSup, ownSup.value.id, "approve", "")).ok, false, "nobody approves their own review");
  assert.ok((await decideReview(sup, ownSup.value.id, "approve", "")).ok);
  const [rv] = (await listReviews(sup)).filter((x) => x.status === "published");
  assert.equal((await resolveItems(admin, [{ reviewId: rv.id, idx: 0 }], true)).ok, false, "admin alone can't resolve a defect");
  assert.ok((await resolveItems(adminSup, [{ reviewId: rv.id, idx: 0 }], true)).ok);
});

test("actions: an admin alone can't raise, plan, work, verify or delete; with a role, can do that role's part", async () => {
  const input = { unitId: ids.harbour, title: "Dual authorisation skipped", priority: "high", ownerEmail: bm.email, ownerName: "Bob", dueDate: "2026-12-01" };
  assert.equal((await createAction(admin, input)).ok, false, "admin alone can't raise an action");
  const c = await createAction(adminSup, input);
  assert.ok(c.ok, "admin with the supervisor role can");
  assert.equal((await editAction(admin, c.value.id, { ...input, title: "Changed" })).ok, false, "admin alone can't change the plan");
  assert.equal((await stepAction(admin, c.value.id, "start", {})).ok, false, "admin alone can't work it");
  assert.ok((await stepAction(bm, c.value.id, "start", {})).ok);
  assert.ok((await stepAction(bm, c.value.id, "submit", { note: "Fixed, evidence attached" })).ok);
  assert.deepEqual(allowedSteps(admin, { ...c.value, status: "awaiting_verification", submittedBy: bm.email }), [], "admin alone: nothing to do");
  assert.equal((await stepAction(admin, c.value.id, "verify", {})).ok, false, "admin alone can't verify");
  assert.equal((await stepAction(inspector, c.value.id, "verify", {})).ok, false, "an inspector can't verify");
  assert.equal((await stepAction(adminSup, c.value.id, "verify", {})).ok, false, "nobody verifies an action they raised");
  assert.ok((await stepAction(sup, c.value.id, "verify", {})).ok);
  // A branch manager's work, by an admin who holds that role too.
  const d = await createAction(sup, { ...input, title: "Receipts not issued", ownerEmail: adminBm.email });
  assert.ok((await stepAction(adminBm, d.value.id, "start", {})).ok, "admin with the branch manager role works their action");
  assert.equal((await deleteAction(admin, d.value.id)).ok, false, "admin alone can't delete an action");
  assert.equal((await deleteAction(sup, d.value.id)).ok, false, "nor can the supervisor who raised it");
  assert.ok((await deleteAction(adminSup, d.value.id)).ok, "another supervisor can");
});
