// The post-response backup check. withTenant() (lib/db/client.ts) calls
// scheduleBackupCheck() for a real company; the check runs only after the
// response has been sent (Next.js after()), so it never slows a request, and
// at most one is queued per company at a time. It backs the company up if it
// has unsaved changes and its last backup is at least 15 minutes old
// (lib/backup.ts backupIfDue): so the first change is backed up straight away,
// a burst of edits gives at most one backup per 15 minutes, and a trailing
// edit is caught by the company's next request (or the daily sweep).
//
// This is the one place outside the cron routes that reaches the cross-company
// system path (through lib/backup.ts), and only inside the after() callback,
// for the company the request was already for. tests/data-safety.test.mjs
// allows exactly this file and checks that it exports nothing else.
import { after } from "next/server";

type Schedule = (task: () => Promise<void>) => void;
const g = globalThis as unknown as { __qualityBackupAfter?: Schedule };
const queued = new Set<string>();

export function scheduleBackupCheck(companyId: string): void {
  if (queued.has(companyId)) return;
  const task = async () => {
    queued.delete(companyId);
    try {
      const { backupIfDue } = await import("./backup");
      await backupIfDue(companyId);
    } catch (e) {
      console.error(`backup: after-response check for ${companyId} failed:`, e instanceof Error ? e.message : e);
    }
  };
  try {
    (g.__qualityBackupAfter ?? after)(task);
    queued.add(companyId);
  } catch {
    // Outside a request (scripts, seeding, the tests): the daily sweep catches up.
  }
}
