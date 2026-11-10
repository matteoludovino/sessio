-- No double booking, decided by the database whatever the API does and however many requests
-- race. Only sessions that hold their slot count: cancelled ones free it. The psychologist and
-- the room are blocked until the end plus the clinic's buffer; the patient only for the session.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_psychologist_no_overlap"
  EXCLUDE USING gist ("psychologist_id" WITH =, tstzrange("starts_at", "blocked_until") WITH &&)
  WHERE ("status" IN ('scheduled', 'confirmed', 'completed', 'no_show'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_no_overlap"
  EXCLUDE USING gist ("room_id" WITH =, tstzrange("starts_at", "blocked_until") WITH &&)
  WHERE ("room_id" IS NOT NULL AND "status" IN ('scheduled', 'confirmed', 'completed', 'no_show'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_no_overlap"
  EXCLUDE USING gist ("patient_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" IN ('scheduled', 'confirmed', 'completed', 'no_show'));
