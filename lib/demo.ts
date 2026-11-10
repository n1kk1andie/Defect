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
//     bundled history workbooks) is swapped for a fully fictional variant when
//     isDemo() — see buildDemoDataset() below, lib/data.ts and lib/msauth.ts.
//
// The fictional tenant is "Meridian Society". Pulsus product branding
// is unchanged; only the *customer* identity and data are fictional. Kept in
// step with cash/lib/server/demo.ts and Ops/lib/demo.ts.

// THE SHARED DEMO WORLD — every Pulsus demo is the same fictional institution,
// Meridian Society, because a visitor moves between apps from the
// Command Center. Take names from the canon rather than inventing new ones:
//
//   Branches  Harbour · Riverside · Parkway · Summit · Crossroads · Gateway
//   People    Alex Morgan (admin, everywhere) · Taylor Reid · Jordan Blake
//             Sam Foster · Robin Ellis · Sam Quinn · Riley Chen · Drew Salazar
//   Domain    demo.pulsus.tech        Refs  MS-…
//
// The full reference, including the three org axes and what NOT to reuse, is
// DEMO-WORLD.md in the Command Center repo (Ops).

import type { Role } from "./auth";
import { demoNamespacingActive } from "./storage";
// Shape only (periods, process areas, metric labels, columns). In a demo build
// "@/institution/data" resolves to demo-institution/data.ts (next.config.mjs).
import { seedDefects, seedOpstd } from "@/institution/data";
import type { Dataset } from "./xlsx";

/** True only in a demo deployment (DEMO_MODE=1). Production never sets this. */
export function isDemo(): boolean {
  return (process.env.DEMO_MODE || "").trim() === "1";
}

/**
 * Hard guard for any demo seeding operation. Throws unless DEMO_MODE=1 AND demo
 * key namespacing is in force.
 *
 * The note that used to sit here said this app "addresses Blob by fixed keys (no
 * single STORAGE_BLOB name to namespace)", and concluded that being a distinct
 * project + store + secret was isolation enough. Fixed keys were the reason to
 * namespace, not a reason not to: they are production's keys exactly, so a demo
 * project handed a production Blob token wrote straight onto live data, and the
 * only thing standing in the way was that the token had been set correctly by
 * hand. lib/storage.ts now prefixes every key with "demo/" instead.
 */
export function assertDemoSafe(): void {
  if (!isDemo()) {
    throw new Error("Refusing: DEMO_MODE is not enabled (this is not a demo deployment).");
  }
  // A Vercel deployment that INHERITS another project's environment must never
  // seed. A branch preview of the production project carries production's
  // BLOB_READ_WRITE_TOKEN, and this app's demo writes to the same storage keys
  // production reads — so DEMO_MODE=1 on such a preview would overwrite live
  // data. VERCEL_ENV is "production" on a dedicated demo project's own
  // deployment and "preview" on a branch build, which is exactly the line.
  if ((process.env.VERCEL_ENV || "").trim() === "preview") {
    throw new Error(
      "Refusing: this is a PREVIEW deployment, which inherits its project's " +
      "environment — including the blob token of whatever project it belongs to. " +
      "Seed only from a dedicated demo project's own deployment.",
    );
  }
  if (!demoNamespacingActive()) {
    throw new Error(
      "Refusing: demo key namespacing is not in effect, so a write could land on " +
        "a production key. Check storageKey() in lib/storage.ts.",
    );
  }
}

/** The fictional institution the demo tenant represents. */
export const DEMO_INSTITUTION = "Meridian Society";
export const DEMO_DOMAIN = "demo.pulsus.tech";

