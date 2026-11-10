-- Moved first: the composite foreign keys below reference this constraint.
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_id_key" UNIQUE("clinic_id","id");--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"psychologist_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_range_check" CHECK ("time_off"."starts_at" < "time_off"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"psychologist_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "working_hours_weekday_check" CHECK ("working_hours"."weekday" between 0 and 6),
	CONSTRAINT "working_hours_range_check" CHECK ("working_hours"."start_minute" >= 0 and "working_hours"."end_minute" <= 1440 and "working_hours"."start_minute" < "working_hours"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"psychologist_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"birth_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "session_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_types_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "session_types_duration_check" CHECK ("session_types"."duration_minutes" between 15 and 240)
);
--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_psychologist_fk" FOREIGN KEY ("clinic_id","psychologist_id") REFERENCES "public"."users"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_psychologist_fk" FOREIGN KEY ("clinic_id","psychologist_id") REFERENCES "public"."users"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_psychologist_fk" FOREIGN KEY ("clinic_id","psychologist_id") REFERENCES "public"."users"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_types" ADD CONSTRAINT "session_types_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_off_psychologist_idx" ON "time_off" USING btree ("clinic_id","psychologist_id","starts_at");--> statement-breakpoint
CREATE INDEX "working_hours_psychologist_idx" ON "working_hours" USING btree ("clinic_id","psychologist_id","weekday");--> statement-breakpoint
CREATE INDEX "patients_clinic_psychologist_idx" ON "patients" USING btree ("clinic_id","psychologist_id");--> statement-breakpoint
CREATE INDEX "patients_clinic_name_idx" ON "patients" USING btree ("clinic_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_clinic_name_key" ON "rooms" USING btree ("clinic_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "session_types_clinic_name_key" ON "session_types" USING btree ("clinic_id",lower("name"));
