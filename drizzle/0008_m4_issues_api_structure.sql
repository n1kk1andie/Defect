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
CREATE TABLE "site_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"unit_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "rca" jsonb;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "effectiveness_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "effectiveness" jsonb;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "reopen_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "email_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "entity_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_company_name" ON "entities" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_reports_ref" ON "issue_reports" USING btree ("company_id","ref");--> statement-breakpoint
CREATE INDEX "issue_reports_status" ON "issue_reports" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "report_links_token" ON "report_links" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "site_groups_company_name" ON "site_groups" USING btree ("company_id","name");