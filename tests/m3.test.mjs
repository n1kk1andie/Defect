// Milestone 3: sampling, programmes and visits, the risk score, the Pulse
// block and the committee report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actor, setupCompany } from "./support/fixtures.mjs";
const S = await import("@/lib/sampling");
const { scoreSite, cleanRisk, DEFAULT_RISK, riskBand, why } = await import("@/lib/risk");
const { windows, statusOf, saveProgramme, visits, listProgrammes } = await import("@/lib/schedule");
const { createPlan, startPlanInspection, evaluatePlan, getPlan, listPlans } = await import("@/lib/samplingPlans");
const { createTemplate, publishTemplate, getTemplate } = await import("@/lib/templates/store");
const { saveInspection, decideInspection } = await import("@/lib/inspections");
const { riskBoard, setFactors } = await import("@/lib/riskScore");
const { pulseFor } = await import("@/lib/pulse");
const { committeePack, committeePdf, committeeXlsx } = await import("@/lib/committee");
const { updateSettings } = await import("@/lib/company");
const { verify } = await import("@/lib/audit");

// ── sampling maths ───────────────────────────────────────────────────────────

test("sample sizes match the standard attribute-sampling figures", () => {
  const n = (c, t, e, N) => S.sampleSize({ confidence: c, tdr: t, edr: e, population: N }).n;
  assert.equal(n(0.95, 0.05, 0), 59); assert.equal(n(0.9, 0.05, 0), 45); assert.equal(n(0.95, 0.1, 0), 29); assert.equal(n(0.9, 0.1, 0), 22); assert.equal(n(0.95, 0.05, 0.01), 93);
  assert.ok(n(0.95, 0.05, 0, 400) < 59, "a small population needs fewer (hypergeometric)");
  assert.equal(n(0.95, 0.05, 0, 15), 15, "a population too small to sample is tested in full");
  assert.throws(() => S.sampleSize({ confidence: 0.95, tdr: 0.05, edr: 0.06 }), /below the tolerable/);
});

test("upper deviation limits (Clopper–Pearson) and the conclusion", () => {
  assert.ok(Math.abs(S.upperLimit(0, 59, 0.95) - 0.0495) < 0.0005);
  assert.ok(S.upperLimit(1, 93, 0.95) <= 0.05);
  const ok = S.evaluate(22, 0, 0.9, 0.1, 420); assert.equal(ok.effective, true);
  const bad = S.evaluate(22, 3, 0.9, 0.1, 420); assert.equal(bad.effective, false); assert.ok(bad.upper > 0.25 && bad.upper < 0.3); assert.equal(bad.projected, 57);
  assert.match(bad.conclusion, /can't be relied on/);
});

test("seeded selection is reproducible; strata and census are honoured", () => {
  const pop = S.numbered(420, "MS");
  const a = S.select(pop, 22, "summit-oct", { stratify: false }), b = S.select([...pop].reverse(), 22, "summit-oct", { stratify: false });
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id), "order of the list doesn't matter, only the seed");
  assert.notDeepEqual(S.select(pop, 22, "other", { stratify: false }).items.map((i) => i.id), a.items.map((i) => i.id));
  assert.equal(new Set(a.items.map((i) => i.id)).size, 22);
  const strat = pop.map((x, i) => ({ ...x, stratum: ["Savings", "Current", "Loans"][i % 3], value: i * 10 }));
  const s = S.select(strat, 30, "x", { stratify: true, censusAbove: 4150 });
  assert.equal(s.items.length, 30);
  assert.equal(s.allocation[0].census, true); assert.equal(s.allocation[0].sample, 5);
  assert.ok(s.allocation.filter((x) => !x.census).every((x) => x.sample >= 1));
  assert.deepEqual(S.parsePopulation("id,product,value\nA1,Loans,100\nA2,Loans,\nA1,dup"), [{ id: "A1", stratum: "Loans", value: 100 }, { id: "A2", stratum: "Loans" }]);
});

// ── the risk model ───────────────────────────────────────────────────────────

