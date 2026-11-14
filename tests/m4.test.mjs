// Milestone 4: tenant isolation on the new tables, reported issues (public
// links and triage), API keys and the REST API, bulk import, root cause and
// effectiveness checks, recurrence, multi-site structure, alerts and the daily
// email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actor, setupCompany } from "./support/fixtures.mjs";
const { withTenant, rowsOf, listTenantIds } = await import("@/lib/db/client");
const { TENANT_TABLES } = await import("@/lib/db/schema");
const { sql } = await import("drizzle-orm");
const { verify } = await import("@/lib/audit");
const issues = await import("@/lib/issues");
const keys = await import("@/lib/apiKeys");
const rest = await import("@/lib/restApi");
const bulk = await import("@/lib/bulk");
const { parseCsv, guessMapping, toNumber } = await import("@/lib/table");
const { BULK_FIELDS } = await import("@/lib/bulkInfo");
const { createAction, stepAction, getAction, listActions } = await import("@/lib/actions");
const { cleanRca, effectivenessBlocker } = await import("@/lib/actionRules");
const { createTemplate, publishTemplate, getTemplate } = await import("@/lib/templates/store");
const { saveInspection, decideInspection } = await import("@/lib/inspections");
const structure = await import("@/lib/structure");
const notify = await import("@/lib/notify");
const { getSettings, setMember } = await import("@/lib/company");

const A = await setupCompany("m4a");
const B = await setupCompany("m4b");
const admin = actor("m4a", "ada@m4a.com", ["admin"]);
const sup = actor("m4a", "sue@m4a.com", ["supervisor"]);
const sup2 = actor("m4a", "sam@m4a.com", ["supervisor"]);
const insp = actor("m4a", "ian@m4a.com", ["inspector"]);
const viewer = actor("m4a", "val@m4a.com", ["viewer"]);
const adminB = actor("m4b", "bob@m4b.com", ["admin"]);
const supB = actor("m4b", "bea@m4b.com", ["supervisor"]);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
/** Run fn as a live (not demo) deployment, whatever the test run's mode. */
async function live(fn, env = {}) {
  const was = { DEMO_MODE: process.env.DEMO_MODE, ...Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])) };
  process.env.DEMO_MODE = ""; Object.assign(process.env, env);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// ── tenancy ──────────────────────────────────────────────────────────────────

const NEW_TABLES = ["entities", "site_groups", "report_links", "issue_reports", "api_keys"];

test("every tenant table, the new ones included, has row-level security switched on and forced", async () => {
  for (const t of NEW_TABLES) assert.ok(TENANT_TABLES.includes(t), `${t} is listed as a tenant table`);
  const rows = rowsOf(await withTenant("m4a", (tx) => tx.execute(sql`select relname, relrowsecurity, relforcerowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`)));
  for (const t of TENANT_TABLES) {
    const r = rows.find((x) => x.relname === t);
    assert.ok(r, `${t} exists`);
    assert.equal(r.relrowsecurity, true, `${t}: RLS on`); assert.equal(r.relforcerowsecurity, true, `${t}: RLS forced`);
  }
});

test("the new tables refuse another company's rows, for reading and for writing", async () => {
  await issues.listLinks(sup); await issues.listLinks(supB);
  await structure.saveGroup(sup, null, { name: "South", unitIds: [A.harbour] });
  await live(() => keys.createKey(adminB, { name: "B's key", scopes: ["sites:read"] }));
  for (const t of NEW_TABLES) {
    const seen = rowsOf(await withTenant("m4a", (tx) => tx.execute(sql.raw(`select company_id from ${t}`))));
    assert.ok(seen.every((r) => r.company_id === "m4a"), `${t}: only m4a's rows`);
  }
  assert.ok(rowsOf(await withTenant("m4b", (tx) => tx.execute(sql`select count(*)::int n from report_links`)))[0].n >= 2);
  await assert.rejects(withTenant("m4a", (tx) => tx.execute(sql`insert into entities (id, company_id, name) values ('e-x', 'm4b', 'Hijack')`)));
  await assert.rejects(withTenant("m4a", (tx) => tx.execute(sql`insert into issue_reports (id, company_id, ref, unit_id, category, description) values ('i-x', 'm4b', 'OBS-9', 'u', 'other', 'hijack attempt')`)));
  await assert.rejects(withTenant("m4a", (tx) => tx.execute(sql`insert into api_keys (id, company_id, name, hint, hash, created_by) values ('k-x', 'm4b', 'x', 'x', 'x', 'x')`)));
  const touched = rowsOf(await withTenant("m4a", (tx) => tx.execute(sql`update api_keys set revoked_at = now() where company_id = 'm4b' returning id`)));
  assert.equal(touched.length, 0, "m4a can't revoke m4b's key");
});

