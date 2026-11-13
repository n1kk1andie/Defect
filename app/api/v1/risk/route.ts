// Every site's risk score, band, visit frequency and drivers.
import { riskBoard } from "@/lib/riskScore";
import { apiJson, withKey } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withKey(req, "risk:read", async (k) => {
    const b = await riskBoard(k.actor);
    return apiJson({ as_of: b.asOf, cutoffs: b.config.cutoffs, sites: b.sites.map((s) => ({ site_id: s.unitId, site: s.name, group: s.group, score: s.score, band: s.band, change_30_days: s.delta, visit_every_days: s.frequencyDays, drivers: s.drivers.map((d) => ({ key: d.key, label: d.label, detail: d.detail, risk: d.risk, weight: d.weight, contribution: d.contribution })) })) });
  });
}
