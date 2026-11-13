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
});

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
  sourceType: text("source_type").notNull().default("manual"), // manual | review_item | recurring | migrated
  sourceId: text("source_id"),
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
});

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
] as const;
