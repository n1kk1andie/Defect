# Pulsus Quality — Branch Defects & Operational Standard Tracker

A Next.js app for branch audit data, styled to match Pulsus Risk
(`n1kk1andie/My-Risk`): Sora + IBM Plex Sans, brand red
(`#E4012B`), card/hero language, RAG (red/amber/green) status, heatmaps and
bottom-tab navigation. A top toggle switches between two datasets that share the
same **Pulse / Heatmap / Register** screens.

Data, uploads and admin auth are backed by a **proper server**: Next.js API
routes with **Vercel Blob** persistence and server-side (scrypt + signed-cookie)
authentication.

## The two datasets

| Toggle | Headline metric | Shape |
|---|---|---|
| **Branch Defects** | Defect rate (lower is better) | branches × process areas × months |
| **Operational Standard** | Operational Standard Score (higher is better) | branches × 9 scores × months |

### The owner's own institution: `institution/`

Everything that names or identifies the live deployment's own institution — its
name, email domain and default supervisor, named administrators, branch-name
spellings, the bundled history workbooks (`institution/seed-*.json`) and their
converters (`institution/scripts/`) — lives in `institution/` and nowhere else.
It is read on the server only, for the own tenant only. A demo build
(`DEMO_MODE=1`) never compiles it: `next.config.mjs` aliases `@/institution` and
`@/institution/data` to the neutral stand-ins in `demo-institution/`.

### The demo's locked date

A demo deployment is locked to **30 Oct 2026** (`DEMO_AS_OF` overrides): every
business use of "today" goes through `lib/asOf.ts`, the fictional data runs up to
that date and nothing after it is listed or can be keyed. Session and cookie
expiry keep the real clock. Production is unaffected.

### Screens (both datasets)

- **Pulse** — headline hero, KPI cards, RAG-coloured monthly trend, and
  breakdowns. The Operational Standard Pulse also shows an **Audit Grades by
  Month** stacked bar (grades derived from the mixed-scale audit score — 2024's
  1–5 scale and the 2025+ A–D scale).
- **Heatmap** — Branch × Month, switchable across each dataset's metrics.
- **Register** — per-branch (or per-process-area) table, sortable, with totals.
- **Settings** (admin) — download/upload the dataset workbook and change the
  admin password.

Global filters (year, branch, and — for Branch Defects — process area) apply
across all tabs. The header ⤓ button exports the current filtered scope to CSV.

Data-quality handling (see `lib/xlsx.ts` / `institution/scripts/`): the mislabeled `Month`
column is dropped (month derived from `Period`), percentages are recomputed from
raw counts, the overall Operational Standard Score is shown as untracked before
May 2025, and empty future placeholder months are excluded from trends.

## Backend

- **`GET /api/data`** — the two datasets (from Blob if uploaded, else the bundled
  seed) plus per-dataset `uploaded` flags. Rendered server-side on first paint.
- **`GET /api/file?dataset=…`** — download the current workbook as `.xlsx`.
- **`POST /api/upload`** (admin) — upload an `.xlsx` (raw body). The dataset type
  is auto-detected from the headers, parsed server-side (SheetJS), and persisted
  to Blob (`defects.json`/`opstd.json` + the workbook). `?reset=…` restores the
  bundled seed.
- **`POST /api/login` · `GET /api/login` · `POST /api/logout`** — sign in / status
  / sign out. A valid password is exchanged for an httpOnly, signed session cookie.
- **`POST /api/password`** (admin) — change the admin password (scrypt-hashed and
  persisted to Blob; takes precedence over the fallback).

Storage adapter (`lib/storage.ts`): **Vercel Blob** when `BLOB_READ_WRITE_TOKEN`
is present (production), otherwise a local `./.data` folder for `next dev`.

## Configuration

Set these in Vercel (see `.env.example`):

| Var | Purpose |
|---|---|
| `SESSION_SECRET` | **Required.** Signs the session cookie. `openssl rand -base64 32`. |
| `ADMIN_PASSWORD` | **Optional.** Password for the Settings page. Overrides the built-in default (`pa55w0rd`) when set. |
| `BLOB_READ_WRITE_TOKEN` | Injected automatically when you connect a Vercel Blob store. |

Sign-in works out of the box with the built-in default password `pa55w0rd` — no
env var or Vercel setup required. Override it with `ADMIN_PASSWORD`, or change it
in-app (Settings → Admin password); the new scrypt hash is persisted to storage
and takes precedence over both the env var and the default.

## Develop

```bash
npm install
cp .env.example .env.local        # SESSION_SECRET recommended; ADMIN_PASSWORD + Blob token optional (uses ./.data)
npm run dev                        # http://localhost:3000
npm run build                      # production build
npm run typecheck
```

Sign in to Settings with the default password `pa55w0rd`, or set `ADMIN_PASSWORD` in `.env.local` to override it.

## Regenerating the seed from spreadsheets

```bash
pip install openpyxl
python3 institution/scripts/convert.py       Branch_Defects_Consolidated.xlsx        > institution/seed-defects.json
python3 institution/scripts/convert_opstd.py Operational_Standards_Consolidated.xlsx > institution/seed-opstd.json
```

## Structure

```
app/
  layout.tsx · page.tsx · globals.css     # shell, fonts, server-loaded initial data
  api/{data,file,upload,login,logout,password}/route.ts
components/TrackerApp.tsx                  # client shell; mounts the render engine
lib/
  engine.js                               # UI rendering (Pulse/Heatmap/Register/Settings)
  storage.ts · auth.ts · data.ts · xlsx.ts
  asOf.ts                                 # business date (demo: locked to 30 Oct 2026)
  demo.ts                                 # demo mode: fictional Meridian Society data
institution/                               # the owner's own institution (server-only, own tenant only)
  index.ts · data.ts · seed-*.json · scripts/
demo-institution/                          # neutral stand-ins compiled into a demo build instead
```
