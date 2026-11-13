// Templates, inspections, scorecards and set-up (Milestone 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { actor, setupCompany } from "./support/fixtures.mjs";
const { validateTemplate, scoreInspection, isVisible, blankTemplate, newQuestion } = await import("@/lib/templates/model");
const { LIBRARY } = await import("@/lib/templates/library");
const { SCORECARD_LIBRARY, resolveLibraryScorecard } = await import("@/lib/scorecards/library");
const { createTemplate, saveDraft, publishTemplate, getTemplate, listTemplates, deleteTemplate, ensureProgramTemplatesFor, setArchived } = await import("@/lib/templates/store");
const { saveInspection, decideInspection, getInspection, listInspections, deleteInspection } = await import("@/lib/inspections");
const { listActions, stepAction } = await import("@/lib/actions");
const { getDataset } = await import("@/lib/dataset");
const { record: metricsRecord } = await import("@/lib/metrics");
const { templateToXlsx, xlsxToTemplate } = await import("@/lib/templates/io");
const { createScorecard, saveScorecardDraft, publishScorecard, listScorecards, activateScorecard } = await import("@/lib/scorecards/store");
const { applySetup, parseLocations } = await import("@/lib/setup");
const { validateDefinition } = await import("@/lib/scorecard");
const { withTenant, rowsOf } = await import("@/lib/db/client");
const { verify } = await import("@/lib/audit");
const { sql } = await import("drizzle-orm");

const ids = await setupCompany("tpl");
const admin = actor("tpl", "ada@tpl.com", ["admin"]);
const sup = actor("tpl", "sue@tpl.com", ["supervisor"]);
const sup2 = actor("tpl", "sam@tpl.com", ["supervisor"]);
const insp = actor("tpl", "ian@tpl.com", ["inspector"]);
const viewer = actor("tpl", "val@tpl.com", ["viewer"]);

// ── the pure model ───────────────────────────────────────────────────────────

test("every library template is valid, and the library covers five sectors", () => {
  assert.ok(LIBRARY.length >= 28);
  for (const e of LIBRARY) { const v = validateTemplate(e.def); assert.ok(v.ok, `${e.key}: ${v.error}`); }
  assert.deepEqual(new Set(LIBRARY.map((e) => e.sector)), new Set(["banking", "healthcare", "government", "higher_ed", "general"]));
  assert.equal(new Set(LIBRARY.map((e) => e.key)).size, LIBRARY.length, "keys are unique");
  for (const s of SCORECARD_LIBRARY) assert.ok(validateDefinition(resolveLibraryScorecard(s, new Map())).ok, s.key);
});

const def = validateTemplate({
  name: "Test", sector: "general", scoring: { passMark: 80 },
  sections: [{ title: "A", questions: [
    { id: "q1", type: "yesno", label: "Door locked", weight: 2, critical: true, photoOnFail: true },
    { id: "q2", type: "text", label: "Why not?", showIf: { q: "q1", is: "fail" } },
    { id: "q3", type: "rating", label: "Tidiness", weight: 1, scale: { min: 1, max: 5, passAt: 3 } },
    { id: "q4", type: "number", label: "Fridge °C", weight: 1, range: { min: 2, max: 8 } },
    { id: "q5", type: "choice", label: "Signage", weight: 1, allowNA: true, options: [{ id: "a", label: "Good", score: 1 }, { id: "b", label: "Missing", score: 0, fail: true }] },
  ] }],
}).def;

