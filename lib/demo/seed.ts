// The demo's fictional data: Meridian Financial Group, six branches, five process
// areas, about three years of Branch Defects history, the Operational Standard
// scorecard, recent reviews at item level (natures, recurring repeats, some
// awaiting approval) and a lived-in action register. Generated from a fixed
// seed relative to the current month, so the demo always looks current and is
// the same for every visitor. Only ever written to the demo tenant ("_demo"),
// in the demo deployment's own database.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, rowsOf, type Tx } from "@/lib/db/client";
import { samplingPlans, programmes, unitFactors, inspectionEvents, inspections, scorecardVersions, templateVersions, templates, actionEvents, actions, members, monthlyStats, reviewEvents, reviewItems, reviews, scorecardEntries, scorecards, units, areas, natures, checks, companySettings, counters, evidence, imports, riskOutbox, companies, apiKeys, issueReports, reportLinks, siteGroups, entities } from "@/lib/db/schema";
import { DEMO, ensureAreas, ensureCompany, ensureUnits, setAreaChecklist, writeSettings } from "@/lib/company";
import { record } from "@/lib/audit";
import { cleanSettings, type Severity } from "@/lib/settings";
import { evaluate, OPERATIONAL_STANDARD } from "@/lib/scorecard";
import { AUDIT_POINTS } from "@/lib/bands";
import { DEMO_COMPANY, DEMO_DOMAIN, PERSONAS } from "@/lib/demo/personas";
import { seedInspections } from "@/lib/demo/inspections";
import { seedM3 } from "@/lib/demo/m3";
import { hasM4, seedM4 } from "@/lib/demo/m4";

const UNITS = ["Harbour", "Riverside", "Parkway", "Summit", "Crossroads", "Gateway"];
const REGIONS = [["Harbour", "South"], ["Riverside", "South"], ["Gateway", "South"], ["Parkway", "North"], ["Summit", "North"], ["Crossroads", "North"]] as const;
// Base defect rate per branch: Summit is the watchlist story; Crossroads is drifting.
const BASE: Record<string, number> = { Harbour: 0.034, Riverside: 0.033, Parkway: 0.034, Summit: 0.072, Crossroads: 0.036, Gateway: 0.033 };
const RESOLVE: Record<string, number> = { Harbour: 0.83, Riverside: 0.85, Parkway: 0.83, Summit: 0.62, Crossroads: 0.78, Gateway: 0.845 };

const c = (code: string, label: string, severity: Severity) => ({ code, label, severity });
const PROGRAM: { area: string; mult: number; checks: ReturnType<typeof c>[]; natures: [string, string][] }[] = [
  { area: "Card Applications", mult: 1.05, checks: [c("id-verified", "Customer identity verified", "critical"), c("form-complete", "Application form complete", "major"), c("signature", "Signature matches records", "critical"), c("limits", "Approved within authority", "major"), c("keyed", "System record matches documents", "minor")],
    natures: [["Missing customer verification", "Process"], ["Incomplete documentation", "Documentation"], ["Signature mismatch", "Process"], ["Incorrect data entry", "Data"]] },
  { area: "Account Changes", mult: 1.0, checks: [c("request-signed", "Request signed by the customer", "critical"), c("id-checked", "Identity checked", "critical"), c("change-keyed", "Change keyed correctly", "major"), c("notice-sent", "Confirmation sent", "minor"), c("filed", "Request filed", "minor")],
    natures: [["Incorrect data entry", "Data"], ["Supporting file missing", "Documentation"], ["Missing customer verification", "Process"]] },
  { area: "Customer Records", mult: 1.02, checks: [c("kyc-current", "KYC record current", "critical"), c("address-proof", "Proof of address on file", "major"), c("no-duplicate", "No duplicate record", "major"), c("contact-valid", "Contact details valid", "minor"), c("risk-rated", "Risk rating recorded", "major")],
    natures: [["Duplicate record", "Data"], ["Incomplete documentation", "Documentation"], ["Outdated KYC", "People"]] },
  { area: "Recurring Instructions", mult: 0.95, checks: [c("mandate", "Mandate signed", "critical"), c("amount", "Amount and schedule match", "major"), c("beneficiary", "Beneficiary verified", "major"), c("review-date", "Review date set", "minor"), c("system-set", "Set up in the system", "minor")],
    natures: [["Supporting file missing", "Documentation"], ["Incorrect data entry", "Data"], ["System set-up error", "Systems"]] },
  { area: "Payments", mult: 1.04, checks: [c("dual-auth", "Dual authorisation", "critical"), c("sanctions", "Sanctions screening done", "critical"), c("purpose", "Purpose of payment recorded", "major"), c("callback", "Call-back performed", "major"), c("receipt", "Receipt issued", "minor")],
    natures: [["Missing customer verification", "Process"], ["Call-back not performed", "People"], ["Incorrect data entry", "Data"], ["System set-up error", "Systems"]] },
];

