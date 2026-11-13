// Outgoing webhooks: a generic endpoint (signed JSON), a Slack channel or a
// Microsoft Teams channel. Events: an inspection approved, an action overdue, a
// site changing risk band, an issue reported, a proposal sent to Pulsus Risk.
//
// Each (webhook, event key) is delivered once: the key names the occurrence
// (for example "action.overdue:<id>:<due date>"), and a unique index stops a
// second delivery. A failed delivery is retried by the sweep, up to five times.
// A demo never sends anything: its deliveries are recorded as skipped.
//
// Generic deliveries carry X-Pulsus-Signature: t=<unix seconds>,v1=<hex
// HMAC-SHA256 of "<t>.<body>" with the webhook's secret>, so the receiver can
// check where it came from and reject replays.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { webhookDeliveries, webhooks } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { can, type Actor } from "@/lib/roles";

import { EVENTS, EVENT_INFO, type WebhookEvent, type WebhookKind, type WebhookView } from "@/lib/integrationInfo";
export { EVENTS, EVENT_INFO, type WebhookEvent, type WebhookKind, type WebhookView };

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const demo = () => (process.env.DEMO_MODE || "").trim() === "1";

let fetcher: typeof fetch = (...a) => fetch(...a);
/** For the tests: replace the HTTP client. */
export function __setFetch(f: typeof fetch) { fetcher = f; }

const PRIVATE = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

/** Where a webhook may point: https, a public host name (no IP literal or private name); Slack and Teams on their own hosts. */
export function checkUrl(raw: string, kind: WebhookKind): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "Enter the full https:// address."; }
  if (u.protocol !== "https:") return "Webhooks are sent over https only.";
  if (u.username || u.password) return "Leave credentials out of the address.";
  const h = u.hostname.toLowerCase();
  if (PRIVATE.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || !h.includes(".")) return "Use a public host name, not an IP address or an internal name.";
  if (kind === "slack" && h !== "hooks.slack.com") return "A Slack incoming webhook starts https://hooks.slack.com/.";
  if (kind === "teams" && !/(\.webhook\.office\.com|\.logic\.azure\.com|\.powerplatform\.com|\.powerautomate\.com)$/.test(h)) return "Use the Teams workflow (or incoming webhook) address from your channel.";
  return null;
}


const mask = (url: string) => { try { const u = new URL(url); return `${u.origin}${u.pathname.length > 16 ? u.pathname.slice(0, 12) + "…" : u.pathname}`; } catch { return "—"; } };

export async function listWebhooks(a: Actor): Promise<WebhookView[]> {
  if (!can.manage(a)) return [];
  return withTenant(a.tenant, async (tx) => {
    const rows = await tx.select().from(webhooks).where(eq(webhooks.companyId, a.tenant)).orderBy(desc(webhooks.createdAt));
    const dels = await tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.companyId, a.tenant)).orderBy(desc(webhookDeliveries.at)).limit(200);
    return rows.map((w) => ({
      id: w.id, name: w.name, kind: w.kind as WebhookKind, url: mask(w.url), events: w.events as WebhookEvent[], active: w.active, createdBy: w.createdBy, createdAt: w.createdAt.toISOString(),
      lastStatus: w.lastStatus, lastAt: w.lastAt?.toISOString() ?? null,
      deliveries: dels.filter((d) => d.webhookId === w.id).slice(0, 8).map((d) => ({ event: d.event, status: d.status, code: d.code, attempts: d.attempts, at: d.at.toISOString() })),
    }));
  });
}

const cleanEvents = (v: unknown): WebhookEvent[] => (Array.isArray(v) ? v.filter((e): e is WebhookEvent => (EVENTS as readonly string[]).includes(String(e))) : []);

