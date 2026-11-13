// Upload a photo or document to a review or action (multipart: entityType,
// entityId, file). Private storage, hashed, 15 MB at most.
import { actorOr, json, result } from "@/lib/api";
import { uploadEvidence } from "@/lib/evidence";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const entityType = String(form?.get("entityType") || "");
  const entityId = String(form?.get("entityId") || "");
  if (!(file instanceof File) || !["review", "action"].includes(entityType) || !entityId) return json({ error: "Choose a file." }, 400);
  if (file.size > 15 * 1024 * 1024) return json({ error: "Files can be up to 15 MB." }, 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  return result(await uploadEvidence(g.actor, entityType, entityId, { name: file.name, type: file.type || "application/octet-stream", bytes }, g.requestId), (file) => ({ file }));
}
