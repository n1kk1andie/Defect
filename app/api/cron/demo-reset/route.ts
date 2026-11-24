// The demo's nightly reset to its published sample data (Vercel Cron, vercel.json,
// about 05:00 UTC: midnight in Jamaica). Demo deployments only — 404 on live —
// and only with Authorization: Bearer $CRON_SECRET (lib/demoResetGate.ts).
// It is the same reset as the demo admin's "Reset the demo data" (lib/demo/seed.ts
// resetDemo): the demo tenant's records go back to the sample. Visitors' sign-in
// and demo-access registrations live on Pulsus Platform, not here, so nothing
// of theirs is touched; the change history is append-only and records the reset.
import { NextResponse } from "next/server";
import { resetDemo } from "@/lib/demo/seed";
import { demoResetRefusal } from "@/lib/demoResetGate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const refused = demoResetRefusal({ demo: (process.env.DEMO_MODE || "").trim().replace(/^["']+|["']+$/g, "") === "1", secret: process.env.CRON_SECRET, authorization: req.headers.get("authorization") });
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status, headers: { "Cache-Control": "no-store" } });
  await resetDemo("nightly-reset");
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
