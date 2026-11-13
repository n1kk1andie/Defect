// Demo stand-in for institution/data.ts. A demo build (DEMO_MODE=1) and the
// tests never load the owner institution's bundled history: its datasets are
// empty here, and the demo's fictional Meridian Financial Group history is generated
// by lib/demo/seed.ts instead.
export const seedDefects = { meta: { source: "", columns: [] as string[] }, periods: [] as string[], branches: [] as string[], areas: [] as string[], rows: [] as number[][] };
export const seedOpstd = { meta: { source: "", columns: [] as string[] }, metrics: [] as { key: string; label: string }[], periods: [] as string[], branches: [] as string[], rows: [] as (number | null)[][], auditRaw: [] as (number | null)[] };