/** The shared demo password. Overridable via env for a private demo. */
export function demoPassword(): string {
  // .trim() alone is not enough. A value pasted into a Vercel environment
  // variable often arrives WRAPPED IN QUOTES, and a quoted password is a
  // different string from the one a person types — so the variable looks
  // correct on the dashboard while every sign-in is rejected. Three apps in
  // the suite already stripped quotes here (ASU, Talent, Communique); the
  // rest did not, which is why a demo password could work in one app and
  // fail in another with the same variable set.
  return (process.env.DEMO_PASSWORD || "").trim().replace(/^["']+|["']+$/g, "").trim()
    || "PulsusDemo!2026";
}

/** Fictional branches — the demo's roster. */
export const DEMO_BRANCHES = ["Harbour", "Riverside", "Parkway", "Summit", "Crossroads", "Gateway"];

/** The fictional demo supervisor(s) for SSO role resolution (see lib/msauth.ts). */
export const DEMO_SUPERVISOR_EMAILS = [`supervisor@${DEMO_DOMAIN}`];

/**
 * The universal demo administrator — the one address that is admin in every
 * Pulsus demo app, so a walkthrough never changes credentials mid-flow.
 *
 * This app signs in by USERNAME, not email, and already has a built-in "admin"
 * login. Rather than invent a parallel account, checkLogin() accepts this
 * address as a synonym for "admin" in demo mode (see lib/auth.ts), so the same
 * string a visitor types into every other Pulsus demo also works here.
 */
export function demoAdminEmail(): string {
  return `admin@${DEMO_DOMAIN}`;
}

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
// The own institution's history (institution/seed-*.json) is never compiled into
// a demo build; "@/institution/data" there is a shape-only stand-in
// (demo-institution/). buildDemoDataset() returns the SAME shape (so the engine and
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

/** Summit's index in DEMO_BRANCHES, and the period its decline begins — see the
 *  note in buildDemoDefects. Resolved from the data so a reordering cannot leave
 *  the story pointing at the wrong branch. */
const SUMMIT = DEMO_BRANCHES.indexOf("Summit");
const APR_2026 = ((seedDefects as any).periods as string[]).indexOf("2026-04-01");
const JAN_2026 = ((seedDefects as any).periods as string[]).indexOf("2026-01-01");

/** Summit's error rate (failed checks / checks) by month of 2026, from the shared
 *  story (DEMO-WORLD.md): ~3% to March, 11% when the UPS failed in April, eased
 *  by treatment from August, back to 3.6% in October. */
const SUMMIT_ERROR_2026: Record<string, number> = {
  "2026-01-01": 0.030, "2026-02-01": 0.031, "2026-03-01": 0.029, "2026-04-01": 0.110,
  "2026-05-01": 0.105, "2026-06-01": 0.100, "2026-07-01": 0.098, "2026-08-01": 0.080,
  "2026-09-01": 0.050, "2026-10-01": 0.036,
};
/** Share of Summit's defects resolved in the month: low while the branch ran on
 *  manual fallbacks, recovering once the UPS was replaced (9 Sep). */
const SUMMIT_RESOLVED_2026: Record<string, [number, number]> = {
  "2026-04-01": [0.45, 0.7], "2026-05-01": [0.45, 0.7], "2026-06-01": [0.45, 0.7], "2026-07-01": [0.45, 0.7],
  "2026-08-01": [0.6, 0.8], "2026-09-01": [0.72, 0.92], "2026-10-01": [0.8, 1],
};

/**
 * Bump whenever the fictional dataset changes shape or figures. It is stamped
 * into each demo payload's meta, and lib/data.ts ignores (in demo mode only) a
 * stored copy that carries a different stamp — so a demo store holding an older
 * build's payload serves the current figures instead of freezing the old ones.
 */
export const DEMO_SEED_VERSION = 4;

/** The demo's last month of data — the month of the demo's locked date
 *  (lib/asOf.ts, 30 Oct 2026). The seed shapes stop at May 2026 (opstd) / list
 *  months to Dec 2026 (defects); the demo runs through October 2026 so the
 *  Command Center's history has no blank Quality months, and lists nothing
 *  after it, so "Latest data" reads October 2026. */
const DEMO_LAST_PERIOD = "2026-10-01";

/** Monthly periods from the seed's list, extended (first-of-month ISO strings)
 *  through DEMO_LAST_PERIOD. Existing periods keep their indices, so every
 *  pre-existing demo figure is unchanged. */
function demoPeriods(seedPeriods: string[]): string[] {
  const out = seedPeriods.slice();
  let [y, m] = out[out.length - 1].split("-").map(Number);
  while (out[out.length - 1] < DEMO_LAST_PERIOD) {
    m += 1; if (m > 12) { m = 1; y += 1; }
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
  }
  return out;
}

/**
 * Operational Standard Score from April 2026: the network mean each month, and
 * how far Summit sits below it. The other five branches hold steady; Summit
 * trails from the April power failure and closes the gap once treated
 * (see buildDemoDefects and DEMO-WORLD.md).
 */
const OPSTD_STORY: Record<string, { mean: number; summitGap: number; summitSla: number }> = {
  "2026-04-01": { mean: 86.9, summitGap: -11, summitSla: 80 },
  "2026-05-01": { mean: 86.7, summitGap: -11, summitSla: 78 },
  "2026-06-01": { mean: 86.8, summitGap: -10, summitSla: 82 },
  "2026-07-01": { mean: 86.6, summitGap: -10, summitSla: 83 },
  "2026-08-01": { mean: 87.4, summitGap: -6, summitSla: 91 },
  "2026-09-01": { mean: 88.1, summitGap: -3, summitSla: 96 },
  "2026-10-01": { mean: 88.4, summitGap: -1, summitSla: 98 },
};

function buildDemoDefects() {
  // Months after the demo's last month are not listed at all: the demo is
  // locked to 30 Oct 2026, so November onwards has not happened yet. (The seed
  // shape lists months to Dec 2026; they sit at the end, so trimming them leaves
  // every earlier period index — and so every figure — unchanged.)
  const periods: string[] = ((seedDefects as any).periods as string[]).filter((p) => p <= DEMO_LAST_PERIOD);
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
        //
        // 2026 follows the shared story (DEMO-WORLD.md). The branch lost power on
        // 8 April (Pulsus Tech records the UPS failure) and fell back to manual
        // processing across every area, so its error rate steps up and its
        // resolution rate drops — the same branch Recon shows unexplained breaks
        // at, and Risk has two overdue findings against. Treatment from August
        // brings it back by October. The other branches stay steady near 3%.
        // A demo should show one story from several angles, not six unrelated
        // sets of noise.
        const in2026 = pi >= JAN_2026;
        const story = bi === SUMMIT ? SUMMIT_ERROR_2026[periods[pi]] : undefined;
        const degraded = bi === SUMMIT && pi >= APR_2026 && pi < APR_2026 + 4;
        const band = SUMMIT_RESOLVED_2026[periods[pi]];
        const rate = story != null
          ? story * between(r, 0.9, 1.1)
          : in2026 ? between(r, 0.022, 0.038)
          : r() < 0.15 ? between(r, 0.05, 0.11) : between(r, 0.004, 0.05);
        const defects = Math.round(instances * rate);
        const resolvable = defects;
        const resolved = Math.round(defects * (bi === SUMMIT && band ? between(r, band[0], band[1]) : between(r, 0.7, 1)));
        const recurring = Math.round(defects * (degraded ? between(r, 0.15, 0.35) : between(r, 0, 0.2)));
        rows.push([pi, bi, ai, reviewed, instances, defects, resolvable, resolved, recurring]);
      }
    }
  }
  return {
    meta: {
      source: "demo-branch-defects.xlsx",
      demoSeedVersion: DEMO_SEED_VERSION,
      columns,
      note: "Fully fictional demo dataset for Meridian Society. Percentages are recomputed from raw counts in-app.",
    },
    periods,
    branches,
    areas,
    rows,
  };
}

