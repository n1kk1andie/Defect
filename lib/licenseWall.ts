// The licence wall for this deployment's own tenant (the Command Center's
// lib/license.ts, mirrored). While it is up, only Pulsus customer companies —
// each licensed by its own subscription, checked by the Command Center when it
// issues their session — get through; every other visitor, this deployment's
// own people included, gets the licence notice. Edge-safe: env + strings only.
//
// Environment (same meaning as on the Command Center)
//   LICENSE_WALL      "off" | "0" | "false" | "no" → never wall
//                     "on"  | "1" | "true"  | "now" → wall now
//                     unset → wall from LICENSE_WALL_AT onwards
//   LICENSE_WALL_AT   ISO 8601 instant to start walling (default below)

const LICENSE_WALL_DEFAULT_AT = "2026-09-03T05:00:00.000Z"; // 3 Sep 2026, 00:00 Jamaica
const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase() : "");
const OFF = new Set(["off", "0", "false", "no", "disabled"]);
const ON = new Set(["on", "1", "true", "yes", "now", "enabled"]);

export function licenseWallActive(now: number = Date.now()): boolean {
  const flag = clean(process.env.LICENSE_WALL);
  if (OFF.has(flag)) return false;
  if (ON.has(flag)) return true;
  const at = Date.parse(clean(process.env.LICENSE_WALL_AT) || "");
  return now >= (Number.isFinite(at) ? at : Date.parse(LICENSE_WALL_DEFAULT_AT));
}

export const LICENSE_WALL_TITLE = "License Required";
export const LICENSE_WALL_MESSAGE = "Please contact your organisation’s administrator for further information.";

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex, nofollow"/><title>License Required · Pulsus Intelligence Suite</title><style>*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(160deg,#e4012b,#a60020);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a2230}.card{width:100%;max-width:380px;background:#fff;border-radius:16px;padding:32px 28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.25)}h1{margin:0 0 10px;font-size:22px;font-weight:800;color:#111827}.sub{margin:0;font-size:14px;line-height:1.55;color:#6b7280}.rule{height:1px;background:#eceff3;margin:22px 0 16px}.product{margin:0;font-size:13px;font-weight:600;color:#111827}.owner{margin:4px 0 0;font-size:11.5px;color:#6b7280}</style></head><body><main class="card"><h1>License Required</h1><p class="sub">Please contact your organisation’s administrator for further information.</p><div class="rule"></div><p class="product">Pulsus Intelligence Suite</p><p class="owner">A Tumblehill Holdings LLC Product</p></main></body></html>`;

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** The notice: JSON for an API path, the page otherwise. 403 — no credential fixes it. */
export function licenseWallResponse(pathname: string): Response {
  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: LICENSE_WALL_TITLE, message: LICENSE_WALL_MESSAGE }), { status: 403, headers: { ...HEADERS, "Content-Type": "application/json" } });
  }
  return new Response(HTML, { status: 403, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}
