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
//
// The suite's licence screen standard: the same title, sentence, button, note
// and two footer lines in every Pulsus app. Two kinds of visitor see it:
//   - the deployment's own tenant (this wall): renewal is self-service —
//     "Renew and pay" opens Pulsus Quality's own Renew and pay page (/renew,
//     public/renew.html: sign in, then pay for Pulsus Quality only, straight
//     to Stripe), the note gives Pulsus support's address for questions, and a
//     small link sends newcomers to the public plans page;
//   - a Pulsus customer company whose own subscription is paused or ended
//     (app/licence/page.tsx): "Renew and pay", to /renew too.

import { esc, frameHtml, QUALITY_FRAME } from "./frame-html";
import { APP_NAME, footerLines } from "./footer";

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

// The words of the licence screen standard.
export const LICENSE_WALL_TITLE = "License Required";
export const SUPPORT_EMAIL = "support@pulsus.tech";
/** The own tenant's licence has ended. */
export const LICENSE_WALL_MESSAGE = "This organisation's licence has ended. Your records are kept.";
export const RENEW_LABEL = "Renew and pay";
export const RENEW_NOTE = `Questions about renewing? Write to ${SUPPORT_EMAIL}.`;
/** Pulsus Platform's product key for Pulsus Quality. */
export const PRODUCT_KEY = "quality";
/** Pulsus Quality's own "Renew and pay" page (public/renew.html): pay for
 *  Pulsus Quality right here, straight to Stripe, without leaving it. */
export const RENEW_PATH = "/renew";
export const renewUrl = (): string => RENEW_PATH;
/** Pulsus Quality's public plans page: the plans, and the free trial. */
export const PLANS_URL = "https://aboutquality.pulsus.tech/plans/";
export const PLANS_LINK = `New to ${APP_NAME}? See plans and start a free trial`;
export const RENEW_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} licence renewal`)}`;
/** A Pulsus customer company's own subscription is paused or ended. */
export const PAUSED_MESSAGE = "Your organisation's Pulsus subscription is not active. Your records are kept.";
export const BILLING_LABEL = "View plan & billing";
export const BILLING_NOTE = "Only your organisation's owner can pay. Ask them, or your administrator, if you can't.";

/** The button and the note under it, for a page in the sign-in standard's frame (lib/frame-html.ts). */
export const ctaHtml = (href: string, label: string, note: string) =>
  `<a class="cta" href="${esc(href)}" target="_top">${esc(label)}</a><p class="note">${esc(note)}</p>`;

// The notice in the Pulsus sign-in standard's frame (lib/frame-html.ts).
const html = (renew: string) => frameHtml(QUALITY_FRAME, {
  pageTitle: `${LICENSE_WALL_TITLE} · ${APP_NAME}`,
  title: LICENSE_WALL_TITLE,
  body: LICENSE_WALL_MESSAGE,
  ctaHtml: `<a class="cta" href="${esc(renew)}" target="_top" rel="noopener">${esc(RENEW_LABEL)}</a><p class="note">${esc(RENEW_NOTE)}</p>`
    + `<p class="note"><a href="${esc(PLANS_URL)}" target="_top" rel="noopener">${esc(PLANS_LINK)}</a></p>`,
  foot: footerLines(),
});

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** The notice: JSON for an API path, the page otherwise. 403 — no credential fixes it; `renew` is where to renew and pay, `plans` the public plans page, `contact` is support for questions. */
export function licenseWallResponse(pathname: string): Response {
  const renew = renewUrl();
  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: LICENSE_WALL_TITLE, message: LICENSE_WALL_MESSAGE, renew, plans: PLANS_URL, contact: RENEW_MAILTO }), { status: 403, headers: { ...HEADERS, "Content-Type": "application/json" } });
  }
  return new Response(html(renew), { status: 403, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}
