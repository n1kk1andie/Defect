// Demo: Meridian Financial Group's Milestone 4 data — two subsidiaries and two
// site groups to compare, a report-an-issue link per branch with issues
// reported by staff and customers (some waiting for triage, some already
// turned into actions or closed), root cause analysis and effectiveness
// checks on actions, and two sample API keys. Deterministic; demo tenant only.
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { actionEvents, actions, apiKeys, entities, issueReports, reportLinks, siteGroups, units } from "@/lib/db/schema";
import { DEMO, loadSettings, writeSettings } from "@/lib/company";
import { nextRef } from "@/lib/refs";
import { makeToken } from "@/lib/issues";
import { PERSONAS } from "@/lib/demo/personas";
import type { Effectiveness, Rca } from "@/lib/actionRules";

const person = (name: string) => PERSONAS.find((p) => p.name === name)!.email;
const day = (now: Date, n: number) => new Date(now.getTime() + n * 864e5);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const ENTITIES: [string, string, string[]][] = [
  ["Meridian Retail Banking", "MRB", ["Harbour", "Riverside", "Parkway"]],
  ["Meridian Community Lending", "MCL", ["Summit", "Crossroads", "Gateway"]],
];
const GROUPS: [string, string[]][] = [["City centre", ["Harbour", "Parkway", "Gateway"]], ["Extended hours", ["Riverside", "Summit"]]];

interface Report { u: string; cat: "observation" | "hazard" | "near_miss" | "complaint" | "other"; text: string; where: string; who?: [string, string]; ago: number; via: "qr" | "link"; to?: "action" | "dismiss"; note?: string }
const REPORTS: Report[] = [
  { u: "Summit", cat: "hazard", text: "The back door to the cash room was propped open with a chair while the van was being unloaded, and nobody was standing by it.", where: "Rear corridor by the cash room", ago: 0.2, via: "qr" },
  { u: "Crossroads", cat: "complaint", text: "I waited 40 minutes to open an account and was then told to come back with a document nobody had mentioned when I booked.", where: "Front counter", who: ["Dana P.", ""], ago: 0.6, via: "link" },
  { u: "Harbour", cat: "observation", text: "The visitor sign-in sheet hasn't been filled in since Monday; contractors are walking straight through to the back office.", where: "Reception", ago: 1.4, via: "qr" },
  { u: "Summit", cat: "near_miss", text: "A customer's statement was nearly posted to the wrong address: two customers with the same surname on the same street. Caught at the envelope check.", where: "Back office post tray", who: ["Chris M.", "chris.m@example.com"], ago: 4, via: "qr", to: "action", note: "Same-surname matching gap; containment then a checklist step." },
  { u: "Parkway", cat: "hazard", text: "Loose carpet tile by the self-service machines; an older customer tripped but didn't fall.", where: "Self-service area", ago: 9, via: "qr", to: "action", note: "Facilities to fix within two days." },
  { u: "Gateway", cat: "other", text: "The leaflet stand is still showing last year's savings rates.", where: "Leaflet stand by the door", ago: 12, via: "link", to: "dismiss", note: "Rates leaflets were replaced the same day by the branch; nothing further needed." },
];

