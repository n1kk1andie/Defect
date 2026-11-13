// Pulsus Quality's database (Postgres: Neon in production, PGlite locally and in
// the tests). Every table but the migration ledger carries company_id and is
// guarded by row-level security (lib/db/migrations.ts, 0001_tenancy): a query
// only ever sees the rows of the company its transaction was opened for
// (lib/db/client.ts withTenant). The application layer filters by company too,
// so isolation holds twice over.
//
// Change this file, then `npm run db:generate` and `node scripts/embed-migrations.mjs`.
import { sql } from "drizzle-orm";
import {
  bigserial, boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** A tenant: a Pulsus platform company, the owner's own institution ("_own") or the demo ("_demo"). */
export const companies = pgTable("companies", {
  companyId: text("company_id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // institution | company | demo
  createdAt: createdAt(),
});

/** One row per company: labels, how instances are counted, colour bands, scorecard switch. */
export const companySettings = pgTable("company_settings", {
  companyId: text("company_id").primaryKey(),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  updatedAt: updatedAt(),
  updatedBy: text("updated_by"),
});

/** A company member's Quality roles and the units (branches) they are scoped to (empty = all). */
export const members = pgTable("members", {
  companyId: text("company_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
  unitIds: text("unit_ids").array().notNull().default(sql`'{}'::text[]`),
  status: text("status").notNull().default("active"), // active | removed
  source: text("source").notNull().default("platform"), // platform | admin | migrated | demo
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.companyId, t.email] })]);

export const units = pgTable("units", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  code: text("code"),
  region: text("region"),
  /** The entity (hospital, agency, campus, subsidiary) the site belongs to, in a multi-entity group. */
  entityId: text("entity_id"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("units_company_name").on(t.companyId, t.name)]);

export const areas = pgTable("areas", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("areas_company_name").on(t.companyId, t.name)]);

/** A checklist item within a process area, with its severity (critical | major | minor). */
export const checks = pgTable("checks", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  areaId: text("area_id").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  severity: text("severity").notNull().default("major"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("checks_area_code").on(t.companyId, t.areaId, t.code)]);

/** Defect natures (the kinds of defect a reviewer records), each in a reporting category. */
export const natures = pgTable("natures", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  areaId: text("area_id"),
  label: text("label").notNull(),
  category: text("category").notNull().default("Process"),
});

/** Branch Defects history at month × unit × area grain (imported workbooks and the migrated datasets). */
export const monthlyStats = pgTable("monthly_stats", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companyId: text("company_id").notNull(),
  period: date("period").notNull(),
  unitId: text("unit_id").notNull(),
  areaId: text("area_id").notNull(),
  reviewed: integer("reviewed").notNull().default(0),
  instances: integer("instances").notNull().default(0),
  defects: integer("defects").notNull().default(0),
  resolvable: integer("resolvable").notNull().default(0),
  resolved: integer("resolved").notNull().default(0),
  recurring: integer("recurring").notNull().default(0),
  source: text("source").notNull().default("import"),
  batchId: text("batch_id"),
}, (t) => [uniqueIndex("monthly_stats_cell").on(t.companyId, t.period, t.unitId, t.areaId, t.source)]);

/** A review (submission): an inspector's sample of one unit for one month, or a scorecard entry. */
export const reviews = pgTable("reviews", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  ref: text("ref").notNull(),
  kind: text("kind").notNull().default("checklist"), // checklist | scorecard
  unitId: text("unit_id").notNull(),
  period: date("period").notNull(),
  entryDate: date("entry_date").notNull(),
  status: text("status").notNull().default("draft"), // draft | submitted | returned | published
  inspectorEmail: text("inspector_email").notNull(),
  supervisorEmail: text("supervisor_email"),
  note: text("note").notNull().default(""),
  scorecardValues: jsonb("scorecard_values"),
  auditGrade: text("audit_grade"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => [index("reviews_company_status").on(t.companyId, t.status), uniqueIndex("reviews_ref").on(t.companyId, t.ref)]);

/** One sampled item in a review: its checks (yes | no | na), defects, nature, recurring flag and resolution. */
export const reviewItems = pgTable("review_items", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  reviewId: text("review_id").notNull(),
  idx: integer("idx").notNull(),
  areaId: text("area_id").notNull(),
  itemType: text("item_type").notNull().default(""),
  reference: text("reference").notNull().default(""),
  checks: jsonb("checks").notNull().default(sql`'{}'::jsonb`),
  defects: integer("defects").notNull().default(0),
  nature: text("nature").notNull().default(""),
  recurring: boolean("recurring").notNull().default(false),
  status: text("status").notNull().default("open"), // open | resolved
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
}, (t) => [index("review_items_review").on(t.companyId, t.reviewId)]);