test("the tenant registry lists company ids and opens nothing else", async () => {
  const ids = await listTenantIds();
  assert.ok(ids.includes("m4a") && ids.includes("m4b"));
  await assert.rejects(withTenant("__registry__", async () => 1), "the reserved setting can't be used as a tenant");
});

// ── reported issues ──────────────────────────────────────────────────────────

test("report an issue: a site's link takes a report with no sign-in; bad, replaced or foreign links open nothing", async () => {
  const links = await issues.listLinks(sup);
  assert.equal(links.length, 2);
  assert.deepEqual(await issues.listLinks(viewer), [], "only supervisors see the links");
  const harbour = links.find((l) => l.unitId === A.harbour);
  const site = await issues.resolveLink(harbour.token);
  assert.equal(site.unitName, "Harbour"); assert.equal(site.companyId, "m4a");
  const r = await issues.submitReport(harbour.token, { category: "hazard", description: "Wet floor by the door, no sign out.", location: "Entrance" }, null, { ip: "203.0.113.5", source: "qr" });
  assert.ok(r.ok, r.error); assert.match(r.value.ref, /^OBS-\d{4}$/);
  assert.equal((await issues.submitReport(harbour.token, { category: "nope", description: "something long enough" }, null, { ip: "203.0.113.6" })).ok, false);
  assert.equal((await issues.submitReport(harbour.token, { category: "other", description: "short" }, null, { ip: "203.0.113.6" })).ok, false);
  const trap = await issues.submitReport(harbour.token, { category: "other", description: "a bot filled every field", website: "http://spam" }, null, { ip: "203.0.113.7" });
  assert.equal(trap.value.ref, "OBS-0000", "the honeypot looks accepted and stores nothing");
  // A forged token: m4b's tenant prefix with m4a's secret part.
  const bLink = (await issues.listLinks(supB))[0];
  const forged = `${bLink.token.split(".")[0]}.${harbour.token.split(".")[1]}`;
  assert.equal(await issues.resolveLink(forged), null);
  assert.equal(await issues.resolveLink("not-a-token"), null);
  // Replacing the link kills the old one.
  assert.equal((await issues.rotateLink(insp, A.harbour)).ok, false);
  const rot = await issues.rotateLink(sup, A.harbour);
  assert.ok(rot.ok);
  assert.equal(await issues.resolveLink(harbour.token), null);
  assert.ok(await issues.resolveLink(rot.value.token));
  const all = await issues.listReports(sup);
  assert.equal(all.length, 1); assert.equal(all[0].source, "qr");
  assert.equal((await issues.listReports(supB)).length, 0, "another company sees none");
});

test("reports from one address are rate-limited", () => {
  const key = "t-" + Math.random();
  for (let i = 0; i < 5; i++) assert.equal(issues.throttled(key, 5, 1000 + i), false);
  assert.equal(issues.throttled(key, 5, 2000), true);
  assert.equal(issues.throttled(key, 5, 1000 + 600_001), false, "and the limit lifts after ten minutes");
});