/** A small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const monthIso = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}-01`;
function monthsBack(n: number, from = new Date()): string[] {
  const out: string[] = [];
  const y = from.getUTCFullYear(), m = from.getUTCMonth();
  for (let i = n; i >= 1; i--) { const d = new Date(Date.UTC(y, m - i, 1)); out.push(monthIso(d.getUTCFullYear(), d.getUTCMonth())); }
  return out;
}
const addDays = (iso: string, days: number) => new Date(Date.parse(iso + "T12:00:00Z") + days * 864e5).toISOString().slice(0, 10);
const person = (name: string) => PERSONAS.find((p) => p.name === name)!.email;

async function chunked<T>(rows: T[], n: number, fn: (c: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += n) await fn(rows.slice(i, i + n)); }

/** Wipe the demo tenant (demo only). */
export async function clearDemo(tx: Tx): Promise<void> {
  for (const t of [apiKeys, issueReports, reportLinks, siteGroups, entities, samplingPlans, programmes, unitFactors, inspectionEvents, inspections, templateVersions, templates, scorecardVersions, actionEvents, actions, reviewEvents, reviewItems, reviews, scorecardEntries, scorecards, monthlyStats, checks, natures, areas, units, members, companySettings, counters, evidence, imports, riskOutbox, companies]) {
    await tx.delete(t).where(sql`company_id = ${DEMO}`);
  }
  // The change history is append-only (its trigger refuses deletes), so a reset is recorded in it rather than erasing it.
}

/** Seed the demo tenant if it's empty. Safe to call on every request; only the first does anything. */
/**
 * The demo data's version. A demo database seeded by an earlier release is
 * brought up to date in place (only additions, demo tenant only), so a deploy
 * never leaves the demo without the newest screens' sample data.
 *   1  Milestone 1: history, reviews, scorecard, actions
 *   2  Milestone 2: templates, inspections, inspection actions, scorecard in design
 *   3  Milestone 3: programmes, sampling plans, risk factors per branch
 *   4  Meridian Financial Group wording
 *   5  Milestone 4: subsidiaries and groups, reported issues, root cause and effectiveness, API keys
 */
export const DEMO_SEED_VERSION = 5;

async function seedVersion(tx: Tx): Promise<number> {
  return Number(rowsOf<{ v: number }>(await tx.execute(sql`select value as v from counters where name = 'demo_seed'`))[0]?.v ?? 1);
}
async function setSeedVersion(tx: Tx, v: number) {
  await tx.insert(counters).values({ companyId: DEMO, name: "demo_seed", value: v }).onConflictDoUpdate({ target: [counters.companyId, counters.name], set: { value: v } });
}

export async function ensureDemoSeeded(): Promise<void> {
  if ((process.env.DEMO_MODE || "").trim() !== "1") return;
  await withTenant(DEMO, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
    const n = Number(rowsOf<{ n: string }>(await tx.execute(sql`select count(*)::text as n from units`))[0]?.n ?? 0);
    if (n === 0) { await seedDemo(tx); return; }
    if ((await seedVersion(tx)) < DEMO_SEED_VERSION) await upgradeDemo(tx);
  });
}

