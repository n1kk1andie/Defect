// Everything a screen shares, loaded once on the server per navigation and
// refreshed after a change: who you are, the company's dataset, settings,
// programme, people and the counts behind the navigation badges.
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getActor } from "@/lib/session";
import { withTenant, rowsOf } from "@/lib/db/client";
import { buildDataset } from "@/lib/dataset";
import { loadProgram, loadSettings } from "@/lib/company";
import { members } from "@/lib/db/schema";
import { can, isSupervisor } from "@/lib/roles";
import { platformUrl } from "@/lib/platform-jwt";
import { ensureDemoSeeded } from "@/lib/demo/seed";
import { AppProvider, type Boot } from "@/components/app-context";
import { Shell } from "@/components/Shell";
import { NoAccess } from "@/components/NoAccess";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const demo = (process.env.DEMO_MODE || "").trim() === "1";
  if (demo) await ensureDemoSeeded();
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!can.view(actor)) return <NoAccess email={actor.email} company={actor.tenantName} />;
  const boot = await withTenant(actor.tenant, async (tx): Promise<Boot> => {
    const settings = await loadSettings(tx, actor.tenant);
    const [data, program, people, c] = await Promise.all([
      buildDataset(tx, actor.tenant, settings),
      loadProgram(tx, actor.tenant),
      isSupervisor(actor) ? tx.select({ email: members.email, name: members.name, roles: members.roles }).from(members).where(and(eq(members.companyId, actor.tenant), eq(members.status, "active"))) : Promise.resolve([]),
      tx.execute(sql`select
        (select count(*) from reviews where status = 'submitted' and inspector_email <> ${actor.email})::int as approvals,
        (select count(*) from reviews where status in ('draft','returned') and inspector_email = ${actor.email})::int as drafts,
        (select count(*) from actions where status <> 'closed')::int as open,
        (select count(*) from actions where status <> 'closed' and due_date < current_date)::int as overdue,
        (select count(*) from actions a where status = 'awaiting_verification' and raised_by <> ${actor.email} and coalesce(owner_email,'') <> ${actor.email}
           and coalesce((select e.by from action_events e where e.action_id = a.id and e.status = 'awaiting_verification' order by e.at desc limit 1),'') <> ${actor.email})::int as verify`),
    ]);
    const n = rowsOf<{ approvals: number; drafts: number; open: number; overdue: number; verify: number }>(c)[0];
    // Someone scoped to some units sees only those units' figures.
    if (actor.unitIds.length) {
      const keep = new Set(data.units.map((u, i) => (actor.unitIds.includes(u.id) ? i : -1)).filter((i) => i >= 0));
      data.rows = data.rows.filter((r) => keep.has(r[1]));
      data.natureRows = data.natureRows.filter((r) => keep.has(r[1]));
      if (data.scorecard) data.scorecard = { ...data.scorecard, rows: data.scorecard.rows.filter((r) => keep.has(r[1] as number)), auditRaw: data.scorecard.auditRaw.filter((_, i) => keep.has(data.scorecard!.rows[i][1] as number)) };
    }
    const hub = platformUrl();
    return {
      actor, data, settings, program,
      people: people.map((p) => ({ email: p.email, name: p.name, roles: p.roles })),
      counts: {
        awaitingApproval: isSupervisor(actor) ? Number(n?.approvals ?? 0) : 0, myDrafts: Number(n?.drafts ?? 0),
        openActions: Number(n?.open ?? 0), overdue: Number(n?.overdue ?? 0), awaitingVerification: isSupervisor(actor) ? Number(n?.verify ?? 0) : 0,
      },
      demo, platformUrl: hub, billingUrl: `${hub}/company#billing`, now: new Date().toISOString(),
    };
  });
  return (
    <AppProvider boot={boot}>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