test("Turnstile is checked when a secret is configured", async () => {
  await live(async () => {
    const ok = async () => new Response(JSON.stringify({ success: true }));
    const no = async () => new Response(JSON.stringify({ success: false }));
    assert.equal(await issues.verifyTurnstile("tok", null, no), false);
    assert.equal(await issues.verifyTurnstile("", null, ok), false, "no answer, no pass");
    assert.equal(await issues.verifyTurnstile("tok", null, ok), true);
  }, { TURNSTILE_SECRET_KEY: "secret" });
  assert.equal(await issues.verifyTurnstile("", null), true, "without a secret the trap field and limit apply instead");
});

test("triage: a supervisor raises an action or closes with a reason; once only", async () => {
  const [rep] = await issues.listReports(sup);
  assert.equal((await issues.triage(insp, rep.id, { to: "dismiss", note: "fine" })).ok, false, "inspectors don't triage");
  assert.equal((await issues.triage(sup, rep.id, { to: "dismiss", note: "" })).ok, false, "a reason is needed");
  const t = await issues.triage(sup, rep.id, { to: "action", title: "Put the wet-floor sign out", priority: "high", dueDate: inDays(2), ownerName: "Facilities", kind: "containment" });
  assert.ok(t.ok, t.error); assert.equal(t.value.status, "action");
  const act = await getAction(sup, t.value.actionId);
  assert.equal(act.sourceType, "issue_report"); assert.equal(act.kind, "containment"); assert.match(act.details, /OBS-/);
  assert.equal((await issues.triage(sup2, rep.id, { to: "dismiss", note: "again" })).status, 409);
  assert.equal((await issues.triage(supB, rep.id, { to: "dismiss", note: "foreign" })).status, 404, "another company can't reach it");
});

// ── API keys and the REST API ────────────────────────────────────────────────