export const reviewEvents = pgTable("review_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companyId: text("company_id").notNull(),
  reviewId: text("review_id").notNull(),
  status: text("status").notNull(),
  by: text("by").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

/** A configurable scorecard (the Operational Standard is the first template). */
export const scorecards = pgTable("scorecards", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  definition: jsonb("definition").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  createdBy: text("created_by"),
  /** The designer's working copy; publishing freezes it as the next version. */
  draft: jsonb("draft"),
  dirty: boolean("dirty").notNull().default(false),
  origin: text("origin").notNull().default("custom"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  updatedBy: text("updated_by"),
});

/** Published scorecard versions: immutable (a trigger refuses updates). */
export const scorecardVersions = pgTable("scorecard_versions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  scorecardId: text("scorecard_id").notNull(),
  version: integer("version").notNull(),
  definition: jsonb("definition").notNull(),
  publishedBy: text("published_by").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("scorecard_versions_v").on(t.companyId, t.scorecardId, t.version)]);

/** A unit's scorecard for one month: measure values (0–100) and the raw audit score. */
export const scorecardEntries = pgTable("scorecard_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companyId: text("company_id").notNull(),
  scorecardId: text("scorecard_id").notNull(),
  period: date("period").notNull(),
  unitId: text("unit_id").notNull(),
  values: jsonb("values").notNull(),
  auditRaw: doublePrecision("audit_raw"),
  source: text("source").notNull().default("import"),
  reviewId: text("review_id"),
}, (t) => [uniqueIndex("scorecard_entries_cell").on(t.companyId, t.scorecardId, t.period, t.unitId)]);

