// The nightly logical backup (vercel.json schedules it; lib/backup.ts does it).
// Vercel sends Authorization: Bearer $CRON_SECRET. Without the separate backup
// store's token (BACKUP_BLOB_READ_WRITE_TOKEN) it does nothing but log; it refuses
// a token equal to the live store's; and a demo deployment never backs up. A run stops before the function's time limit
// and, if companies remain, calls this route again to carry on with the same day.
import { cronAuthorized } from "@/lib/cron";
import { blobBackupStore, runBackup } from "@/lib/backup";
import { vercelBlobToken as liveBlobToken } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUDGET_MS = 240_000;
const MAX_HOPS = 48;
let warned = false;

export async function GET(req: Request) {
  const started = Date.now();
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  if ((process.env.DEMO_MODE || "").trim().replace(/^["']+|["']+$/g, "") === "1") return json({ ok: true, skipped: "demo" });
  const token = (process.env.BACKUP_BLOB_READ_WRITE_TOKEN || "").trim().replace(/^["']+|["']+$/g, "");
  if (!token) {
    if (!warned) { warned = true; console.warn("backup: BACKUP_BLOB_READ_WRITE_TOKEN is not set; the nightly backup is off"); }
    return json({ ok: true, skipped: "BACKUP_BLOB_READ_WRITE_TOKEN is not set" });
  }
  if (token === (liveBlobToken() || "").trim().replace(/^["']+|["']+$/g, "")) {
    // A backup kept in the live store is no backup, and pruning there must never run.
    console.error("backup: BACKUP_BLOB_READ_WRITE_TOKEN is the live Blob store's token; refusing to back up into the live store");
    return json({ error: "The backup store must be separate from the live store" }, 500);
  }
  const url = new URL(req.url);
  const hop = Math.max(0, Number(url.searchParams.get("hop")) || 0);
  try {
    const r = await runBackup(blobBackupStore(token), { date: url.searchParams.get("date") || undefined, deadline: started + BUDGET_MS });
    if (!r.complete && r.wroteNow > 0 && hop < MAX_HOPS) {
      // Hand the rest of the day to a fresh invocation; don't wait for it to finish.
      const next = new URL(url.pathname, url.origin);
      next.searchParams.set("date", r.date);
      next.searchParams.set("hop", String(hop + 1));
      await fetch(next, { headers: { authorization: req.headers.get("authorization") || "" }, signal: AbortSignal.timeout(5_000) }).catch(() => {});
    }
    return json({ ok: true, ...r, hop });
  } catch (e) {
    console.error("backup failed:", e);
    return json({ error: "Backup failed" }, 500);
  }
}
