import { apiError, apiJson, getInspectionApi, withKey } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withKey(req, "inspections:read", async (k) => { const r = await getInspectionApi(k, id); return r ? apiJson(r) : apiError(404, "not_found", "No inspection with that id."); });
}