/** Corrective and preventive actions (CAPA). */
export const actions = pgTable("actions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  ref: text("ref").notNull(),
  kind: text("kind").notNull().default("corrective"), // corrective | preventive
  unitId: text("unit_id").notNull(),
  areaId: text("area_id"),
  title: text("title").notNull(),
  details: text("details").notNull().default(""),
  rootCause: text("root_cause").notNull().default(""),
  priority: text("priority").notNull().default("medium"), // high | medium | low
  ownerEmail: text("owner_email"),
  ownerName: text("owner_name").notNull().default(""),
  dueDate: date("due_date").notNull(),
  status: text("status").notNull().default("open"), // open | in_progress | awaiting_verification | closed
  closureNote: text("closure_note").notNull().default(""),
  raisedBy: text("raised_by").notNull(),
  verifierEmail: text("verifier_email"),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  sourceType: text("source_type").notNull().default("manual"), // manual | review_item | recurring | migrated | inspection | issue_report | import | api
  sourceId: text("source_id"),
  /** Root cause analysis: the 5 whys and the fishbone categories. */
  rca: jsonb("rca"),
  /** Days after closure when the effectiveness check falls due (0 = none). */
  effectivenessDays: integer("effectiveness_days").notNull().default(0),
  /** The effectiveness check: due date, status (pending | due | effective | ineffective), evidence. */
  effectiveness: jsonb("effectiveness"),
  /** How many times the finding came back and reopened the action. */
  reopenCount: integer("reopen_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("actions_ref").on(t.companyId, t.ref), index("actions_company_status").on(t.companyId, t.status)]);

export const actionEvents = pgTable("action_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companyId: text("company_id").notNull(),
  actionId: text("action_id").notNull(),
  kind: text("kind").notNull(), // status | edited | evidence | comment
  status: text("status"),
  by: text("by").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

/** Evidence and photos: the bytes stay in private Blob storage; this row holds what and where. */
export const evidence = pgTable("evidence", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  entityType: text("entity_type").notNull(), // review | action
  entityId: text("entity_id").notNull(),
  name: text("name").notNull(),
  size: integer("size").notNull().default(0),
  contentType: text("content_type").notNull().default("application/octet-stream"),
  sha256: text("sha256"),
  blobKey: text("blob_key").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("evidence_entity").on(t.companyId, t.entityType, t.entityId)]);

/** Change history: who, what, when, before → after, hash-chained per company so tampering shows. */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companyId: text("company_id").notNull(),
  seq: integer("seq").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  summary: text("summary").notNull().default(""),
  before: jsonb("before"),
  after: jsonb("after"),
  requestId: text("request_id"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
}, (t) => [uniqueIndex("audit_log_seq").on(t.companyId, t.seq)]);

/** Imports and migrations: a dry run (preview) first, then a commit only after an admin confirms. */
export const imports = pgTable("imports", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  kind: text("kind").notNull(), // legacy | workbook_defects | workbook_opstd
  status: text("status").notNull().default("preview"), // preview | committed | discarded
  summary: jsonb("summary").notNull(),
  plan: jsonb("plan").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  committedBy: text("committed_by"),
  committedAt: timestamp("committed_at", { withTimezone: true }),
});

/** Items proposed to Pulsus Risk (docs/risk-contract.md). Sending is stubbed until Risk's intake is live. */
export const riskOutbox = pgTable("risk_outbox", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("queued"), // queued | sent | failed | stubbed
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  response: jsonb("response"),
  /** The payload id (SHA-256 of company, record type and record): one row per proposal. */
  proposalId: text("proposal_id"),
  /** finding | kri_breach | issue | risk_event */
  kind: text("kind"),
  /** Set by the automatic rules (site band, critical failure, failed sample), else null. */
  rule: text("rule"),
  attempts: integer("attempts").notNull().default(1),
  riskRef: text("risk_ref"),
  /** Risk's decision when it calls back: accepted | rejected. */
  decision: text("decision"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [uniqueIndex("risk_outbox_proposal").on(t.companyId, t.proposalId)]);

/** A checklist template a company built, imported or added from the library. The draft is edited; publishing freezes a version. */
export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  sector: text("sector").notNull().default("general"),
  category: text("category").notNull().default(""),
  status: text("status").notNull().default("draft"), // draft | published | archived
  draft: jsonb("draft").notNull(),
  /** The latest published version (0 = never published). */
  version: integer("version").notNull().default(0),
  /** Whether the draft differs from the latest published version. */
  dirty: boolean("dirty").notNull().default(true),
  origin: text("origin").notNull().default("custom"), // custom | library:<key> | import | migrated | copy:<id>
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  updatedBy: text("updated_by"),
}, (t) => [index("templates_company").on(t.companyId, t.status)]);

/** Published template versions: immutable (a trigger refuses updates). Inspections keep the version they were started on. */
export const templateVersions = pgTable("template_versions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  templateId: text("template_id").notNull(),
  version: integer("version").notNull(),
  definition: jsonb("definition").notNull(),
  sha256: text("sha256").notNull(),
  publishedBy: text("published_by").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note").notNull().default(""),
}, (t) => [uniqueIndex("template_versions_v").on(t.companyId, t.templateId, t.version)]);

