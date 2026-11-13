// The daily email of what needs each person (Vercel Cron, vercel.json). Needs
// Authorization: Bearer $CRON_SECRET; without CRON_SECRET it refuses. Sends
// nothing unless RESEND_API_KEY is set, and never from a demo (lib/notify.ts).
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendAllDigests } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const want = (process.env.CRON_SECRET || "").trim();
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const ok = !!want && want.length === got.length && timingSafeEqual(Buffer.from(want), Buffer.from(got));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const runs = await sendAllDigests();
  return NextResponse.json({ companies: runs.length, sent: runs.reduce((n, r) => n + r.sent, 0), failed: runs.reduce((n, r) => n + r.failed, 0) }, { headers: { "Cache-Control": "no-store" } });
}
