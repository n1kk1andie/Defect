// Switch on a scorecard from a template (the Operational Standard is the first).
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { actorOr, body, json } from "@/lib/api";
import { withTenant } from "@/lib/db/client";
import { scorecards } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { BRANCH_STANDARDS, OPERATIONAL_STANDARD } from "@/lib/scorecard";
import { can } from "@/lib/roles";
import { loadSettings, writeSettings } from "@/lib/company";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  const def = b.template === "operational-standard" ? OPERATIONAL_STANDARD : b.template === "branch-standards" ? BRANCH_STANDARDS : null;
  if (!def) return json({ error: "Choose a template." }, 400);
  const a = g.actor;
  await withTenant(a.tenant, async (tx) => {
    await tx.update(scorecards).set({ active: false }).where(and(eq(scorecards.companyId, a.tenant), eq(scorecards.active, true)));
    const id = randomUUID();
    await tx.insert(scorecards).values({ id, companyId: a.tenant, name: def.name, definition: def, createdBy: a.email });
    const s = await loadSettings(tx, a.tenant);
    await writeSettings(tx, a.tenant, { ...s, scorecard: true }, a.email);
    await record(tx, a.tenant, { actor: a.email, action: "scorecard.enable", entityType: "scorecard", entityId: id, summary: `Started the ${def.name} scorecard from its template`, after: { name: def.name, measures: def.measures.length }, requestId: g.requestId });
  });
  return json({ ok: true });
}
