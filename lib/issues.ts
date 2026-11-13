// Report an issue: anyone — staff without a seat, a contractor, a visitor —
// raises an observation, hazard, near miss or complaint from a site's own link
// or QR code, on a phone, with no sign-in. A supervisor triages it into a
// corrective action, an inspection, or dismisses it with a reason.
//
// Each site has one public link token: <company id, base64url>.<random>. The
// company part only says which tenant to look in; the random part must match
// the stored token, so a guessed or rotated link opens nothing. Submissions are
// checked by Cloudflare Turnstile when TURNSTILE_SECRET_KEY is set; a honeypot
// field and a per-address rate limit apply either way.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { companies, evidence, inspections, issueReports, members, reportLinks, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { loadSettings } from "@/lib/company";
import { can, inScope, isSupervisor, type Actor } from "@/lib/roles";
import { getStorage, storageIsDurable } from "@/lib/storage";
import { createAction } from "@/lib/actions";
import { saveInspection } from "@/lib/inspections";
import { emit } from "@/lib/webhooks";

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const TENANT_ID = /^(?:_own|_demo|[a-z0-9][a-z0-9-]{0,39})$/;
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);

import { CATEGORIES, CATEGORY_INFO, STATUS_INFO, type IssueCategory, type IssueView, type LinkView } from "@/lib/issueInfo";
export { CATEGORIES, CATEGORY_INFO, STATUS_INFO, type IssueCategory, type IssueView, type LinkView };

const appUrl = () => (process.env.APP_URL || "https://quality.pulsus.tech").replace(/\/+$/, "");
export const makeToken = (companyId: string) => `${Buffer.from(companyId).toString("base64url")}.${randomBytes(16).toString("base64url")}`;
export function tokenTenant(token: string): string | null {
  const m = /^([A-Za-z0-9_-]{1,60})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const t = Buffer.from(m[1], "base64url").toString("utf8");
  return TENANT_ID.test(t) ? t : null;
}
export const reportUrl = (token: string) => `${appUrl()}/r/${token}`;


/** Every active site's link, creating any that are missing (supervisors and admins). */
export async function listLinks(a: Actor): Promise<LinkView[]> {
  if (!isSupervisor(a)) return [];
  return withTenant(a.tenant, async (tx) => {
    const us = (await tx.select().from(units).where(and(eq(units.companyId, a.tenant), eq(units.active, true)))).filter((u) => inScope(a, u.id)).sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name));
    let links = await tx.select().from(reportLinks).where(eq(reportLinks.companyId, a.tenant));
    const missing = us.filter((u) => !links.some((l) => l.unitId === u.id));
    if (missing.length) {
      for (const u of missing) await tx.insert(reportLinks).values({ companyId: a.tenant, unitId: u.id, token: makeToken(a.tenant), createdBy: a.email }).onConflictDoNothing();
      links = await tx.select().from(reportLinks).where(eq(reportLinks.companyId, a.tenant));
    }
    const counts = await tx.select({ unitId: issueReports.unitId }).from(issueReports).where(eq(issueReports.companyId, a.tenant));
    return us.map((u) => { const l = links.find((x) => x.unitId === u.id)!; return { unitId: u.id, unitName: u.name, region: u.region, token: l.token, path: `/r/${l.token}`, url: reportUrl(l.token), active: l.active, createdAt: l.createdAt.toISOString(), reports: counts.filter((c) => c.unitId === u.id).length }; });
  });
}

/** A site's current token (creating it), for reports that arrive through the API. */
export async function tokenFor(companyId: string, unitId: string, by: string): Promise<string | null> {
  return withTenant(companyId, async (tx) => {
    const u = (await tx.select().from(units).where(and(eq(units.companyId, companyId), eq(units.id, unitId))).limit(1))[0];
    if (!u || !u.active) return null;
    const l = (await tx.select().from(reportLinks).where(and(eq(reportLinks.companyId, companyId), eq(reportLinks.unitId, unitId))).limit(1))[0];
    if (l) return l.active ? l.token : null;
    const token = makeToken(companyId);
    await tx.insert(reportLinks).values({ companyId, unitId, token, createdBy: by });
    return token;
  });
}