/** Bring a demo seeded by an earlier release up to the current sample data, adding only what's missing. */
export async function upgradeDemo(tx: Tx, now = new Date()): Promise<void> {
  const from = await seedVersion(tx);
  if (from < 2) {
    const s = rowsOf<{ data: unknown }>(await tx.execute(sql`select data from company_settings where company_id = ${DEMO}`))[0]?.data;
    await writeSettings(tx, DEMO, cleanSettings({ ...((s as object) || {}), sector: "banking", groupLabel: "Region", setupDone: true }), "demo");
    const rows = await tx.select({ id: units.id, name: units.name }).from(units).where(sql`company_id = ${DEMO}`);
    const unitIds = new Map(rows.filter((u) => UNITS.includes(u.name)).map((u) => [u.name, u.id]));
    for (const [u, region] of REGIONS) if (unitIds.has(u)) await tx.update(units).set({ region }).where(sql`id = ${unitIds.get(u)!} and region is null`);
    const already = Number(rowsOf<{ n: number }>(await tx.execute(sql`select count(*)::int as n from inspections where client_id like 'demo-%'`))[0]?.n ?? 0);
    const ins = already ? { templates: 0, inspections: 0 } : await seedInspections(tx, now, unitIds);
    await record(tx, DEMO, { actor: "demo", action: "demo.upgrade", entityType: "company", entityId: DEMO, summary: `Demo sample data brought up to version 2: ${ins.templates} templates, ${ins.inspections} inspections` });
  }
  if (from < 3) {
    const rows = await tx.select({ id: units.id, name: units.name }).from(units).where(sql`company_id = ${DEMO}`);
    const unitIds = new Map(rows.filter((u) => UNITS.includes(u.name)).map((u) => [u.name, u.id]));
    const already = Number(rowsOf<{ n: number }>(await tx.execute(sql`select count(*)::int as n from programmes`))[0]?.n ?? 0);
    const m3 = already ? { programmes: 0, plans: 0 } : await seedM3(tx, now, unitIds);
    await record(tx, DEMO, { actor: "demo", action: "demo.upgrade", entityType: "company", entityId: DEMO, summary: `Demo sample data brought up to version 3: ${m3.programmes} programmes, ${m3.plans} sampling plans, risk factors` });
  }
  if (from < 4) {
    // Rename in place: the demo institution was "Meridian Society" and its
    // account-change checklist said "member". A demo already seeded keeps all
    // its data; only the wording is corrected.
    await tx.update(companies).set({ name: DEMO_COMPANY }).where(sql`company_id = ${DEMO}`);
    await tx.update(checks).set({ label: "Request signed by the customer" })
      .where(sql`company_id = ${DEMO} and code = 'request-signed' and label = 'Request signed by the member'`);
    await record(tx, DEMO, { actor: "demo", action: "demo.upgrade", entityType: "company", entityId: DEMO, summary: "Demo sample data brought up to version 4: Meridian Financial Group, customers not members" });
  }
  if (from < 5) {
    const rows = await tx.select({ id: units.id, name: units.name }).from(units).where(sql`company_id = ${DEMO}`);
    const unitIds = new Map(rows.filter((u) => UNITS.includes(u.name)).map((u) => [u.name, u.id]));
    const m4 = (await hasM4(tx)) ? { entities: 0, issues: 0 } : await seedM4(tx, now, unitIds);
    await record(tx, DEMO, { actor: "demo", action: "demo.upgrade", entityType: "company", entityId: DEMO, summary: `Demo sample data brought up to version 5: ${m4.entities} subsidiaries, ${m4.issues} reported issues, API keys` });
  }
  await setSeedVersion(tx, DEMO_SEED_VERSION);
}

