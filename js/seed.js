/**
 * Seed data for the Defect Tracker.
 *
 * These are sample defect records used to populate the tracker on first run.
 * Replace the contents of SEED_DEFECTS with your own data, or import a JSON
 * file via the "Import" button in the UI. The app persists everything to
 * localStorage, so this seed is only applied when no saved data exists.
 *
 * Schema per record:
 *   id          string   e.g. "DEF-001" (auto-generated for new defects)
 *   title       string
 *   description string
 *   status      "Open" | "In Progress" | "Resolved" | "Closed"
 *   severity    "Critical" | "High" | "Medium" | "Low"
 *   priority    "P0" | "P1" | "P2" | "P3"
 *   component   string
 *   assignee    string
 *   reporter    string
 *   createdAt   ISO date string
 *   updatedAt   ISO date string
 */
window.SEED_DEFECTS = [
  {
    id: "DEF-001",
    title: "Login fails with valid credentials after password reset",
    description: "Users who reset their password are unable to log in for ~5 minutes. Expected: login works immediately. Actual: 401 Unauthorized until the session cache expires.",
    status: "Open",
    severity: "Critical",
    priority: "P0",
    component: "Auth",
    assignee: "Priya Nair",
    reporter: "Support Team",
    createdAt: "2026-06-28T09:12:00Z",
    updatedAt: "2026-07-02T14:30:00Z",
  },
  {
    id: "DEF-002",
    title: "Checkout total ignores applied discount code",
    description: "Discount codes are accepted and shown in the cart, but the final charged amount is the pre-discount total.",
    status: "In Progress",
    severity: "Critical",
    priority: "P0",
    component: "Payments",
    assignee: "Marcus Lee",
    reporter: "QA",
    createdAt: "2026-06-25T11:00:00Z",
    updatedAt: "2026-07-03T08:45:00Z",
  },
  {
    id: "DEF-003",
    title: "Dashboard charts flicker on window resize",
    description: "Resizing the browser window causes the analytics charts to re-render repeatedly, producing a visible flicker.",
    status: "Open",
    severity: "Low",
    priority: "P3",
    component: "UI",
    assignee: "Sofia Almeida",
    reporter: "Design",
    createdAt: "2026-06-30T16:20:00Z",
    updatedAt: "2026-06-30T16:20:00Z",
  },
  {
    id: "DEF-004",
    title: "CSV export truncates rows beyond 10,000",
    description: "Exporting a large report silently stops at 10k rows with no warning to the user.",
    status: "In Progress",
    severity: "High",
    priority: "P1",
    component: "Reporting",
    assignee: "Marcus Lee",
    reporter: "Data Team",
    createdAt: "2026-06-20T13:05:00Z",
    updatedAt: "2026-07-01T10:15:00Z",
  },
  {
    id: "DEF-005",
    title: "Mobile nav menu does not close after selection",
    description: "On mobile, tapping a nav item navigates correctly but the slide-out menu stays open, covering the page.",
    status: "Resolved",
    severity: "Medium",
    priority: "P2",
    component: "UI",
    assignee: "Sofia Almeida",
    reporter: "QA",
    createdAt: "2026-06-15T09:40:00Z",
    updatedAt: "2026-06-29T12:00:00Z",
  },
  {
    id: "DEF-006",
    title: "API rate limiter counts cached responses",
    description: "Requests served from cache still decrement the rate-limit budget, causing clients to be throttled prematurely.",
    status: "Open",
    severity: "High",
    priority: "P1",
    component: "API",
    assignee: "Priya Nair",
    reporter: "Platform",
    createdAt: "2026-07-01T07:30:00Z",
    updatedAt: "2026-07-01T07:30:00Z",
  },
  {
    id: "DEF-007",
    title: "Email notifications sent in wrong timezone",
    description: "Scheduled digest emails use UTC instead of the user's configured timezone, arriving hours early.",
    status: "Closed",
    severity: "Medium",
    priority: "P2",
    component: "Notifications",
    assignee: "Aiden Koch",
    reporter: "Support Team",
    createdAt: "2026-06-05T08:00:00Z",
    updatedAt: "2026-06-22T17:10:00Z",
  },
  {
    id: "DEF-008",
    title: "Search returns stale results after item deletion",
    description: "Deleted items continue to appear in search for up to an hour due to a stale index.",
    status: "Open",
    severity: "Medium",
    priority: "P2",
    component: "Search",
    assignee: "Aiden Koch",
    reporter: "QA",
    createdAt: "2026-06-27T14:50:00Z",
    updatedAt: "2026-06-29T09:05:00Z",
  },
  {
    id: "DEF-009",
    title: "Profile image upload fails for HEIC files",
    description: "iOS users uploading HEIC images get a generic 'upload failed' error. JPEG/PNG work fine.",
    status: "In Progress",
    severity: "Low",
    priority: "P3",
    component: "Uploads",
    assignee: "Sofia Almeida",
    reporter: "Support Team",
    createdAt: "2026-06-18T10:25:00Z",
    updatedAt: "2026-07-02T11:40:00Z",
  },
  {
    id: "DEF-010",
    title: "Memory leak in background sync worker",
    description: "The sync worker's memory grows unbounded over ~6 hours until it is OOM-killed and restarted.",
    status: "Open",
    severity: "Critical",
    priority: "P1",
    component: "Sync",
    assignee: "Marcus Lee",
    reporter: "Platform",
    createdAt: "2026-06-29T22:15:00Z",
    updatedAt: "2026-07-03T06:00:00Z",
  },
  {
    id: "DEF-011",
    title: "Two-factor code accepted after expiry window",
    description: "TOTP codes remain valid for ~90s past their intended 30s window, weakening 2FA.",
    status: "Resolved",
    severity: "High",
    priority: "P1",
    component: "Auth",
    assignee: "Priya Nair",
    reporter: "Security",
    createdAt: "2026-06-12T15:30:00Z",
    updatedAt: "2026-06-28T13:20:00Z",
  },
  {
    id: "DEF-012",
    title: "Pagination skips last record on odd page counts",
    description: "When total records are odd, the final record is never shown on the last page of results.",
    status: "Closed",
    severity: "Medium",
    priority: "P2",
    component: "API",
    assignee: "Aiden Koch",
    reporter: "QA",
    createdAt: "2026-05-30T12:00:00Z",
    updatedAt: "2026-06-18T16:45:00Z",
  },
];
