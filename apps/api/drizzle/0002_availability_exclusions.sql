-- Overlaps that the database itself refuses, whatever the API does and however many
-- requests race: GiST exclusion constraints need btree_gist for the equality columns.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_no_overlap"
  EXCLUDE USING gist ("psychologist_id" WITH =, "weekday" WITH =, int4range("start_minute", "end_minute") WITH &&);--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_no_overlap"
  EXCLUDE USING gist ("psychologist_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&);