export async function seedDemo(tx: Tx, now = new Date()): Promise<void> {
  const rand = rng(20261);
  await ensureCompany(tx, DEMO, DEMO_COMPANY, "demo");
  await writeSettings(tx, DEMO, cleanSettings({ unitLabel: "Branch", unitPlural: "Branches", itemLabel: "File", itemTypes: ["New", "Change", "Maintenance", "Other"], instanceBasis: "check", scorecard: true, sector: "banking", groupLabel: "Region", setupDone: true }), "demo");
  const unitIds = await ensureUnits(tx, DEMO, UNITS);
  for (const [u, region] of REGIONS) await tx.update(units).set({ region }).where(sql`id = ${unitIds.get(u)!}`);
  const areaIds = await ensureAreas(tx, DEMO, PROGRAM.map((p) => p.area));
  for (const p of PROGRAM) await setAreaChecklist(tx, DEMO, areaIds.get(p.area)!, p.checks, p.natures.map(([label, category]) => ({ label, category })));
  for (const p of PERSONAS) {
    await tx.insert(members).values({ companyId: DEMO, email: p.email, name: p.name, roles: p.roles, unitIds: (p.units || []).map((u) => unitIds.get(u)!).filter(Boolean), source: "demo" }).onConflictDoNothing();
  }
  for (const [email, name, role] of [[`riley.chen@${DEMO_DOMAIN}`, "Riley Chen", "inspector"], [`drew.salazar@${DEMO_DOMAIN}`, "Drew Salazar", "branch_manager"], [`sam.quinn@${DEMO_DOMAIN}`, "Sam Quinn", "viewer"]] as const) {
    await tx.insert(members).values({ companyId: DEMO, email, name, roles: [role], unitIds: role === "branch_manager" ? [unitIds.get("Parkway")!] : [], source: "demo" }).onConflictDoNothing();
  }

  // ── Branch Defects history (imported), up to three months before the latest. ──
  const months = monthsBack(34, now); // the last is last month
  const itemMonths = months.slice(-3); // reviewed at item level
  const histMonths = months.slice(0, -3);
  const stats: (typeof monthlyStats.$inferInsert)[] = [];
  histMonths.forEach((iso, mi) => {
    const t = mi / histMonths.length;
    for (const u of UNITS) {
      for (const p of PROGRAM) {
        const reviewed = 26 + Math.floor(rand() * 16);
        const instances = reviewed * p.checks.length;
        const drift = u === "Summit" ? 0.85 + t * 0.45 : u === "Crossroads" ? 0.9 + t * 0.2 : 1.12 - t * 0.2;
        const season = 1 + 0.18 * Math.sin((Number(iso.slice(5, 7)) / 12) * Math.PI * 2 + 1);
        const rate = Math.max(0.004, BASE[u] * p.mult * drift * season * (0.75 + rand() * 0.5));
        const defects = Math.round(instances * rate);
        const age = histMonths.length - mi;
        const res = Math.min(1, RESOLVE[u] + (age > 12 ? 0.08 : age > 6 ? 0.04 : -0.02) + (rand() - 0.5) * 0.08);
        const resolved = Math.min(defects, Math.round(defects * res));
        const recurring = Math.min(defects, Math.round(defects * (u === "Summit" ? 0.22 : 0.12) * (0.6 + rand() * 0.8)));
        stats.push({ companyId: DEMO, period: iso, unitId: unitIds.get(u)!, areaId: areaIds.get(p.area)!, reviewed, instances, defects, resolvable: defects, resolved, recurring, source: "import", batchId: "demo" });
      }
    }
  });
  await chunked(stats, 400, (cks) => tx.insert(monthlyStats).values(cks));

  // ── Recent reviews at item level (published), plus work in flight. ──
  const inspectors = [person("Jordan Blake"), `riley.chen@${DEMO_DOMAIN}`];
  const supervisors = [person("Taylor Reid"), person("Robin Ellis")];
  let refNo = 0;
  const reviewRows: (typeof reviews.$inferInsert)[] = [];
  const itemRows: (typeof reviewItems.$inferInsert)[] = [];
  const eventRows: (typeof reviewEvents.$inferInsert)[] = [];
  const latest = itemMonths[itemMonths.length - 1];
  itemMonths.forEach((iso, mi) => {
    for (const [ui, u] of UNITS.entries()) {
      for (const p of PROGRAM) {
        const isLatest = iso === latest;
        // In the latest month a few reviews are still in flight.
        const status = isLatest && u === "Gateway" && p.area === "Payments" ? "submitted" : isLatest && u === "Crossroads" && p.area === "Customer Records" ? "submitted" : isLatest && u === "Riverside" && p.area === "Account Changes" ? "returned" : "published";
        const id = randomUUID();
        const inspector = inspectors[(ui + mi) % 2];
        const supervisor = supervisors[(ui + mi + 1) % 2];
        const entryDate = addDays(iso, 18 + Math.floor(rand() * 8));
        reviewRows.push({ id, companyId: DEMO, ref: `REV-${String(++refNo).padStart(4, "0")}`, kind: "checklist", unitId: unitIds.get(u)!, period: iso, entryDate, status, inspectorEmail: inspector, supervisorEmail: status === "submitted" ? null : supervisor, note: status === "returned" ? "Two files are missing the call-back evidence. Please add them and resubmit." : "", createdAt: new Date(entryDate + "T09:00:00Z"), updatedAt: new Date(addDays(entryDate, 2) + "T15:00:00Z"), submittedAt: new Date(addDays(entryDate, 1) + "T10:00:00Z"), publishedAt: status === "published" ? new Date(addDays(entryDate, 2) + "T15:00:00Z") : null });
        eventRows.push({ companyId: DEMO, reviewId: id, status: "draft", by: inspector, at: new Date(entryDate + "T09:00:00Z") }, { companyId: DEMO, reviewId: id, status: "submitted", by: inspector, at: new Date(addDays(entryDate, 1) + "T10:00:00Z") });
        if (status !== "submitted") eventRows.push({ companyId: DEMO, reviewId: id, status, by: supervisor, at: new Date(addDays(entryDate, 2) + "T15:00:00Z"), note: status === "returned" ? "Two files are missing the call-back evidence. Please add them and resubmit." : null });
        const n = 22 + Math.floor(rand() * 10);
        const rate = BASE[u] * p.mult * (u === "Summit" ? 1.25 : 0.95) * (0.8 + rand() * 0.4);
        for (let i = 0; i < n; i++) {
          const marks: Record<string, string> = {};
          let failed = 0;
          for (const ck of p.checks) {
            const v = rand() < rate ? "no" : rand() < 0.04 ? "na" : "yes";
            marks[ck.code] = v; if (v === "no") failed++;
          }
          // Summit keeps failing customer verification: the recurring-issue story.
          let nature = "";
          if (failed) nature = u === "Summit" && (p.area === "Card Applications" || p.area === "Payments") && rand() < 0.7 ? "Missing customer verification" : p.natures[Math.floor(rand() * p.natures.length)][0];
          const recurring = failed > 0 && (nature === "Missing customer verification" && u === "Summit" ? rand() < 0.6 : rand() < 0.12);
          const resolved = failed > 0 && status === "published" && rand() < (RESOLVE[u] - (isLatest ? 0.25 : 0.05));
          itemRows.push({ id: randomUUID(), companyId: DEMO, reviewId: id, idx: i, areaId: areaIds.get(p.area)!, itemType: ["New", "Change", "Maintenance"][Math.floor(rand() * 3)], reference: `MS-${iso.slice(2, 4)}${iso.slice(5, 7)}-${String(ui * 1000 + i + 101)}`, checks: marks, defects: failed, nature, recurring, status: resolved ? "resolved" : "open", resolvedAt: resolved ? new Date(addDays(entryDate, 6) + "T12:00:00Z") : null, resolvedBy: resolved ? supervisor : null });
        }
      }
    }
  });
  // A draft the inspector is still working on.
  const draftId = randomUUID();
  reviewRows.push({ id: draftId, companyId: DEMO, ref: `REV-${String(++refNo).padStart(4, "0")}`, kind: "checklist", unitId: unitIds.get("Harbour")!, period: latest, entryDate: addDays(latest, 27), status: "draft", inspectorEmail: person("Jordan Blake"), note: "" });
  for (let i = 0; i < 4; i++) itemRows.push({ id: randomUUID(), companyId: DEMO, reviewId: draftId, idx: i, areaId: areaIds.get("Payments")!, itemType: "New", reference: `MS-DRAFT-${i + 1}`, checks: Object.fromEntries(PROGRAM[4].checks.map((k) => [k.code, i === 2 && k.code === "callback" ? "no" : "yes"])), defects: i === 2 ? 1 : 0, nature: i === 2 ? "Call-back not performed" : "", recurring: false, status: "open" });
  eventRows.push({ companyId: DEMO, reviewId: draftId, status: "draft", by: person("Jordan Blake") });
  await chunked(reviewRows, 200, (cks) => tx.insert(reviews).values(cks));
  await chunked(itemRows, 400, (cks) => tx.insert(reviewItems).values(cks));
  await chunked(eventRows, 400, (cks) => tx.insert(reviewEvents).values(cks));
  await tx.insert(counters).values({ companyId: DEMO, name: "review", value: refNo });

  // ── Operational Standard scorecard. ──
  const cardId = randomUUID();
  await tx.insert(scorecards).values({ id: cardId, companyId: DEMO, name: OPERATIONAL_STANDARD.name, definition: OPERATIONAL_STANDARD, createdBy: "demo" });
  const entries: (typeof scorecardEntries.$inferInsert)[] = [];
  const cardMonths = monthsBack(34, now);
  const BASE_SC: Record<string, number> = { Harbour: 93.5, Riverside: 94.2, Parkway: 92.8, Summit: 86.4, Crossroads: 90.1, Gateway: 93.9 };
  cardMonths.forEach((iso, mi) => {
    for (const u of UNITS) {
      const b = BASE_SC[u] + (u === "Summit" ? -mi * 0.08 : mi * 0.04);
      const v = (spread: number) => Math.max(55, Math.min(100, Math.round((b + (rand() - 0.5) * spread) * 100) / 100));
      const inputs: Record<string, number> = {
        screening: v(10), wires: v(10), sourceOfFunds: v(12), csl: v(10), fees: v(8), declaration: v(10), salesService: v(12), acknowledgement: v(8),
        complaints: v(14), procurement: v(16), queueSla: v(10), onboardingSla: v(12), auditResolution: v(14),
      };
      const y = Number(iso.slice(0, 4));
      const gradeIdx = Math.min(4, Math.max(0, Math.round((96 - b) / 4 + (rand() - 0.5) * 1.5)));
      const letter = ["A", "B+", "B", "C", "D"][gradeIdx];
      const auditRaw = y < 2025 ? 5 - Math.min(4, gradeIdx) : AUDIT_POINTS[letter];
      const all = evaluate(OPERATIONAL_STANDARD, inputs, AUDIT_POINTS[letter]);
      entries.push({ companyId: DEMO, scorecardId: cardId, period: iso, unitId: unitIds.get(u)!, values: all, auditRaw, source: "import" });
    }
  });
  await chunked(entries, 300, (cks) => tx.insert(scorecardEntries).values(cks));

  // ── The action register. ──
  const todayIso = now.toISOString().slice(0, 10);
  const A = (ref: number, u: string, area: string | null, title: string, priority: string, status: string, dueIn: number, opts: { kind?: string; owner?: [string | null, string]; raisedBy?: string; submittedBy?: string; verifiedBy?: string; root?: string; details?: string; ageDays?: number } = {}) => ({ ref, u, area, title, priority, status, dueIn, ...opts });
  const LIST = [
    A(42, "Summit", "Card Applications", "Missing customer verification", "high", "open", 4, { root: "New starters at Summit aren't completing the verification step; the checklist isn't in the account-opening pack.", details: "Customer verification documents are missing for a sample of files. Request and upload the required documentation.", owner: [person("Sam Foster"), "Sam Foster"], ageDays: 12 }),
    A(41, "Harbour", "Account Changes", "Incomplete documentation", "high", "open", 6, { owner: [null, "Branch operations"], ageDays: 10 }),
    A(40, "Summit", "Payments", "Incorrect data entry on payments", "medium", "in_progress", 10, { owner: [person("Sam Foster"), "Sam Foster"], root: "Manual re-keying from paper forms.", ageDays: 20 }),
    A(39, "Gateway", "Recurring Instructions", "Supporting file missing", "medium", "open", 12, { owner: [null, "QA team"], ageDays: 8 }),
    A(38, "Riverside", "Customer Records", "Review not completed", "low", "in_progress", 14, { owner: [null, "Branch operations"], ageDays: 15 }),
    A(37, "Parkway", "Customer Records", "Incorrect customer details", "medium", "open", 15, { owner: [`drew.salazar@${DEMO_DOMAIN}`, "Drew Salazar"], ageDays: 9 }),
    A(36, "Crossroads", "Customer Records", "Duplicate records", "low", "in_progress", 18, { owner: [null, "Branch operations"], ageDays: 22 }),
    A(35, "Summit", "Card Applications", "Verification checklist added to the opening pack", "high", "awaiting_verification", -3, { kind: "preventive", owner: [person("Sam Foster"), "Sam Foster"], submittedBy: person("Sam Foster"), root: "Recurring: missing customer verification at Summit for three months running.", ageDays: 34 }),
    A(34, "Summit", "Payments", "Call-back procedure refreshed with the team", "high", "awaiting_verification", -6, { owner: [person("Sam Foster"), "Sam Foster"], submittedBy: person("Sam Foster"), ageDays: 40 }),
    A(33, "Crossroads", "Payments", "Sanctions screening evidence not retained", "high", "in_progress", -9, { owner: [null, "Crossroads branch manager"], ageDays: 45 }),
    A(32, "Parkway", "Account Changes", "Confirmation letters not sent", "medium", "awaiting_verification", -2, { owner: [`drew.salazar@${DEMO_DOMAIN}`, "Drew Salazar"], submittedBy: `drew.salazar@${DEMO_DOMAIN}`, ageDays: 30 }),
    A(31, "Harbour", "Payments", "Dual authorisation skipped on two payments", "high", "closed", -20, { owner: [null, "Harbour branch manager"], submittedBy: person("Jordan Blake"), verifiedBy: person("Robin Ellis"), ageDays: 60 }),
    A(30, "Gateway", "Customer Records", "KYC refresh backlog", "medium", "closed", -25, { owner: [null, "QA team"], submittedBy: person("Jordan Blake"), verifiedBy: person("Taylor Reid"), ageDays: 70 }),
    A(29, "Riverside", "Card Applications", "Signature mismatch on card applications", "medium", "closed", -32, { owner: [null, "Riverside operations"], submittedBy: person("Jordan Blake"), verifiedBy: person("Robin Ellis"), ageDays: 75 }),
    A(28, "Summit", "Customer Records", "Proof of address missing", "medium", "closed", -40, { owner: [person("Sam Foster"), "Sam Foster"], submittedBy: person("Sam Foster"), verifiedBy: person("Taylor Reid"), ageDays: 90 }),
    A(27, "Parkway", "Recurring Instructions", "Mandates not signed", "high", "closed", -46, { owner: [null, "Parkway operations"], submittedBy: person("Jordan Blake"), verifiedBy: person("Robin Ellis"), ageDays: 95 }),
    A(26, "Crossroads", "Account Changes", "Change requests filed late", "low", "closed", -55, { owner: [null, "Branch operations"], submittedBy: person("Jordan Blake"), verifiedBy: person("Taylor Reid"), ageDays: 100 }),
    A(25, "Harbour", "Customer Records", "Duplicate record merged", "low", "closed", -60, { owner: [null, "Data team"], submittedBy: person("Jordan Blake"), verifiedBy: person("Robin Ellis"), ageDays: 110 }),
    A(24, "Gateway", "Payments", "Purpose of payment not recorded", "medium", "closed", -70, { owner: [null, "Gateway operations"], submittedBy: person("Jordan Blake"), verifiedBy: person("Taylor Reid"), ageDays: 120 }),
    A(23, "Riverside", "Payments", "Receipts not issued", "low", "closed", -80, { owner: [null, "Riverside operations"], submittedBy: person("Jordan Blake"), verifiedBy: person("Robin Ellis"), ageDays: 130 }),
  ];
  for (const x of LIST) {
    const id = randomUUID();
    const raisedBy = x.raisedBy || (x.ref % 2 ? person("Taylor Reid") : person("Robin Ellis"));
    const created = new Date(now.getTime() - (x.ageDays ?? 30) * 864e5);
    const due = addDays(todayIso, x.dueIn);
    const closed = x.status === "closed";
    await tx.insert(actions).values({
      id, companyId: DEMO, ref: `ACT-${String(x.ref).padStart(4, "0")}`, kind: x.kind || "corrective", unitId: unitIds.get(x.u)!, areaId: x.area ? areaIds.get(x.area)! : null,
      title: x.title, details: x.details || "", rootCause: x.root || "", priority: x.priority, ownerEmail: x.owner?.[0] ?? null, ownerName: x.owner?.[1] ?? "Branch operations",
      dueDate: due, status: x.status, closureNote: x.status === "awaiting_verification" || closed ? "Corrected the sampled files, briefed the team at the morning huddle and added the step to the checklist. Evidence attached." : "",
      raisedBy, verifiedBy: x.verifiedBy ?? null, verifiedAt: closed ? new Date(Date.parse(due + "T15:00:00Z") - 2 * 864e5) : null, closedAt: closed ? new Date(Date.parse(due + "T15:00:00Z") - 2 * 864e5) : null,
      sourceType: x.ref === 35 ? "recurring" : "manual", createdAt: created, updatedAt: closed ? new Date(Date.parse(due + "T15:00:00Z") - 2 * 864e5) : new Date(created.getTime() + 5 * 864e5),
    });
    const ev: (typeof actionEvents.$inferInsert)[] = [{ companyId: DEMO, actionId: id, kind: "status", status: "open", by: raisedBy, at: created }];
    if (x.status !== "open") ev.push({ companyId: DEMO, actionId: id, kind: "status", status: "in_progress", by: x.submittedBy || x.owner?.[0] || person("Jordan Blake"), at: new Date(created.getTime() + 2 * 864e5) });
    if (x.status === "awaiting_verification" || closed) ev.push({ companyId: DEMO, actionId: id, kind: "status", status: "awaiting_verification", by: x.submittedBy || person("Jordan Blake"), at: new Date(created.getTime() + 5 * 864e5), note: "Corrected the sampled files, briefed the team at the morning huddle and added the step to the checklist. Evidence attached." });
    if (closed) ev.push({ companyId: DEMO, actionId: id, kind: "status", status: "closed", by: x.verifiedBy!, at: new Date(Date.parse(due + "T15:00:00Z") - 2 * 864e5) });
    await tx.insert(actionEvents).values(ev);
  }
  await tx.insert(counters).values({ companyId: DEMO, name: "action", value: 42 });
  const ins = await seedInspections(tx, now, unitIds);
  await seedM3(tx, now, unitIds);
  await seedM4(tx, now, unitIds);
  await setSeedVersion(tx, DEMO_SEED_VERSION);
  await record(tx, DEMO, { actor: "demo", action: "demo.seed", entityType: "company", entityId: DEMO, summary: `${DEMO_COMPANY} sample data: ${stats.length} history rows, ${reviewRows.length} reviews, ${LIST.length} actions, ${ins.templates} templates, ${ins.inspections} inspections` });
}

/** Reset the demo to its sample data (demo admin only). The change history keeps a record of the reset. */
export async function resetDemo(by: string): Promise<void> {
  await withTenant(DEMO, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
    await clearDemo(tx);
    await seedDemo(tx);
    await record(tx, DEMO, { actor: by, action: "demo.reset", entityType: "company", entityId: DEMO, summary: "Demo reset to its sample data" });
  });
}
