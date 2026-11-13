import { test } from "node:test";
import assert from "node:assert/strict";
import "./support/fixtures.mjs";
const { withTenant, rowsOf, connection } = await import("@/lib/db/client");
const { sql } = await import("drizzle-orm");
const { record, verify } = await import("@/lib/audit");
const { verifyChain } = await import("@/lib/auditchain");

test("row-level security: a company never sees another's rows, even without a filter", async () => {
  await withTenant("acme", (tx) => tx.execute(sql`insert into units (id, company_id, name) values ('u-acme', 'acme', 'Harbour')`));
  await withTenant("beta", (tx) => tx.execute(sql`insert into units (id, company_id, name) values ('u-beta', 'beta', 'Summit')`));
  const seen = rowsOf(await withTenant("acme", (tx) => tx.execute(sql`select id from units`)));
  assert.deepEqual(seen.map((r) => r.id), ["u-acme"]);
  assert.equal((await connection()).appRole, true);
});

test("row-level security: writing a row for another company is refused", async () => {
  await assert.rejects(withTenant("acme", (tx) => tx.execute(sql`insert into units (id, company_id, name) values ('x', 'beta', 'X')`)));
  const n = rowsOf(await withTenant("beta", (tx) => tx.execute(sql`update units set name = 'hijack' where company_id = 'beta' returning id`)));
  assert.equal(n.length, 1, "beta can change its own");
  const m = rowsOf(await withTenant("acme", (tx) => tx.execute(sql`update units set name = 'hijack' where company_id = 'beta' returning id`)));
  assert.equal(m.length, 0, "acme can't touch beta's");
});

test("an invalid tenant id is refused before any query", async () => {
  await assert.rejects(withTenant("Bad Id; drop", async () => 1));
});

test("the change history is hash-chained and append-only", async () => {
  for (let i = 0; i < 3; i++) await withTenant("acme", (tx) => record(tx, "acme", { actor: "a@x.com", action: "test", entityType: "t", summary: `entry ${i}`, after: { i } }));
  const v = await verify("acme");
  assert.equal(v.ok, true);
  assert.equal(v.count, 3);
  await assert.rejects(withTenant("acme", (tx) => tx.execute(sql`update audit_log set summary = 'changed'`)));
  await assert.rejects(withTenant("acme", (tx) => tx.execute(sql`delete from audit_log`)));
});

test("tampering with an entry breaks the chain", async () => {
  const rows = rowsOf(await withTenant("acme", (tx) => tx.execute(sql`select seq, at, actor, action, entity_type, entity_id, summary, before, after, request_id, prev_hash, hash from audit_log order by seq`)))
    .map((r) => ({ seq: r.seq, at: new Date(r.at).toISOString(), actor: r.actor, action: r.action, entityType: r.entity_type, entityId: r.entity_id, summary: r.summary, before: r.before, after: r.after, requestId: r.request_id, prevHash: r.prev_hash, hash: r.hash }));
  assert.equal(verifyChain("acme", rows).ok, true);
  const forged = rows.map((r, i) => (i === 1 ? { ...r, summary: "forged" } : r));
  const v = verifyChain("acme", forged);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);
  assert.equal(verifyChain("acme", rows.filter((_, i) => i !== 1)).ok, false, "a removed entry shows");
});
