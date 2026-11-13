// GET reported issues; POST { site_id, category, description, location?, reporter_name?, reporter_contact? } reports one from another system.
import { listReports, submitReport, tokenFor } from "@/lib/issues";
import { apiError, apiJson, withKey } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withKey(req, "issues:read", async (k) => {
    const all = await listReports({ ...k.actor, roles: ["supervisor"] });
    return apiJson({ data: all.map((r) => ({ id: r.id, ref: r.ref, site_id: r.unitId, site: r.unitName, category: r.category, description: r.description, location: r.location, status: r.status, triage_note: r.triageNote, action_id: r.actionId, inspection_id: r.inspectionId, source: r.source, created_at: r.createdAt, photos: r.photos.length })) });
  });
}

export async function POST(req: Request) {
  return withKey(req, "issues:write", async (k) => {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return apiError(400, "invalid_json", "Send a JSON object.");
    const token = await tokenFor(k.actor.tenant, String(b.site_id || ""), k.actor.email);
    if (!token) return apiError(400, "invalid_request", "site_id must be an active site.");
    const r = await submitReport(token, { category: b.category, description: b.description, location: b.location, name: b.reporter_name, contact: b.reporter_contact }, null, { ip: null, source: "api", trusted: true });
    return r.ok ? apiJson({ ref: r.value.ref }, 201) : apiError(r.status ?? 400, "invalid_request", r.error);
  });
}
