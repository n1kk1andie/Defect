// Demo: Meridian Society's checklists, inspections and scorecards (Milestone
// 2). Banking library templates published (one on version 2), the
// programme's Branch Defects and the Operational Standard as templates, a
// draft the admin is still building, and four months of inspections across
// the six branches with Summit as the watchlist story. Deterministic from a
// fixed seed. Demo tenant only.
import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { actionEvents, actions, counters, inspectionEvents, inspections, scorecardVersions, scorecards, templateVersions, templates } from "@/lib/db/schema";
import { DEMO } from "@/lib/company";
import { libraryEntry } from "@/lib/templates/library";
import { ensureProgramTemplates } from "@/lib/templates/store";
import { scoreInspection, type Answer, type Answers, type Question, type SampledItem, type TemplateDef } from "@/lib/templates/model";
import { scorecardEntry, resolveLibraryScorecard } from "@/lib/scorecards/library";
import { DEMO_DOMAIN, PERSONAS } from "@/lib/demo/personas";

function rng(seed: number) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const person = (name: string) => PERSONAS.find((p) => p.name === name)!.email;
const sha = (d: unknown) => createHash("sha256").update(JSON.stringify(d)).digest("hex");

// ── a small PNG signature (a pen stroke), so signed inspections look signed ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function signaturePng(seed: number): string {
  const W = 300, H = 90, r = rng(seed);
  const px = new Uint8Array(W * H).fill(255);
  const dot = (x: number, y: number) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const X = Math.round(x + dx), Y = Math.round(y + dy); if (X >= 0 && X < W && Y >= 0 && Y < H) px[Y * W + X] = 20; } };
  const f1 = 0.05 + r() * 0.04, f2 = 0.13 + r() * 0.08, a1 = 14 + r() * 10, a2 = 6 + r() * 8, ph = r() * 6;
  for (let x = 24; x < 270; x += 0.5) dot(x, 48 + a1 * Math.sin(x * f1 + ph) * Math.exp(-(x - 24) / 260) + a2 * Math.sin(x * f2));
  for (let x = 60; x < 200; x += 0.5) dot(x, 72 + Math.sin(x * 0.02) * 2);
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; for (let x = 0; x < W; x++) raw[y * (W + 1) + 1 + x] = px[y * W + x]; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + png.toString("base64");
}

// How each branch performs (probability that any scored question fails).
const FAIL: Record<string, number> = { Harbour: 0.035, Riverside: 0.03, Parkway: 0.045, Summit: 0.12, Crossroads: 0.07, Gateway: 0.035 };
const GEO: Record<string, [number, number]> = { Harbour: [51.4545, -2.5879], Riverside: [51.4612, -2.6051], Parkway: [51.4783, -2.5466], Summit: [51.4389, -2.6203], Crossroads: [51.4701, -2.5791], Gateway: [51.4489, -2.5619] };

function answerFor(q: Question, failP: number, r: () => number, notes: string[]): Answer | undefined {
  const fail = r() < failP * (q.critical ? 0.3 : 1);
  if (q.allowNA && r() < 0.03) return { na: true };
  switch (q.type) {
    case "yesno": return fail ? { v: "no", note: notes[Math.floor(r() * notes.length)] } : { v: "yes" };
    case "passfail": return fail ? { v: "fail", note: notes[Math.floor(r() * notes.length)] } : { v: "pass" };
    case "rating": { const sc = q.scale!; return { v: fail ? Math.max(sc.min, sc.passAt - 1) : Math.min(sc.max, sc.passAt + Math.floor(r() * (sc.max - sc.passAt + 1))) }; }
    case "number": { const lo = q.range?.min ?? 0, hi = q.range?.max ?? lo + 10; return { v: fail ? Math.round((hi + (hi - lo) * 0.3 + 1) * 10) / 10 : Math.round((lo + (hi - lo) * (0.2 + r() * 0.6)) * 10) / 10 }; }
    case "choice": { const opts = q.options!; const bad = opts.filter((o) => o.fail); const good = opts.filter((o) => !o.fail && o.score >= 0.99); const pickFrom = fail && bad.length ? bad : good.length ? good : opts; return { v: pickFrom[Math.floor(r() * pickFrom.length)].id }; }
    case "multi": return { v: q.options!.filter(() => r() < 0.6).map((o) => o.id).slice(0, 3).concat(q.options![0].id).filter((x, i, a) => a.indexOf(x) === i) };
    case "text": return r() < 0.5 ? { v: "Seen and discussed with the branch manager." } : undefined;
    case "date": return { v: new Date().toISOString().slice(0, 10) };
    case "reference": return { v: `MS-${100000 + Math.floor(r() * 899999)}` };
    default: return undefined;
  }
}

