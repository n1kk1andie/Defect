// The set-up wizard: a new organisation goes from sign-up to its first
// inspection in one step. It names its sector and what it calls its sites,
// adds its locations (one by one or pasted), picks starter checklists and a
// scorecard. Everything is written in one transaction, for this tenant only,
// and recorded in the change history. Admins only; it can be re-run to add
// more (it never removes anything).
import { eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { can, type Actor } from "@/lib/roles";
import { ensureUnits, loadSettings, writeSettings } from "@/lib/company";
import { cleanSettings, plural } from "@/lib/settings";
import { SECTORS, type Sector } from "@/lib/templates/model";
import { libraryEntry } from "@/lib/templates/library";
import { insertTemplate, publishIn } from "@/lib/templates/store";
import { createScorecardIn, } from "@/lib/scorecards/store";
import { scorecards } from "@/lib/db/schema";

export interface SetupInput { sector?: unknown; unitLabel?: unknown; unitPlural?: unknown; groupLabel?: unknown; itemLabel?: unknown; locations?: unknown; templates?: unknown; scorecard?: unknown }

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Parse pasted locations: one per line, "Name, Group" or "Name<TAB>Group"; a header row is skipped. */
export function parseLocations(text: string): { name: string; group: string }[] {
  const out: { name: string; group: string }[] = [];
  const seen = new Set<string>();
  for (const line of String(text || "").split(/\r?\n/)) {
    const [n, g] = line.split(/\t|,|;/).map((x) => clean(x, 80));
    if (!n || /^(name|site|branch|location|ward|campus|office)s?$/i.test(n)) continue;
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push({ name: n, group: g || "" });
  }
  return out.slice(0, 500);
}

export async function applySetup(a: Actor, input: SetupInput, requestId?: string): Promise<{ ok: true; value: { units: number; templates: number; scorecard: boolean } } | { ok: false; error: string; status?: number }> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin sets the organisation up.", status: 403 };
  const sector = (SECTORS as readonly string[]).includes(String(input.sector)) ? (input.sector as Sector) : "general";
  const unitLabel = clean(input.unitLabel, 30) || "Site";
  const raw = Array.isArray(input.locations) ? input.locations : [];
  const locations = raw.map((l: any) => ({ name: clean(l?.name, 80), group: clean(l?.group, 80) })).filter((l) => l.name).slice(0, 500);
  const keys = (Array.isArray(input.templates) ? input.templates : []).map(String).filter((k) => libraryEntry(k)).slice(0, 40);
  const scorecardKey = clean(input.scorecard, 60);
  return withTenant(a.tenant, async (tx) => {
    const before = await loadSettings(tx, a.tenant);
    const next = cleanSettings({ ...before, sector, unitLabel, unitPlural: clean(input.unitPlural, 30) || plural(unitLabel), groupLabel: clean(input.groupLabel, 30) || "Region", itemLabel: clean(input.itemLabel, 30) || before.itemLabel, setupDone: true, scorecard: !!scorecardKey || before.scorecard });
    await writeSettings(tx, a.tenant, next, a.email);
    const ids = await ensureUnits(tx, a.tenant, locations.map((l) => l.name));
    for (const l of locations) if (l.group) await tx.update(units).set({ region: l.group }).where(eq(units.id, ids.get(l.name)!));
    let made = 0;
    for (const k of keys) {
      const e = libraryEntry(k)!;
      const id = await insertTemplate(tx, a.tenant, structuredClone(e.def), `library:${e.key}`, a.email);
      await publishIn(tx, a.tenant, id, a.email, "Added at set-up");
      made++;
    }
    let card = false;
    if (scorecardKey) {
      const c = await createScorecardIn(tx, a.tenant, a.email, { from: "library", libraryKey: scorecardKey }, requestId);
      if (c.ok) {
        const { scorecardVersions } = await import("@/lib/db/schema");
        const { randomUUID } = await import("node:crypto");
        const s = (await tx.select().from(scorecards).where(eq(scorecards.id, c.value)).limit(1))[0];
        await tx.update(scorecards).set({ active: false }).where(eq(scorecards.companyId, a.tenant));
        await tx.insert(scorecardVersions).values({ id: randomUUID(), companyId: a.tenant, scorecardId: c.value, version: 1, definition: s.draft ?? s.definition, publishedBy: a.email });
        await tx.update(scorecards).set({ version: 1, dirty: false, active: true, definition: s.draft ?? s.definition }).where(eq(scorecards.id, c.value));
        card = true;
      }
    }
    await record(tx, a.tenant, {
      actor: a.email, action: "setup.apply", entityType: "company", entityId: a.tenant,
      summary: `Set up as ${sector.replace("_", " ")}: ${locations.length} ${next.unitPlural.toLowerCase()}, ${made} checklists${card ? ", a scorecard" : ""}`,
      before: { sector: before.sector, unitLabel: before.unitLabel }, after: { sector, unitLabel: next.unitLabel, unitPlural: next.unitPlural, groupLabel: next.groupLabel, locations: locations.length, templates: keys, scorecard: scorecardKey || null }, requestId,
    });
    return { ok: true as const, value: { units: locations.length, templates: made, scorecard: card } };
  });
}
