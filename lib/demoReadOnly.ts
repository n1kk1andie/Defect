// The read-only demo. A demo deployment (DEMO_MODE=1) is SHARED by default:
// what a visitor saves stays in the demo's shared store for later visitors,
// as the demo has always worked (its reset is unchanged). The owner can make
// it READ-ONLY instead, so nothing a visitor does is saved and the 14-day free
// trial (quality.pulsus.tech/signup) is where people work with their own data.
//
// Who decides: the operator, in Pulsus Platform's operator console (Demos →
// Demo modes), which the demo reads from executive.pulsus.tech/api/demo-modes
// (key "quality", cached half a minute, 1.5 s timeout). DEMO_READONLY on the
// demo project overrides it: "1" read-only, "0" shared. With neither, or when
// the platform can't be reached or answers anything else, the demo is SHARED.
// The platform is asked only for a write that could be refused. Live
// deployments never run this.
//
// Still open on a read-only demo: everything that reads, and these writes:
//   /api/demo            switching persona (a cookie); "Reset the demo data" puts the sample back
//   /api/logout          signing out
//   /api/health, /api/cron  machine channels
//   /api/sampling/preview   works out a sampling plan without saving it
//   /api/table           reads an uploaded CSV/Excel into columns; nothing is stored
//   /api/bulk            its preview saves nothing; a commit is refused in the route
// Any other write to the API gets 403 with a pointer to the trial, which the
// page shows where it would show a save error.
export const TRIAL_URL = "https://quality.pulsus.tech/signup";
export const READ_ONLY_MESSAGE = "This is a read-only demo, so nothing here can be saved. To try Pulsus Quality with your own data, start a 14-day free trial at quality.pulsus.tech/signup.";
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const OPEN = ["/api/demo", "/api/logout", "/api/health", "/api/cron", "/api/sampling/preview", "/api/table", "/api/bulk"];
export const MODES_URL = "https://executive.pulsus.tech/api/demo-modes";
const APP = "quality";
let cache = { at: 0, readOnly: false };

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Is the demo read-only right now? DEMO_READONLY "1"/"0" decides when set;
 *  otherwise the operator's mode from the platform (cached 30s); otherwise
 *  shared. Never throws. */
export async function demoReadOnly(env: Env = process.env, { fetchImpl = globalThis.fetch as unknown as FetchLike, now = Date.now() }: { fetchImpl?: FetchLike; now?: number } = {}): Promise<boolean> {
  const forced = String(env.DEMO_READONLY ?? "").trim().replace(/^["']+|["']+$/g, "");
  if (forced === "1") return true;
  if (forced === "0") return false;
  if (now - cache.at < 30000) return cache.readOnly;
  let readOnly = false;
  try {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 1500) : null;
    try {
      const r = await fetchImpl(MODES_URL, { headers: { Accept: "application/json" }, cache: "no-store", ...(ctl ? { signal: ctl.signal } : {}) });
      if (r && r.ok) { const j = (await r.json()) as { modes?: Record<string, unknown> } | null; readOnly = !!(j && j.modes && j.modes[APP] === "readonly"); }
    } finally { if (t) clearTimeout(t); }
  } catch { readOnly = false; }
  cache = { at: now, readOnly };
  return readOnly;
}
/** Tests: forget the cached mode. */
export const resetDemoModeCache = () => { cache = { at: 0, readOnly: false }; };

/** Could this request be refused? A demo write to the API that isn't open. */
export function demoWriteCandidate({ demo, method, path }: { demo: boolean; method: string; path: string }): boolean {
  if (!demo || !WRITE.has(String(method || "").toUpperCase())) return false;
  const p = String(path || "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (!p.startsWith("/api/")) return false;
  return !OPEN.some((o) => p === o || p.startsWith(o + "/"));
}
/** Should this request be refused? A candidate, on a read-only demo. */
export const demoWriteRefused = ({ demo, readOnly, method, path }: { demo: boolean; readOnly: boolean; method: string; path: string }) => !!readOnly && demoWriteCandidate({ demo, method, path });

/** The 403 a refused write gets. */
export function demoReadOnlyResponse(): Response {
  return new Response(JSON.stringify({ error: READ_ONLY_MESSAGE, readOnlyDemo: true, trial: TRIAL_URL }), {
    status: 403, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
