// ?status=approved&since=2026-11-01&limit=50&after=<cursor>
import { apiJson, listInspectionsApi, withKey } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withKey(req, "inspections:read", async (k) => apiJson(await listInspectionsApi(k, req)));
}
