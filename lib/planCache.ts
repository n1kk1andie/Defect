// Keep the company row's copy of its plan up to date (server only). The REST
// API has no platform session, so it reads this copy (lib/apiKeys.ts); every
// verified company session refreshes it, the licence page included, so a
// lapsed plan, and a reinstated one, reach the API on the next visit.
import { sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import type { PlanState } from "@/lib/planStatus";

export async function cachePlan(companyId: string, plan: PlanState): Promise<void> {
  const v = JSON.stringify({ standing: plan.standing, trialEndsAt: plan.trialEndsAt ?? null });
  // A cached copy of the platform's plan, not customer data: never a reason for a backup.
  await withTenant(companyId, (tx) => tx.execute(sql`update companies set plan = ${v}::jsonb, plan_seen_at = now() where company_id = ${companyId} and plan is distinct from ${v}::jsonb`), { backup: false });
}
