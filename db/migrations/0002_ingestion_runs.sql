CREATE TYPE "public"."data_domain" AS ENUM('markets', 'sports');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('running', 'succeeded', 'partial', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."ingestion_trigger" AS ENUM('schedule', 'manual');--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" "data_domain" NOT NULL,
	"provider" varchar(40) NOT NULL,
	"trigger" "ingestion_trigger" NOT NULL,
	"status" "ingestion_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"request_count" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_runs_finish_after_start" CHECK ("ingestion_runs"."finished_at" is null or "ingestion_runs"."finished_at" >= "ingestion_runs"."started_at"),
	CONSTRAINT "ingestion_runs_finished_unless_running" CHECK ("ingestion_runs"."status" = 'running' or "ingestion_runs"."finished_at" is not null),
	CONSTRAINT "ingestion_runs_counts_non_negative" CHECK ("ingestion_runs"."request_count" >= 0 and "ingestion_runs"."rows_written" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ingestion_runs_domain_started_idx" ON "ingestion_runs" USING btree ("domain","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_runs_one_running_per_domain" ON "ingestion_runs" USING btree ("domain") WHERE "ingestion_runs"."status" = 'running';