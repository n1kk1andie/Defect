// Vercel calls each cron route with Authorization: Bearer $CRON_SECRET. Without
// CRON_SECRET set, every cron call is refused.
import { timingSafeEqual } from "node:crypto";

export function cronAuthorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
