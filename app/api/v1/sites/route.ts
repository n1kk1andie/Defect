import { apiJson, sitesFor, withKey } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withKey(req, "sites:read", async (k) => apiJson(await sitesFor(k)));
}