/** Replace a site's link (a poster went missing, or the link was misused): the old one stops working at once. */
export async function rotateLink(a: Actor, unitId: string, requestId?: string): Promise<Result<{ token: string }>> {
  if (!isSupervisor(a) || !inScope(a, unitId)) return { ok: false, error: "A supervisor for this site replaces its link.", status: 403 };
  const token = makeToken(a.tenant);
  return withTenant(a.tenant, async (tx) => {
    const u = (await tx.select().from(units).where(and(eq(units.companyId, a.tenant), eq(units.id, unitId))).limit(1))[0];
    if (!u) return { ok: false as const, error: "Not found.", status: 404 };
    await tx.insert(reportLinks).values({ companyId: a.tenant, unitId, token, createdBy: a.email }).onConflictDoUpdate({ target: [reportLinks.companyId, reportLinks.unitId], set: { token, active: true, createdBy: a.email, createdAt: new Date() } });
    await record(tx, a.tenant, { actor: a.email, action: "issues.link.rotate", entityType: "unit", entityId: unitId, summary: `New report-an-issue link for ${u.name}; the old link no longer works`, requestId });
    return { ok: true as const, value: { token } };
  });
}

export interface PublicSite { companyId: string; companyName: string; unitId: string; unitName: string; unitLabel: string }

/** What a public link opens: the organisation and site names, nothing else. */
export async function resolveLink(token: string): Promise<PublicSite | null> {
  const tenant = tokenTenant(token);
  if (!tenant) return null;
  return withTenant(tenant, async (tx) => {
    const l = (await tx.select().from(reportLinks).where(and(eq(reportLinks.companyId, tenant), eq(reportLinks.token, token))).limit(1))[0];
    if (!l || !l.active) return null;
    const u = (await tx.select().from(units).where(and(eq(units.companyId, tenant), eq(units.id, l.unitId))).limit(1))[0];
    if (!u || !u.active) return null;
    const c = (await tx.select().from(companies).where(eq(companies.companyId, tenant)).limit(1))[0];
    const s = await loadSettings(tx, tenant);
    return { companyId: tenant, companyName: tenant === "_demo" ? "Meridian Society" : c?.name ?? "", unitId: u.id, unitName: u.name, unitLabel: s.unitLabel };
  });
}

// ── submission ────────────────────────────────────────────────────────────────

const recent = new Map<string, number[]>();
/** At most `max` reports from one address to one site in ten minutes (in this process). */
export function throttled(key: string, max = 5, now = Date.now()): boolean {
  const xs = (recent.get(key) || []).filter((t) => now - t < 600_000);
  if (xs.length >= max) { recent.set(key, xs); return true; }
  xs.push(now); recent.set(key, xs);
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => now - t < 600_000)) recent.delete(k);
  return false;
}

export const turnstileSiteKey = () => { const k = (process.env.TURNSTILE_SITE_KEY || "").trim(); return /^[A-Za-z0-9_-]{1,200}$/.test(k) ? k : ""; };

/** Check a Turnstile answer when a secret key is configured. Without one, it passes (the honeypot and rate limit still apply). */
export async function verifyTurnstile(response: string, ip: string | null, fetcher: typeof fetch = fetch): Promise<boolean> {
  const secret = (process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) return true;
  if (!response) return false;
  try {
    const body = new URLSearchParams({ secret, response, ...(ip ? { remoteip: ip } : {}) });
    const r = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(6000) });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch { return false; }
}

const PHOTO = /^image\/(jpeg|png|webp|heic|heif)$/;
export const MAX_PHOTO = 10 * 1024 * 1024;

export interface ReportInput { category?: unknown; description?: unknown; location?: unknown; name?: unknown; contact?: unknown; website?: unknown; turnstile?: unknown }

