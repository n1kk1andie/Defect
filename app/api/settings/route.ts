// Company settings an admin changes: labels, colour bands, recurring rule.
// Every change is recorded with before → after.
import { actorOr, body, json } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/company";
import { FAMILIES, validateCutoffs, type BandOverrides, type FamilyKey } from "@/lib/bands";
import { can } from "@/lib/roles";
import type { CompanySettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ settings: await getSettings(g.actor.tenant) });
}

export async function PATCH(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  const patch: Partial<CompanySettings> = {};
  const what: string[] = [];
  for (const k of ["unitLabel", "unitPlural", "itemLabel", "itemTypes", "recurringMonths", "severityWeights", "instanceBasis"] as const) {
    if (b[k] !== undefined) { (patch as Record<string, unknown>)[k] = b[k]; what.push(k); }
  }
  if (typeof b.emailAlerts === "boolean") { patch.emailAlerts = b.emailAlerts; what.push(`daily email ${b.emailAlerts ? "on" : "off"}`); }
  if (b.bands && typeof b.bands === "object") {
    const current = (await getSettings(g.actor.tenant)).bands;
    const next: BandOverrides = { ...current };
    for (const [k, v] of Object.entries(b.bands as Record<string, unknown>)) {
      if (!FAMILIES.some((f) => f.key === k)) continue;
      if (v === null) { delete next[k as FamilyKey]; what.push(`${k} bands reset to default`); continue; }
      const r = validateCutoffs(k as FamilyKey, v);
      if (!r.ok) return json({ error: r.error }, 400);
      next[k as FamilyKey] = r.cutoffs; what.push(`${k} bands`);
    }
    patch.bands = next;
  }
  if (!what.length) return json({ error: "Nothing to change." }, 400);
  const settings = await updateSettings(g.actor, patch, `Changed ${what.join(", ")}`, g.requestId);
  return json({ settings });
}