const req = (path, key, init = {}) => new Request(`https://quality.example${path}`, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", ...(init.headers || {}) } });

let keyA, keyAid;
test("API keys: admins only, the secret shown once and stored as a hash, scoped, revocable", async () => {
  await live(async () => {
    assert.equal((await keys.createKey(sup, { name: "x", scopes: ["sites:read"] })).ok, false, "supervisors don't make keys");
    assert.equal((await keys.createKey(admin, { name: "", scopes: ["sites:read"] })).ok, false);
    assert.equal((await keys.createKey(admin, { name: "BI", scopes: ["everything"] })).ok, false);
    const k = await keys.createKey(admin, { name: "BI", scopes: ["sites:read", "actions:read", "actions:write"], expiresInDays: 30 });
    assert.ok(k.ok); keyA = k.value.key; keyAid = k.value.id;
    assert.match(keyA, /^pq_[\w-]+\.[\w-]{43}$/);
    const stored = rowsOf(await withTenant("m4a", (tx) => tx.execute(sql`select hash, hint from api_keys where id = ${keyAid}`)))[0];
    assert.equal(stored.hash, keys.hashKey(keyA)); assert.notEqual(stored.hash, keyA); assert.equal(stored.hint, `…${keyA.slice(-4)}`);
    assert.equal((await keys.listKeys(admin)).find((x) => x.id === keyAid).state, "expiring");
  });
  await live(async () => assert.equal((await keys.createKey(admin, { name: "demo", scopes: ["sites:read"] })).ok, false, "the demo issues no keys"), { DEMO_MODE: "1" });
});

test("REST API: authenticated, scoped, rate-limited, one company's data only; raises actions as the key", async () => {
  const sites = await rest.withKey(req("/api/v1/sites", keyA), "sites:read", async (k) => rest.apiJson(await rest.sitesFor(k)));
  assert.equal(sites.status, 200);
  const body = await sites.json();
  assert.deepEqual(body.sites.map((s) => s.name).sort(), ["Harbour", "Summit"]);
  assert.equal((await rest.withKey(req("/api/v1/sites", null), "sites:read", async () => rest.apiJson({}))).status, 401);
  assert.equal((await rest.withKey(req("/api/v1/sites", keyA.slice(0, -2) + "xx"), "sites:read", async () => rest.apiJson({}))).status, 401, "a wrong secret");
  assert.equal((await rest.withKey(req("/api/v1/risk", keyA), "risk:read", async () => rest.apiJson({}))).status, 403, "outside its scopes");
  // A key claiming another company's tenant with this secret opens nothing.
  const forged = `pq_${Buffer.from("m4b").toString("base64url")}.${keyA.split(".")[1]}`;
  assert.equal(await keys.authenticateKey(`Bearer ${forged}`), null);
  // Raise an action through the API: recorded as the key, which can't verify it.
  const { POST } = await import("@/app/api/v1/actions/route");
  const made = await POST(req("/api/v1/actions", keyA, { method: "POST", body: JSON.stringify({ site_id: A.summit, title: "Replace the faulty card reader", due_date: inDays(7), owner_email: "sue@m4a.com" }) }));
  assert.equal(made.status, 201);
  const j = await made.json();
  assert.equal(j.source.type, "api"); assert.match(j.raised_by, /^api-key:/);
  const bad = await POST(req("/api/v1/actions", keyA, { method: "POST", body: JSON.stringify({ site_id: B.summit, title: "Cross-company", due_date: inDays(7) }) }));
  assert.equal(bad.status, 400, "a site of another company isn't found");
  const { GET } = await import("@/app/api/v1/actions/route");
  const list = await (await GET(req("/api/v1/actions?limit=1", keyA))).json();
  assert.equal(list.data.length, 1); assert.ok(list.next, "paged");
  const page2 = await (await GET(req(`/api/v1/actions?limit=50&after=${list.next}`, keyA))).json();
  assert.ok(page2.data.every((a) => a.id > list.next));
  for (let i = 0; i < 125; i++) keys.rateLimited(keyAid);
  assert.equal((await rest.withKey(req("/api/v1/sites", keyA), "sites:read", async () => rest.apiJson({}))).status, 429);
});

test("API keys: rotation keeps the old key for a day; revoking stops it at once; all recorded", async () => {
  await live(async () => {
    assert.equal((await keys.changeKey(adminB, keyAid, "revoke")).ok, false, "another company's admin can't");
    const r = await keys.changeKey(admin, keyAid, "rotate");
    assert.ok(r.ok);
    assert.ok(await keys.authenticateKey(`Bearer ${keyA}`), "old key still works during the grace day");
    assert.ok(await keys.authenticateKey(`Bearer ${r.value.key}`));
    assert.ok((await keys.changeKey(admin, r.value.id, "revoke")).ok);
    assert.equal(await keys.authenticateKey(`Bearer ${r.value.key}`), null);
  });
  const h = rowsOf(await withTenant("m4a", (tx) => tx.execute(sql`select action from audit_log where action like 'apikey.%' order by seq`))).map((x) => x.action);
  assert.deepEqual(h, ["apikey.create", "apikey.rotate", "apikey.revoke"]);
});

// ── bulk import ──────────────────────────────────────────────────────────────

test("CSV parsing and column mapping", () => {
  const t = parseCsv('Site name,Area,"Notes, long"\r\nHarbour,South,"said ""hi""\nline 2"\r\n\r\nMill Lane,North,x\r\n');
  assert.deepEqual(t.headers, ["Site name", "Area", "Notes, long"]);
  assert.equal(t.rows.length, 2); assert.equal(t.rows[0][2], 'said "hi"\nline 2');
  assert.deepEqual(guessMapping(t.headers, BULK_FIELDS.locations).name, 0);
  assert.equal(guessMapping(t.headers, BULK_FIELDS.locations).region, 1, "Area is a synonym for region");
  assert.equal(parseCsv("a;b\n1;2").headers[1], "b", "semicolon files");
  assert.equal(toNumber("(1,200.50)"), -1200.5);
  assert.equal(bulk.toIsoDate("01/12/2026"), "2026-12-01"); assert.equal(bulk.toIsoDate("31/02/2026"), null); assert.equal(bulk.toIsoDate("46000"), "2025-12-09");
});

test("bulk import: preview flags new, updates, duplicates and errors; commit writes only good rows and saves the mapping", async () => {
  assert.equal((await bulk.previewBulk(sup, "locations", [{ name: "X" }])).ok, false, "admins only");
  const p = await bulk.previewBulk(admin, "locations", [{ name: "Mill Lane", region: "North", entity: "Retail" }, { name: "harbour", code: "H1" }, { name: "Mill lane" }, { name: "" }, { name: "Quay", active: "maybe" }]);
  assert.ok(p.ok);
  assert.deepEqual(p.value.rows.map((r) => r.status), ["new", "update", "error", "error", "error"]);
  assert.match(p.value.rows[2].message, /twice/);
  const c = await bulk.commitBulk(admin, "locations", [{ name: "Mill Lane", region: "North", entity: "Retail" }, { name: "harbour", code: "H1" }], "", { name: "Site name", region: "Area", entity: "Entity", code: "Code" });
  assert.ok(c.ok); assert.equal(c.value.added, 1); assert.equal(c.value.updated, 1);
  const s = await structure.getStructure(admin);
  assert.equal(s.entities.length, 1); assert.equal(s.entities[0].name, "Retail");
  assert.equal((await getSettings("m4a")).bulkMappings.locations.region, "Area", "the mapping is remembered");

  const people = await bulk.previewBulk(admin, "people", [{ email: "pat@m4a.com", roles: "inspector, site manager", sites: "Harbour" }, { email: "bad-email", roles: "viewer" }, { email: "kim@m4a.com", roles: "wizard" }, { email: "ada@m4a.com", roles: "viewer" }]);
  assert.deepEqual(people.value.rows.map((r) => r.status), ["new", "error", "error", "error"]);
  assert.match(people.value.rows[3].message, /own admin/);

  await createAction(sup, { unitId: A.harbour, title: "Fix the door closer", dueDate: inDays(10), priority: "medium", ownerName: "Facilities" });
  const acts = await bulk.previewBulk(admin, "actions", [
    { title: "Fix the door closer", site: "Harbour", due: inDays(5) },
    { title: "Replace the signage", site: "Harbour", due: "15/12/2026", priority: "high" },
    { title: "Replace the signage", site: "harbour", due: "15/12/2026" },
    { title: "Unknown place", site: "Atlantis", due: "2026-12-01" },
    { title: "No date", site: "Summit", due: "soon" },
  ]);
  assert.deepEqual(acts.value.rows.map((r) => r.status), ["skip", "new", "skip", "error", "error"]);
  assert.match(acts.value.rows[0].message, /already open/);
  const done = await bulk.commitBulk(admin, "actions", acts.value.rows.map((r) => r.values));
  assert.equal(done.value.added, 1); assert.equal(done.value.skipped, 4);
  assert.equal((await listActions(admin)).filter((a) => a.sourceType === "import").length, 1);
  assert.ok((await verify("m4a")).ok);
});

// ── root cause, effectiveness, recurrence ────────────────────────────────────

test("root cause analysis is cleaned: at most five whys, five causes per fishbone heading", () => {
  const r = cleanRca({ whys: ["a", "b", "c", "d", "e", "f", ""], fishbone: { people: ["x", "", "y"], bogus: ["z"], method: Array(9).fill("m") } });
  assert.equal(r.whys.length, 5); assert.deepEqual(r.fishbone.people, ["x", "y"]); assert.equal(r.fishbone.method.length, 5); assert.equal(r.fishbone.bogus, undefined);
  assert.equal(cleanRca({}), null);
});

test("effectiveness checks: set on closure, recorded by an independent supervisor; 'not effective' reopens", async () => {
  const a = await createAction(sup, { unitId: A.harbour, title: "Retrain the counter team on ID checks", dueDate: inDays(5), priority: "high", ownerEmail: insp.email, ownerName: "Ian", effectivenessDays: 30, rca: { whys: ["No second check"], fishbone: { people: ["New starters"] } } });
  assert.ok(a.ok, a.error);
  assert.equal(a.value.rca.whys[0], "No second check");
  assert.ok((await stepAction(insp, a.value.id, "start", {})).ok);
  assert.ok((await stepAction(insp, a.value.id, "submit", { note: "Training done and signed off." })).ok);
  const v = await stepAction(sup2, a.value.id, "verify", {});
  assert.ok(v.ok, v.error);
  assert.equal(v.value.effectiveness.status, "pending"); assert.equal(v.value.effectiveness.due, inDays(30));
  assert.equal(effectivenessBlocker(insp, v.value), "A supervisor records whether the action worked.");
  assert.match(effectivenessBlocker({ ...sup, email: insp.email, roles: ["supervisor"] }, v.value), /own this action/);
  assert.equal((await stepAction(sup2, a.value.id, "ineffective", { note: "short" })).ok, false, "say what was checked");
  const no = await stepAction(sup2, a.value.id, "ineffective", { note: "Two of ten files still had no second check." });
  assert.ok(no.ok, no.error);
  assert.equal(no.value.status, "in_progress"); assert.equal(no.value.reopenCount, 1); assert.equal(no.value.effectiveness.status, "ineffective");
});

test("an inspection question that fails again reopens its earlier action instead of raising another", async () => {
  const t = await createTemplate(sup, { from: "library", libraryKey: "hc-medication" });
  assert.ok((await publishTemplate(sup, t.value.id, "v1")).ok);
  const def = (await getTemplate(sup, t.value.id)).draft;
  const answers = {};
  for (const s of def.sections) for (const q of s.questions) answers[q.id] = q.type === "number" ? { v: 5 } : q.type === "yesno" ? { v: "yes" } : q.type === "text" ? { v: "ok" } : undefined;
  const fridge = def.sections[0].questions.find((q) => q.type === "number");
  answers[fridge.id] = { v: 11, note: "Door left open", photos: ["evidence-1"] };
  const sig = { name: "Ian", data: "data:image/png;base64,iVBORw0KGgo=", at: new Date().toISOString() };
  const run = async (period, client) => {
    const s = await saveInspection(insp, { clientId: client, templateId: t.value.id, unitId: A.summit, period, answers, signatures: { inspector: sig, site: { ...sig, name: "Mo" } }, submit: true });
    assert.ok(s.ok, s.error);
    const d = await decideInspection(sup, s.value.id, "approve", "");
    assert.ok(d.ok, d.error);
  };
  await run("2026-09-01", "rec-1");
  const first = (await listActions(sup)).filter((x) => x.sourceType === "inspection" && x.unitId === A.summit);
  assert.equal(first.length, 1); assert.equal(first[0].effectivenessDays, 30, "inspection actions get a 30-day check");
  await stepAction(insp, first[0].id, "submit", { note: "Fridge serviced and log checked." });
  assert.ok((await stepAction(sup2, first[0].id, "verify", {})).ok);
  await run("2026-10-01", "rec-2");
  const after = (await listActions(sup)).filter((x) => x.sourceType === "inspection" && x.unitId === A.summit);
  assert.equal(after.length, 1, "no second action");
  assert.equal(after[0].status, "in_progress"); assert.equal(after[0].reopenCount, 1);
  assert.equal(after[0].effectiveness.status, "ineffective");
});

// ── structure and comparison ─────────────────────────────────────────────────

test("structure: admins set entities (a site in one at most); supervisors make groups; the comparison rolls up", async () => {
  assert.equal((await structure.saveEntity(sup, null, { name: "Hospital A", unitIds: [A.harbour] })).ok, false);
  const e1 = await structure.saveEntity(admin, null, { name: "North Trust", unitIds: [A.harbour, A.summit] });
  assert.ok(e1.ok);
  const e2 = await structure.saveEntity(admin, null, { name: "South Trust", unitIds: [A.summit] });
  const s = e2.value;
  assert.deepEqual(s.entities.find((e) => e.name === "South Trust").unitIds, [A.summit]);
  assert.ok(!s.entities.find((e) => e.name === "North Trust").unitIds.includes(A.summit), "moved, not shared");
  assert.equal((await structure.saveEntity(admin, null, { name: "North Trust" })).status, 409);
  assert.equal((await structure.saveGroup(viewer, null, { name: "G", unitIds: [A.harbour] })).ok, false);
  assert.equal((await structure.saveGroup(sup, null, { name: "Bad", unitIds: [B.harbour] })).ok, false, "another company's site isn't valid");
  const c = await structure.compare(sup, { level: "entity", days: 365 });
  assert.equal(c.level, "entity");
  assert.ok(c.groups.some((g) => g.name === "South Trust" && g.sites === 1));
  assert.equal(structure.median([1, 3, 2, 10]), 2.5);
  assert.equal(structure.percentile(3, [1, 2, 3, 4]), 63);
});

// ── alerts and the daily email ───────────────────────────────────────────────

test("alerts: each person sees what needs them, never their own work to approve or verify", async () => {
  const supAlerts = await notify.alertsFor(sup);
  const verifyKinds = supAlerts.filter((x) => x.kind === "verify");
  const raisedBySup = (await listActions(sup)).filter((a) => a.status === "awaiting_verification" && a.raisedBy === sup.email);
  for (const a of raisedBySup) assert.ok(!verifyKinds.some((v) => v.id === a.id), "not an action you raised");
  const rep = await issues.submitReport((await issues.listLinks(sup))[1].token, { category: "observation", description: "The queue barrier is broken again." }, null, { ip: "198.51.100.1" });
  assert.ok(rep.ok);
  assert.ok((await notify.alertsFor(sup)).some((x) => x.kind === "issue"), "supervisors triage reports");
  assert.ok(!(await notify.alertsFor(insp)).some((x) => x.kind === "issue"));
  await createAction(sup, { unitId: A.harbour, title: "Overdue thing", dueDate: inDays(-2), priority: "low", ownerEmail: viewer.email, ownerName: "Val" });
  await createAction(sup, { unitId: A.harbour, title: "Soon thing", dueDate: inDays(1), priority: "low", ownerEmail: viewer.email, ownerName: "Val" });
  const mine = await notify.alertsFor(viewer);
  assert.deepEqual(mine.map((x) => x.kind), ["overdue", "due_soon"], "most urgent first");
  assert.equal((await notify.alertsFor(supB)).filter((x) => x.kind === "issue").length, 0, "another company's reports never show");
});

test("the daily email: grouped, escaped, sent once a day through Resend, only when configured, never in a demo, never to people who opted out", async () => {
  const m = notify.digestEmail("Acme <Co>", "Val Smith", [{ kind: "overdue", id: "1", title: "ACT-1: <b>x</b>", detail: "Harbour", href: "/actions?open=1", at: "" }, { kind: "issue", id: "2", title: "OBS-1", detail: "d", href: "/issues", at: "" }], "https://q.example");
  assert.match(m.subject, /2 things need you today/);
  assert.ok(m.html.includes("Acme &lt;Co&gt;") && m.html.includes("&lt;b&gt;x&lt;/b&gt;") && !m.html.includes("<b>x</b>"));
  assert.ok(m.html.indexOf("Your overdue actions") < m.html.indexOf("Reported issues to triage"));
  assert.match(m.text, /https:\/\/q\.example\/actions\?open=1/);

  await setMember(admin, { email: viewer.email, name: "Val", roles: ["viewer"] });
  await setMember(admin, { email: sup.email, name: "Sue", roles: ["supervisor"] });
  const sent = [];
  notify.__setFetch(async (url, init) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response("{}", { status: 200 }); });
  assert.equal((await notify.sendDigests("m4a")).skipped, process.env.DEMO_MODE === "1" ? "demo" : "email not set up");
  await live(async () => assert.equal((await notify.sendDigests("m4a")).skipped, "demo"), { DEMO_MODE: "1", RESEND_API_KEY: "re_test" });
  assert.equal(sent.length, 0, "nothing sent without a key or in a demo");
  await live(async () => {
    const r = await notify.sendDigests("m4a");
    assert.equal(r.skipped, null); assert.ok(r.sent >= 2, `sent ${r.sent}`);
    assert.ok(sent.every((x) => x.url === "https://api.resend.com/emails" && x.body.from === "Pulsus Quality <support@pulsus.tech>" && x.auth === "Bearer re_test"));
    assert.ok(sent.some((x) => x.body.to[0] === viewer.email && /Your overdue actions/.test(x.body.html)));
    assert.equal(new Set(sent.map((x) => x.body.to[0])).size, sent.length, "one email per person");
    assert.equal((await notify.sendDigests("m4a")).skipped, "already sent today");
    // Tomorrow: Val has opted out.
    sent.length = 0;
    assert.ok(await notify.setMyEmailAlerts(viewer, false));
    await notify.sendDigests("m4a", new Date(Date.now() + 864e5));
    assert.ok(!sent.some((x) => x.body.to[0] === viewer.email));
    assert.ok(sent.length >= 1);
  }, { RESEND_API_KEY: "re_test" });
  assert.ok((await verify("m4a")).ok);
});