function buildDemoOpstd() {
  const periods: string[] = demoPeriods((seedOpstd as any).periods);
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
    // From April 2026: reshape the month's scores so the branch mean lands on
    // the story's figure, Summit trailing by the story's gap, its service levels
    // at the counter's, and its audit resolution held down while two audit
    // actions were overdue (May to August).
    const story = OPSTD_STORY[periods[pi]];
    if (story) {
      const month = rows.slice(rows.length - branches.length);
      const spread = rng(pi * 7919 + 3);
      const raw = month.map((row, bi) => bi === SUMMIT ? story.summitGap : (spread() - 0.5) * 6);
      const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
      month.forEach((row, bi) => {
        row[2] = round2(Math.min(99, Math.max(55, story.mean + raw[bi] - mean)));
        if (bi !== SUMMIT) return;
        row[3] = round2(story.summitSla + spread() * 2);
        row[4] = round2(Math.min(100, story.summitSla + 2 + spread() * 2));
        const p = periods[pi];
        if (p >= "2026-05-01" && p <= "2026-08-01") row[10] = round2(Math.min(row[10] as number, 62 + spread() * 8));
        else if (p === "2026-09-01") row[10] = round2(78 + spread() * 8);
        if (p <= "2026-08-01") row[9] = round2(70 + spread() * 8); // complaints piled up during the outage
      });
    }
  }
  return {
    meta: {
      source: "demo-operational-standards.xlsx",
      demoSeedVersion: DEMO_SEED_VERSION,
      columns,
      note: "Fully fictional demo dataset for Meridian Society. 0–100 performance scores; higher is better.",
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
