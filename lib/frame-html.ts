// The Pulsus sign-in standard's frame as a self-contained page, for notices
// served without the app around them (the licence wall, the plan page): the
// family paper by day and navy by night, one centred card, the app's emblem big
// at the top with its name and subtitle, then the notice. One inline stylesheet
// and the app's own images; no scripts.
export interface FrameBrand { word: string; sub: string; emblem: string; emblemNight: string; icon: string }

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function frameHtml(b: FrameBrand, p: { pageTitle: string; title: string; body: string; ctaHtml?: string; foot?: string[]; lang?: string }): string {
  const foot = (p.foot || []).map((l) => `<p>${esc(l)}</p>`).join("");
  return `<!doctype html><html lang="${esc(p.lang || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark"><title>${esc(p.pageTitle)}</title><link rel="icon" href="${esc(b.icon)}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"><link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&amp;family=IBM+Plex+Sans:wght@400;600&amp;display=swap" rel="stylesheet"><style>
:root{--bg:#f6f3f1;--card:#fff;--ink:#1c1416;--navy:#0b1d4d;--red:#c8102e;--muted:#5f5552;--line:#d9d1cc;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0a0f2c;--card:#121a42;--ink:#f3f4fb;--navy:#f3f4fb;--red:#ff5c78;--muted:#c6cae3;--line:rgba(255,255,255,.22);color-scheme:dark}img.day{display:none!important}img.night{display:block!important}.cta{background:#c8102e!important}}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:480px;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:36px 24px 32px;text-align:center;box-shadow:0 1px 2px rgba(28,20,22,.04),0 14px 40px -18px rgba(28,20,22,.18)}
img.emblem{display:block;width:176px;height:176px;object-fit:contain;margin:4px auto 0}img.night{display:none}
.name{margin:12px 0 0;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:800;font-size:clamp(24px,7.4vw,36px);line-height:1.1;letter-spacing:-.01em;white-space:nowrap;color:#0b1f4d}.name span{color:#c8102e}
.sub{margin:8px 0 0;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:700;font-size:14px;line-height:1.3;letter-spacing:.16em;text-transform:uppercase;color:#0b1f4d}
.tag{margin:22px 0 0;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:700;font-size:18px;line-height:1.3}.tag span{color:#c8102e}
@media (prefers-color-scheme:dark){.name{color:#f3f4fb}.name span,.tag span{color:#ff4d6d}.sub{color:#c6cae3}}
h2{margin:28px 0 0;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-size:24px;font-weight:800;line-height:1.25}
.body{margin:12px 0 0;font-size:17px;line-height:1.55;color:var(--muted)}
.cta{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:24px;background:var(--red);color:#fff;text-decoration:none;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:700;font-size:18px;padding:12px 16px;border-radius:14px}
.note{margin:14px 0 0;font-size:14px;line-height:1.5;color:var(--muted)}.signout{display:inline-block;margin-top:14px;font-weight:700;font-size:16px;color:var(--red);text-decoration:none}
.cta:focus-visible,a:focus-visible{outline:3px solid #2f5bd3;outline-offset:2px}
.foot{width:100%;max-width:480px;margin:22px auto 0;text-align:center;font-size:13px;line-height:1.6;color:var(--muted)}.foot p{margin:0}
@media (min-width:600px){img.emblem{width:200px;height:200px}}
@media (min-width:720px){.card{padding:44px 40px 36px}}
/* The Pulsus sign-in form standard (Nov 2026), the same in every app: the page starts 56 px down on a phone (top-aligned, so every app's button sits at the same height), the subtitle on one line from 375 px, one 54 px red button. */
body{justify-content:flex-start;padding:56px 16px 8px}.card{padding:36px 24px 30px}.sub{font-size:clamp(11px,3.1vw,14px);letter-spacing:.12em;line-height:1.35;white-space:nowrap}@media (max-width:374px){.sub{white-space:normal}}.tag{line-height:24px}
h2{margin:24px 0 0;font-size:24px;line-height:30px}.body{margin:12px 0 0;font-size:17px;line-height:26px}.cta{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:54px;min-height:54px;margin-top:24px;padding:0 16px;border-radius:12px;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:700;font-size:17px;line-height:1;background:#c8102e;color:#fff;text-decoration:none}.cta:hover{background:#a50d26}
.note{margin:16px 0 0;font-size:15px;line-height:22px}.foot{margin:22px auto 0;padding:0 0 28px;font-size:12.5px;line-height:1.6}
@media (min-width:720px){body{justify-content:center}.card{padding:44px 40px 36px}}
</style></head><body><main class="card"><img class="emblem day" src="${esc(b.emblem)}" alt="" width="200" height="200"><img class="emblem night" src="${esc(b.emblemNight)}" alt="" width="200" height="200"><h1 class="name">Pulsus <span>${esc(b.word)}</span></h1><p class="sub">${esc(b.sub)}</p><p class="tag">Live. <span>Signal.</span> Clarity.</p><h2>${esc(p.title)}</h2><p class="body">${esc(p.body)}</p>${p.ctaHtml || ""}</main>${foot ? `<footer class="foot">${foot}</footer>` : ""}</body></html>`;
}

/** Pulsus Quality's own artwork and words (components/account/AccountFrame QUALITY_BRAND). */
export const QUALITY_FRAME: FrameBrand = { word: "Quality", sub: "Quality assurance", emblem: "/pulsus-quality-emblem-day.png", emblemNight: "/pulsus-quality-emblem-night.png", icon: "/pulsus-quality-icon.png" };
