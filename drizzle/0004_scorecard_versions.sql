CREATE TABLE "scorecard_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"scorecard_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "dirty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "origin" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "updated_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "scorecard_versions_v" ON "scorecard_versions" USING btree ("company_id","scorecard_id","version");