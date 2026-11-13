import { test } from "node:test";
import assert from "node:assert/strict";
import { actor, setupCompany } from "./support/fixtures.mjs";
const { saveReview, decideReview, resolveItems, listReviews } = await import("@/lib/reviews");
const { createAction, stepAction, editAction, listActions, deleteAction } = await import("@/lib/actions");
const { getDataset } = await import("@/lib/dataset");
const { record } = await import("@/lib/metrics");
const { verify } = await import("@/lib/audit");

const ids = await setupCompany("acme");
const inspector = actor("acme", "ian@acme.com", ["inspector"]);
const sup1 = actor("acme", "sue@acme.com", ["supervisor"]);
const sup2 = actor("acme", "sam@acme.com", ["supervisor"]);
const viewer = actor("acme", "val@acme.com", ["viewer"]);
const items = [
  { areaId: ids.payments, checks: { dual: "no", purpose: "yes", receipt: "na" }, nature: "Missing approval", recurring: true },
  { areaId: ids.payments, checks: { dual: "yes", purpose: "yes", receipt: "yes" } },
];

test("a review publishes only after a different supervisor approves it", async () => {
  const draft = await saveReview(inspector, { unitId: ids.harbour, period: "2026-09-01", items, submit: true });
  assert.ok(draft.ok);
  assert.equal(draft.value.status, "submitted");
  assert.equal((await getDataset("acme")).rows.length, 0, "nothing on the dashboards yet");
  const self = await decideReview({ ...inspector, roles: ["supervisor"] }, draft.value.id, "approve", "");
  assert.equal(self.ok, false, "nobody approves their own review");
  const noNote = await decideReview(sup1, draft.value.id, "return", "");
  assert.equal(noNote.ok, false, "returning needs a note");
  const ok = await decideReview(sup1, draft.value.id, "approve", "Fine");
  assert.ok(ok.ok);
  const d = await getDataset("acme");
  const r = record(d.rows);
  assert.equal(r.instances, 5, "each check performed (not N/A) is a possible instance");
  assert.equal(r.defects, 1);
  assert.equal(r.recurring, 1);
  assert.equal(d.natureRows.length, 1);
});

test("published work is locked; inspectors can't approve or resolve", async () => {
  const [rv] = (await listReviews(sup1)).filter((x) => x.status === "published");
  const edit = await saveReview(inspector, { id: rv.id, unitId: ids.harbour, period: "2026-09-01", items });
  assert.equal(edit.ok, false);
  assert.equal((await resolveItems(inspector, [{ reviewId: rv.id, idx: 0 }], true)).ok, false);
  const res = await resolveItems(sup2, [{ reviewId: rv.id, idx: 0 }], true);
  assert.ok(res.ok && res.value === 1);
  assert.equal(record((await getDataset("acme")).rows).resolutionRate, 1);
});

test("viewers don't key reviews and only see published ones", async () => {
  assert.equal((await saveReview(viewer, { unitId: ids.harbour, period: "2026-09-01", items })).ok, false);
  await saveReview(inspector, { unitId: ids.summit, period: "2026-10-01", items });
  const seen = await listReviews(viewer);
  assert.ok(seen.every((r) => r.status === "published"));
});

test("corrective actions: whoever raised, submitted or owns it can't verify it", async () => {
  assert.equal((await createAction(inspector, { unitId: ids.harbour, title: "x", priority: "high", ownerName: "Ops", dueDate: "2026-12-01" })).ok, false, "inspectors don't raise actions");
  const c = await createAction(sup1, { unitId: ids.harbour, title: "Dual authorisation skipped", priority: "high", ownerEmail: "bm@acme.com", ownerName: "Branch manager", dueDate: "2026-12-01", kind: "preventive", rootCause: "Training" });
  assert.ok(c.ok);
  assert.match(c.value.ref, /^ACT-\d{4}$/);
  const id = c.value.id;
  assert.equal((await stepAction(inspector, id, "submit", { note: "short" })).ok, false, "a closure needs a real note");
  assert.ok((await stepAction(inspector, id, "submit", { note: "Retrained the team and fixed the two payments." })).ok);
  assert.equal((await stepAction(sup1, id, "verify", {})).ok, false, "the raiser can't verify");
  const owner = actor("acme", "bm@acme.com", ["supervisor"]);
  assert.equal((await stepAction(owner, id, "verify", {})).ok, false, "the owner can't verify");
  const submitterAsSupervisor = actor("acme", "ian@acme.com", ["supervisor", "admin"]);
  assert.equal((await stepAction(submitterAsSupervisor, id, "verify", {})).ok, false, "granting yourself a role doesn't let you verify your own closure");
  const v = await stepAction(sup2, id, "verify", {});
  assert.ok(v.ok);
  assert.equal(v.value.status, "closed");
  assert.equal(v.value.verifiedBy, "sam@acme.com");
  assert.equal((await editAction(sup1, id, { title: "y", priority: "low", ownerName: "x", dueDate: "2026-12-02" })).ok, false, "closed actions are locked");
  assert.equal((await stepAction(sup1, id, "reopen", {})).ok, false, "reopening needs a note");
  assert.ok((await stepAction(sup1, id, "reopen", { note: "Happened again" })).ok);
  assert.equal((await deleteAction(sup1, id)).ok, false, "only admins delete");
});

test("someone scoped to one branch sees only its actions", async () => {
  await createAction(sup1, { unitId: ids.summit, title: "Summit issue", priority: "low", ownerName: "Ops", dueDate: "2026-12-01" });
  const scoped = actor("acme", "bm2@acme.com", ["branch_manager"], { unitIds: [ids.summit] });
  const list = await listActions(scoped);
  assert.ok(list.length >= 1);
  assert.ok(list.every((a) => a.unitId === ids.summit));
});

test("every step was recorded and the chain verifies", async () => {
  const v = await verify("acme");
  assert.equal(v.ok, true);
  assert.ok(v.count >= 6, String(v.count));
});
