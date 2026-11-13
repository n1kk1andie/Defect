// The summary Pulsus Platform's brief and Quality driver read (GET /api/pulse,
// under the suite's service grant for "quality.pulse"). Documented for the
// platform in docs/platform-feed.md.
import { sql } from "drizzle-orm";
import { rowsOf, withTenant } from "@/lib/db/client";
import { buildDataset } from "@/lib/dataset";
import { loadSettings } from "@/lib/company";
import { byUnit, lastActive, record, filterRows, recurringIssues, scLastActive, scMean, scRows, ALL } from "@/lib/metrics";
import { classify } from "@/lib/bands";
import { inspectionsBlock } from "@/lib/pulseInspections";

export async function pulseFor(companyId: string) {
  const base = await withTenant(companyId, async (tx) => {
    const settings = await loadSettings(tx, companyId);
    const d = await buildDataset(tx, companyId, settings);
    const li = lastActive(d);
    const month = li >= 0 ? d.periods[li] : null;
    const f = { ...ALL, period: li >= 0 ? li : undefined };
    const rec = record(li >= 0 ? filterRows(d, f) : []);
    const bands = settings.bands;
    const below = li >= 0 ? byUnit(d, f).filter((u) => { const b = classify("defectRate", u.rec.defectRate, bands); return b === "watch" || b === "attention" || b === "escalate"; }) : [];
    const sc = d.scorecard;
    const sli = sc ? scLastActive(sc) : -1;
    const opStd = sc && sli >= 0 ? scMean(scRows(sc, { ...ALL, period: sli }), 0) : null;
    const a = rowsOf<{ open: string; overdue: string; awaiting: string }>(await tx.execute(sql`
      select count(*) filter (where status <> 'closed')::text as open,
             count(*) filter (where status <> 'closed' and due_date < current_date)::text as overdue,
             count(*) filter (where status = 'awaiting_verification')::text as awaiting
      from actions`))[0];
    return {
      ok: true,
      app: "quality",
      schema: "pulsus.quality.pulse/v1",
      generatedAt: new Date().toISOString(),
      period: month ? month.slice(0, 7) : null,
      defectRate: { value: rec.defectRate, band: classify("defectRate", rec.defectRate, bands), defects: rec.defects, instances: rec.instances, itemsReviewed: rec.reviewed },
      resolutionRate: { value: rec.resolutionRate, band: classify("resolutionRate", rec.resolutionRate, bands) },
      recurringRate: { value: rec.recurringRate, band: classify("recurringRate", rec.recurringRate, bands) },
      operationalStandard: sc ? { value: opStd, band: classify("opStandard", opStd, bands), period: sli >= 0 ? sc.periods[sli].slice(0, 7) : null, name: sc.name } : null,
      unitsBelowStandard: below.map((u) => ({ name: u.name, defectRate: u.rec.defectRate, band: classify("defectRate", u.rec.defectRate, bands) })),
      actions: { open: Number(a?.open ?? 0), overdue: Number(a?.overdue ?? 0), awaitingVerification: Number(a?.awaiting ?? 0) },
      recurringIssues: recurringIssues(d, settings.recurringMonths).length,
    };
  });
  return { ...base, inspections: await inspectionsBlock(companyId) };
}
