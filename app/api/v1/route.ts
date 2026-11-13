// The REST API's front page: what this key can reach. Documented in docs/api.md.
import { authenticateKey } from "@/lib/apiKeys";
import { API_VERSION, apiError, apiJson } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const k = await authenticateKey(req.headers.get("authorization"));
  if (!k) return apiError(401, "unauthorized", "Send a valid API key as Authorization: Bearer pq_…");
  return apiJson({
    api: "Pulsus Quality", version: API_VERSION, key: { name: k.actor.name, scopes: k.scopes },
    endpoints: {
      "GET /api/v1/sites": "sites:read", "GET /api/v1/inspections": "inspections:read", "GET /api/v1/inspections/{id}": "inspections:read",
      "GET /api/v1/actions": "actions:read", "GET /api/v1/actions/{id}": "actions:read", "POST /api/v1/actions": "actions:write",
      "GET /api/v1/risk": "risk:read", "GET /api/v1/sampling": "sampling:read", "GET /api/v1/issues": "issues:read", "POST /api/v1/issues": "issues:write",
    },
  });
}
