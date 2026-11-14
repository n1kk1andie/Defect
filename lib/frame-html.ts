// The Pulsus sign-in standard's frame as a self-contained page, for notices
// served without the app around them (the licence wall, the plan page): the
// family paper by day and navy by night, one centred card, the app's emblem big
// at the top with its name and subtitle, then the notice. One inline stylesheet
// and the app's own images; no scripts.
export interface FrameBrand { word: string; sub: string; emblem: string; emblemNight: string; icon: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function frameHtml(b: FrameBrand, p: { pageTitle: string; title: string; body: string; ctaHtml?: string; foot?: string[]; lang?: string }): string {
  const foot = (p.foot || []).map((l) => `<p>${esc(l)}</p>`).join("");
  return `<!doctype html><html lang="${esc(p.lang || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark"><title>${esc(p.pageTitle)}</title><link rel="icon" href="${esc(b.icon)}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"><link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&amp;family=IBM+Plex+Sans:wght@400;600&amp;display=swap" rel="stylesheet"><style>
:root{--bg:#f6f3f1;--card:#fff;--ink:#1c1416;--navy:#0b1d4d;--red:#c8102e;--muted:#5f5552;--line:#d9d1cc;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0a0f2c;--card:#121a42;--ink:#f3f4fb;--navy:#f3f4fb;--red:#ff5c78;--muted:#c6cae3;--line:rgba(255,255,255,.22);color-scheme:dark}img.day{display:none!important}img.night{display:block!important}.cta{background:#c8102e!important}}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:480px;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:36px 24px 32px;text-align:center;box-shadow:0 1px 2px rgba(28,20,22,.04),0 14px 40px -18px rgba(28,20,22,.18)}
img.emblem{display:block;width:58%;min-width:180px;max-width:240px;height:auto;margin:0 auto 6px}img.night{display:none}
.name{margin:4px 0 0;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:800;font-size:clamp(40px,12vw,52px);line-height:1.05;letter-spacing:-.02em;color:var(--navy)}.name span{color:var(--red)}.name.long{font-size:clamp(30px,9vw,52px);white-space:nowrap}.name.xlong{font-size:clamp(28px,8.2vw,50px);white-space:nowrap}
.sub{margin:10px 0 0;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:600;font-size:clamp(14px,4.4vw,17px);letter-spacing:.12em;text-transform:uppercase}
.tag{margin:22px 0 0;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:700;font-size:18px}.tag span{color:var(--red)}
h2{margin:28px 0 0;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-size:24px;font-weight:800;line-height:1.25}
.body{margin:12px 0 0;font-size:17px;line-height:1.55;color:var(--muted)}
.cta{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:24px;background:var(--red);color:#fff;text-decoration:none;font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:700;font-size:18px;padding:12px 16px;border-radius:14px}
.cta:focus-visible,a:focus-visible{outline:3px solid #2f5bd3;outline-offset:2px}
.foot{width:100%;max-width:480px;margin:22px auto 0;text-align:center;font-size:13px;line-height:1.6;color:var(--muted)}.foot p{margin:0}
@media (min-width:720px){.card{padding:44px 40px 36px}img.emblem{width:260px;max-width:260px}}
</style></head><body><main class="card"><img class="emblem day" src="${esc(b.emblem)}" alt="" width="240" height="240"><img class="emblem night" src="${esc(b.emblemNight)}" alt="" width="240" height="240"><h1 class="name${b.word.length + 7 >= 15 ? " xlong" : b.word.length + 7 >= 12 ? " long" : ""}">Pulsus <span>${esc(b.word)}</span></h1><p class="sub">${esc(b.sub)}</p><p class="tag">Live. <span>Signal.</span> Clarity.</p><h2>${esc(p.title)}</h2><p class="body">${esc(p.body)}</p>${p.ctaHtml || ""}</main>${foot ? `<footer class="foot">${foot}</footer>` : ""}</body></html>`;
}

/** Pulsus Quality's own artwork and words (components/account/AccountFrame QUALITY_BRAND). */
export const QUALITY_FRAME: FrameBrand = { word: "Quality", sub: "Quality assurance", emblem: "/pulsus-quality-icon-day.png", emblemNight: "/pulsus-quality-icon-night.png", icon: "/pulsus-quality-icon.png" };
