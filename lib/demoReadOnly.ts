// The read-only demo: a demo deployment (DEMO_MODE=1) shows Meridian Financial
// Group's sample data to every visitor as it was published, so nothing a
// visitor does is saved for the next visitor to find. The 14-day free trial
// (quality.pulsus.tech/signup) is where people work with their own data.
//
// The switch: DEMO_READONLY on the demo project. Read-only unless it is "0";
// set DEMO_READONLY=0 to open the demo for saving (a workshop, say) — the
// shared demo then keeps what people save, for everyone, until it is reset.
// Live deployments never run this.
//
// Still open on a read-only demo: everything that reads, and these writes that
// save nothing (or are part of entering the demo):
//   /api/demo            switching persona (a cookie); "Reset the demo data" puts the sample back
//   /api/logout          signing out
//   /api/health, /api/cron  machine channels
//   /api/sampling/preview   works out a sampling plan without saving it
//   /api/table           reads an uploaded CSV/Excel into columns; nothing is stored
//   /api/bulk            its preview saves nothing; a commit is refused in the route (demoReadOnlyNow)
// Any other write to the API gets 403 with a pointer to the trial, which the
// page shows where it would have said "Saved" (components/app-context.tsx api()).
export const TRIAL_URL = "https://quality.pulsus.tech/signup";
export const READ_ONLY_MESSAGE = "This is a read-only demo, so nothing here can be saved. To try Pulsus Quality with your own data, start a 14-day free trial at quality.pulsus.tech/signup.";
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const OPEN = ["/api/demo", "/api/logout", "/api/health", "/api/cron", "/api/sampling/preview", "/api/table", "/api/bulk"];

const flag = (v: string | undefined) => String(v ?? "").trim().replace(/^["']+|["']+$/g, "");

/** Is the demo read-only? On unless DEMO_READONLY is "0". */
export const demoReadOnly = (env: Record<string, string | undefined> = process.env) => flag(env.DEMO_READONLY) !== "0";

/** A demo deployment that is read-only right now (for the one route that decides on its body: /api/bulk). */
export const demoReadOnlyNow = (env: Record<string, string | undefined> = process.env) => flag(env.DEMO_MODE) === "1" && demoReadOnly(env);

/** Should this request be refused? Only on a read-only demo, only writes to the API. */
export function demoWriteRefused({ demo, readOnly, method, path }: { demo: boolean; readOnly: boolean; method: string; path: string }): boolean {
  if (!demo || !readOnly || !WRITE.has(String(method || "").toUpperCase())) return false;
  const p = String(path || "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (!p.startsWith("/api/")) return false;
  return !OPEN.some((o) => p === o || p.startsWith(o + "/"));
}

/** The 403 a refused write gets. */
export function demoReadOnlyResponse(): Response {
  return new Response(JSON.stringify({ error: READ_ONLY_MESSAGE, readOnlyDemo: true, trial: TRIAL_URL }), {
    status: 403, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
