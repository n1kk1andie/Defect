// Demo-environment support for Pulsus Quality (Branch Defect & Operations
// Standards Tracker).
//
// Everything in this file is INERT in production. A demo deployment is a
// SEPARATE Vercel project (demo-defect) with its own Blob store and its own
// fresh SESSION_SECRET, and it opts in by setting DEMO_MODE=1. Production never
// sets it, so none of this code has any effect there.
//
// Isolation guarantees:
//   • No production data is read or written — the demo store is a new Blob store
//     bound only to the demo project.
//   • A fresh SESSION_SECRET means a demo cannot mint or read production
//     sessions even in principle.
//   • Every real-data path (real branch roster, real company email domain, the
//     bundled VMBS seed workbooks) is swapped for a fully fictional variant when
//     isDemo() — see buildDemoDataset() below, lib/data.ts and lib/msauth.ts.
//
// The fictional tenant is "Meridian Building Society". Pulsus product branding
// is unchanged; only the *customer* identity and data are fictional. Kept in
// step with cash/lib/server/demo.ts and Ops/lib/demo.ts.

import type { Role } from "./auth";
import seedDefects from "./seed-defects.json";
import seedOpstd from "./seed-opstd.json";
import type { Dataset } from "./xlsx";

/** True only in a demo deployment (DEMO_MODE=1). Production never sets this. */
export function isDemo(): boolean {
  return (process.env.DEMO_MODE || "").trim() === "1";
}

/**
 * Hard guard for any demo seeding operation. Throws unless DEMO_MODE=1. This app
 * addresses Blob by fixed keys (no single STORAGE_BLOB name to namespace), so
 * isolation is provided by the demo being a distinct Vercel project + Blob store
 * + SESSION_SECRET rather than by a key prefix — the isDemo() gate is what keeps
 * seeding out of production.
 */
export function assertDemoSafe(): void {
  if (!isDemo()) {
    throw new Error("Refusing: DEMO_MODE is not enabled (this is not a demo deployment).");
  }
}

/** The fictional institution the demo tenant represents. */
export const DEMO_INSTITUTION = "Meridian Building Society";
export const DEMO_DOMAIN = "demo.pulsus.tech";

/** The shared demo password. Overridable via env for a private demo. */
export function demoPassword(): string {
  return (process.env.DEMO_PASSWORD || "PulsusDemo!2026").trim();
}

/** Fictional branches — replace the real VMBS roster in demo mode. */
export const DEMO_BRANCHES = ["Harbour", "Riverside", "Parkway", "Summit", "Crossroads", "Gateway"];

/** The fictional demo supervisor(s) for SSO role resolution (see lib/msauth.ts). */
export const DEMO_SUPERVISOR_EMAILS = [`supervisor@${DEMO_DOMAIN}`];

export interface DemoUserDef {
  username: string;
  name: string;
  role: Role;
  branch: string | null;
  password: string;
}

/** Named demo accounts seeded into accounts.json (one write). Usernames obey the
 *  account rule /^[a-z0-9._-]{2,32}$/, so they are role handles, not emails —
 *  "admin" is reserved and stays the built-in admin login. Sign in from the
 *  in-app gear with these + the demo password to show each role's screens. */