/** Add a webhook (admins). Returns the signing secret once, for generic endpoints. */
export async function createWebhook(a: Actor, input: { name?: unknown; kind?: unknown; url?: unknown; events?: unknown }, requestId?: string): Promise<Result<{ id: string; secret: string | null }>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin adds webhooks.", status: 403 };
  const kind: WebhookKind = input.kind === "slack" || input.kind === "teams" ? input.kind : "generic";
  const url = String(input.url || "").trim().slice(0, 600);
  const bad = checkUrl(url, kind);
  if (bad) return { ok: false, error: bad, status: 400 };
  const events = cleanEvents(input.events);
  if (!events.length) return { ok: false, error: "Choose at least one event.", status: 400 };
  const name = String(input.name || "").trim().slice(0, 80) || (kind === "generic" ? "Webhook" : kind === "slack" ? "Slack alerts" : "Teams alerts");
  const id = randomUUID(), secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await withTenant(a.tenant, async (tx) => {
    await tx.insert(webhooks).values({ id, companyId: a.tenant, name, kind, url, secret, events, createdBy: a.email });
    await record(tx, a.tenant, { actor: a.email, action: "webhook.create", entityType: "webhook", entityId: id, summary: `Webhook added: ${name} (${kind}) for ${events.join(", ")}`, after: { name, kind, host: new URL(url).host, events }, requestId });
  });
  return { ok: true, value: { id, secret: kind === "generic" ? secret : null } };
}

export async function updateWebhook(a: Actor, id: string, input: { active?: unknown; events?: unknown; remove?: unknown }, requestId?: string): Promise<Result<true>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin changes webhooks.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    const w = (await tx.select().from(webhooks).where(and(eq(webhooks.companyId, a.tenant), eq(webhooks.id, id))).limit(1))[0];
    if (!w) return { ok: false as const, error: "Webhook not found.", status: 404 };
    if (input.remove === true) {
      await tx.delete(webhookDeliveries).where(and(eq(webhookDeliveries.companyId, a.tenant), eq(webhookDeliveries.webhookId, id)));
      await tx.delete(webhooks).where(eq(webhooks.id, id));
      await record(tx, a.tenant, { actor: a.email, action: "webhook.delete", entityType: "webhook", entityId: id, summary: `Webhook removed: ${w.name}`, requestId });
      return { ok: true as const, value: true as const };
    }
    const events = input.events !== undefined ? cleanEvents(input.events) : (w.events as WebhookEvent[]);
    const active = typeof input.active === "boolean" ? input.active : w.active;
    await tx.update(webhooks).set({ events, active }).where(eq(webhooks.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "webhook.update", entityType: "webhook", entityId: id, summary: `Webhook ${w.name}: ${active ? "on" : "off"}, ${events.join(", ") || "no events"}`, requestId });
    return { ok: true as const, value: true as const };
  });
}

export interface EventData { title: string; text: string; url?: string; facts?: [string, string][]; [k: string]: unknown }

/** The request body for each kind of endpoint. */
export function formatPayload(kind: WebhookKind, event: string, deliveryId: string, companyId: string, data: EventData): unknown {
  if (kind === "slack") {
    return {
      text: `${data.title}: ${data.text}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${data.title}*\n${data.text}` } },
        ...(data.facts?.length ? [{ type: "section", fields: data.facts.slice(0, 10).map(([k, v]) => ({ type: "mrkdwn", text: `*${k}*\n${v}` })) }] : []),
        ...(data.url ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in Pulsus Quality" }, url: data.url }] }] : []),
        { type: "context", elements: [{ type: "mrkdwn", text: `Pulsus Quality · ${event}` }] },
      ],
    };
  }
  if (kind === "teams") {
    return {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
          body: [
            { type: "TextBlock", text: data.title, weight: "Bolder", size: "Medium", wrap: true },
            { type: "TextBlock", text: data.text, wrap: true },
            ...(data.facts?.length ? [{ type: "FactSet", facts: data.facts.slice(0, 10).map(([title, value]) => ({ title, value })) }] : []),
            { type: "TextBlock", text: `Pulsus Quality · ${event}`, isSubtle: true, size: "Small" },
          ],
          ...(data.url ? { actions: [{ type: "Action.OpenUrl", title: "Open in Pulsus Quality", url: data.url }] } : {}),
        },
      }],
    };
  }
  const { title, text, url, facts, ...rest } = data;
  return { id: deliveryId, event, created_at: new Date().toISOString(), company_id: companyId, data: { title, text, url: url ?? null, facts: Object.fromEntries(facts ?? []), ...rest } };
}

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