/** An inspection (or field visit): a template version answered at one site for one period. */
export const inspections = pgTable("inspections", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  ref: text("ref").notNull(),
  /** Generated on the device, so a retried save after a dropped connection never makes a second inspection. */
  clientId: text("client_id"),
  templateId: text("template_id").notNull(),
  templateVersion: integer("template_version").notNull(),
  unitId: text("unit_id").notNull(),
  period: date("period").notNull(),
  status: text("status").notNull().default("draft"), // draft | submitted | returned | approved
  inspectorEmail: text("inspector_email").notNull(),
  supervisorEmail: text("supervisor_email"),
  answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
  items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
  signatures: jsonb("signatures").notNull().default(sql`'{}'::jsonb`),
  checkin: jsonb("checkin"),
  score: jsonb("score"),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("inspections_ref").on(t.companyId, t.ref),
  uniqueIndex("inspections_client").on(t.companyId, t.clientId),
  index("inspections_company_status").on(t.companyId, t.status),
  index("inspections_template").on(t.companyId, t.templateId),
]);

export const inspectionEvents = pgTable("inspection_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companyId: text("company_id").notNull(),
  inspectionId: text("inspection_id").notNull(),
  status: text("status").notNull(),
  by: text("by").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

/** A sampling plan: the population, the method, the seeded selection and its evaluation. */
export const samplingPlans = pgTable("sampling_plans", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  ref: text("ref").notNull(),
  name: text("name").notNull(),
  templateId: text("template_id"),
  unitId: text("unit_id"),
  period: date("period"),
  method: text("method").notNull().default("statistical"), // statistical | judgmental
  confidence: doublePrecision("confidence"),
  tdr: doublePrecision("tdr"),
  edr: doublePrecision("edr"),
  populationSize: integer("population_size").notNull(),
  /** The listed items (id, stratum, value), or empty when only the size was given. */
  population: jsonb("population").notNull().default(sql`'[]'::jsonb`),
  populationHash: text("population_hash").notNull(),
  stratify: boolean("stratify").notNull().default(false),
  censusAbove: doublePrecision("census_above"),
  sampleSize: integer("sample_size").notNull(),
  seed: text("seed").notNull(),
  selection: jsonb("selection").notNull().default(sql`'[]'::jsonb`),
  allocation: jsonb("allocation").notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("selected"), // selected | evaluated
  inspectionId: text("inspection_id"),
  evaluation: jsonb("evaluation"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("sampling_plans_ref").on(t.companyId, t.ref)]);

/** An inspection programme: which checklist, at which sites, how often, by whom, within what window. */
export const programmes = pgTable("programmes", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  templateId: text("template_id").notNull(),
  /** Empty = every active site. */
  unitIds: text("unit_ids").array().notNull().default(sql`'{}'::text[]`),
  /** Days between visits, or 0 for risk-based (the site's band sets it). */
  everyDays: integer("every_days").notNull().default(30),
  windowDays: integer("window_days").notNull().default(14),
  assignees: text("assignees").array().notNull().default(sql`'{}'::text[]`),
  startDate: date("start_date").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Organisation-specific risk factors entered per site (0–100). */
export const unitFactors = pgTable("unit_factors", {
  companyId: text("company_id").notNull(),
  unitId: text("unit_id").notNull(),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  updatedAt: updatedAt(),
  updatedBy: text("updated_by"),
}, (t) => [primaryKey({ columns: [t.companyId, t.unitId] })]);

/** An entity within a group: a hospital in a health system, an agency in a ministry, a campus in a university system. */
export const entities = pgTable("entities", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  code: text("code"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("entities_company_name").on(t.companyId, t.name)]);

/** A named set of sites for comparison (e.g. "Urban branches", "Surgical wards"). */
export const siteGroups = pgTable("site_groups", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  unitIds: text("unit_ids").array().notNull().default(sql`'{}'::text[]`),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("site_groups_company_name").on(t.companyId, t.name)]);

/** The public "report an issue" link of a site (printed as a QR code). Rotating it retires the old link. */
export const reportLinks = pgTable("report_links", {
  companyId: text("company_id").notNull(),
  unitId: text("unit_id").notNull(),
  token: text("token").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.companyId, t.unitId] }), uniqueIndex("report_links_token").on(t.token)]);