const site = (o) => ({ unitId: "u", name: "Ward 4A", inspections: [], samples: [], overdueActions: 0, repeatFindings: [], daysSinceVisit: 10, factors: {}, ...o });
test("risk: transparent drivers, weights, bands, and no data means no score", () => {
  const cfg = cleanRisk({}, "healthcare");
  assert.equal(cfg.factors[0].label, "Patient acuity and bed occupancy", "sector factors by default");
  const good = scoreSite(site({ inspections: [{ ageMonths: 0.5, pct: 98, criticalFails: 0, items: 0, deviations: 0 }] }), cfg);
  const bad = scoreSite(site({ inspections: [{ ageMonths: 0.5, pct: 72, criticalFails: 2, items: 20, deviations: 4 }], overdueActions: 3, repeatFindings: [{ label: "Fridge temperature", template: "Meds" }], daysSinceVisit: 100, factors: { acuity: 90 } }), cfg);
  assert.ok(good.score < 15 && good.band === "worldClass");
  assert.ok(bad.score > 55); assert.ok(["attention", "escalate"].includes(bad.band));
  assert.ok(Math.abs(bad.drivers.reduce((t, d) => t + d.contribution, 0) - bad.score) < 0.6, "contributions add up to the score");
  assert.match(why(bad, "Ward"), /Ward 4A is (Attention|Escalate)/);
  const none = scoreSite(site({ daysSinceVisit: null }), { ...cfg, weights: { ...cfg.weights, recency: 0 }, factors: [] });
  assert.equal(none.score, 0, "only zero-risk drivers with data");
  assert.equal(riskBand(null, cfg), "none");
  assert.deepEqual(cleanRisk({ cutoffs: { worldClass: 50, strong: 40, healthy: 60, watch: 70, attention: 80 } }).cutoffs, DEFAULT_RISK.cutoffs, "an out-of-order set of cut-offs is refused");
  // Recent inspections weigh more.
  const old = scoreSite(site({ inspections: [{ ageMonths: 11, pct: 70, criticalFails: 0, items: 0, deviations: 0 }, { ageMonths: 0, pct: 100, criticalFails: 0, items: 0, deviations: 0 }] }), cfg);
  assert.ok(old.drivers.find((d) => d.key === "score").risk < 50);
});

// ── visits ───────────────────────────────────────────────────────────────────

test("visit windows and their status", () => {
  const w = windows("2026-08-01", 30, 10, "2026-11-30");
  assert.deepEqual(w.slice(0, 2), [{ from: "2026-08-01", by: "2026-08-10" }, { from: "2026-08-31", by: "2026-09-09" }]);
  assert.equal(statusOf(w[0], "2026-11-13", [{ id: "i", day: "2026-08-04", status: "approved" }]).status, "done");
  assert.equal(statusOf(w[1], "2026-11-13", []).status, "overdue");
  assert.equal(statusOf({ from: "2026-11-10", by: "2026-11-20" }, "2026-11-13", []).status, "due");
  assert.equal(statusOf({ from: "2026-11-10", by: "2026-11-20" }, "2026-11-13", [{ id: "d", day: "2026-11-12", status: "draft" }]).status, "in_progress");
});

// ── on the database ──────────────────────────────────────────────────────────

const ids = await setupCompany("m3");
const admin = actor("m3", "ada@m3.org", ["admin"]);
const sup = actor("m3", "sue@m3.org", ["supervisor"]);
const insp = actor("m3", "ian@m3.org", ["inspector"]);
const sig = { name: "Ian", data: "data:image/png;base64,iVBORw0KGgo=", at: new Date().toISOString() };

