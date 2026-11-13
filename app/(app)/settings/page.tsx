import { and, asc, eq } from "drizzle-orm";
import { getActor } from "@/lib/session";
import { listMembers } from "@/lib/company";
import { history, historyCount } from "@/lib/audit";
import { latestImports, legacyAvailable } from "@/lib/migrator";
import { outbox } from "@/lib/riskLink";
import { migrationStatus, withTenant } from "@/lib/db/client";
import { scorecards } from "@/lib/db/schema";
import { can } from "@/lib/roles";
import { listKeys } from "@/lib/apiKeys";
import { listWebhooks } from "@/lib/webhooks";
import { emailConfigured } from "@/lib/reportBuilder";
import { turnstileSiteKey } from "@/lib/issues";
import { Settings } from "@/components/screens/Settings";
import type { ScorecardDef } from "@/lib/scorecard";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = (await getActor())!;
  const admin = can.manage(actor);
  const [members, hist, count, imports, box, db, legacy, card] = await Promise.all([
    listMembers(actor.tenant),
    admin ? history(actor.tenant, { limit: 150 }) : history(actor.tenant, { limit: 50, entityType: "settings" }),
    historyCount(actor.tenant),
    admin ? latestImports(actor.tenant) : Promise.resolve([]),
    outbox(actor.tenant),
    admin ? migrationStatus() : Promise.resolve(null),
    admin ? legacyAvailable(actor.tenant).catch(() => false) : Promise.resolve(false),
    withTenant(actor.tenant, async (tx) => (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, actor.tenant), eq(scorecards.active, true))).orderBy(asc(scorecards.createdAt)).limit(1))[0]),
  ]);
  const keys = admin ? (await listKeys(actor)).filter((k) => k.state !== "revoked" && k.state !== "expired").length : 0;
  const hooks = admin ? (await listWebhooks(actor)).length : 0;
  const automation = { keys, webhooks: hooks, email: emailConfigured(), turnstile: !!turnstileSiteKey() && !!(process.env.TURNSTILE_SECRET_KEY || "").trim(), cron: !!(process.env.CRON_SECRET || "").trim() };
  return <Settings s={{ members, history: hist, historyCount: count, imports, outbox: box, automation, database: db, legacyAvailable: legacy, scorecard: card ? (card.definition as ScorecardDef) : null, riskConnected: !!(process.env.RISK_INTAKE_URL || "").trim() }} />;
}
