// Who counts for change-triggered backups. Pure: no database, no Blob.
//
// A demo deployment (DEMO_MODE=1) never marks or backs anything up, and neither
// does a demo company (the demo's fictional tenants: _demo and demo-*), so demo
// data never costs a backup run. Everything else is real customer data.
const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/^["']+|["']+$/g, "").trim() : "");

export const isDemoMode = () => clean(process.env.DEMO_MODE) === "1";
export const isDemoCompany = (companyId: string) => companyId === "_demo" || companyId.startsWith("demo-");
/** Does a write for this company mark it for backup? */
export const tracksChanges = (companyId: string) => !isDemoMode() && !isDemoCompany(companyId);

/** At most one change-triggered backup per company per this long. */
export const BACKUP_THROTTLE_MS = 15 * 60_000;
