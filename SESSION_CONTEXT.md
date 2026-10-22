# AMOS-Extractor — Session Context

> **Last updated:** 2026-09-29  
> **Purpose:** Preserve accumulated knowledge between sessions. Resume here without lost context.

---

## 🎯 Project Goal

Extract maintenance records from the **AMOS Aviation MRO database** and validate their correctness, including:
- Syntax correctness
- Time ordering
- Time-booking duration checks

The database is PostgreSQL-compatible. We query it using **PostgreSQL syntax** (AMOS accepts this directly).

---

## 📁 Repository Files

| File | Description |
|---|---|
| `Database-Description-AMOS-csv.csv` | Full AMOS database schema export (~45,913 lines). Lists every table and its columns with types and descriptions. |
| `Database-Description-AMOS.xlsx` | Same schema in Excel format. |
| [docs/legacy/AMOS-WO.sql](file:///g:/AMOS-Extractor/docs/legacy/AMOS-WO.sql) | **Legacy** schema subset mapping the Work Order data chain. Superseded by `schema/`. |
| [extract_work_order.sql](file:///g:/AMOS-Extractor/extract_work_order.sql) | **Full Work Order Extraction Query** — complete 1:1 raw data query across all 9 schema tables. |
| [extract_han_workpacks_today.sql](file:///g:/AMOS-Extractor/extract_han_workpacks_today.sql) | **HAN Station Workpacks Query** — extracts all active Workpacks at station HAN for today with status lookups. |
| [extract_han_workpacks_date_range.sql](file:///g:/AMOS-Extractor/extract_han_workpacks_date_range.sql) | **Station Workpacks in Date Range** — sample: WPs at HAN overlapping 2026-09-22..2026-09-26, with status and responsible department. Uses approved `z_` aliases. |
| [extract_wp_seqs_parameterized.sql](file:///g:/AMOS-Extractor/extract_wp_seqs_parameterized.sql) | **Parameterized WP Sequences Query** — extracts active/recent Workpacks at HAN/NTHN down to item, workstep, description, and required materials (part requests). |
| [extract_wp_timebookings.sql](file:///g:/AMOS-Extractor/extract_wp_timebookings.sql) | **Workpack Timebookings Query** — extracts active/recent Workpacks at HAN/NTHN down to item sequences, worksteps, action execution, and associated time bookings. |
| [extract_wp_timebookings_history.sql](file:///g:/AMOS-Extractor/extract_wp_timebookings_history.sql) | **Workpack Timebookings & Modification History Query** — extracts active/recent Workpacks at HAN/NTHN down to worksteps, time bookings, and modification history audit records from `time_captured_history` (History Viewer). |
| [extract_wp_timebookings_seq_4_7.sql](file:///g:/AMOS-Extractor/extract_wp_timebookings_seq_4_7.sql) | **Specific Sequence Timebookings Query** — extracts timebookings and modification history for sequence 4.7 of WP `A620-040326-BASE-MCC-STO`. |

---

## 📖 How to Read `Database-Description-AMOS-csv.csv`

Each table is described in a repeating block:

```
Table <table_name>
<Table description text>
Keys,Name,Mime-Type,Type,Description
[P],<col_name>,<AMOS type>,<pg type>,<description>
   ,<col_name>,<AMOS type>,<pg type>,<description>
...
Table <next_table_name>
...
```

### Key conventions
| Keys field | Meaning |
|---|---|
| `[P]` | Primary Key |
| `[I]` | Indexed (Very often used for Foreign Keys) |
| `[U]` | Unique Constraint |
| *(blank)* | Regular column |

### Date/Time encoding (IMPORTANT)
AMOS stores dates and times as integers:
- **Dates** (`DATE_INT`, `int4`): Days since **1971-12-31**. To convert to a real date in PostgreSQL: `DATE '1971-12-31' + <column>::integer`
- **Times** (`TIMI` / `TIME`, `int4`): `TIMI` columns are milliseconds since the start of the day. `TIME` columns (like `start_time` in `time_captured`) are **minutes** since day start.

---

## 🗂️ Logical Schema (Single Source of Truth)

The logical schema modeling AMOS entities (like Workpacks, Work Orders, Time Bookings) is defined in `schema/`. 
Do not refer to the legacy `AMOS-WO.sql` file.

**Reference:**
- YAML Source: [schema/](file:///g:/AMOS-Extractor/schema)
- Markdown Documentation: [docs/generated/schema.md](file:///g:/AMOS-Extractor/docs/generated/schema.md)
- Entity ERD is available at the top of the Markdown documentation.

---

## 🔍 Planned Validation Checks

These are the correctness checks to build queries for:

1. **Syntax correctness** — e.g., sign-off fields not empty when they should be, registration format valid.
2. **Time ordering** — `start_date`/`start_time` must be before `end_date`/`end_time`.
3. **Duration consistency** — calculated `(end - start)` must match stored `duration`.
4. **Timebooking coverage** — every completed WO action should have an associated time booking.
5. **Sign-off completeness** — `sign_performed` and `sign_inspected` must be filled for closed worksteps.

---

## 💡 Next Steps / Open Questions

- [x] Confirm the **unit of `duration`** in `time_captured` — Verified as **minutes** in the CSV. `start_time` and `end_time` are also stored in minutes since day begin.
- [x] Find the column in `wo_header` (or linked table) that stores the WO **status** — Verified as `state` ('O' for Open, 'C' for Closed) inside `wo_header`.
- [x] Determine how Work Order Sign-offs are handled — General WO sign-offs are logged in `wo_header` via `mech_sign` and `release_sign`. Step-level sign-offs are in `wo_text_action`.
- [x] Find where "Remarks (Event or W/O)" are stored — Verified they are stored in `wo_remarks`, linked directly to `wo_header.event_perfno_i`.
- [ ] Find the column that stores the **planned date** of the WO (for schedule adherence checks).
- [ ] Determine the exact table/column for the **aircraft type/model** (for filtering by fleet type).
- [ ] Build a template query: **all WOs for aircraft `X` on date `Y`**.

---

## 🛠️ Query Approach

When building queries:
1. **Identify relevant tables** from the CSV schema using keyword search (e.g., search `work_order`, `time_captured`).
2. **Trace foreign keys** to plan JOIN conditions.
3. **Convert dates** using `DATE '1971-12-31' + <col>` for any `DATE_INT` columns.
4. Use **PostgreSQL syntax** — AMOS accepts it directly.

### Example Template (WOs for Aircraft X on Day Y)
```sql
SELECT
    wh.event_perfno_i,
    wh.ac_register,
    wph.wpno          AS workpack_name,
    wph.station,
    tc.start_date,
    tc.start_time,
    tc.end_date,
    tc.end_time,
    tc.duration,
    tc.user_sign
FROM wo_header wh
JOIN wp_sequence wps ON wps.event_perfno_i = wh.event_perfno_i
JOIN wp_header wph   ON wph.wpno_i = wps.wpno_i
JOIN time_captured tc ON tc.primkey = wh.event_perfno_i
WHERE wh.ac_registr = 'XY-ABC'          -- replace with aircraft registration
  AND (DATE '1971-12-31' + tc.start_date) = '2026-09-01'  -- replace with target date
ORDER BY tc.start_date, tc.start_time;
```
> ⚠️ Column names in `wo_header` may need to be verified against the full CSV schema (e.g., whether the date field is directly in `wo_header` or in a linked table).

---

## 💡 Key Technical Insights & Lessons Learned

- **wo_text_description text storage**: wo_text_description.text is ONLY populated if saved in plain text; otherwise it is NULL. Formatted step descriptions are stored in wo_text_description.text_html. Step titles/summaries are in wo_text_description.header. Always SELECT header, text, and text_html together to ensure full step text extraction.
- **Workpack Item Sequence Hierarchy**: 
  1. `wp_sequence.seqno_prefix_i`: First part of the WP sequence.
  2. `wp_sequence.seqno`: Second part of the sequence. Together with the prefix, they identify the WP item (e.g., item "3.23").
  3. `workstep_link.sequenceno`: Third part of the sequence. If the first and second parts stay the same, this orders the individual worksteps within that item (e.g., item 3.23, step 1, step 2).
- **Strict Aliases Policy**: Column aliases can ONLY be used if explicitly approved by the user, and they MUST be CAPITALIZED (e.g., `AS WP_SEQ_1ST`). Table aliases are strictly forbidden. Always use full table names for 1:1 schema clarity.
- **wo_header as a Universal Container**: The `wo_header` table is not just for Work Orders. It also stores Work Templates, Event Pendings, Jobcards, Customer Requirements, and Shopcards. When extracting ALL sequences from a WP, `wp_sequence` seamlessly connects them all into `wo_header.event_perfno_i`.
- **Linking Taskcard/Coversheet Info**: Boeing Toolbox XML metadata is stored in `taskcard_coversheet_info` (deprecated) and `bt_taskcard_info`. These tables can be linked directly to `wo_header` via the `ext_workorderno` column.
- **Historical Workpack Queries**: When querying for "active" Workpacks on historical dates, DO NOT filter by `wp_status`. The `wp_status` reflects the *present-day, real-time* status (e.g., CLOSED). Instead, filter by ensuring the target date falls between `start_date` and `end_date`.
- **Closed Workpack Dates (`act_end_date` is empty)**: When a Workpack is closed, AMOS does *not* populate `wp_header.act_end_date` or `wp_header.act_end_time`. It only populates `end_date`. Do not rely on `act_end_date` for filters.
- **Database Timezone (UTC)**: The AMOS database `CURRENT_TIMESTAMP` operates in UTC time. If doing real-time comparisons against local time windows (e.g. +07:00), you must offset the database timestamp explicitly (e.g., `CURRENT_TIMESTAMP + INTERVAL '7' HOUR`) before comparing it against AMOS integer dates and times.
- **`wp_history` 1:N Row Duplication Hazard**: The `wp_history` table is an append-only audit log. Joining `wp_history` to `wo_header` or `wp_sequence` creates a 1:N relationship that artificially multiplies row results for every historical event. Never use `wp_history` just to retrieve sequence titles—use `wo_event_link` instead.

---

## 🛑 Querying Rules

1. **No Column Combining**: Any SQL query must select and return exactly the column names as they appear in the database. Do not combine or concatenate columns (e.g., no `CONCAT()`, no `||`) within the SQL queries.
2. **Ask Before Combining**: If a user request implicitly requires combining columns, explicitly ask the user for permission or clarification before doing so.
3. **Strict Column Aliases Policy**: DO NOT use column aliases (e.g., AS work_order_id) unless explicitly approved by the user. Approved aliases MUST be CAPITALIZED and prefixed with `z_` (e.g., `AS z_WP_SEQ_1ST`). Otherwise, keep original column names exactly as they appear in the schema so columns can be precisely pinpointed.
4. **Purpose of Queries**: SQL queries are strictly used for probing the database and validating data correctness. 
5. **Ultimate Goal**: The end objective is to write software that extracts this raw data, manipulates it in code, and validates its content. Keep raw data extraction as 1:1 with the database schema as possible.
6. **Building Up Extraction SQL**: We need to progressively build up the SQL to extract useful, structured information from the greater database, always referencing the master CSV schema file to find the right tables and columns.
