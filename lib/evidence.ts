// Evidence and photos on reviews and actions. The bytes go to private Blob
// storage under the company's own prefix; the evidence table records what was
// uploaded, by whom, its size, type and SHA-256 (so a later copy can be
// checked against it). Only people who can see the review or action can read
// its files.
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { actions, evidence, reviews } from "@/lib/db/schema";
import { getStorage, storageIsDurable } from "@/lib/storage";
import { record } from "@/lib/audit";
import { canSeeAction } from "@/lib/actions";
import { canSeeReview } from "@/lib/reviews";
import type { Actor } from "@/lib/roles";

export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf|text\/(plain|csv)|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document|presentationml\.presentation)|application\/msword|application\/vnd\.ms-excel)$/;

export function evidenceTypeAllowed(type: string): boolean { return ALLOWED.test(type); }

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

async function entityVisible(a: Actor, entityType: string, entityId: string, forWrite: boolean): Promise<boolean> {
  return withTenant(a.tenant, async (tx) => {
    if (entityType === "action") {
      const r = (await tx.select().from(actions).where(and(eq(actions.companyId, a.tenant), eq(actions.id, entityId))).limit(1))[0];
      if (!r) return false;
      if (forWrite && r.status === "closed") return false;
      return canSeeAction(a, r) && (!forWrite || a.roles.some((x) => x !== "viewer") || r.ownerEmail === a.email);
    }
    if (entityType === "review") {
      const r = (await tx.select().from(reviews).where(and(eq(reviews.companyId, a.tenant), eq(reviews.id, entityId))).limit(1))[0];
      if (!r) return false;
      if (forWrite) return (r.inspectorEmail === a.email || a.roles.includes("admin")) && (r.status === "draft" || r.status === "returned");
      return canSeeReview(a, r);
    }
    return false;
  });
}

export async function uploadEvidence(a: Actor, entityType: string, entityId: string, file: { name: string; type: string; bytes: Buffer }, requestId?: string): Promise<Result<{ id: string; name: string; size: number; contentType: string }>> {
  if (!storageIsDurable()) return { ok: false, error: "File storage isn't connected on this deployment.", status: 503 };
  if (file.bytes.length === 0) return { ok: false, error: "That file is empty.", status: 400 };
  if (file.bytes.length > MAX_EVIDENCE_BYTES) return { ok: false, error: "Files can be up to 15 MB.", status: 413 };
  if (!evidenceTypeAllowed(file.type)) return { ok: false, error: "Upload a photo, PDF, Office document, text or CSV file.", status: 415 };
  if (!(await entityVisible(a, entityType, entityId, true))) return { ok: false, error: "You can't add files here.", status: 403 };
  const id = randomUUID();
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const name = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "file";
  const blobKey = `evidence/${a.tenant}/${entityType}/${entityId}/${id}`;
  await getStorage().write(blobKey, file.bytes, file.type);
  await withTenant(a.tenant, async (tx) => {
    await tx.insert(evidence).values({ id, companyId: a.tenant, entityType, entityId, name, size: file.bytes.length, contentType: file.type, sha256, blobKey, uploadedBy: a.email });
    await record(tx, a.tenant, { actor: a.email, action: "evidence.upload", entityType, entityId, summary: `Added ${name} (${Math.ceil(file.bytes.length / 1024)} KB)`, after: { id, name, size: file.bytes.length, sha256 }, requestId });
  });
  return { ok: true, value: { id, name, size: file.bytes.length, contentType: file.type } };
}

export async function readEvidence(a: Actor, id: string): Promise<Result<{ name: string; contentType: string; bytes: Buffer }>> {
  const row = await withTenant(a.tenant, async (tx) => (await tx.select().from(evidence).where(and(eq(evidence.companyId, a.tenant), eq(evidence.id, id))).limit(1))[0]);
  if (!row) return { ok: false, error: "Not found.", status: 404 };
  if (!(await entityVisible(a, row.entityType, row.entityId, false))) return { ok: false, error: "Not found.", status: 404 };
  const bytes = await getStorage().read(row.blobKey);
  if (!bytes) return { ok: false, error: "The file is missing from storage.", status: 410 };
  return { ok: true, value: { name: row.name, contentType: row.contentType, bytes } };
}
