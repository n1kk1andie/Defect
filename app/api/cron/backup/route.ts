// The daily backup sweep (vercel.json, once a day). Backups are triggered by
// changes (lib/backup.ts, lib/backup-after.ts); this only catches the trailing
// edits a company made within 15 minutes of its last backup. It first asks one
// cheap question, "is any company pending?", and returns at once when none is:
// no Blob listing, no scan, no per-company loop.
//
// Vercel sends Authorization: Bearer $CRON_SECRET. Without the separate backup
// store's token (BACKUP_BLOB_READ_WRITE_TOKEN) it does nothing but log; it
// refuses a token equal to the live store's; and a demo deployment never backs
// up. A run stops before the function's time limit and, if companies remain,
// calls this route again to carry on.
import { cronAuthorized } from "@/lib/cron";
import { backupStoreFromEnv, sweepPending } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUDGET_MS = 240_000;
const MAX_HOPS = 48;

export async function GET(req: Request) {
  const started = Date.now();
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  const env = backupStoreFromEnv();
  if ("error" in env) return json({ error: env.error }, 500);
  if ("skipped" in env) return json({ ok: true, skipped: env.skipped });
  const url = new URL(req.url);
  const hop = Math.max(0, Number(url.searchParams.get("hop")) || 0);
  try {
    const r = await sweepPending(env.store, { deadline: started + BUDGET_MS });
    if (r.left > 0 && r.backedUp.length > 0 && hop < MAX_HOPS) {
      // Hand the rest to a fresh invocation; don't wait for it to finish.
      const next = new URL(url.pathname, url.origin);
      next.searchParams.set("hop", String(hop + 1));
      await fetch(next, { headers: { authorization: req.headers.get("authorization") || "" }, signal: AbortSignal.timeout(5_000) }).catch(() => {});
    }
    return json({ ok: true, ...r, hop });
  } catch (e) {
    console.error("backup sweep failed:", e);
    return json({ error: "Backup failed" }, 500);
  }
}
