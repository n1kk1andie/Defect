CREATE TABLE "inspection_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"inspection_id" text NOT NULL,
	"status" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"ref" text NOT NULL,
	"client_id" text,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"unit_id" text NOT NULL,
	"period" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"inspector_email" text NOT NULL,
	"supervisor_email" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signatures" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checkin" jsonb,
	"score" jsonb,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"sector" text DEFAULT 'general' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"dirty" boolean DEFAULT true NOT NULL,
	"origin" text DEFAULT 'custom' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_ref" ON "inspections" USING btree ("company_id","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_client" ON "inspections" USING btree ("company_id","client_id");--> statement-breakpoint
CREATE INDEX "inspections_company_status" ON "inspections" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "inspections_template" ON "inspections" USING btree ("company_id","template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_v" ON "template_versions" USING btree ("company_id","template_id","version");--> statement-breakpoint
CREATE INDEX "templates_company" ON "templates" USING btree ("company_id","status");