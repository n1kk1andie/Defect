// Shared test helpers: an in-memory database per test file and actors.
process.env.PGLITE_MEMORY = "1";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "pq-blob-"));

export function actor(tenant, email, roles, extra = {}) {
  return { tenant, tenantName: tenant, kind: tenant === "_own" ? "institution" : "company", email, name: email.split("@")[0], roles, unitIds: [], platformRole: "editor", operator: false, plan: null, ...extra };
}

/** A company with two units, one area and a three-check checklist. */
export async function setupCompany(id) {
  const { withTenant } = await import("@/lib/db/client");
  const { ensureCompany, ensureUnits, ensureAreas, setAreaChecklist, writeSettings } = await import("@/lib/company");
  const { cleanSettings } = await import("@/lib/settings");
  return withTenant(id, async (tx) => {
    await ensureCompany(tx, id, id, "company");
    await writeSettings(tx, id, cleanSettings({ instanceBasis: "check" }), "test");
    const u = await ensureUnits(tx, id, ["Harbour", "Summit"]);
    const a = await ensureAreas(tx, id, ["Payments"]);
    await setAreaChecklist(tx, id, a.get("Payments"), [{ code: "dual", label: "Dual authorisation", severity: "critical" }, { code: "purpose", label: "Purpose recorded", severity: "major" }, { code: "receipt", label: "Receipt issued", severity: "minor" }], [{ label: "Missing approval", category: "Process" }]);
    return { harbour: u.get("Harbour"), summit: u.get("Summit"), payments: a.get("Payments") };
  });
}