test("scoring: weighted %, N/A excluded, rating and range, critical override", () => {
  const all = scoreInspection(def, { q1: { v: "yes" }, q3: { v: 5 }, q4: { v: 5 }, q5: { na: true } });
  assert.equal(all.pct, 100); assert.equal(all.result, "pass"); assert.equal(all.possible, 4, "N/A is not in the denominator");
  const mixed = scoreInspection(def, { q1: { v: "yes" }, q3: { v: 3 }, q4: { v: 9 }, q5: { v: "a" } });
  assert.equal(mixed.pct, Math.round(((2 + 0.5 + 0 + 1) / 5) * 1000) / 10); assert.equal(mixed.result, "fail");
  const crit = scoreInspection(def, { q1: { v: "no", photos: ["abcdefgh1"] }, q2: { v: "jammed" }, q3: { v: 5 }, q4: { v: 5 }, q5: { v: "a" } });
  assert.equal(crit.result, "fail", "a failed critical question fails the inspection");
  assert.equal(crit.criticalFails, 1);
  assert.equal(crit.pct, 60);
  const zero = scoreInspection({ ...def, scoring: { passMark: 80, critical: "zero" } }, { q1: { v: "no", photos: ["abcdefgh1"] }, q3: { v: 5 }, q4: { v: 5 }, q5: { v: "a" } });
  assert.equal(zero.pct, 0);
});

test("conditional logic and evidence on failure", () => {
  const s = def.sections[0];
  assert.equal(isVisible(s.questions[1], s, { q1: { v: "yes" } }), false);
  assert.equal(isVisible(s.questions[1], s, { q1: { v: "no" } }), true);
  const sc = scoreInspection(def, { q1: { v: "no" }, q3: { v: 4 }, q4: { v: 4 }, q5: { v: "a" } });
  assert.equal(sc.result, "fail");
  assert.ok(sc.missing.some((m) => m.why === "photo"), "a failed question that needs a photo is incomplete without one");
  assert.ok(!sc.missing.some((m) => m.questionId === "q2"), "hidden questions aren't required (the follow-up is optional text)");
  const bad = validateTemplate({ name: "x", sections: [{ title: "A", questions: [{ id: "a", type: "text", label: "x", showIf: { q: "zzz", is: "fail" } }] }] });
  assert.equal(bad.ok, false, "a condition must point at an earlier question");
});

test("per-item sections: deviations, defects and opportunities", () => {
  const kyc = LIBRARY.find((e) => e.key === "bank-kyc-file").def;
  const sec = kyc.sections.find((s) => s.perItem);
  const yes = Object.fromEntries(sec.questions.map((q) => [q.id, q.type === "reference" ? { v: "ACC-1" } : { v: "yes" }]));
  const one = { ...yes, [sec.questions[1].id]: { v: "no" } };
  const sc = scoreInspection(kyc, { s1q1: { v: "random, seed 42" } }, [{ ref: "A", answers: yes }, { ref: "B", answers: one }, { ref: "C", answers: yes }]);
  assert.equal(sc.items, 3); assert.equal(sc.deviations, 1); assert.equal(sc.defects, 1);
  assert.equal(sc.criticalFails, 1, "identity verification is critical");
  assert.ok(sc.opportunities >= 3 * 7);
});

// ── templates on the database ────────────────────────────────────────────────

let tplId;
test("build, publish and lock: published versions never change", async () => {
  assert.equal((await createTemplate(insp, { from: "library", libraryKey: "gen-5s" })).ok, false, "inspectors don't build templates");
  const t = await createTemplate(sup, { from: "library", libraryKey: "hc-medication" });
  assert.ok(t.ok); tplId = t.value.id;
  assert.equal(t.value.version, 0); assert.equal(t.value.status, "draft");
  assert.ok((await listTemplates(sup)).some((x) => x.id === tplId));
  assert.ok(!(await listTemplates(insp)).some((x) => x.id === tplId), "drafts are hidden from inspectors");
  const p1 = await publishTemplate(sup, tplId, "First");
  assert.ok(p1.ok); assert.equal(p1.value.version, 1); assert.equal(p1.value.dirty, false);
  assert.equal((await publishTemplate(sup, tplId, "")).ok, false, "nothing new to publish");
  const d = structuredClone(p1.value.draft); d.sections[0].questions[0].label = "Medicine cupboards locked (checked)";
  const e = await saveDraft(sup, tplId, d);
  assert.ok(e.ok); assert.equal(e.value.dirty, true);
  assert.equal((await publishTemplate(sup, tplId, "Wording")).value.version, 2);
  await assert.rejects(withTenant("tpl", (tx) => tx.execute(sql`update template_versions set note = 'x' where template_id = ${tplId}`)), "a published version can't be updated");
  assert.equal((await deleteTemplate(sup, tplId)).ok, false, "a published template is archived, not deleted");
});

