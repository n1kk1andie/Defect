// Bulk import (admins): { kind: locations | people | actions, rows: [{ field: value }], commit?: true, mapping?: { field: column heading } } — the mapping is saved for next time on commit..
import { actorOr, body, result } from "@/lib/api";
import { BULK_KINDS, commitBulk, previewBulk, type BulkKind } from "@/lib/bulk";
import { can } from "@/lib/roles";
import { demoReadOnly, demoReadOnlyResponse } from "@/lib/demoReadOnly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  const kind = BULK_KINDS.find((k) => k === b.kind) as BulkKind | undefined;
  if (!kind) return result({ ok: false, error: "Choose what to import.", status: 400 });
  // A read-only demo (lib/demoReadOnly.ts): the preview saves nothing and stays open; the import is refused.
  if (b.commit === true && (process.env.DEMO_MODE || "").trim() === "1" && (await demoReadOnly())) return demoReadOnlyResponse();
  if (b.commit === true) return result(await commitBulk(g.actor, kind, b.rows, g.requestId, b.mapping), (done) => ({ done }));
  return result(await previewBulk(g.actor, kind, b.rows), (preview) => ({ preview }));
}
