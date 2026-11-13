// Demo: Meridian Financial Group's Milestone 3 data — programmes of visits, sampling
// plans (Summit's KYC files fail their sample; Harbour's pass; Crossroads'
// loan files are selected and waiting), and the risk factors entered per
// branch, with Summit the weakest. Deterministic; demo tenant only.
import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { counters, inspectionEvents, inspections, programmes, samplingPlans, templates, unitFactors } from "@/lib/db/schema";
import { DEMO } from "@/lib/company";
import { loadVersion } from "@/lib/templates/store";
import { scoreInspection, type SampledItem } from "@/lib/templates/model";
import { evaluate, methodText, sampleSize, select, type PopItem } from "@/lib/sampling";
import { DEMO_DOMAIN, PERSONAS } from "@/lib/demo/personas";
import { signaturePng } from "@/lib/demo/inspections";

const person = (name: string) => PERSONAS.find((p) => p.name === name)!.email;
function rng(seed: number) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (items: PopItem[]) => createHash("sha256").update(JSON.stringify([...items].sort((a, b) => (a.id < b.id ? -1 : 1)))).digest("hex");

const FACTORS: Record<string, { volume: number; turnover: number }> = {
  Harbour: { volume: 62, turnover: 25 }, Riverside: { volume: 44, turnover: 30 }, Parkway: { volume: 50, turnover: 38 },
  Summit: { volume: 78, turnover: 82 }, Crossroads: { volume: 58, turnover: 61 }, Gateway: { volume: 40, turnover: 22 },
};

