// GET ?status=open&since=&limit=&after=   POST { site_id, title, due_date, priority?, kind?, details?, root_cause?, owner_email?, owner_name? }
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { actions, units } from "@/lib/db/schema";
import { createAction } from "@/lib/actions";
import { actionJson, apiError, apiJson, listActionsApi, withKey } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withKey(req, "actions:read", async (k) => apiJson(await listActionsApi(k, req)));
}

export async function POST(req: Request) {
  return withKey(req, "actions:write", async (k) => {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object") return apiError(400, "invalid_json", "Send a JSON object.");
    const r = await createAction(k.actor, {
      unitId: b.site_id, title: b.title, dueDate: b.due_date, priority: b.priority ?? "medium", kind: b.kind ?? "corrective", details: b.details, rootCause: b.root_cause,
      ownerEmail: b.owner_email, ownerName: b.owner_name ?? (b.owner_email ? "" : "To be assigned"), sourceType: "api", sourceId: typeof b.external_id === "string" ? b.external_id : undefined,
    });
    if (!r.ok) return apiError(r.status ?? 400, "invalid_request", r.error);
    const row = await withTenant(k.actor.tenant, async (tx) => {
      const a = (await tx.select().from(actions).where(and(eq(actions.companyId, k.actor.tenant), eq(actions.id, r.value.id))).limit(1))[0];
      const u = (await tx.select({ name: units.name }).from(units).where(and(eq(units.companyId, k.actor.tenant), eq(units.id, a.unitId))).limit(1))[0];
      return actionJson(a, u?.name ?? null);
    });
    return apiJson(row, 201);
  });
}