/** A report from a public link. Returns the reference to show the reporter. */
export async function submitReport(token: string, input: ReportInput, photo: { type: string; bytes: Buffer } | null, meta: { ip: string | null; source?: "link" | "qr" | "api"; trusted?: boolean }, fetcher: typeof fetch = fetch): Promise<Result<{ ref: string; photo: "stored" | "skipped" | "none" }>> {
  const site = await resolveLink(token);
  if (!site) return { ok: false, error: "This link isn't active. Ask the site for its current poster or link.", status: 404 };
  if (!meta.trusted) {
    if (clean(input.website, 200)) return { ok: true, value: { ref: "OBS-0000", photo: "none" } }; // honeypot: look accepted, store nothing
    const ipKey = createHash("sha256").update(`${meta.ip || "unknown"}|${token}`).digest("hex").slice(0, 32);
    if (throttled(ipKey)) return { ok: false, error: "Thanks — we've had several reports from you just now. Please wait a few minutes before sending another.", status: 429 };
    if (!(await verifyTurnstile(clean(input.turnstile, 4000), meta.ip, fetcher))) return { ok: false, error: "Please complete the quick check, then send again.", status: 400 };
  }
  const category = (CATEGORIES as readonly string[]).includes(String(input.category)) ? (input.category as IssueCategory) : null;
  if (!category) return { ok: false, error: "Choose what kind of issue it is.", status: 400 };
  const description = clean(input.description, 2000);
  if (description.length < 10) return { ok: false, error: "Describe what you saw (a sentence or two).", status: 400 };
  if (photo && (!PHOTO.test(photo.type) || photo.bytes.length > MAX_PHOTO || photo.bytes.length === 0)) return { ok: false, error: "Attach a photo (JPEG, PNG, WebP or HEIC) up to 10 MB.", status: 400 };
  const id = randomUUID();
  let photoState: "stored" | "skipped" | "none" = photo ? "skipped" : "none";
  let blob: { key: string; sha: string } | null = null;
  if (photo && storageIsDurable()) {
    const key = `evidence/${site.companyId}/issue_report/${id}/${randomUUID()}`;
    await getStorage().write(key, photo.bytes, photo.type);
    blob = { key, sha: createHash("sha256").update(photo.bytes).digest("hex") };
    photoState = "stored";
  }
  const ref = await withTenant(site.companyId, async (tx) => {
    const ref = await nextRef(tx, site.companyId, "issue", "OBS");
    await tx.insert(issueReports).values({ id, companyId: site.companyId, ref, unitId: site.unitId, category, description, location: clean(input.location, 200), reporterName: clean(input.name, 120), reporterContact: clean(input.contact, 160), source: meta.source ?? "link" });
    if (blob && photo) await tx.insert(evidence).values({ id: randomUUID(), companyId: site.companyId, entityType: "issue_report", entityId: id, name: `photo.${photo.type.split("/")[1]}`, size: photo.bytes.length, contentType: photo.type, sha256: blob.sha, blobKey: blob.key, uploadedBy: "public report" });
    await record(tx, site.companyId, { actor: `public:${site.unitName}`, action: "issue.report", entityType: "issue_report", entityId: id, summary: `${ref} reported at ${site.unitName}: ${CATEGORY_INFO[category].label.toLowerCase()}`, after: { ref, category, photo: photoState } });
    return ref;
  });
  await emit(site.companyId, "issue.reported", id, { title: `${ref}: ${CATEGORY_INFO[category].label} at ${site.unitName}`, text: description.slice(0, 300), url: `${appUrl()}/issues?open=${id}`, facts: [[site.unitLabel, site.unitName], ["Kind", CATEGORY_INFO[category].label], ["Photo", photoState === "stored" ? "yes" : "no"]], issue: { id, ref, unitId: site.unitId, category } });
  return { ok: true, value: { ref, photo: photoState } };
}

// ── triage ────────────────────────────────────────────────────────────────────


export async function listReports(a: Actor): Promise<IssueView[]> {
  if (!can.inspect(a) && !isSupervisor(a)) return [];
  return withTenant(a.tenant, async (tx) => {
    const rows = (await tx.select().from(issueReports).where(eq(issueReports.companyId, a.tenant)).orderBy(desc(issueReports.createdAt)).limit(500)).filter((r) => inScope(a, r.unitId));
    if (!rows.length) return [];
    const us = await tx.select({ id: units.id, name: units.name }).from(units).where(eq(units.companyId, a.tenant));
    const ph = await tx.select({ id: evidence.id, entityId: evidence.entityId, contentType: evidence.contentType }).from(evidence).where(and(eq(evidence.companyId, a.tenant), eq(evidence.entityType, "issue_report"), inArray(evidence.entityId, rows.map((r) => r.id))));
    const un = new Map(us.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id, ref: r.ref, unitId: r.unitId, unitName: un.get(r.unitId) ?? "—", category: r.category as IssueCategory, description: r.description, location: r.location, reporterName: r.reporterName, reporterContact: r.reporterContact,
      status: r.status, triageNote: r.triageNote, triagedBy: r.triagedBy, triagedAt: r.triagedAt?.toISOString() ?? null, actionId: r.actionId, inspectionId: r.inspectionId, source: r.source, createdAt: r.createdAt.toISOString(),
      photos: ph.filter((p) => p.entityId === r.id).map((p) => ({ id: p.id, contentType: p.contentType })),
    }));
  });
}

