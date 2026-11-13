// What needs each person, in one place: the alerts bell in the top bar and the
// daily email read the same list.
//
//  • inspections and reviews waiting for your approval (not ones you carried out);
//  • actions waiting for you to verify (not ones you raised, own or submitted);
//  • your actions that are overdue or due in the next three days;
//  • effectiveness checks that have fallen due (supervisors who didn't own or submit the action);
//  • issues reported from a site's QR code or link, waiting for triage (supervisors).
//
// The email is one message per person per day, grouped by kind, sent through
// Resend only when RESEND_API_KEY is set, never from a demo, and only to people
// who haven't turned it off (and when the company hasn't). The daily run is
// GET /api/cron/notify (Vercel Cron, CRON_SECRET).
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { listTenantIds, withTenant } from "@/lib/db/client";
import { actionEvents, actions, companies, counters, inspections, issueReports, members, reviews, units } from "@/lib/db/schema";
import { loadSettings } from "@/lib/company";
import { record } from "@/lib/audit";
import { inScope, isSupervisor, verifyBlocker, isRole, type Actor, type Role } from "@/lib/roles";
import type { Effectiveness } from "@/lib/actionRules";

import { ALERT_KINDS, type AlertItem, type AlertKind } from "@/lib/alertInfo";
export { ALERT_KINDS, type AlertItem, type AlertKind };

export const SENDER = "Pulsus Quality <support@pulsus.tech>";
const isDemo = () => (process.env.DEMO_MODE || "").trim() === "1";
export const emailConfigured = () => !!(process.env.RESEND_API_KEY || "").trim() && !isDemo();
const appUrl = () => (process.env.APP_URL || "https://quality.pulsus.tech").replace(/\/+$/, "");
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d ?? "")).slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/** Everything waiting on this person now, most urgent first. */
export async function alertsFor(a: Actor, now = new Date()): Promise<AlertItem[]> {
  const today = now.toISOString().slice(0, 10);
  const soon = addDays(today, 3);
  const me = a.email.toLowerCase();
  const sup = isSupervisor(a);
  return withTenant(a.tenant, async (tx) => {
    const unitName = new Map((await tx.select({ id: units.id, name: units.name }).from(units).where(eq(units.companyId, a.tenant))).map((u) => [u.id, u.name]));
    const site = (id: string) => unitName.get(id) ?? "—";
    const out: AlertItem[] = [];
    if (sup) {
      const ins = (await tx.select().from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.status, "submitted")))).filter((r) => r.inspectorEmail.toLowerCase() !== me && inScope(a, r.unitId));
      for (const r of ins) out.push({ kind: "approve", id: r.id, title: `${r.ref} at ${site(r.unitId)}`, detail: `Submitted by ${r.inspectorEmail}`, href: `/inspect/${r.id}`, at: (r.submittedAt ?? r.updatedAt).toISOString() });
      const rev = (await tx.select().from(reviews).where(and(eq(reviews.companyId, a.tenant), eq(reviews.status, "submitted")))).filter((r) => r.inspectorEmail.toLowerCase() !== me && inScope(a, r.unitId));
      for (const r of rev) out.push({ kind: "approve", id: r.id, title: `Review ${r.ref} at ${site(r.unitId)}`, detail: `Keyed by ${r.inspectorEmail}`, href: "/review", at: (r.submittedAt ?? r.updatedAt).toISOString() });
    }
    const open = await tx.select().from(actions).where(and(eq(actions.companyId, a.tenant), ne(actions.status, "closed")));
    const awaiting = open.filter((x) => x.status === "awaiting_verification" && inScope(a, x.unitId));
    const submitters = awaiting.length ? await tx.select({ actionId: actionEvents.actionId, by: actionEvents.by, at: actionEvents.at }).from(actionEvents).where(and(eq(actionEvents.companyId, a.tenant), eq(actionEvents.status, "awaiting_verification"), inArray(actionEvents.actionId, awaiting.map((x) => x.id)))).orderBy(desc(actionEvents.at)) : [];
    for (const x of awaiting) {
      const submittedBy = submitters.find((s) => s.actionId === x.id)?.by ?? null;
      if (!verifyBlocker(a, { raisedBy: x.raisedBy, ownerEmail: x.ownerEmail, submittedBy })) out.push({ kind: "verify", id: x.id, title: `${x.ref}: ${x.title}`, detail: `${site(x.unitId)} · submitted by ${submittedBy ?? "the owner"}`, href: `/actions?open=${x.id}`, at: x.updatedAt.toISOString() });
    }
    for (const x of open) {
      if ((x.ownerEmail ?? "").toLowerCase() !== me || x.status === "awaiting_verification") continue;
      const due = iso(x.dueDate);
      if (due < today) out.push({ kind: "overdue", id: x.id, title: `${x.ref}: ${x.title}`, detail: `${site(x.unitId)} · was due ${due}`, href: `/actions?open=${x.id}`, at: due });
      else if (due <= soon) out.push({ kind: "due_soon", id: x.id, title: `${x.ref}: ${x.title}`, detail: `${site(x.unitId)} · due ${due}`, href: `/actions?open=${x.id}`, at: due });
    }
    if (sup) {
      const closed = await tx.select().from(actions).where(and(eq(actions.companyId, a.tenant), eq(actions.status, "closed")));
      for (const x of closed) {
        const e = x.effectiveness as Effectiveness | null;
        if (!e || (e.status !== "pending" && e.status !== "due") || e.due > today || !inScope(a, x.unitId)) continue;
        if ((x.ownerEmail ?? "").toLowerCase() === me) continue;
        out.push({ kind: "effectiveness", id: x.id, title: `${x.ref}: ${x.title}`, detail: `${site(x.unitId)} · check whether the fix held (due ${e.due})`, href: `/actions?open=${x.id}`, at: e.due });
      }
      const iss = (await tx.select().from(issueReports).where(and(eq(issueReports.companyId, a.tenant), eq(issueReports.status, "new")))).filter((r) => inScope(a, r.unitId));
      for (const r of iss) out.push({ kind: "issue", id: r.id, title: `${r.ref} at ${site(r.unitId)}`, detail: r.description.length > 90 ? r.description.slice(0, 90) + "…" : r.description, href: `/issues?open=${r.id}`, at: r.createdAt.toISOString() });
    }
    const order = new Map(ALERT_KINDS.map((k, i) => [k.key, i]));
    return out.sort((x, y) => (order.get(x.kind)! - order.get(y.kind)!) || x.at.localeCompare(y.at));
  });
}

