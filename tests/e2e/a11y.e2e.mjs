// Accessibility: axe-core (WCAG 2.0, 2.1 and 2.2, levels A and AA) over every
// screen and the main sheets, on desktop and an iPhone 13, by day and by night,
// at zero violations; plus no page errors and no horizontal scroll.
//
//   A11Y_BASE=http://localhost:3652 node --test tests/e2e/a11y.e2e.mjs
//   (a running DEMO_MODE=1 build: it opens straight in; personas by cookie).
// Needs Playwright's Chromium. Not part of `npm test` (it needs a server).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright"); }
const { chromium, devices } = pw;
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = (process.env.A11Y_BASE || "http://localhost:3652").replace(/\/$/, "");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const ADMIN = "admin@demo.pulsus.tech";
const SCREENS = [
  { name: "pulse", path: "/" },
  { name: "pulse: scorecard", path: "/", go: (p) => p.getByRole("button", { name: "Operational Standard", exact: true }).click() },
  { name: "register", path: "/register" },
  { name: "register: defects", path: "/register", go: (p) => p.getByRole("button", { name: /^Defects \(/ }).click() },
  { name: "history", path: "/history" },
  { name: "insights", path: "/insights" },
  { name: "review", path: "/review", persona: ADMIN },
  { name: "review: new", path: "/review", persona: ADMIN, go: (p) => p.getByRole("button", { name: "New review" }).click() },
  { name: "actions", path: "/actions", persona: ADMIN },
  { name: "actions: detail", path: "/actions", persona: ADMIN, go: (p) => p.locator("tbody tr").first().click() },
  { name: "report", path: "/report" },
  { name: "settings", path: "/settings", persona: ADMIN },
  { name: "settings: bands", path: "/settings#settings-bands", persona: ADMIN },
  { name: "settings: people", path: "/settings#settings-people", persona: ADMIN },
  { name: "settings: data", path: "/settings#settings-data", persona: ADMIN },
  { name: "sign-in", path: "/login" },
];

for (const theme of ["light", "dark"]) {
  for (const device of ["desktop", "iPhone 13"]) {
    for (const s of SCREENS) {
      test(`${s.name} — ${device} — ${theme}: no WCAG 2.2 A/AA violations`, async () => {
        const ctx = await browser.newContext(device === "desktop" ? { viewport: { width: 1280, height: 900 } } : devices["iPhone 13"]);
        await ctx.addInitScript((t) => { try { localStorage.setItem("pz-theme", t); } catch {} }, theme);
        await ctx.addCookies([{ name: "pq_persona", value: s.persona || "guest@demo.pulsus.tech", url: BASE }]);
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(BASE + s.path, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        if (s.go) { await s.go(page); await page.waitForTimeout(600); }
        await page.addScriptTag({ content: AXE });
        const v = await page.evaluate(async (tags) => (await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] })).violations
          .map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.slice(0, 4).map((n) => n.target.join(" ")) })), TAGS);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        await ctx.close();
        assert.deepEqual(errors, [], "no page errors");
        assert.equal(overflow, false, "no horizontal overflow");
        assert.deepEqual(v, [], JSON.stringify(v, null, 1));
      });
    }
  }
}