export async function seedM3(tx: Tx, now: Date, unitIds: Map<string, string>): Promise<{ programmes: number; plans: number }> {
  const r = rng(30303);
  const admin = person("Alex Morgan"), sup = person("Taylor Reid"), jordan = person("Jordan Blake"), riley = `riley.chen@${DEMO_DOMAIN}`;
  const tid = async (key: string) => (await tx.select({ id: templates.id, version: templates.version }).from(templates).where(and(eq(templates.companyId, DEMO), eq(templates.origin, `library:${key}`))).limit(1))[0];
  // Risk factors entered per branch.
  for (const [u, f] of Object.entries(FACTORS)) if (unitIds.has(u)) await tx.insert(unitFactors).values({ companyId: DEMO, unitId: unitIds.get(u)!, data: f, updatedBy: admin }).onConflictDoNothing();

  // Programmes, started four months ago.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
  const plan: [string, string, number, number, string[]][] = [
    ["Monthly branch operations review", "bank-branch-ops", 30, 21, [jordan, riley]],
    ["Teller cash counts", "bank-teller-cash", 30, 21, [jordan, riley]],
    ["KYC file reviews (risk-based)", "bank-kyc-file", 0, 21, [jordan]],
    ["ATM site checks", "bank-atm", 91, 30, [riley]],
  ];
  let made = 0;
  for (const [name, key, every, win, who] of plan) {
    const t = await tid(key);
    if (!t) continue;
    await tx.insert(programmes).values({ id: randomUUID(), companyId: DEMO, name, templateId: t.id, unitIds: [], everyDays: every, windowDays: win, assignees: who, startDate: start, createdBy: sup, createdAt: new Date(Date.parse(start + "T09:00:00Z")) });
    made++;
  }

  // Sampling plans.
  const kyc = await tid("bank-kyc-file"), loan = await tid("bank-loan-file");
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const products = ["Personal", "Business", "Joint"];
  const population = (u: string, n: number, seed: number): PopItem[] => { const g = rng(seed); return Array.from({ length: n }, (_, i) => ({ id: `MS-${u.slice(0, 3).toUpperCase()}-${String(400100 + i)}`, stratum: products[Math.floor(g() * 3)], value: Math.round((g() < 0.06 ? 50000 + g() * 200000 : 500 + g() * 20000)) })); };
  const counterNext = async (name: string, prefix: string) => {
    const cur = (await tx.select({ v: counters.value }).from(counters).where(and(eq(counters.companyId, DEMO), eq(counters.name, name))).limit(1))[0]?.v ?? 0;
    await tx.insert(counters).values({ companyId: DEMO, name, value: cur + 1 }).onConflictDoUpdate({ target: [counters.companyId, counters.name], set: { value: cur + 1 } });
    return `${prefix}-${String(cur + 1).padStart(4, "0")}`;
  };
  let plans = 0;
  const mk = async (o: { unit: string; name: string; template?: { id: string; version: number }; pop: PopItem[]; conf: number; tdr: number; edr: number; stratify: boolean; census: number | null; seed: string; failures?: number | null; review?: boolean }) => {
    const census = o.census != null ? o.pop.filter((i) => (i.value ?? -Infinity) >= o.census!).length : 0;
    const n = sampleSize({ confidence: o.conf, tdr: o.tdr, edr: o.edr, population: o.pop.length - census }).n + census;
    const sel = select(o.pop, n, o.seed, { stratify: o.stratify, censusAbove: o.census });
    const id = randomUUID();
    const ref = await counterNext("sampling", "SMP");
    let inspectionId: string | null = null, evaluation: unknown = null;
    if (o.review && o.template) {
      // The review of the selected files, approved, with `failures` of them failing identity verification.
      const def = (await loadVersion(tx, DEMO, o.template.id, o.template.version))!;
      const sec = def.sections.find((s) => s.perItem)!;
      const failAt = new Set(Array.from({ length: o.failures ?? 0 }, (_, i) => Math.floor((i + 1) * sel.items.length / ((o.failures ?? 0) + 1))));
      const items: SampledItem[] = sel.items.map((s, i) => ({ ref: s.id, answers: Object.fromEntries(sec.questions.map((q) => [q.id, q.type === "reference" ? { v: s.id } : q.allowNA && r() < 0.05 ? { na: true } : { v: failAt.has(i) && q.critical && q.label.startsWith("Identity") ? "no" : "yes", ...(failAt.has(i) && q.critical && q.label.startsWith("Identity") ? { note: "Copy of ID not on file." } : {}) }])) }));
      const answers = { [def.sections[0].questions[0].id]: { v: `Selected by sampling plan ${ref} (seed “${o.seed}”).` } };
      const score = scoreInspection(def, answers, items);
      inspectionId = randomUUID();
      const iref = await counterNext("inspection", "INS");
      const at = new Date(Date.parse(month + "T09:00:00Z") + 18 * 864e5), ap = new Date(at.getTime() + 2 * 864e5);
      await tx.insert(inspections).values({ id: inspectionId, companyId: DEMO, ref: iref, clientId: `demo-plan-${id.slice(0, 8)}`, templateId: o.template.id, templateVersion: o.template.version, unitId: unitIds.get(o.unit)!, period: month, status: "approved", inspectorEmail: jordan, supervisorEmail: sup, answers, items, signatures: { inspector: { name: "Jordan Blake", data: signaturePng(4242), at: at.toISOString() } }, score, createdAt: at, updatedAt: ap, submittedAt: at, approvedAt: ap });
      await tx.insert(inspectionEvents).values([{ companyId: DEMO, inspectionId, status: "draft", by: jordan, at }, { companyId: DEMO, inspectionId, status: "submitted", by: jordan, at }, { companyId: DEMO, inspectionId, status: "approved", by: sup, at: ap }]);
      evaluation = { ...evaluate(score.items, score.deviations, o.conf, o.tdr, o.pop.length), source: "inspection", at: ap.toISOString(), by: sup };
    } else if (o.failures != null) {
      evaluation = { ...evaluate(sel.items.length, o.failures, o.conf, o.tdr, o.pop.length), source: "entered", at: new Date(now.getTime() - 9 * 864e5).toISOString(), by: sup };
    }
    await tx.insert(samplingPlans).values({
      id, companyId: DEMO, ref, name: o.name, templateId: o.template?.id ?? null, unitId: unitIds.get(o.unit)!, period: month, method: "statistical", confidence: o.conf, tdr: o.tdr, edr: o.edr,
      populationSize: o.pop.length, population: o.pop, populationHash: hash(o.pop), stratify: o.stratify, censusAbove: o.census, sampleSize: sel.items.length, seed: o.seed,
      selection: sel.items, allocation: sel.allocation, status: evaluation ? "evaluated" : "selected", inspectionId, evaluation, createdBy: sup, createdAt: new Date(Date.parse(month + "T08:00:00Z") + 16 * 864e5),
    });
    plans++;
    void methodText;
  };
  if (kyc) {
    await mk({ unit: "Summit", name: "Summit KYC account-opening files", template: kyc, pop: population("Summit", 412, 11), conf: 0.9, tdr: 0.1, edr: 0, stratify: true, census: 50000, seed: "summit-kyc-oct", failures: 3, review: true });
    await mk({ unit: "Harbour", name: "Harbour KYC account-opening files", template: kyc, pop: population("Harbour", 356, 12), conf: 0.9, tdr: 0.1, edr: 0, stratify: true, census: null, seed: "harbour-kyc-oct", failures: 0 });
  }
  if (loan) await mk({ unit: "Crossroads", name: "Crossroads consumer loan files", template: loan, pop: population("Crossroads", 238, 13), conf: 0.95, tdr: 0.05, edr: 0, stratify: false, census: null, seed: "crossroads-loans-nov" });
  return { programmes: made, plans };
}