test("excel round trip keeps the definition", async () => {
  for (const key of ["bank-branch-ops", "hc-hand-hygiene", "gov-procurement-file", "gen-5s"]) {
    const src = LIBRARY.find((e) => e.key === key).def;
    const back = await xlsxToTemplate(await templateToXlsx(src));
    assert.ok(back.ok, back.error);
    const strip = (d) => d.sections.map((s) => ({ t: s.title, p: !!s.perItem, q: s.questions.map((q) => [q.type, q.label, q.weight, q.critical, q.allowNA, q.options?.map((o) => [o.label, o.score, !!o.fail]), q.range, q.scale?.passAt, q.showIf?.is, !!q.photoOnFail]) }));
    assert.deepEqual(strip(back.def), strip(src), key);
    assert.equal(back.def.scoring.passMark, src.scoring.passMark);
  }
});

// ── inspections ──────────────────────────────────────────────────────────────

const sig = { name: "Ian", data: "data:image/png;base64,iVBORw0KGgo=", at: new Date().toISOString() };
let inspId;
test("an inspection: draft offline-safe, submit checks completeness, version kept", async () => {
  const t = await getTemplate(sup, tplId);
  const def2 = t.draft;
  const answers = {};
  for (const s of def2.sections) for (const q of s.questions) answers[q.id] = q.type === "number" ? { v: 5 } : q.type === "yesno" ? { v: "yes" } : q.type === "text" ? { v: "ok" } : undefined;
  const fridge = def2.sections[0].questions.find((q) => q.type === "number");
  answers[fridge.id] = { v: 11, note: "Door left open", photos: ["evidence-1234"] };
  const a = await saveInspection(insp, { clientId: "device-abc", templateId: tplId, unitId: ids.harbour, period: "2026-10-01", answers });
  assert.ok(a.ok, a.error); inspId = a.value.id;
  const again = await saveInspection(insp, { clientId: "device-abc", templateId: tplId, unitId: ids.harbour, period: "2026-10-01", answers });
  assert.equal(again.value.id, inspId, "a retried save with the same client id updates, never duplicates");
  assert.equal(a.value.templateVersion, 2);
  const noSig = await saveInspection(insp, { id: inspId, answers, submit: true });
  assert.equal(noSig.ok, false); assert.match(noSig.error, /sign/i);
  const site = { ...sig, name: "Mo (ward manager)" };
  const sub = await saveInspection(insp, { id: inspId, answers, signatures: { inspector: sig, site }, checkin: { at: new Date().toISOString(), lat: 51.5, lng: -0.12 }, submit: true });
  assert.ok(sub.ok, sub.error); assert.equal(sub.value.status, "submitted");
  assert.equal(sub.value.score.result, "fail", "fridge out of range is a critical failure");
  assert.equal(sub.value.checkin.lat, 51.5);
  assert.equal((await saveInspection(insp, { id: inspId, answers })).ok, false, "submitted work is locked");
  // A new version doesn't move this inspection.
  const d = structuredClone(t.draft); d.sections[0].title = "Storage (v3)"; await saveDraft(sup, tplId, d); await publishTemplate(sup, tplId, "");
  const got = await getInspection(sup, inspId);
  assert.equal(got.inspection.templateVersion, 2); assert.notEqual(got.def.sections[0].title, "Storage (v3)");
});

