# VM Building Society — Branch Defects & Operational Standard Tracker

A Next.js app for VMBS branch audit data, styled to match the VMBS Operational
Risk & Audit app (`n1kk1andie/My-Risk`): Sora + IBM Plex Sans, VM red
(`#E4012B`), card/hero language, RAG (red/amber/green) status, heatmaps and
bottom-tab navigation. A top toggle switches between two datasets that share the
same **Pulse / Heatmap / Register** screens.

Data, uploads and admin auth are backed by a **proper server**: Next.js API
routes with **Vercel Blob** persistence and server-side (scrypt + signed-cookie)
authentication.

## The two datasets

| Toggle | Headline metric | Shape |
|---|---|---|
| **Branch Defects** | Defect rate (lower is better) | 16 branches × 5 process areas × 36 months |
| **Operational Standard** | Operational Standard Score (higher is better) | 16 branches × 9 scores × 29 months |

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

Data-quality handling (see `lib/xlsx.ts` / `scripts/`): the mislabeled `Month`
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
| `BLOB_READ_WRITE_TOKEN` | Injected automatically when you connect a Vercel Blob store. |
| `ADMIN_PASSWORD` | Optional initial password. If unset, the default is **`pa55w0rd`**. |

The admin password can be changed in-app (Settings → Admin password); the new
scrypt hash is persisted to Blob and takes precedence over `ADMIN_PASSWORD`.

## Develop

```bash
npm install
cp .env.example .env.local        # set SESSION_SECRET; Blob token optional (uses ./.data)
npm run dev                        # http://localhost:3000
npm run build                      # production build
npm run typecheck
```

Default admin password locally: **`pa55w0rd`**.

## Regenerating the seed from spreadsheets

```bash
pip install openpyxl
python3 scripts/convert.py       Branch_Defects_Consolidated.xlsx        > lib/seed-defects.json
python3 scripts/convert_opstd.py Operational_Standards_Consolidated.xlsx > lib/seed-opstd.json
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
  seed-defects.json · seed-opstd.json
scripts/convert.py · convert_opstd.py      # xlsx → seed JSON
```