/** An observation, hazard or complaint raised by anyone from a site's link, with no sign-in. A supervisor triages it. */
export const issueReports = pgTable("issue_reports", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  ref: text("ref").notNull(),
  unitId: text("unit_id").notNull(),
  category: text("category").notNull(), // observation | hazard | near_miss | complaint | other
  description: text("description").notNull(),
  location: text("location").notNull().default(""),
  reporterName: text("reporter_name").notNull().default(""),
  reporterContact: text("reporter_contact").notNull().default(""),
  status: text("status").notNull().default("new"), // new | action | inspection | dismissed
  triageNote: text("triage_note").notNull().default(""),
  triagedBy: text("triaged_by"),
  triagedAt: timestamp("triaged_at", { withTimezone: true }),
  actionId: text("action_id"),
  inspectionId: text("inspection_id"),
  source: text("source").notNull().default("link"), // link | qr | api
  createdAt: createdAt(),
}, (t) => [uniqueIndex("issue_reports_ref").on(t.companyId, t.ref), index("issue_reports_status").on(t.companyId, t.status)]);

/** A saved report: its sections, filters, format and schedule. */
export const savedReports = pgTable("saved_reports", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  sections: text("sections").array().notNull().default(sql`'{}'::text[]`),
  filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
  format: text("format").notNull().default("pdf"), // pdf | xlsx | both
  schedule: jsonb("schedule").notNull().default(sql`'{"every":"none"}'::jsonb`),
  recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One run of a saved report: emailed, stored (no email service) or failed. The files are kept for download. */
export const reportRuns = pgTable("report_runs", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  reportId: text("report_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull(), // emailed | stored | failed
  recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`),
  note: text("note").notNull().default(""),
  by: text("by").notNull(),
  pdf: text("pdf"),
  xlsx: text("xlsx"),
}, (t) => [index("report_runs_report").on(t.companyId, t.reportId)]);

/** An API key: only its SHA-256 is stored; the secret is shown once. */
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  hint: text("hint").notNull(),
  hash: text("hash").notNull(),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedBy: text("replaced_by"),
}, (t) => [uniqueIndex("api_keys_hash").on(t.hash)]);

/** An outgoing webhook: a generic signed JSON endpoint, or a Slack or Teams channel. */
export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("generic"), // generic | slack | teams
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  lastStatus: text("last_status"),
  lastAt: timestamp("last_at", { withTimezone: true }),
});

/** Each event sent to each webhook, once (the event key makes it idempotent), with retries. */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  webhookId: text("webhook_id").notNull(),
  event: text("event").notNull(),
  eventKey: text("event_key").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(), // sent | failed | skipped
  code: integer("code"),
  attempts: integer("attempts").notNull().default(1),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("webhook_deliveries_key").on(t.companyId, t.webhookId, t.eventKey)]);

/** Each site's last known risk band, so a change of band is noticed once. */
export const siteBands = pgTable("site_bands", {
  companyId: text("company_id").notNull(),
  unitId: text("unit_id").notNull(),
  band: text("band").notNull(),
  score: doublePrecision("score"),
  since: timestamp("since", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.companyId, t.unitId] })]);

/** Per-company counters for human references (REV-0001, ACT-0001). */
export const counters = pgTable("counters", {
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  value: integer("value").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.companyId, t.name] })]);

/** Every tenant-scoped table, for the RLS migration and the isolation tests. */
export const TENANT_TABLES = [
  "companies", "company_settings", "members", "units", "areas", "checks", "natures", "monthly_stats", "reviews", "review_items",
  "review_events", "scorecards", "scorecard_entries", "actions", "action_events", "evidence", "audit_log", "imports", "risk_outbox", "counters",
  "templates", "template_versions", "inspections", "inspection_events", "scorecard_versions", "sampling_plans", "programmes", "unit_factors",
  "entities", "site_groups", "report_links", "issue_reports", "saved_reports", "report_runs", "api_keys", "webhooks", "webhook_deliveries", "site_bands",
] as const;
