CREATE TABLE "programmes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"unit_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"every_days" integer DEFAULT 30 NOT NULL,
	"window_days" integer DEFAULT 14 NOT NULL,
	"assignees" text[] DEFAULT '{}'::text[] NOT NULL,
	"start_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sampling_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"ref" text NOT NULL,
	"name" text NOT NULL,
	"template_id" text,
	"unit_id" text,
	"period" date,
	"method" text DEFAULT 'statistical' NOT NULL,
	"confidence" double precision,
	"tdr" double precision,
	"edr" double precision,
	"population_size" integer NOT NULL,
	"population" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"population_hash" text NOT NULL,
	"stratify" boolean DEFAULT false NOT NULL,
	"census_above" double precision,
	"sample_size" integer NOT NULL,
	"seed" text NOT NULL,
	"selection" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allocation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'selected' NOT NULL,
	"inspection_id" text,
	"evaluation" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_factors" (
	"company_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "unit_factors_company_id_unit_id_pk" PRIMARY KEY("company_id","unit_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sampling_plans_ref" ON "sampling_plans" USING btree ("company_id","ref");