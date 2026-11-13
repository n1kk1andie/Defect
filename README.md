# Pulsus Quality

Quality management and inspections for multi-site organisations: banks and credit unions, hospitals and health systems, government agencies, universities and any business with many sites. Part of the Pulsus suite. **Live. Signal. Clarity.**

- **Pulse:** defect rate, defects found, resolved and recurring, the trend, every branch and process area; or the Operational Standard scorecard against its target, with audit grades.
- **Register:** the counts behind every rate (sortable, CSV/Excel) and each published defect, which supervisors resolve or turn into actions.
- **History:** branch × month heat-maps of the defect, resolution and recurring rates, and branch × process area.
- **Insights:** the branch watchlist, the resolution gap, recurring-issue detection (preventive actions, send to Pulsus Risk), systemic recurring, scorecard vs defects.
- **Inspect:** inspections, field visits and file reviews on any published template, on a phone and offline: check-in, photos per question, signatures, live score; a supervisor who didn't carry it out approves it, and failed items become corrective actions.
- **Schedule:** programmes of recurring visits per checklist and site (fixed cadence or set by the risk band), assigned to inspectors; my schedule on the phone, all visits, a month calendar and overdue alerts.
- **Sampling:** attribute sampling plans: the sample size from population, confidence and tolerable/expected deviation, stratification and census items, a seeded selection anyone can re-run, and the projection with the upper deviation limit, evaluated automatically from the review inspection.
- **Risk:** a risk score per site from configurable, weighted drivers (inspection score, critical failures, deviation rate, overdue actions, repeat findings, time since the last visit, entered factors), in the six bands, with the reasons, risk-based visit frequency, a league table and a watchlist. Sent to Pulsus Risk in `/api/pulse`.
- **Templates:** the checklist builder (sections, eleven question types, weights, critical items, logic, guidance, policy references, auto-actions, a live phone preview, drag and drop), locked published versions, JSON and Excel import/export, and a library of 29 starter templates across five sectors. The institution's Branch Defects and Operational Standard are templates too.
- **Scorecards:** the scorecard designer (entered, computed and checklist-fed measures, weights, target, rounding, dashboard columns, sample-data preview, locked versions) and ready-made scorecards by sector.
- **Set up:** a wizard from sign-up to the first inspection: sector, site labels, locations (typed or pasted), starter checklists and a scorecard.
- **Review:** inspectors key reviews against their checklist on a phone (saved on the device as they type); a different supervisor approves or returns them.
- **Issues:** anyone (staff without a seat, contractors, customers, visitors) reports an observation, hazard, near miss or complaint from a site's QR poster or link, on a phone, with no sign-in or app; a supervisor triages it into an action or an inspection, or closes it with a reason.
- **Actions:** containment, corrective and preventive actions with owner, due date, root cause (5 whys and fishbone) and evidence, verified by someone who didn't raise, own or submit them, then an effectiveness check: the failed question passing on a later inspection, or a supervisor who didn't own it recording whether the fix held. A finding that fails again reopens its action instead of raising another.
- **Compare:** every site rolled up to its entity (a subsidiary, hospital, agency or campus), region or a named group, side by side, and each site benchmarked against the median.
- **Alerts:** the bell in the top bar shows what needs you (approvals, actions to verify, your overdue actions, effectiveness checks, reported issues); the same list goes out as one daily email per person when email is set up.
- **Report:** the executive report, printable to PDF, with PMAS to date; the committee report as a PDF and Excel workbook.
- **Settings:** the suite's grouped settings (plan and trial, company set-up, colour bands, people and roles, data and uploads, bulk import, how it's measured, integrations, API keys, email alerts, change history, approvals, appearance, about, help).
- **Bulk import:** locations, people or actions from Excel or CSV: download a template, upload, map the columns (the mapping is remembered), preview every row as new, update, duplicate or error with the reason, then import the good rows.
- **REST API:** company API keys (hashed, scoped, expiring, rotated with a day's grace, revocable) for other systems to read sites, inspections, actions, risk, sampling and issues, and to raise actions and report issues. See [docs/api.md](docs/api.md).

## Architecture

- Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript.
- Postgres via Drizzle (`lib/db/schema.ts`, migrations in `drizzle/`, embedded by `scripts/embed-migrations.mjs`). Neon in production; PGlite locally and in the tests.
- **Tenancy:** every table carries `company_id`; row-level security admits only the transaction's company (`lib/db/client.ts withTenant`), as the `quality_app` role. The institution is tenant `_own`; the demo `_demo`.
- **People:** the Pulsus Platform session (company members, or the institution's staff on its allow-list). Quality roles per member: admin, supervisor, inspector, branch manager, viewer, optionally scoped to units. No shared passwords.
- **Change history:** every change, with before → after, hash-chained per company and append-only (`lib/audit.ts`, `lib/auditchain.ts`).
- Evidence in private Blob storage, hashed (`lib/evidence.ts`).
- The pure figures (`lib/metrics.ts`, `lib/bands.ts`, `lib/scorecard.ts`) are shared by the server and the browser.

- **Email:** the daily alert email goes through Resend from "Pulsus Quality <support@pulsus.tech>", only when `RESEND_API_KEY` is set, never from a demo; Vercel Cron calls `/api/cron/notify` each morning with `CRON_SECRET` (`lib/notify.ts`).
- **Public report form:** `/r/<token>`; Cloudflare Turnstile checks each report when `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set, and a trap field and a per-address limit apply always.

Docs: [quality model and benchmark](docs/quality-model.md) · [migration](docs/migration.md) · [platform feed](docs/platform-feed.md) · [Pulsus Risk contract](docs/risk-contract.md) · [REST API](docs/api.md).

## Develop

```
npm install
npm run dev                         # http://localhost:3000 (needs a platform session; or:)
DEMO_MODE=1 npm run dev             # the demo, straight in
npm test                            # unit and database tests (PGlite, row-level security on)
DEMO_MODE=1 npm test
A11Y_BASE=http://localhost:3652 npm run test:a11y   # axe, WCAG 2.2 AA, against a running demo build
```

Change the schema in `lib/db/schema.ts`, then `npm run db:generate` and `node scripts/embed-migrations.mjs`.

## The institution

Everything that identifies the owner's own institution lives in `institution/` (server only, its own tenant only). A demo build aliases it to `demo-institution/`.

© 2026 Tumblehill Holdings LLC
