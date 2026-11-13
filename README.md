# Pulsus Quality

Quality management and inspections for multi-site organisations: banks and credit unions, hospitals and health systems, government agencies, universities and any business with many sites. Part of the Pulsus suite. **Live. Signal. Clarity.**

- **Pulse:** defect rate, defects found, resolved and recurring, the trend, every branch and process area; or the Operational Standard scorecard against its target, with audit grades.
- **Register:** the counts behind every rate (sortable, CSV/Excel) and each published defect, which supervisors resolve or turn into actions.
- **History:** branch × month heat-maps of the defect, resolution and recurring rates, and branch × process area.
- **Insights:** the branch watchlist, the resolution gap, recurring-issue detection (preventive actions, send to Pulsus Risk), systemic recurring, scorecard vs defects.
- **Inspect:** inspections, field visits and file reviews on any published template, on a phone and offline: check-in, photos per question, signatures, live score; a supervisor who didn't carry it out approves it, and failed items become corrective actions.
- **Templates:** the checklist builder (sections, eleven question types, weights, critical items, logic, guidance, policy references, auto-actions, a live phone preview, drag and drop), locked published versions, JSON and Excel import/export, and a library of 29 starter templates across five sectors. The institution's Branch Defects and Operational Standard are templates too.
- **Scorecards:** the scorecard designer (entered, computed and checklist-fed measures, weights, target, rounding, dashboard columns, sample-data preview, locked versions) and ready-made scorecards by sector.
- **Set up:** a wizard from sign-up to the first inspection: sector, site labels, locations (typed or pasted), starter checklists and a scorecard.
- **Review:** inspectors key reviews against their checklist on a phone (saved on the device as they type); a different supervisor approves or returns them.
- **Actions:** corrective and preventive actions with owner, due date, root cause and evidence, verified by someone who didn't raise, own or submit them.
- **Report:** the executive report, printable to PDF, with PMAS to date.
- **Settings:** the suite's grouped settings (plan and trial, company set-up, colour bands, people and roles, data and uploads, how it's measured, integrations, change history, approvals, appearance, about, help).

## Architecture

- Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript.
- Postgres via Drizzle (`lib/db/schema.ts`, migrations in `drizzle/`, embedded by `scripts/embed-migrations.mjs`). Neon in production; PGlite locally and in the tests.
- **Tenancy:** every table carries `company_id`; row-level security admits only the transaction's company (`lib/db/client.ts withTenant`), as the `quality_app` role. The institution is tenant `_own`; the demo `_demo`.
- **People:** the Pulsus Platform session (company members, or the institution's staff on its allow-list). Quality roles per member: admin, supervisor, inspector, branch manager, viewer, optionally scoped to units. No shared passwords.
- **Change history:** every change, with before → after, hash-chained per company and append-only (`lib/audit.ts`, `lib/auditchain.ts`).
- Evidence in private Blob storage, hashed (`lib/evidence.ts`).
- The pure figures (`lib/metrics.ts`, `lib/bands.ts`, `lib/scorecard.ts`) are shared by the server and the browser.

Docs: [quality model and benchmark](docs/quality-model.md) · [migration](docs/migration.md) · [platform feed](docs/platform-feed.md) · [Pulsus Risk contract](docs/risk-contract.md).

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