export function demoUsers(): DemoUserDef[] {
  const pw = demoPassword();
  return [
    { username: "supervisor", name: "Jordan Blake", role: "supervisor", branch: null, password: pw },
    { username: "inspector", name: "Sam Foster", role: "inspector", branch: DEMO_BRANCHES[0], password: pw },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fictional dataset builder.
//
// The real seed JSON (lib/seed-defects.json / seed-opstd.json) carries the 16
// REAL VMBS branch names and real defect / operational figures. In demo mode we
// never serve them: buildDemoDataset() returns the SAME shape (so the engine and
// export render identically) but with the 6 fictional branches and deterministic,
// obviously-synthetic numbers. Periods, process-area names and metric labels are
// generic (not tenant-identifying) and are reused for realism; meta.source is
// replaced so the real workbook filenames never leak.
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) so a demo build is stable across reseeds. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const round2 = (n: number) => Math.round(n * 100) / 100;

function buildDemoDefects() {
  const periods: string[] = (seedDefects as any).periods;
  const areas: string[] = (seedDefects as any).areas;
  const columns: string[] = (seedDefects as any).meta.columns;
  const branches = DEMO_BRANCHES;
  const rows: number[][] = [];
  for (let pi = 0; pi < periods.length; pi++) {
    for (let bi = 0; bi < branches.length; bi++) {
      for (let ai = 0; ai < areas.length; ai++) {
        const r = rng(pi * 100000 + bi * 1000 + ai * 7 + 11);
        const reviewed = Math.round(between(r, 12, 40));
        const instances = reviewed * Math.round(between(r, 14, 24));
        // Mostly low defect rates, with the occasional elevated month for variety.
        const rate = r() < 0.15 ? between(r, 0.05, 0.11) : between(r, 0.004, 0.05);
        const defects = Math.round(instances * rate);
        const resolvable = defects;
        const resolved = Math.round(defects * between(r, 0.7, 1));
        const recurring = Math.round(defects * between(r, 0, 0.2));
        rows.push([pi, bi, ai, reviewed, instances, defects, resolvable, resolved, recurring]);
      }
    }
  }
  return {
    meta: {
      source: "demo-branch-defects.xlsx",
      columns,
      note: "Fully fictional demo dataset for Meridian Building Society. Percentages are recomputed from raw counts in-app.",
    },
    periods,
    branches,
    areas,
    rows,
  };
}

function buildDemoOpstd() {
  const periods: string[] = (seedOpstd as any).periods;
  const metrics = (seedOpstd as any).metrics;
  const columns: string[] = (seedOpstd as any).meta.columns;
  const branches = DEMO_BRANCHES;
  const rows: (number | null)[][] = [];
  const auditRaw: (number | null)[] = [];
  for (let pi = 0; pi < periods.length; pi++) {
    const year = Number(String(periods[pi]).slice(0, 4));
    for (let bi = 0; bi < branches.length; bi++) {
      const r = rng(pi * 100000 + bi * 1000 + 53);
      const score = round2(between(r, 78, 99));
      const avgSla = round2(between(r, 80, 100));
      const queueSla = round2(between(r, 85, 100));
      const onboarding = round2(between(r, 80, 100));
      const procurement = round2(between(r, 60, 96));
      const majorProc = round2(between(r, 75, 100));
      const avgProc = round2(between(r, 72, 99));
      const complaints = round2(between(r, 70, 100));
      const auditResolution = round2(between(r, 60, 100));
      rows.push([pi, bi, score, avgSla, queueSla, onboarding, procurement, majorProc, avgProc, complaints, auditResolution]);
      // 2024 used a 1–5 audit scale; 2025+ used 20/40/60/80/100. Skew high.
      if (year <= 2024) auditRaw.push([4, 5, 5, 4, 3][Math.floor(r() * 5)]);
      else auditRaw.push([100, 80, 100, 60, 80][Math.floor(r() * 5)]);
    }
  }
  return {
    meta: {
      source: "demo-operational-standards.xlsx",
      columns,
      note: "Fully fictional demo dataset for Meridian Building Society. 0–100 performance scores; higher is better.",
      auditGradeMap: (seedOpstd as any).meta.auditGradeMap,
    },
    metrics,
    periods,
    branches,
    rows,
    auditRaw,
  };
}

/** The fictional dataset for a demo deployment — mirrors the bundled seed's shape
 *  so the engine, upload-merge and export all work unchanged. */
export function buildDemoDataset(type: Dataset): any {
  return type === "defects" ? buildDemoDefects() : buildDemoOpstd();
}