test("approval: nobody approves their own; failures raise actions; verifier ≠ raiser", async () => {
  assert.equal((await decideInspection({ ...insp, roles: ["supervisor"] }, inspId, "approve", "")).ok, false, "not your own");
  assert.equal((await decideInspection(viewer, inspId, "approve", "")).ok, false);
  const ok = await decideInspection(sup, inspId, "approve", "Agreed");
  assert.ok(ok.ok, ok.error); assert.equal(ok.value.status, "approved");
  const acts = (await listActions(sup)).filter((x) => x.sourceType === "inspection");
  assert.equal(acts.length, 1, "one action for the failed critical question");
  assert.equal(acts[0].raisedBy, sup.email);
  assert.match(acts[0].details, /INS-0001/);
  assert.equal(ok.value.actions.length, 1);
  await stepAction(insp, acts[0].id, "submit", { note: "Fridge serviced and the log checked twice daily." });
  assert.equal((await stepAction(sup, acts[0].id, "verify", {})).ok, false, "the raiser can't verify");
  assert.ok((await stepAction(sup2, acts[0].id, "verify", {})).ok);
  assert.ok((await verify("tpl")).ok, "the change history chain holds");
});

test("drafts can be deleted by their inspector; approved can't", async () => {
  const d = await saveInspection(insp, { templateId: tplId, unitId: ids.summit, period: "2026-10-01", answers: {} });
  assert.ok(d.ok);
  assert.equal((await deleteInspection(sup2, d.value.id)).ok, false);
  assert.ok((await deleteInspection(insp, d.value.id)).ok);
  assert.equal((await deleteInspection(insp, inspId)).ok, false);
  assert.ok((await listInspections(viewer)).every((x) => x.status === "approved"));
});

// ── Branch Defects as a template feeds the same figures ──────────────────────

test("the programme becomes templates; approving one feeds Branch Defects like a review", async () => {
  const made = await ensureProgramTemplatesFor("tpl");
  assert.equal(made, 1, "one area → one template (no scorecard here)");
  assert.equal(await ensureProgramTemplatesFor("tpl"), 0, "idempotent");
  const t = (await listTemplates(sup)).find((x) => x.binding?.kind === "defects");
  assert.equal(t.version, 1);
  const full = await getTemplate(sup, t.id);
  const sec = full.draft.sections[0];
  const q = (k) => sec.questions.find((x) => x.key === k).id;
  const items = [
    { ref: "F-1", answers: { [q("dual")]: { v: "fail" }, [q("purpose")]: { v: "pass" }, [q("receipt")]: { na: true }, [q("@nature")]: { v: "Missing approval" }, [q("@recurring")]: { v: "yes" } } },
    { ref: "F-2", answers: { [q("dual")]: { v: "pass" }, [q("purpose")]: { v: "pass" }, [q("receipt")]: { v: "pass" } } },
  ];
  const s = await saveInspection(insp, { templateId: t.id, unitId: ids.summit, period: "2026-09-01", items, submit: true });
  assert.ok(s.ok, s.error);
  const before = metricsRecord((await getDataset("tpl")).rows);
  await decideInspection(sup, s.value.id, "approve", "");
  const d = await getDataset("tpl");
  const after = metricsRecord(d.rows);
  assert.equal(after.instances - before.instances, 5, "each pass/fail check is a possible instance");
  assert.equal(after.defects - before.defects, 1);
  assert.equal(after.recurring - before.recurring, 1);
  assert.ok(d.natures.some((n) => n.label === "Missing approval"));
});

// ── scorecards ───────────────────────────────────────────────────────────────

