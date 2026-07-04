# VM Building Society — Branch Defects Tracker

A self-contained tracker for VMBS branch audit defects, built to be **visually
consistent with the VMBS Operational Risk & Audit app** (`n1kk1andie/My-Risk`):
same Sora + IBM Plex Sans type, VM red (`#E4012B`), card + hero language, RAG
(red/amber/green) status, heatmaps and bottom-tab navigation.

No build step, no server, no dependencies — open `index.html` and it runs. All
logic is vanilla JS.

## Data

Built from **`Branch_Defects_Consolidated_2024_2026.xlsx`** — a complete grid of
**16 branches × 5 process areas × 36 months (Jan 2024 – Dec 2026) = 2,880 rows**.
Each row carries: items reviewed, possible instances, defects, resolvable
defects, defects resolved, and recurring defects.

The spreadsheet is converted to a compact, indexed [`js/data.js`](js/data.js) at
~64 KB. Two data-quality decisions, applied on conversion:

- **The `Month` column was dropped** — it was mislabeled (it read "June" for
  every January-2024 row, and was wrong in 100% of rows). Month is derived from
  the reliable ISO `Period` date instead.
- **Percentages are recomputed from raw counts.** The sheet's `% Defects
  Resolved` was unreliable (it exceeds 100% wherever resolved > resolvable —
  backlog clearance), so all rates are computed in-app:
  - Defect rate = defects ÷ possible instances
  - Resolution rate = defects resolved ÷ resolvable defects *(can exceed 100%)*
  - Recurring rate = recurring defects ÷ defects
- **Aug–Dec 2026 are empty placeholders** in the source (400 all-zero rows), so
  trends and heatmaps run through the last month with activity.

## The two views (top toggle)

Both datasets flow through the same three tabs — **Pulse**, **Heatmap**,
**Register** — via a small dataset abstraction in `js/app.js`.

| Toggle | Data | Headline metric |
|---|---|---|
| **Branch Defects** | `js/data.js` (16 branches × 5 process areas × 36 months) | Defect rate (lower is better) |
| **Operational Standard** | `js/opstd.js` (16 branches × 9 scores × 29 months) | Operational Standard Score (higher is better) |

### Branch Defects

- **Pulse** — headline defect rate (red hero), KPI cards, RAG-coloured monthly
  trend, and breakdowns by process area and by branch.
- **Heatmap** — Branch × Month grid, coloured by **defect rate**, **resolution
  rate**, or **recurring rate** (switchable). Tap any cell for detail.
- **Register** — consolidated table grouped by branch (or by process area when a
  single branch is selected), sortable, with a totals row.

### Operational Standard

Per-branch monthly performance **scores (0–100, higher is better)** — SLA
adherence, onboarding, procurement, procedure compliance, complaints, audit
resolution — banded on the risk app's world-class scale (≥95 World Class, ≥90
Industry Average, ≥80 Non-Competitive, <80 Unacceptable).

- **Pulse** — overall Operational Standard Score hero, key-metric KPI cards,
  score trend, a per-standard breakdown, and an **Audit Grades by Month** stacked
  bar (see below).
- **Heatmap** — Branch × Month, switchable across all nine score metrics.
- **Register** — every branch's average across all nine metrics, sortable.

Two source-data notes for this dataset:

- **The overall "Operational Standard Score" was only introduced in May 2025**,
  so it's null before then; the app shows those months as "not tracked" and says
  so in the hero coverage line.
- **Audit grades from a messy column.** The `Audit Score` column mixes two
  scales — a 1–5 scale in 2024 and a 20–100 (D…A) scale from 2025 — so the raw
  numbers aren't comparable. Rather than chart a misleading metric, the app
  derives a **letter grade** from each value (2024: 5→A, 4→B, 3→C, 2→D, 1→F;
  2025+: 100→A, 80→B+, 60→B, 40→C, 20→D — the mapping the source's own formula
  text uses) and shows the **grade distribution as a stacked bar per month**.

Global **filters** (year, branch, and — for Branch Defects — process area) apply
across all tabs. The header **⤓ button** exports the current filtered scope to CSV.

### Settings (admin)

A fourth **Settings** tab mirrors the risk app's admin screen. It's gated behind
an admin sign-in (a lock shows on the tab until you sign in):

- **Download** the current dataset as an `.xlsx` (rebuilt client-side from the
  in-app data via a vendored copy of SheetJS — no CDN).
- **Upload** an updated `.xlsx`. The file type (Branch Defects vs Operational
  Standard) is auto-detected from its headers, parsed in the browser, and stored
  in `localStorage` so it survives reloads. **Reset to built-in** clears it.
- **Change the admin password** and **sign out**.

Because this app is fully static (no server), these are **browser-local**
equivalents of the risk app's server-backed features: uploaded data lives in
your browser only, and the admin password is stored client-side (default:
`admin`) — it is not shared across devices and is not a real security boundary.
The default admin password gates the editing UI, not the read-only dashboards.

## Running it

```bash
open index.html          # macOS
xdg-open index.html      # Linux
# or serve it:
python3 -m http.server 8000   # then visit http://localhost:8000
```

Fonts (Sora, IBM Plex Sans) load from Google Fonts to match the risk app; if
offline they degrade gracefully to the system sans-serif.

## Regenerating the data from new spreadsheets

```bash
pip install openpyxl
python3 scripts/convert.py       path/to/Branch_Defects_Consolidated.xlsx        > js/data.js
python3 scripts/convert_opstd.py path/to/Operational_Standards_Consolidated.xlsx > js/opstd.js
```

## Project structure

```
.
├── index.html               # shell: appbar, mode toggle, tab bar
├── css/styles.css           # VMBS design system (ported from My-Risk)
├── js/data.js               # Branch Defects dataset (generated from the xlsx)
├── js/opstd.js              # Operational Standard dataset (generated from the xlsx)
├── js/app.js                # state, models, screens, Settings (upload/download/auth), CSV export
├── js/vendor/xlsx.full.min.js  # SheetJS 0.18.5 (vendored, for .xlsx import/export)
└── scripts/
    ├── convert.py           # xlsx → js/data.js
    └── convert_opstd.py     # xlsx → js/opstd.js
```
