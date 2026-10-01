CREATE TABLE "wo_header" (
  "event_perfno_i" integer PRIMARY KEY,
  "ac_registr" string,
  "state" string,
  "mech_sign" string,
  "release_sign" string,
  "release_sign2" string,
  "closing_date" int
);

CREATE TABLE "workstep_link" (
  "event_perfno_i" integer NOT NULL,
  "descno_i" integer UNIQUE,
  "workstep_linkno_i" integer PRIMARY KEY,
  "sequenceno" int
);

CREATE TABLE "wo_text_description" (
  "descno_i" integer PRIMARY KEY,
  "header" string,
  "text" string,
  "desc_comment" string,
  "text_html" string
);

CREATE TABLE "wo_text_action" (
  "event_perfno_i" integer NOT NULL,
  "workstep_linkno_i" integer NOT NULL,
  "actionno_i" integer PRIMARY KEY,
  "header" string,
  "text" string,
  "action_comment" string,
  "sign_performed" string,
  "sign_inspected" string,
  "sign_double_inspected" string
);

CREATE TABLE "time_captured" (
  "bookingno_i" integer PRIMARY KEY,
  "user_sign" string,
  "created_by" string,
  "start_date" int,
  "start_time" int,
  "end_date" int,
  "end_time" int,
  "duration" int,
  "primkey" int NOT NULL
);

CREATE TABLE "time_captured_additional" (
  "itemno_i" integer,
  "bookingno_i" integer PRIMARY KEY
);

CREATE TABLE "wp_sequence" (
  "seqno" int UNIQUE,
  "seqno_prefix_i" int UNIQUE,
  "seqno_prefix_i2" int UNIQUE,
  "wp_sequence_id" int PRIMARY KEY,
  "wpno_i" int UNIQUE,
  "event_perfno_i" int
);

CREATE TABLE "wp_header" (
  "wpno_i" int PRIMARY KEY,
  "wp_status" int,
  "ac_registr" string,
  "station" string,
  "wpno" string UNIQUE
);

COMMENT ON COLUMN "wp_sequence"."event_perfno_i" IS 'Link to WO/Taskcard';

COMMENT ON COLUMN "wp_header"."station" IS 'Location';

COMMENT ON COLUMN "wp_header"."wpno" IS 'Name of workpack';

ALTER TABLE "workstep_link" ADD FOREIGN KEY ("event_perfno_i") REFERENCES "wo_header" ("event_perfno_i") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "wo_text_description" ADD FOREIGN KEY ("descno_i") REFERENCES "workstep_link" ("descno_i") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "wo_text_action" ADD FOREIGN KEY ("workstep_linkno_i") REFERENCES "workstep_link" ("workstep_linkno_i") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "wo_text_action" ADD FOREIGN KEY ("event_perfno_i") REFERENCES "wo_header" ("event_perfno_i") DEFERRABLE INITIALLY IMMEDIATE;


ALTER TABLE "time_captured_additional" ADD FOREIGN KEY ("itemno_i") REFERENCES "wo_text_action" ("actionno_i") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "time_captured" ADD FOREIGN KEY ("bookingno_i") REFERENCES "time_captured_additional" ("bookingno_i") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "time_captured" ADD FOREIGN KEY ("primkey") REFERENCES "wo_header" ("event_perfno_i") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "wp_sequence" ADD FOREIGN KEY ("wpno_i") REFERENCES "wp_header" ("wpno_i") DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE "wo_remarks" (
  "event_perfno_i" integer,
  "recordno" integer,
  "recno" integer,
  "text" string,
  PRIMARY KEY ("event_perfno_i", "recno")
);

ALTER TABLE "wo_remarks" ADD FOREIGN KEY ("event_perfno_i") REFERENCES "wo_header" ("event_perfno_i") DEFERRABLE INITIALLY IMMEDIATE;