test("scorecard designer: library copy, draft, versioned publish, checklist-fed measure", async () => {
  assert.equal((await createScorecard(sup, { from: "library", libraryKey: "ward-quality" })).ok, false, "admins design scorecards");
  const c = await createScorecard(admin, { from: "library", libraryKey: "ward-quality" });
  assert.ok(c.ok, c.error);
  const meds = c.value.draft.measures.find((m) => m.key === "meds");
  assert.equal(meds.kind, "inspection", "linked to the company's own copy of the medicines checklist");
  assert.equal(meds.source.templateId, tplId);
  assert.equal(c.value.draft.measures.find((m) => m.key === "handHygiene").kind, "input", "no hand hygiene checklist here, so it is keyed");
  const d = structuredClone(c.value.draft);
  d.target = 92;
  const saved = await saveScorecardDraft(admin, c.value.id, d);
  assert.ok(saved.ok, saved.error);
  const p = await publishScorecard(admin, c.value.id, { activate: true });
  assert.ok(p.ok, p.error); assert.equal(p.value.version, 1); assert.equal(p.value.active, true);
  assert.equal((await publishScorecard(admin, c.value.id)).ok, false, "nothing new");
  await assert.rejects(withTenant("tpl", (tx) => tx.execute(sql`update scorecard_versions set version = 9`)), "a published scorecard version can't be updated");
  // A fresh approved inspection of the medicines checklist feeds the measure.
  const t = await getTemplate(sup, tplId);
  const answers = {};
  for (const s of t.draft.sections) for (const q of s.questions) if (q.type === "yesno") answers[q.id] = { v: "yes" }; else if (q.type === "number") answers[q.id] = { v: 5 };
  const s = await saveInspection(insp, { templateId: tplId, unitId: ids.summit, period: "2026-10-01", answers, signatures: { inspector: sig, site: sig }, submit: true });
  assert.ok(s.ok, s.error);
  await decideInspection(sup2, s.value.id, "approve", "");
  const entry = rowsOf(await withTenant("tpl", (tx) => tx.execute(sql`select values from scorecard_entries where scorecard_id = ${c.value.id} and unit_id = ${ids.summit}`)))[0];
  assert.equal(entry.values.meds, 100);
  assert.equal((await listScorecards(admin)).filter((x) => x.active).length, 1);
  assert.equal((await activateScorecard(sup, c.value.id)).ok, false);
});

// ── set-up wizard ────────────────────────────────────────────────────────────

test("set-up: a hospital's own labels, wards, checklists and scorecard, in its tenant only", async () => {
  assert.deepEqual(parseLocations("Name, Hospital\nWard 1, St Mary's\nWard 2\tSt Mary's\nward 1, dup\n\nICU"), [{ name: "Ward 1", group: "St Mary's" }, { name: "Ward 2", group: "St Mary's" }, { name: "ICU", group: "" }]);
  const h = actor("mercy-health", "admin@mercy.org", ["admin"]);
  assert.equal((await applySetup({ ...h, roles: ["supervisor"] }, {})).ok, false);
  const r = await applySetup(h, { sector: "healthcare", unitLabel: "Ward", unitPlural: "Wards", groupLabel: "Hospital", itemLabel: "Chart", locations: parseLocations("Ward 1, St Mary's\nWard 2, St Mary's\nICU, General"), templates: ["hc-hand-hygiene", "hc-medication", "hc-chart-review"], scorecard: "ward-quality" });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.value, { units: 3, templates: 3, scorecard: true });
  const list = await listTemplates(actor("mercy-health", "ian@mercy.org", ["inspector"]));
  assert.equal(list.filter((t) => t.version > 0).length, 3, "published, so inspectors can start straight away");
  const cards = await listScorecards(h);
  assert.equal(cards[0].active, true);
  assert.equal(cards[0].definition.measures.find((m) => m.key === "meds").kind, "inspection", "linked to the ward's own medicines checklist");
  assert.ok(!(await listTemplates(admin)).some((t) => t.name.startsWith("Hand hygiene")), "nothing crosses tenants");
});

test("blank templates and the archive", async () => {
  const b = blankTemplate("Quick check");
  b.sections[0].questions = [{ ...newQuestion("passfail"), label: "Is it OK?" }];
  const t = await createTemplate(sup, { from: "import", def: b });
  assert.ok(t.ok);
  assert.ok((await deleteTemplate(sup, t.value.id)).ok, "never published: can be deleted");
  const a = await setArchived(sup, tplId, true);
  assert.equal(a.value.status, "archived");
  const s = await saveInspection(insp, { templateId: tplId, unitId: ids.harbour, period: "2026-10-01", answers: {} });
  assert.equal(s.ok, false, "no new inspections on an archived template");
});
