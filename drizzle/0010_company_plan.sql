ALTER TABLE "companies" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "plan_seen_at" timestamp with time zone;