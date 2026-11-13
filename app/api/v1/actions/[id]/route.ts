import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { actions, units } from "@/lib/db/schema";
import { actionJson, apiError, apiJson, withKey } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withKey(req, "actions:read", async (k) => {
    const row = await withTenant(k.actor.tenant, async (tx) => {
      const a = (await tx.select().from(actions).where(and(eq(actions.companyId, k.actor.tenant), eq(actions.id, id))).limit(1))[0];
      if (!a) return null;
      const u = (await tx.select({ name: units.name }).from(units).where(and(eq(units.companyId, k.actor.tenant), eq(units.id, a.unitId))).limit(1))[0];
      return actionJson(a, u?.name ?? null);
    });
    return row ? apiJson(row) : apiError(404, "not_found", "No action with that id.");
  });
}