export async function seedM4(tx: Tx, now: Date, unitIds: Map<string, string>): Promise<{ entities: number; issues: number }> {
  const admin = person("Alex Morgan"), sup = person("Taylor Reid"), robin = person("Robin Ellis");
  // Subsidiaries and groups.
  await writeSettings(tx, DEMO, { ...(await loadSettings(tx, DEMO)), entityLabel: "Subsidiary" }, "demo");
  for (const [i, [name, code, us]] of ENTITIES.entries()) {
    const id = randomUUID();
    await tx.insert(entities).values({ id, companyId: DEMO, name, code, sort: i });
    const ids = us.map((u) => unitIds.get(u)).filter((x): x is string => !!x);
    if (ids.length) await tx.update(units).set({ entityId: id }).where(and(eq(units.companyId, DEMO), inArray(units.id, ids)));
  }
  for (const [name, us] of GROUPS) await tx.insert(siteGroups).values({ id: randomUUID(), companyId: DEMO, name, unitIds: us.map((u) => unitIds.get(u)!).filter(Boolean), createdBy: sup });
  // A report-an-issue link per branch.
  for (const id of unitIds.values()) await tx.insert(reportLinks).values({ companyId: DEMO, unitId: id, token: makeToken(DEMO), createdBy: admin }).onConflictDoNothing();
  // Reported issues.
  for (const r of [...REPORTS].sort((a, b) => b.ago - a.ago)) {
    const unitId = unitIds.get(r.u);
    if (!unitId) continue;
    const id = randomUUID(), at = day(now, -r.ago), ref = await nextRef(tx, DEMO, "issue", "OBS");
    let actionId: string | null = null;
    if (r.to === "action") {
      actionId = randomUUID();
      const aref = await nextRef(tx, DEMO, "action", "ACT");
      const kind = r.cat === "hazard" ? "containment" : "corrective";
      const due = iso(day(now, r.cat === "hazard" ? -3 : 10));
      await tx.insert(actions).values({
        id: actionId, companyId: DEMO, ref: aref, kind, unitId, title: r.cat === "hazard" ? "Re-lay the loose carpet tile by the self-service machines" : "Check customer and address together before posting statements",
        details: `Reported as ${r.cat.replace("_", " ")} (${ref}) at "${r.where}": ${r.text}\n\nTriage: ${r.note}`, priority: r.cat === "hazard" ? "high" : "medium",
        ownerEmail: r.cat === "hazard" ? null : person("Sam Foster"), ownerName: r.cat === "hazard" ? "Facilities" : "Sam Foster", dueDate: due, status: "in_progress", raisedBy: sup, sourceType: "issue_report", sourceId: id,
        effectivenessDays: r.cat === "hazard" ? 0 : 30, createdAt: day(at, 0.1), updatedAt: day(at, 1),
      });
      await tx.insert(actionEvents).values([
        { companyId: DEMO, actionId, kind: "status", status: "open", by: sup, at: day(at, 0.1) },
        { companyId: DEMO, actionId, kind: "status", status: "in_progress", by: sup, at: day(at, 1) },
      ]);
    }
    await tx.insert(issueReports).values({
      id, companyId: DEMO, ref, unitId, category: r.cat, description: r.text, location: r.where, reporterName: r.who?.[0] ?? "", reporterContact: r.who?.[1] ?? "",
      status: r.to === "dismiss" ? "dismissed" : r.to ?? "new", triageNote: r.note ?? "", triagedBy: r.to ? (r.to === "dismiss" ? robin : sup) : null, triagedAt: r.to ? day(at, 0.1) : null, actionId, source: r.via, createdAt: at,
    });
  }
  // Root cause analysis and effectiveness checks on the closed actions.
  const closed = await tx.select().from(actions).where(and(eq(actions.companyId, DEMO), eq(actions.status, "closed")));
  const rca: Rca = {
    whys: ["Files were opened without the second ID check", "The checker was covering the counter at lunch", "Lunch cover isn't planned for the back office", "The rota only plans counter cover"],
    fishbone: { people: ["One trained checker per shift"], method: ["Second ID check not on the opening checklist"], environment: ["Lunchtime queue peaks"] },
  };
  for (const [i, x] of closed.slice(0, 4).entries()) {
    const closedOn = iso(x.closedAt ?? now);
    const eff: Effectiveness = i === 0 ? { days: 30, due: iso(day(now, -2)), status: "pending" }
      : i === 1 ? { days: 30, due: iso(day(now, -20)), status: "effective", checkedAt: day(now, -15).toISOString(), by: robin, note: "Re-inspected: the second ID check was done on all 12 sampled files." }
      : { days: 60, due: iso(day(new Date(closedOn + "T12:00:00Z"), 60)), status: "pending" };
    await tx.update(actions).set({ rca: i < 2 ? rca : null, effectivenessDays: eff.days, effectiveness: eff }).where(eq(actions.id, x.id));
  }
  // Sample API keys (their secrets exist nowhere).
  const fake = (s: string) => createHash("sha256").update(`demo-key:${s}`).digest("hex");
  await tx.insert(apiKeys).values([
    { id: randomUUID(), companyId: DEMO, name: "Power BI", hint: "…7Qf2", hash: fake("powerbi"), scopes: ["sites:read", "inspections:read", "actions:read", "risk:read"], createdBy: admin, createdAt: day(now, -40), lastUsedAt: day(now, -0.3), expiresAt: day(now, 325) },
    { id: randomUUID(), companyId: DEMO, name: "Customer complaints system", hint: "…mX0d", hash: fake("complaints"), scopes: ["issues:write", "issues:read"], createdBy: admin, createdAt: day(now, -25), lastUsedAt: day(now, -2) },
  ]).onConflictDoNothing();
  return { entities: ENTITIES.length, issues: REPORTS.length };
}

/** Whether the Milestone 4 sample data is already there. */
export async function hasM4(tx: Tx): Promise<boolean> {
  return (await tx.select({ id: entities.id }).from(entities).where(eq(entities.companyId, DEMO)).limit(1)).length > 0;
}