const NOTES = ["Log not signed for three days last week.", "Second key-holder was on leave; procedure not followed.", "Corrected on the spot; manager briefed.", "Evidence missing from the file.", "Staff unaware of the updated procedure.", "Found on the second visit this month."];

export async function seedInspections(tx: Tx, now: Date, unitIds: Map<string, string>): Promise<{ templates: number; inspections: number }> {
  const r = rng(91827);
  const UNITS = Array.from(unitIds.keys());
  const admin = person("Alex Morgan"), sups = [person("Taylor Reid"), person("Robin Ellis")], insp = [person("Jordan Blake"), `riley.chen@${DEMO_DOMAIN}`], sam = person("Sam Foster");

  // Programme and scorecard as templates.
  await ensureProgramTemplates(tx, DEMO, admin);

  // Library templates, published.
  const keys = ["bank-branch-ops", "bank-teller-cash", "bank-kyc-file", "bank-loan-file", "bank-atm", "bank-premises-hs", "bank-mystery-shop", "bank-complaints"];
  const tpl = new Map<string, { id: string; def: TemplateDef; version: number }>();
  for (const k of keys) {
    const e = libraryEntry(k)!;
    const id = randomUUID();
    const created = new Date(now.getTime() - 150 * 864e5);
    await tx.insert(templates).values({ id, companyId: DEMO, name: e.def.name, sector: e.sector, category: e.def.category, draft: e.def, version: 1, dirty: false, status: "published", origin: `library:${k}`, createdBy: admin, updatedBy: admin, createdAt: created, updatedAt: created });
    await tx.insert(templateVersions).values({ id: randomUUID(), companyId: DEMO, templateId: id, version: 1, definition: e.def, sha256: sha(e.def), publishedBy: admin, publishedAt: created, note: "Added from the library" });
    let def = e.def, version = 1;
    if (k === "bank-branch-ops") {
      // Version 2 added a question about the night safe; inspections before it keep version 1.
      def = structuredClone(e.def);
      def.sections[1].questions.push({ id: "s2q6", type: "yesno", label: "Night safe deposits logged and verified by two staff", required: true, allowNA: true, weight: 2, severity: "major", critical: false, reference: "Branch Operations Manual §6.3", action: { auto: true, priority: "medium", dueDays: 21 } });
      version = 2;
      const at = new Date(now.getTime() - 50 * 864e5);
      await tx.insert(templateVersions).values({ id: randomUUID(), companyId: DEMO, templateId: id, version: 2, definition: def, sha256: sha(def), publishedBy: sups[0], publishedAt: at, note: "Added the night-safe check" });
      await tx.update(templates).set({ draft: def, version: 2, updatedAt: at, updatedBy: sups[0] }).where(eq(templates.id, id));
    }
    tpl.set(k, { id, def, version });
  }
  // A template the admin is still building.
  const draft = structuredClone(libraryEntry("gen-cx")!.def);
  draft.name = "Branch opening readiness"; draft.category = "Branch operations"; draft.sector = "banking";
  draft.description = "A quick morning check before the doors open: cash, systems, signage and the team brief.";
  draft.sections = [{ id: "s1", title: "Before opening", questions: [
    { id: "s1q1", type: "yesno", label: "Vault opened under dual control", required: true, allowNA: false, weight: 3, severity: "critical", critical: true, action: { auto: true, priority: "high", dueDays: 3 } },
    { id: "s1q2", type: "yesno", label: "Teller systems online and balanced", required: true, allowNA: false, weight: 2, severity: "major", critical: false },
    { id: "s1q3", type: "text", label: "What went wrong?", required: false, allowNA: false, weight: 0, severity: "minor", critical: false, showIf: { q: "s1q2", is: "fail" } },
    { id: "s1q4", type: "rating", label: "Customer area ready", required: true, allowNA: false, weight: 1, severity: "minor", critical: false, scale: { min: 1, max: 5, passAt: 3, labels: ["Not ready", "Spotless"] } },
    { id: "s1q5", type: "photo", label: "Photo of the counter", required: false, allowNA: false, weight: 0, severity: "minor", critical: false },
  ] }];
  await tx.insert(templates).values({ id: randomUUID(), companyId: DEMO, name: draft.name, sector: "banking", category: draft.category, draft, version: 0, dirty: true, status: "draft", origin: "custom", createdBy: admin, updatedBy: admin });

  // Four months of inspections.
  const months: string[] = [];
  for (let i = 3; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 10)); }
  const plan: { key: string; every: number; items?: [number, number] }[] = [
    { key: "bank-branch-ops", every: 1 }, { key: "bank-teller-cash", every: 1 }, { key: "bank-kyc-file", every: 1, items: [10, 16] },
    { key: "bank-atm", every: 2 }, { key: "bank-premises-hs", every: 3 }, { key: "bank-mystery-shop", every: 2 }, { key: "bank-loan-file", every: 2, items: [8, 12] }, { key: "bank-complaints", every: 3, items: [6, 10] },
  ];
  // Continue the references from wherever this demo's counters are (an upgraded demo may have had actions added since).
  const cur = async (name: string) => (await tx.select({ v: counters.value }).from(counters).where(and(eq(counters.companyId, DEMO), eq(counters.name, name))).limit(1))[0]?.v ?? 0;
  let ref = await cur("inspection"), act = Math.max(42, await cur("action"));
  const rows: (typeof inspections.$inferInsert)[] = [], events: (typeof inspectionEvents.$inferInsert)[] = [];
  const raised: { inspId: string; ref: string; unit: string; q: Question; tplName: string; version: number; at: Date; status: string; sup: string }[] = [];
  months.forEach((m, mi) => {
    const latest = mi === months.length - 1;
    for (const [ui, u] of UNITS.entries()) {
      for (const p of plan) {
        if ((mi + ui) % p.every !== 0) continue;
        const t = tpl.get(p.key)!;
        const version = p.key === "bank-branch-ops" && mi < 2 ? 1 : t.version;
        const def = version === t.version ? t.def : libraryEntry(p.key)!.def;
        const failP = FAIL[u] * (u === "Summit" ? 1 + mi * 0.12 : u === "Crossroads" ? 1 + mi * 0.08 : 1.1 - mi * 0.05);
        const answers: Answers = {};
        const items: SampledItem[] = [];
        for (const s of def.sections) {
          if (s.perItem) {
            const n = p.items![0] + Math.floor(r() * (p.items![1] - p.items![0] + 1));
            for (let i = 0; i < n; i++) {
              const a: Answers = {};
              for (const q of s.questions) { const x = answerFor(q, failP * 0.8, r, NOTES); if (x) a[q.id] = x; }
              const refQ = s.questions.find((q) => q.type === "reference");
              items.push({ ref: refQ && typeof a[refQ.id]?.v === "string" ? String(a[refQ.id]!.v) : `MS-${200000 + i}`, answers: a });
            }
          } else for (const q of s.questions) { const x = answerFor(q, failP, r, NOTES); if (x) answers[q.id] = x; }
        }
        // Summit keeps failing dual control in the branch review: the story behind its watchlist place.
        if (u === "Summit" && p.key === "bank-branch-ops" && mi >= 1) answers["s2q1"] = { v: "no", note: "Second key-holder not present at opening on 3 of 10 days sampled." };
        const score = scoreInspection(def, answers, items);
        if (score.result === "incomplete") { score.missing = []; score.result = score.criticalFails ? "fail" : (score.pct ?? 100) >= def.scoring.passMark ? "pass" : "fail"; }
        const status = latest && u === "Gateway" && p.key === "bank-branch-ops" ? "submitted" : latest && u === "Summit" && p.key === "bank-teller-cash" ? "submitted" : latest && u === "Riverside" && p.key === "bank-kyc-file" ? "returned" : latest && u === "Harbour" && p.key === "bank-teller-cash" ? "draft" : "approved";
        const id = randomUUID();
        const inspector = p.key === "bank-mystery-shop" ? insp[1] : insp[(ui + mi) % 2];
        const sup = sups[(ui + mi) % 2];
        const day = 4 + Math.floor(r() * 18);
        const started = new Date(Date.parse(m + "T08:30:00Z") + day * 864e5 + Math.floor(r() * 300) * 60000);
        const submitted = new Date(started.getTime() + (25 + Math.floor(r() * 70)) * 60000);
        const approved = new Date(submitted.getTime() + (1 + Math.floor(r() * 3)) * 864e5);
        const [lat, lng] = GEO[u];
        const iref = `INS-${String(++ref).padStart(4, "0")}`;
        rows.push({
          id, companyId: DEMO, ref: iref, clientId: `demo-${id.slice(0, 8)}`, templateId: t.id, templateVersion: version, unitId: unitIds.get(u)!, period: m, status, inspectorEmail: inspector,
          supervisorEmail: status === "approved" || status === "returned" ? sup : null, answers, items,
          signatures: def.signatures.inspector || def.signatures.site ? { ...(def.signatures.inspector ? { inspector: { name: PERSONAS.find((x) => x.email === inspector)?.name ?? "Riley Chen", data: signaturePng(ref * 7), at: submitted.toISOString() } } : {}), ...(def.signatures.site ? { site: { name: u === "Summit" ? "Sam Foster" : `${u} branch manager`, data: signaturePng(ref * 13 + 1), at: submitted.toISOString() } } : {}) } : {},
          checkin: def.checkin ? { at: started.toISOString(), lat: lat + (r() - 0.5) * 0.0008, lng: lng + (r() - 0.5) * 0.0008, accuracy: 8 + Math.floor(r() * 20) } : null,
          score: status === "draft" ? scoreInspection(def, answers, items) : score, note: status === "returned" ? "Three files are missing the source-of-funds evidence. Please add it and resubmit." : status === "approved" && r() < 0.3 ? "Agreed. Follow up the open points with the branch manager." : "",
          createdAt: started, updatedAt: status === "approved" ? approved : submitted, submittedAt: status === "draft" ? null : submitted, approvedAt: status === "approved" ? approved : null,
        });
        events.push({ companyId: DEMO, inspectionId: id, status: "draft", by: inspector, at: started });
        if (status !== "draft") events.push({ companyId: DEMO, inspectionId: id, status: "submitted", by: inspector, at: submitted });
        if (status === "approved" || status === "returned") events.push({ companyId: DEMO, inspectionId: id, status, by: sup, at: approved, note: status === "returned" ? "Three files are missing the source-of-funds evidence. Please add it and resubmit." : null });
        // The latest two months' critical and action-flagged failures became actions.
        if (status === "approved" && mi >= 2) {
          const seen = new Set<string>();
          for (const f of score.findings) {
            if (seen.has(f.questionId)) continue;
            const q = def.sections.flatMap((s) => s.questions).find((x) => x.id === f.questionId)!;
            if (!q.critical && !q.action?.auto) continue;
            seen.add(f.questionId);
            raised.push({ inspId: id, ref: iref, unit: u, q, tplName: def.name, version, at: approved, status: r() < 0.35 ? "in_progress" : r() < 0.3 ? "awaiting_verification" : "open", sup });
          }
        }
      }
    }
  });
  for (let i = 0; i < rows.length; i += 100) await tx.insert(inspections).values(rows.slice(i, i + 100));
  for (let i = 0; i < events.length; i += 300) await tx.insert(inspectionEvents).values(events.slice(i, i + 300));
  await tx.insert(counters).values({ companyId: DEMO, name: "inspection", value: ref }).onConflictDoUpdate({ target: [counters.companyId, counters.name], set: { value: ref } });

  for (const x of raised.slice(0, 18)) {
    const id = randomUUID();
    const due = new Date(x.at.getTime() + (x.q.action?.dueDays ?? 14) * 864e5).toISOString().slice(0, 10);
    const owner = x.unit === "Summit" ? { email: sam, name: "Sam Foster" } : { email: null, name: `${x.unit} branch manager` };
    await tx.insert(actions).values({
      id, companyId: DEMO, ref: `ACT-${String(++act).padStart(4, "0")}`, kind: "corrective", unitId: unitIds.get(x.unit)!, areaId: null,
      title: (x.q.critical ? "Critical: " : "") + x.q.label, details: `Failed in ${x.ref} (${x.tplName}, version ${x.version}).${x.q.reference ? `\nStandard: ${x.q.reference}.` : ""}${x.q.guidance ? `\nGuidance: ${x.q.guidance}` : ""}`,
      priority: x.q.action?.priority ?? "high", ownerEmail: owner.email, ownerName: owner.name, dueDate: due, status: x.status, raisedBy: x.sup,
      closureNote: x.status === "awaiting_verification" ? "Procedure re-briefed at the morning huddle; the log is now countersigned daily. Evidence attached." : "",
      sourceType: "inspection", sourceId: `${x.inspId}:${x.q.id}`, createdAt: x.at, updatedAt: new Date(x.at.getTime() + 2 * 864e5),
    });
    const ev: (typeof actionEvents.$inferInsert)[] = [{ companyId: DEMO, actionId: id, kind: "status", status: "open", by: x.sup, at: x.at, note: `Raised from ${x.ref}` }];
    if (x.status !== "open") ev.push({ companyId: DEMO, actionId: id, kind: "status", status: "in_progress", by: owner.email ?? insp[0], at: new Date(x.at.getTime() + 864e5) });
    if (x.status === "awaiting_verification") ev.push({ companyId: DEMO, actionId: id, kind: "status", status: "awaiting_verification", by: owner.email ?? insp[0], at: new Date(x.at.getTime() + 2 * 864e5), note: "Procedure re-briefed at the morning huddle; the log is now countersigned daily. Evidence attached." });
    await tx.insert(actionEvents).values(ev);
  }
  await tx.insert(counters).values({ companyId: DEMO, name: "action", value: act }).onConflictDoUpdate({ target: [counters.companyId, counters.name], set: { value: act } });

  // Scorecards: the Operational Standard's first version on record, and a branch quality index being designed.
  const op = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, DEMO), eq(scorecards.active, true))).limit(1))[0];
  const hasVersion = op ? (await tx.select({ id: scorecardVersions.id }).from(scorecardVersions).where(and(eq(scorecardVersions.companyId, DEMO), eq(scorecardVersions.scorecardId, op.id))).limit(1)).length > 0 : true;
  if (op && !hasVersion) await tx.insert(scorecardVersions).values({ id: randomUUID(), companyId: DEMO, scorecardId: op.id, version: op.version, definition: op.definition, publishedBy: admin, publishedAt: op.createdAt });
  const lib = scorecardEntry("branch-standards")!;
  const bq = resolveLibraryScorecard(lib, new Map());
  bq.name = "Branch quality index";
  bq.measures = [
    { key: "branchOps", label: "Branch operations review", kind: "inspection", source: { templateId: tpl.get("bank-branch-ops")!.id, metric: "score" }, group: "Inspections" },
    { key: "cash", label: "Teller and cash handling", kind: "inspection", source: { templateId: tpl.get("bank-teller-cash")!.id, metric: "passRate" }, group: "Inspections" },
    { key: "kyc", label: "KYC file compliance", kind: "inspection", source: { templateId: tpl.get("bank-kyc-file")!.id, metric: "compliance" }, group: "File reviews" },
    { key: "cx", label: "Mystery shop", kind: "inspection", source: { templateId: tpl.get("bank-mystery-shop")!.id, metric: "score" }, group: "Customer" },
    { key: "complaints", label: "Complaints resolved in time (%)", kind: "input", group: "Customer" },
    { key: "control", label: "Control environment", kind: "computed", of: ["branchOps", "cash", "kyc"], weights: [2, 1, 2] },
    { key: "customer", label: "Customer", kind: "computed", of: ["cx", "complaints"] },
    { key: "overall", label: "Branch quality index", kind: "computed", of: ["control", "customer"], weights: [3, 1], round: true },
  ];
  bq.columns = [{ key: "overall", label: "Quality index" }, { key: "control", label: "Control" }, { key: "customer", label: "Customer" }, { key: "kyc", label: "KYC" }];
  bq.target = 90;
  await tx.insert(scorecards).values({ id: randomUUID(), companyId: DEMO, name: bq.name, version: 0, definition: bq, draft: bq, dirty: true, active: false, origin: "library:branch-standards", createdBy: admin, updatedBy: admin, updatedAt: new Date(now.getTime() - 3 * 864e5) });
  return { templates: keys.length + 1, inspections: rows.length };
}