/** Turn your own daily email on or off. */
export async function setMyEmailAlerts(a: Actor, on: boolean, requestId?: string): Promise<boolean> {
  return withTenant(a.tenant, async (tx) => {
    const r = await tx.update(members).set({ emailAlerts: on, updatedAt: new Date() }).where(and(eq(members.companyId, a.tenant), eq(members.email, a.email))).returning({ email: members.email });
    if (!r.length) return false;
    await record(tx, a.tenant, { actor: a.email, action: "member.email_alerts", entityType: "member", entityId: a.email, summary: `${a.email} turned the daily email ${on ? "on" : "off"}`, after: { emailAlerts: on }, requestId });
    return true;
  });
}

export async function myEmailAlerts(a: Actor): Promise<boolean> {
  return withTenant(a.tenant, async (tx) => (await tx.select({ on: members.emailAlerts }).from(members).where(and(eq(members.companyId, a.tenant), eq(members.email, a.email))).limit(1))[0]?.on ?? true);
}

// ── the email ────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** One grouped email: a heading per kind, a line per item, each linking to it. */
export function digestEmail(company: string, name: string, items: AlertItem[], base = appUrl()): { subject: string; html: string; text: string } {
  const n = items.length;
  const subject = `Pulsus Quality: ${n} ${n === 1 ? "thing needs" : "things need"} you today`;
  const groups = ALERT_KINDS.map((k) => ({ ...k, items: items.filter((i) => i.kind === k.key) })).filter((g) => g.items.length);
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#F7F1E8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1C1416">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6B5E60">Pulsus Quality · ${esc(company)}</p>
<h1 style="margin:0 0 12px;font-size:22px">Good morning${name ? `, ${esc(name.split(" ")[0])}` : ""}.</h1>
<p style="margin:0 0 16px">${n === 1 ? "One thing needs" : `${n} things need`} you today.</p>
${groups.map((g) => `<h2 style="margin:20px 0 6px;font-size:15px">${esc(g.label)} (${g.items.length})</h2>
<ul style="margin:0;padding:0 0 0 18px">${g.items.slice(0, 15).map((i) => `<li style="margin:0 0 6px"><a href="${esc(base + i.href)}" style="color:#7A1F2B;font-weight:600">${esc(i.title)}</a><br><span style="color:#6B5E60;font-size:13px">${esc(i.detail)}</span></li>`).join("")}${g.items.length > 15 ? `<li style="color:#6B5E60">and ${g.items.length - 15} more</li>` : ""}</ul>`).join("\n")}
<p style="margin:24px 0 0"><a href="${esc(base)}/" style="display:inline-block;background:#7A1F2B;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open Pulsus Quality</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#6B5E60">You get this email because you have a role in Pulsus Quality at ${esc(company)}. Turn it off in Settings, Email alerts.</p>
</div></body></html>`;
  const text = [`Pulsus Quality · ${company}`, "", `${n} ${n === 1 ? "thing needs" : "things need"} you today.`, ...groups.flatMap((g) => ["", `${g.label} (${g.items.length})`, ...g.items.slice(0, 15).map((i) => `- ${i.title} (${i.detail}) ${base + i.href}`)]), "", "Turn this email off in Settings, Email alerts."].join("\n");
  return { subject, html, text };
}

let fetcher: typeof fetch = (...x) => fetch(...x);
/** For the tests: replace the HTTP client. */
export function __setFetch(f: typeof fetch) { fetcher = f; }

export async function sendEmail(to: string, m: { subject: string; html: string; text: string }): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const r = await fetcher("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${(process.env.RESEND_API_KEY || "").trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER, to: [to], subject: m.subject, html: m.html, text: m.text }), signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch { return false; }
}

/** The actor a member acts as, for working out what needs them. */
function memberActor(companyId: string, companyName: string, m: typeof members.$inferSelect): Actor {
  return { tenant: companyId, tenantName: companyName, kind: companyId === "_own" ? "institution" : "company", email: m.email, name: m.name, roles: (m.roles as string[]).filter(isRole) as Role[], unitIds: m.unitIds as string[], platformRole: "member", operator: false, plan: null };
}

export interface DigestRun { companyId: string; sent: number; skipped: string | null; failed: number }

/** Send today's emails for one company, once a day. */
export async function sendDigests(companyId: string, now = new Date()): Promise<DigestRun> {
  if (!emailConfigured()) return { companyId, sent: 0, skipped: isDemo() ? "demo" : "email not set up", failed: 0 };
  if (companyId === "_demo") return { companyId, sent: 0, skipped: "demo", failed: 0 };
  const day = Number(now.toISOString().slice(0, 10).replace(/-/g, ""));
  const ctx = await withTenant(companyId, async (tx) => {
    const last = (await tx.select({ v: counters.value }).from(counters).where(and(eq(counters.companyId, companyId), eq(counters.name, "digest_day"))).limit(1))[0]?.v ?? 0;
    if (last >= day) return null;
    await tx.insert(counters).values({ companyId, name: "digest_day", value: day }).onConflictDoUpdate({ target: [counters.companyId, counters.name], set: { value: day } });
    const settings = await loadSettings(tx, companyId);
    const c = (await tx.select().from(companies).where(eq(companies.companyId, companyId)).limit(1))[0];
    const people = await tx.select().from(members).where(and(eq(members.companyId, companyId), eq(members.status, "active"), eq(members.emailAlerts, true)));
    return { settings, name: c?.name ?? "", people };
  });
  if (!ctx) return { companyId, sent: 0, skipped: "already sent today", failed: 0 };
  if (!ctx.settings.emailAlerts) return { companyId, sent: 0, skipped: "turned off for the company", failed: 0 };
  let sent = 0, failed = 0;
  for (const m of ctx.people) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email) || !(m.roles as string[]).length) continue;
    const items = await alertsFor(memberActor(companyId, ctx.name, m), now);
    if (!items.length) continue;
    if (await sendEmail(m.email, digestEmail(ctx.name, m.name, items))) sent++; else failed++;
  }
  if (sent || failed) await withTenant(companyId, (tx) => record(tx, companyId, { actor: "pulsus-quality", action: "notify.digest", entityType: "settings", summary: `Daily email sent to ${sent} ${sent === 1 ? "person" : "people"}${failed ? `; ${failed} failed` : ""}`, after: { sent, failed } }));
  return { companyId, sent, skipped: null, failed };
}

/** The daily run across every company. */
export async function sendAllDigests(now = new Date()): Promise<DigestRun[]> {
  if (!emailConfigured()) return [];
  const out: DigestRun[] = [];
  for (const id of await listTenantIds()) {
    try { out.push(await sendDigests(id, now)); } catch (e) { console.error("digest", e); out.push({ companyId: id, sent: 0, skipped: "error", failed: 0 }); }
  }
  return out;
}