let kyc, plan;
test("a sampling plan: seeded selection, review of the selected files, evaluation on approval", async () => {
  const t = await createTemplate(sup, { from: "library", libraryKey: "bank-kyc-file" }); await publishTemplate(sup, t.value.id, "");
  kyc = (await getTemplate(sup, t.value.id)).draft;
  const pop = Array.from({ length: 300 }, (_, i) => `ACC-${1000 + i},${i % 2 ? "Personal" : "Business"}`).join("\n");
  assert.equal((await createPlan(insp, { name: "x", populationSize: 100, method: "judgmental", size: 5 })).ok, false, "inspectors don't plan samples");
  const p = await createPlan(sup, { name: "Summit KYC files, October", templateId: t.value.id, unitId: ids.summit, period: "2026-10-01", method: "statistical", confidence: 0.9, tdr: 0.1, edr: 0, population: pop, stratify: true, seed: "summit-oct-2026" });
  assert.ok(p.ok, p.error);
  plan = p.value;
  assert.equal(plan.sampleSize, 22); assert.equal(plan.selection.length, 22); assert.equal(plan.allocation.length, 2);
  const again = S.select(S.parsePopulation(pop), 22, "summit-oct-2026", { stratify: true });
  assert.deepEqual(again.items.map((i) => i.id), plan.selection.map((i) => i.id), "anyone can re-run the selection from the seed");
  assert.match(plan.method_text, /mulberry32/);
  const st = await startPlanInspection(insp, plan.id);
  assert.ok(st.ok, st.error);
  // Answer: three files fail identity verification.
  const sec = kyc.sections.find((s) => s.perItem);
  const items = plan.selection.map((s, i) => ({ ref: s.id, answers: Object.fromEntries(sec.questions.map((q) => [q.id, q.type === "reference" ? { v: s.id } : { v: q.critical && i < 3 ? "no" : "yes" }])) }));
  const sub = await saveInspection(insp, { id: st.value.inspectionId, answers: { [kyc.sections[0].questions[0].id]: { v: "seeded random" } }, items, signatures: { inspector: sig }, submit: true });
  assert.ok(sub.ok, sub.error);
  await decideInspection(sup, sub.value.id, "approve", "");
  const after = (await getPlan(sup, plan.id)).plan;
  assert.equal(after.status, "evaluated"); assert.equal(after.evaluation.deviations, 3); assert.equal(after.evaluation.effective, false); assert.equal(after.evaluation.source, "inspection");
  const manual = await createPlan(sup, { name: "Harbour KYC", unitId: ids.harbour, method: "statistical", confidence: 0.9, tdr: 0.1, edr: 0, populationSize: 180 });
  const ev = await evaluatePlan(sup, manual.value.id, 0);
  assert.equal(ev.value.evaluation.effective, true);
  assert.equal((await evaluatePlan(sup, manual.value.id, 99)).ok, false);
  assert.equal((await listPlans(insp)).length, 2);
});

test("programmes: fixed and risk-based visits, overdue alerts, my schedule", async () => {
  assert.equal((await saveProgramme(insp, null, { name: "x", templateId: plan.templateId, everyDays: 30 })).ok, false);
  const p = await saveProgramme(sup, null, { name: "KYC file reviews", templateId: plan.templateId, everyDays: 30, windowDays: 10, assignees: [insp.email], startDate: "2026-07-01" });
  assert.ok(p.ok, p.error); assert.equal(p.value.sites, 2);
  const rb = await saveProgramme(sup, null, { name: "Risk-based", templateId: plan.templateId, everyDays: 0, windowDays: 14, startDate: "2026-09-01", unitIds: [ids.summit] });
  assert.ok(rb.ok);
  const vs = await visits(insp, { now: new Date("2026-11-13T12:00:00Z"), fromDay: "2026-07-01" });
  const mine = vs.filter((v) => v.programmeId === p.value.id);
  assert.ok(mine.some((v) => v.status === "overdue"), "missed windows show as overdue");
  assert.ok(mine.every((v) => v.assignee === insp.email));
  assert.ok(vs.some((v) => v.programmeId === rb.value.id), "risk-based programme has visits");
  assert.equal((await listProgrammes(sup)).length, 2);
});

test("risk board: sites ranked with drivers and entered factors; pulse and committee report", async () => {
  await updateSettings(admin, { risk: cleanRisk({ factors: [{ key: "volume", label: "Transaction volume", weight: 1 }] }) }, "test");
  assert.equal((await setFactors(sup, [{ unitId: ids.summit, data: { volume: 90 } }])).ok, false);
  assert.ok((await setFactors(admin, [{ unitId: ids.summit, data: { volume: 90, nope: 5 } }, { unitId: ids.harbour, data: { volume: 20 } }])).ok);
  const b = await riskBoard(sup);
  assert.equal(b.sites[0].name, "Summit", "deviations and a high factor put Summit first");
  assert.ok(b.sites[0].drivers.some((d) => d.key === "f:volume" && d.risk === 90));
  const pulse = await pulseFor("m3");
  assert.equal(pulse.inspections.schema, "pulsus.quality.inspections/v1");
  assert.equal(pulse.inspections.risk.sites[0].name, "Summit");
  assert.equal(pulse.inspections.sampling.notEffective, 1);
  assert.equal(pulse.defectRate !== undefined, true, "the original fields stay");
  const pack = await committeePack(sup);
  assert.ok(pack.league.length === 2 && pack.sampling.length === 2);
  const pdf = await committeePdf(pack); assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const xlsx = await committeeXlsx(pack); assert.equal(xlsx.subarray(0, 2).toString(), "PK");
  assert.ok((await verify("m3")).ok);
});
