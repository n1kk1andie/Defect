// The guarded database route: GET the migration status, POST to apply pending
// migrations now (admins). Migrations also run on their own at first use.
import { actorOr, json } from "@/lib/api";
import { connection, migrate, migrationStatus } from "@/lib/db/client";
import { can } from "@/lib/roles";
import { withTenant } from "@/lib/db/client";
import { record } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return json(await migrationStatus());
}

export async function POST() {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const applied = await migrate((await connection()).db);
  await withTenant(g.actor.tenant, (tx) => record(tx, g.actor.tenant, { actor: g.actor.email, action: "database.migrate", entityType: "database", summary: applied.length ? `Applied ${applied.join(", ")}` : "No migrations pending", requestId: g.requestId }));
  return json({ ...(await migrationStatus()), justApplied: applied });
}
