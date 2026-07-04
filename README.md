# 🐞 Defect Tracker

A lightweight, self-contained defect (bug) tracker that runs entirely in the
browser — **no build step, no server, no dependencies**. Open `index.html` and
start tracking. Data persists in the browser via `localStorage`.

> **Note on the initial data:** the task was to "build a tracker using this
> data," but no data file was reachable in the session (the repo was empty and
> the connectors required interactive approval that isn't available in an async
> run). The tracker therefore ships with realistic **sample defect records** in
> [`js/seed.js`](js/seed.js). Swapping in real data is a one-file edit or a
> single **Import** click — see [Using your own data](#using-your-own-data).

## Features

- **Board view** — Kanban columns (Open · In Progress · Resolved · Closed) with
  drag-and-drop to change status.
- **Table view** — sortable, scannable list.
- **Dashboard stats** — totals, open/in-progress counts, resolution rate, and
  open-critical count.
- **Search & filter** — full-text search plus filters by status, severity, and
  assignee.
- **Sort** — by updated/created date, severity, priority, or title.
- **Create / edit / delete** defects via a modal editor.
- **Import / Export JSON** — back up or load your data.
- **Light & dark themes** — toggle in the header (remembered across sessions).
- **Responsive** — works on desktop and mobile.

## Running it

No tooling required. Either:

```bash
# Option A — just open the file
open index.html          # macOS
xdg-open index.html      # Linux

# Option B — serve it (recommended; avoids any file:// quirks)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Data model

Each defect is a plain object (see [`js/seed.js`](js/seed.js)):

| Field         | Type   | Values / notes                                   |
|---------------|--------|--------------------------------------------------|
| `id`          | string | e.g. `DEF-001` (auto-generated for new defects)  |
| `title`       | string | required                                         |
| `description` | string | free text                                        |
| `status`      | string | `Open` · `In Progress` · `Resolved` · `Closed`   |
| `severity`    | string | `Critical` · `High` · `Medium` · `Low`           |
| `priority`    | string | `P0` · `P1` · `P2` · `P3`                         |
| `component`   | string | e.g. `Auth`, `API`, `UI`                         |
| `assignee`    | string | owner                                            |
| `reporter`    | string | who filed it                                     |
| `createdAt`   | string | ISO 8601 timestamp                               |
| `updatedAt`   | string | ISO 8601 timestamp                               |

## Using your own data

Three ways, easiest first:

1. **Import** — click **Import** in the header and select a JSON file that is an
   array of defect objects (the same shape as the table above). Missing fields
   are filled with sensible defaults.
2. **Edit the seed** — replace the contents of `window.SEED_DEFECTS` in
   [`js/seed.js`](js/seed.js), then clear the site's `localStorage` (or use a
   fresh browser profile) so the new seed is applied.
3. **In-app** — use **+ New Defect** to add records one at a time.

Use **Export** at any time to download the current data as JSON.

## Resetting

The app stores everything under the `localStorage` key `defect-tracker:v1`.
To start over, clear site data in your browser, or run in the console:

```js
localStorage.removeItem("defect-tracker:v1");
location.reload();
```

## Project structure

```
.
├── index.html        # markup + layout
├── css/styles.css    # styling, light/dark themes, responsive rules
├── js/seed.js        # sample data (edit to use your own)
└── js/app.js         # all app logic (state, rendering, persistence)
```