async function send(w: typeof webhooks.$inferSelect, event: string, deliveryId: string, payload: unknown): Promise<{ status: "sent" | "failed" | "skipped"; code: number | null }> {
  if (demo()) return { status: "skipped", code: null };
  const body = JSON.stringify(payload);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "PulsusQuality-Webhooks/1" };
    if (w.kind === "generic") Object.assign(headers, { "X-Pulsus-Event": event, "X-Pulsus-Delivery": deliveryId, "X-Pulsus-Signature": sign(w.secret, body) });
    const r = await fetcher(w.url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(5000) });
    return { status: r.status >= 200 && r.status < 300 ? "sent" : "failed", code: r.status };
  } catch {
    return { status: "failed", code: null };
  }
}

/** Deliver an event to every active webhook subscribed to it, once per event key. Never throws. */
export async function emit(companyId: string, event: WebhookEvent, key: string, data: EventData): Promise<number> {
  try {
    const hooks = await withTenant(companyId, async (tx) => (await tx.select().from(webhooks).where(and(eq(webhooks.companyId, companyId), eq(webhooks.active, true)))).filter((w) => (w.events as string[]).includes(event)));
    let n = 0;
    for (const w of hooks) {
      const eventKey = `${event}:${key}`.slice(0, 300);
      const id = randomUUID();
      const generic = formatPayload("generic", event, id, companyId, data);
      const claimed = await withTenant(companyId, async (tx) => (await tx.insert(webhookDeliveries).values({ id, companyId, webhookId: w.id, event, eventKey, payload: generic as object, status: "failed", attempts: 0 }).onConflictDoNothing().returning({ id: webhookDeliveries.id })).length > 0);
      if (!claimed) continue;
      const r = await send(w, event, id, formatPayload(w.kind as WebhookKind, event, id, companyId, data));
      await withTenant(companyId, async (tx) => {
        await tx.update(webhookDeliveries).set({ status: r.status, code: r.code, attempts: 1, at: new Date() }).where(eq(webhookDeliveries.id, id));
        await tx.update(webhooks).set({ lastStatus: r.status, lastAt: new Date() }).where(eq(webhooks.id, w.id));
      });
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Retry failed deliveries (up to five attempts). The sweep calls this. */
export async function retryDeliveries(companyId: string): Promise<number> {
  const rows = await withTenant(companyId, async (tx) => tx.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.companyId, companyId), eq(webhookDeliveries.status, "failed"), lt(webhookDeliveries.attempts, 5))).limit(50));
  let n = 0;
  for (const d of rows) {
    const w = await withTenant(companyId, async (tx) => (await tx.select().from(webhooks).where(and(eq(webhooks.companyId, companyId), eq(webhooks.id, d.webhookId))).limit(1))[0]);
    if (!w || !w.active) continue;
    const g = d.payload as { data: EventData & { facts?: Record<string, string> } };
    const data: EventData = { ...g.data, facts: Object.entries(g.data.facts ?? {}) as [string, string][] };
    const r = await send(w, d.event, d.id, formatPayload(w.kind as WebhookKind, d.event, d.id, companyId, data));
    await withTenant(companyId, async (tx) => { await tx.update(webhookDeliveries).set({ status: r.status, code: r.code, attempts: d.attempts + 1, at: new Date() }).where(eq(webhookDeliveries.id, d.id)); });
    if (r.status === "sent") n++;
  }
  return n;
}

/** Send a test message to one webhook (admins). */
export async function testWebhook(a: Actor, id: string): Promise<Result<{ status: string; code: number | null }>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin tests webhooks.", status: 403 };
  const w = await withTenant(a.tenant, async (tx) => (await tx.select().from(webhooks).where(and(eq(webhooks.companyId, a.tenant), eq(webhooks.id, id))).limit(1))[0]);
  if (!w) return { ok: false, error: "Webhook not found.", status: 404 };
  const did = randomUUID();
  const r = await send(w, "ping", did, formatPayload(w.kind as WebhookKind, "ping", did, a.tenant, { title: "Pulsus Quality test", text: `A test message from ${a.tenantName}, sent by ${a.name || a.email}.` }));
  await withTenant(a.tenant, async (tx) => { await tx.update(webhooks).set({ lastStatus: r.status, lastAt: new Date() }).where(eq(webhooks.id, id)); });
  return { ok: true, value: r };
}