// ── the licence: the API follows the company's plan ─────────────────────────

test("the REST API follows the company's plan: paid works, lapsed is refused with licence_required, reinstated works again with the same key", async () => {
  const { resolveActor } = await import("@/lib/session");
  const { cachePlan } = await import("@/lib/planCache");
  const { licenceLapsed, cachedLicenceLapsed } = await import("@/lib/planStatus");
  const { GET: root } = await import("@/app/api/v1/route");
  const { GET: sitesGet } = await import("@/app/api/v1/sites/route");
  await setupCompany("lic");
  const visit = (standing, trialEndsAt = null) => resolveActor({ tenant: "lic", tenantName: "Lic", kind: "company", email: "owner@lic.com", name: "Owner", platformRole: "owner", operator: false, plan: { standing, trialEndsAt }, requestId: "" });
  const owner = await visit("active");
  assert.deepEqual(owner.roles, ["admin"]);
  const made = await live(() => keys.createKey(owner, { name: "BI", scopes: ["sites:read"] }));
  assert.ok(made.ok, made.error);
  const key = made.value.key;
  const call = async (h = sitesGet) => { const r = await h(req("/api/v1/sites", key)); return { status: r.status, body: await r.json() }; };

  assert.equal((await call()).status, 200, "paid: data");

  await visit("suspended");
  const refused = await call();
  assert.equal(refused.status, 402); assert.equal(refused.body.error.code, "licence_required");
  assert.ok(!refused.body.sites, "no data");
  assert.equal((await call(root)).body.error.code, "licence_required", "the API's front page too");
  const lapsedOwner = await visit("ended");
  const noKey = await live(() => keys.createKey(lapsedOwner, { name: "Another", scopes: ["sites:read"] }));
  assert.equal(noKey.ok, false); assert.equal(noKey.status, 402, "no new keys while lapsed");

  const reinstated = await visit("active");
  assert.equal((await call()).status, 200, "the same key works again once paid, with no new key");
  assert.ok((await live(() => keys.createKey(reinstated, { name: "Another", scopes: ["sites:read"] }))).ok);

  // A trial: works while it runs; a cached trial whose end has passed counts as ended (the platform will have moved it).
  await visit("trial", new Date(Date.now() + 5 * 864e5).toISOString());
  assert.equal((await call()).status, 200);
  await cachePlan("lic", { standing: "trial", trialEndsAt: new Date(Date.now() - 864e5).toISOString() });
  assert.equal((await call()).body.error.code, "licence_required");

  // The rule itself: the same as the licence wall's.
  assert.equal(licenceLapsed({ standing: "past_due", trialEndsAt: null }), null);
  assert.equal(licenceLapsed({ standing: "ended", trialEndsAt: null }), "ended");
  assert.equal(licenceLapsed(null), null, "the institution and the demo have no plan");
  assert.equal(cachedLicenceLapsed({ standing: "active", trialEndsAt: "2020-01-01" }), null);
  assert.equal((await keys.authenticateKey(`Bearer ${keyA}`))?.licence ?? null, null, "another company's standing doesn't touch m4a's keys");
});
