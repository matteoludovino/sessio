CREATE TABLE "appointment_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"psychologist_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"session_type_id" uuid NOT NULL,
	"room_id" uuid,
	"mode" "appointment_mode" NOT NULL,
	"anchor_date" date NOT NULL,
	"start_minute" smallint NOT NULL,
	"interval_weeks" smallint DEFAULT 1 NOT NULL,
	"until_date" date,
	"max_occurrences" integer,
	"horizon_date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_series_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "series_interval_check" CHECK ("appointment_series"."interval_weeks" in (1, 2)),
	CONSTRAINT "series_start_minute_check" CHECK ("appointment_series"."start_minute" between 0 and 1439),
	CONSTRAINT "series_max_occurrences_check" CHECK ("appointment_series"."max_occurrences" is null or "appointment_series"."max_occurrences" between 1 and 520),
	CONSTRAINT "series_room_mode_check" CHECK (("appointment_series"."mode" = 'in_person') = ("appointment_series"."room_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "occurrence_date" date;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "series_psychologist_fk" FOREIGN KEY ("clinic_id","psychologist_id") REFERENCES "public"."users"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "series_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "series_session_type_fk" FOREIGN KEY ("clinic_id","session_type_id") REFERENCES "public"."session_types"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "series_room_fk" FOREIGN KEY ("clinic_id","room_id") REFERENCES "public"."rooms"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_series_occurrence_key" ON "appointments" USING btree ("series_id","occurrence_date");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_check" CHECK (("appointments"."series_id" is null) = ("appointments"."occurrence_date" is null));--> statement-breakpoint
-- Declared here rather than in the Drizzle schema to avoid a circular import between the two tables.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_fk" FOREIGN KEY ("clinic_id","series_id") REFERENCES "public"."appointment_series"("clinic_id","id");
