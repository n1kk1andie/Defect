CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"hint" text NOT NULL,
	"hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"replaced_by" text
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"ref" text NOT NULL,
	"unit_id" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"reporter_name" text DEFAULT '' NOT NULL,
	"reporter_contact" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"triage_note" text DEFAULT '' NOT NULL,
	"triaged_by" text,
	"triaged_at" timestamp with time zone,
	"action_id" text,
	"inspection_id" text,
	"source" text DEFAULT 'link' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_links" (
	"company_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_links_company_id_unit_id_pk" PRIMARY KEY("company_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"report_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"by" text NOT NULL,
	"pdf" text,
	"xlsx" text
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"sections" text[] DEFAULT '{}'::text[] NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" text DEFAULT 'pdf' NOT NULL,
	"schedule" jsonb DEFAULT '{"every":"none"}'::jsonb NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_bands" (
	"company_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"band" text NOT NULL,
	"score" double precision,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_bands_company_id_unit_id_pk" PRIMARY KEY("company_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "site_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"unit_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"code" integer,
	"attempts" integer DEFAULT 1 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'generic' NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status" text,
	"last_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "rca" jsonb;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "effectiveness_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "effectiveness" jsonb;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "reopen_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_outbox" ADD COLUMN "proposal_id" text;--> statement-breakpoint
ALTER TABLE "risk_outbox" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "risk_outbox" ADD COLUMN "rule" text;--> statement-breakpoint
ALTER TABLE "risk_outbox" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_outbox" ADD COLUMN "risk_ref" text;--> statement-breakpoint
ALTER TABLE "risk_outbox" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "risk_outbox" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "entity_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_company_name" ON "entities" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_reports_ref" ON "issue_reports" USING btree ("company_id","ref");--> statement-breakpoint
CREATE INDEX "issue_reports_status" ON "issue_reports" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "report_links_token" ON "report_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "report_runs_report" ON "report_runs" USING btree ("company_id","report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_groups_company_name" ON "site_groups" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_key" ON "webhook_deliveries" USING btree ("company_id","webhook_id","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_outbox_proposal" ON "risk_outbox" USING btree ("company_id","proposal_id");