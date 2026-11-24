// The nightly demo reset's door (app/api/cron/demo-reset): a demo deployment
// only (404 anywhere else, so it does nothing on live), and only for Vercel
// Cron's Authorization: Bearer $CRON_SECRET (401 without CRON_SECRET or with
// the wrong one). Dependency-free so it can be tested on its own.
import { timingSafeEqual } from "node:crypto";

export function demoResetRefusal({ demo, secret, authorization }: { demo: boolean; secret: string | undefined; authorization: string | null }): { status: number; error: string } | null {
  if (!demo) return { status: 404, error: "Not found" };
  const want = String(secret || "").trim();
  const got = String(authorization || "");
  const expected = `Bearer ${want}`;
  const ok = !!want && got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  return ok ? null : { status: 401, error: "Unauthorized" };
}
