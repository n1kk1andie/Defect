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

import { frameHtml, QUALITY_FRAME } from "./frame-html";

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

// The notice in the Pulsus sign-in standard's frame (lib/frame-html.ts).
const HTML = frameHtml(QUALITY_FRAME, {
  pageTitle: "License Required · Pulsus Intelligence Suite",
  title: LICENSE_WALL_TITLE,
  body: LICENSE_WALL_MESSAGE,
  foot: ["Pulsus Intelligence Suite", "A Tumblehill Holdings LLC Product"],
});

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** The notice: JSON for an API path, the page otherwise. 403 — no credential fixes it. */
export function licenseWallResponse(pathname: string): Response {
  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: LICENSE_WALL_TITLE, message: LICENSE_WALL_MESSAGE }), { status: 403, headers: { ...HEADERS, "Content-Type": "application/json" } });
  }
  return new Response(HTML, { status: 403, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}
