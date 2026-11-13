// Liveness and the database's state (no secrets): whether it answers, which
// engine, how isolation is enforced and whether any migration is pending.
import { json } from "@/lib/api";
import { migrationStatus } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await migrationStatus();
    return json({ ok: s.pending.length === 0, database: s.kind, isolation: s.isolation, migrations: { applied: s.applied.length, pending: s.pending } });
  } catch (e) {
    return json({ ok: false, database: "unavailable", error: e instanceof Error ? e.message.slice(0, 200) : "error" }, 503);
  }
}
