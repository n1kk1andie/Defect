CREATE TABLE "action_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"action_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"ref" text NOT NULL,
	"kind" text DEFAULT 'corrective' NOT NULL,
	"unit_id" text NOT NULL,
	"area_id" text,
	"title" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"root_cause" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"owner_email" text,
	"owner_name" text DEFAULT '' NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closure_note" text DEFAULT '' NOT NULL,
	"raised_by" text NOT NULL,
	"verifier_email" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"seq" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"area_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"severity" text DEFAULT 'major' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"company_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"company_id" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counters_company_id_name_pk" PRIMARY KEY("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"name" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"sha256" text,
	"blob_key" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"summary" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_by" text,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "members" (
	"company_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"unit_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'platform' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "members_company_id_email_pk" PRIMARY KEY("company_id","email")
);
--> statement-breakpoint
CREATE TABLE "monthly_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"period" date NOT NULL,
	"unit_id" text NOT NULL,
	"area_id" text NOT NULL,
	"reviewed" integer DEFAULT 0 NOT NULL,
	"instances" integer DEFAULT 0 NOT NULL,
	"defects" integer DEFAULT 0 NOT NULL,
	"resolvable" integer DEFAULT 0 NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL,
	"recurring" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'import' NOT NULL,
	"batch_id" text
);
--> statement-breakpoint
CREATE TABLE "natures" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"area_id" text,
	"label" text NOT NULL,
	"category" text DEFAULT 'Process' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"review_id" text NOT NULL,
	"status" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"review_id" text NOT NULL,
	"idx" integer NOT NULL,
	"area_id" text NOT NULL,
	"item_type" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"defects" integer DEFAULT 0 NOT NULL,
	"nature" text DEFAULT '' NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"ref" text NOT NULL,
	"kind" text DEFAULT 'checklist' NOT NULL,
	"unit_id" text NOT NULL,
	"period" date NOT NULL,
	"entry_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"inspector_email" text NOT NULL,
	"supervisor_email" text,
	"note" text DEFAULT '' NOT NULL,
	"scorecard_values" jsonb,
	"audit_grade" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "risk_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"response" jsonb
);
--> statement-breakpoint
CREATE TABLE "scorecard_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"scorecard_id" text NOT NULL,
	"period" date NOT NULL,
	"unit_id" text NOT NULL,
	"values" jsonb NOT NULL,
	"audit_raw" double precision,
	"source" text DEFAULT 'import' NOT NULL,
	"review_id" text
);
--> statement-breakpoint
CREATE TABLE "scorecards" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"region" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "actions_ref" ON "actions" USING btree ("company_id","ref");--> statement-breakpoint
CREATE INDEX "actions_company_status" ON "actions" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "areas_company_name" ON "areas" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_seq" ON "audit_log" USING btree ("company_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "checks_area_code" ON "checks" USING btree ("company_id","area_id","code");--> statement-breakpoint
CREATE INDEX "evidence_entity" ON "evidence" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_stats_cell" ON "monthly_stats" USING btree ("company_id","period","unit_id","area_id","source");--> statement-breakpoint
CREATE INDEX "review_items_review" ON "review_items" USING btree ("company_id","review_id");--> statement-breakpoint
CREATE INDEX "reviews_company_status" ON "reviews" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_ref" ON "reviews" USING btree ("company_id","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecard_entries_cell" ON "scorecard_entries" USING btree ("company_id","scorecard_id","period","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_company_name" ON "units" USING btree ("company_id","name");