export interface TriageInput { to?: unknown; note?: unknown; title?: unknown; priority?: unknown; dueDate?: unknown; ownerEmail?: unknown; ownerName?: unknown; kind?: unknown; templateId?: unknown; assignee?: unknown }

/** A supervisor turns a report into an action or an inspection, or closes it with a reason. */
export async function triage(a: Actor, id: string, input: TriageInput, requestId?: string): Promise<Result<IssueView>> {
  if (!isSupervisor(a)) return { ok: false, error: "A supervisor triages reported issues.", status: 403 };
  const rep = await withTenant(a.tenant, async (tx) => (await tx.select().from(issueReports).where(and(eq(issueReports.companyId, a.tenant), eq(issueReports.id, id))).limit(1))[0]);
  if (!rep || !inScope(a, rep.unitId)) return { ok: false, error: "Report not found.", status: 404 };
  if (rep.status !== "new") return { ok: false, error: "This report has already been triaged.", status: 409 };
  const note = clean(input.note, 1000);
  const to = input.to === "action" || input.to === "inspection" || input.to === "dismiss" ? input.to : null;
  if (!to) return { ok: false, error: "Choose what to do with it.", status: 400 };
  let actionId: string | null = null, inspectionId: string | null = null;
  if (to === "dismiss") {
    if (note.length < 5) return { ok: false, error: "Say why no action is needed.", status: 400 };
  } else if (to === "action") {
    const r = await createAction(a, {
      kind: input.kind ?? (rep.category === "hazard" ? "containment" : "corrective"), unitId: rep.unitId, title: clean(input.title, 160) || rep.description.slice(0, 120), priority: input.priority ?? (rep.category === "hazard" ? "high" : "medium"),
      details: `Reported as ${CATEGORY_INFO[rep.category as IssueCategory]?.label.toLowerCase() ?? rep.category} (${rep.ref})${rep.location ? ` at "${rep.location}"` : ""}: ${rep.description}${note ? `\n\nTriage: ${note}` : ""}`,
      ownerEmail: input.ownerEmail, ownerName: input.ownerName, dueDate: input.dueDate, sourceType: "issue_report", sourceId: rep.id,
    }, requestId);
    if (!r.ok) return r;
    actionId = r.value.id;
  } else {
    const tid = clean(input.templateId, 80);
    const period = new Date().toISOString().slice(0, 7) + "-01";
    const r = await saveInspection(a, { clientId: `issue-${rep.id}`, templateId: tid, unitId: rep.unitId, period }, requestId);
    if (!r.ok) return r;
    inspectionId = r.value.id;
    const assignee = clean(input.assignee, 254).toLowerCase();
    if (assignee) {
      const m = await withTenant(a.tenant, async (tx) => (await tx.select().from(members).where(and(eq(members.companyId, a.tenant), eq(members.email, assignee))).limit(1))[0]);
      if (!m || !(m.roles as string[]).some((x) => x === "inspector" || x === "supervisor" || x === "admin")) return { ok: false, error: "Assign it to someone who carries out inspections.", status: 400 };
      await withTenant(a.tenant, async (tx) => { await tx.update(inspections).set({ inspectorEmail: assignee, note: `From reported issue ${rep.ref}` }).where(and(eq(inspections.companyId, a.tenant), eq(inspections.id, inspectionId!))); });
    }
  }
  await withTenant(a.tenant, async (tx) => {
    await tx.update(issueReports).set({ status: to === "dismiss" ? "dismissed" : to, triageNote: note, triagedBy: a.email, triagedAt: new Date(), actionId, inspectionId }).where(eq(issueReports.id, rep.id));
    await record(tx, a.tenant, { actor: a.email, action: `issue.${to}`, entityType: "issue_report", entityId: rep.id, summary: `${rep.ref}: ${to === "dismiss" ? `closed, no action (${note})` : to === "action" ? "action raised" : "inspection scheduled"}`, after: { status: to, actionId, inspectionId }, requestId });
  });
  return { ok: true, value: (await listReports(a)).find((x) => x.id === rep.id)! };
}
