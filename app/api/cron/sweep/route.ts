// The scheduled sweep (Vercel Cron, vercel.json): band changes, overdue actions,
// effectiveness checks, scheduled reports and retries, for every company.
// Needs Authorization: Bearer $CRON_SECRET; without CRON_SECRET it refuses.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sweepAll } from "@/lib/automation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const want = (process.env.CRON_SECRET || "").trim();
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const ok = !!want && want.length === got.length && timingSafeEqual(Buffer.from(want), Buffer.from(got));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await sweepAll();
  return NextResponse.json({ ran: results.length, results: results.map((r) => ({ company: r.companyId.slice(0, 8), ...r, companyId: undefined })) }, { headers: { "Cache-Control": "no-store" } });
}
