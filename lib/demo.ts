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

/**
 * Bump whenever the fictional dataset changes shape or figures. It is stamped
 * into each demo payload's meta, and lib/data.ts ignores (in demo mode only) a
 * stored copy that carries a different stamp — so a demo store holding an older
 * build's payload serves the current figures instead of freezing the old ones.
 */
export const DEMO_SEED_VERSION = 3;

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
 * Operational Standard Score targets (mean across branches) for the months
 * appended after the bundled seed ends. A gentle autumn drift down from the
 * mid/high 80s of early 2026 — led by Summit, which never recovered from the
 * April power failure (see buildDemoDefects).
 */
const OPSTD_EXTENSION_TARGETS: Record<string, number> = {
  "2026-06-01": 86.4,
  "2026-07-01": 85.1,
  "2026-08-01": 83.6,
  "2026-09-01": 82.2,
  "2026-10-01": 80.7,
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
        // Except at Summit from April 2026. The branch lost power on 8 April
        // (Pulsus Tech records the UPS failure) and fell back to manual
        // processing across every area; the fallbacks were never withdrawn. So
        // its defect rate steps up and its resolution rate drops from that month
        // on — the same branch Cash shows an unreconciled till at, and Risk has
        // two overdue findings against. A demo should show one story from several
        // angles, not six unrelated sets of noise.
        const degraded = bi === SUMMIT && pi >= APR_2026;
        const rate = degraded
          ? between(r, 0.07, 0.14)
          : r() < 0.15 ? between(r, 0.05, 0.11) : between(r, 0.004, 0.05);
        const defects = Math.round(instances * rate);
        const resolvable = defects;
        const resolved = Math.round(defects * (degraded ? between(r, 0.45, 0.7) : between(r, 0.7, 1)));
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
  const seedPeriodCount = ((seedOpstd as any).periods as string[]).length;
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
    // Months appended beyond the bundled seed: reshape this month's scores so
    // the branch mean lands on its target, with Summit trailing the network.
    if (pi >= seedPeriodCount) {
      const target = OPSTD_EXTENSION_TARGETS[periods[pi]];
      const month = rows.slice(rows.length - branches.length);
      const spread = rng(pi * 7919 + 3);
      const raw = month.map((row, bi) => bi === SUMMIT ? -9 - spread() * 3 : (spread() - 0.5) * 9);
      const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
      month.forEach((row, bi) => {
        row[2] = round2(Math.min(99, Math.max(55, target + raw[bi] - mean)));
        if (bi === SUMMIT) row[10] = round2(Math.min(row[10] as number, 62 + spread() * 8));
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
