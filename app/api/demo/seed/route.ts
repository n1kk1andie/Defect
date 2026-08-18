import { NextResponse } from "next/server";
import { seedDemoLogins } from "@/lib/auth";
import { assertDemoSafe, isDemo, buildDemoDataset, DEMO_INSTITUTION, DEMO_BRANCHES, demoUsers, demoPassword } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Demo-only. Plants the pre-activated demo logins into this deployment's
// (isolated) store so it can be signed into without any per-role env config.
// The fictional dataset itself needs no write — an empty store auto-serves the
// Meridian Building Society demo data (see lib/data.ts). Double-gated by
// assertDemoSafe(): DEMO_MODE=1 required. Inert (404) in production.
//
// Optional extra gate: if DEMO_SEED_TOKEN is set, the caller must pass
// ?token=… so a public demo URL can't be re-seeded by a visitor.

function tokenOk(url: string): boolean {
  const want = (process.env.DEMO_SEED_TOKEN || "").trim();
  if (!want) return true;
  try {
    return new URL(url).searchParams.get("token") === want;
  } catch {
    return false;
  }
}

/** The static list of logins a seed creates (no store access). */
function loginSummary() {
  return [
    { username: "admin", role: "admin", branch: null, note: "built-in admin login (blank or 'admin')" },
    ...demoUsers().map((u) => ({ username: u.username, role: u.role, branch: u.branch, note: "username login or role login" })),
  ];
}

/** GET — show what a seed would create (no writes). Handy for the runbook. */
export async function GET() {
  if (!isDemo()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    institution: DEMO_INSTITUTION,
    action: "POST to this URL (with ?token=… if DEMO_SEED_TOKEN is set) to seed the demo logins",
    password: demoPassword(),
    logins: loginSummary(),
  });
}

/** POST — seed the demo logins. */
export async function POST(req: Request) {
  if (!isDemo()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!tokenOk(req.url)) return NextResponse.json({ error: "Bad token" }, { status: 401 });
  try {
    assertDemoSafe();
    const logins = await seedDemoLogins();
    const defects = buildDemoDataset("defects");
    const opstd = buildDemoDataset("opstd");
    return NextResponse.json({
      ok: true,
      institution: DEMO_INSTITUTION,
      dataset: {
        branches: DEMO_BRANCHES,
        defectRows: defects.rows.length,
        opstdRows: opstd.rows.length,
        note: "Dataset is served from an empty store automatically — no write needed.",
      },
      logins,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
