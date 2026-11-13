import { test } from "node:test";
import assert from "node:assert/strict";
import "./support/fixtures.mjs";
const { resolveActor, institutionDefaultRoles } = await import("@/lib/session");
const { defaultRolesForPlatformRole, approveBlocker, verifyBlocker } = await import("@/lib/roles");

const info = (over) => ({ tenant: "acme", tenantName: "Acme", kind: "company", email: "x@acme.com", name: "", platformRole: "viewer", operator: false, plan: null, requestId: "", ...over });

test("platform roles give starting Quality roles", async () => {
  assert.deepEqual(defaultRolesForPlatformRole("owner"), ["admin"]);
  assert.deepEqual(defaultRolesForPlatformRole("editor"), ["inspector"]);
  assert.deepEqual(defaultRolesForPlatformRole("viewer"), ["viewer"]);
  const a = await resolveActor(info({ email: "owner@acme.com", platformRole: "owner" }));
  assert.deepEqual(a.roles, ["admin"]);
  const again = await resolveActor(info({ email: "owner@acme.com", platformRole: "viewer" }));
  assert.deepEqual(again.roles, ["admin"], "roles granted in Quality persist; the platform role only seeds them");
});

test("the institution's allow-list: unknown staff get no access", async () => {
  const a = await resolveActor(info({ tenant: "_own", kind: "institution", email: "stranger@elsewhere.com", platformRole: "staff" }));
  assert.deepEqual(a.roles, []);
  process.env.ADMIN_EMAILS = "chief@inst.com";
  assert.deepEqual(institutionDefaultRoles("chief@inst.com", false), ["admin"]);
  assert.deepEqual(institutionDefaultRoles("anyone@x.com", true), ["admin"], "a platform operator (break-glass)");
});

test("separation of duties reads who did the work, not the roles held", () => {
  const sup = { email: "s@x.com", roles: ["supervisor", "admin"] };
  assert.ok(approveBlocker(sup, { inspectorEmail: "s@x.com" }));
  assert.equal(approveBlocker(sup, { inspectorEmail: "i@x.com" }), null);
  assert.ok(verifyBlocker(sup, { raisedBy: "s@x.com", ownerEmail: null, submittedBy: null }));
  assert.ok(verifyBlocker(sup, { raisedBy: "r@x.com", ownerEmail: null, submittedBy: "S@x.com" }));
  assert.equal(verifyBlocker(sup, { raisedBy: "r@x.com", ownerEmail: "o@x.com", submittedBy: "o@x.com" }), null);
  assert.ok(verifyBlocker({ email: "v@x.com", roles: ["viewer"] }, { raisedBy: "r@x.com", ownerEmail: null, submittedBy: null }));
});
