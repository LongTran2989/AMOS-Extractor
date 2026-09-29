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
| `AMOS-WO.sql` | **Verified** schema subset mapping the Work Order data chain — the key reference for extraction queries. |

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
| `[F]` | Foreign Key (expected) |
| *(blank)* | Regular column |

### Date/Time encoding (IMPORTANT)
AMOS stores dates and times as integers:
- **Dates** (`DATE_INT`, `int4`): Days since **1971-12-31**. To convert to a real date in PostgreSQL: `DATE '1971-12-31' + <column>::integer`
- **Times** (`TIMI`, `int4`): Milliseconds since the start of the day. To convert: `<column> / 1000` gives seconds.

---

## 🗂️ Verified Work Order Schema (`AMOS-WO.sql`)

This file was pre-worked and verified. It defines the key table chain for Work Order / Taskcard extraction.

### Table Hierarchy (Top → Bottom)

```
wp_header
    └── wp_sequence           (links Workpack → WO)
            └── wo_header     (Work Order / Taskcard)
                    ├── workstep_link          (ordered steps within the WO)
                    │       ├── wo_text_description   (text of each step)
                    │       └── [via workstep_link_wo_text_action]
                    │               └── wo_text_action    (actions + sign-offs)
                    │                       └── time_captured_additional
                    │                               └── time_captured   (time bookings)
                    └── time_captured (also directly linked via primkey)
```

### Table Definitions

#### `wp_header` — Workpack Header
| Column | Type | Notes |
|---|---|---|
| `wpno_i` | int (PK) | Internal Workpack ID |
| `wp_status` | int | Status code |
| `ac_registr` | string | Aircraft registration |
| `station` | string | Location |
| `wpno` | string (UNIQUE) | Human-readable Workpack name |

#### `wp_sequence` — Workpack ↔ WO Link
| Column | Type | Notes |
|---|---|---|
| `wp_sequence_id` | int (PK) | |
| `wpno_i` | int | FK → `wp_header.wpno_i` |
| `event_perfno_i` | int | FK → `wo_header.event_perfno_i` (= Link to WO/Taskcard) |
| `seqno`, `seqno_prefix_i`, `seqno_prefix_i2` | int (UNIQUE) | Sequence numbering |

#### `wo_header` — Work Order Header
| Column | Type | Notes |
|---|---|---|
| `event_perfno_i` | int (PK) | Internal WO ID |
| `ac_register` | string | Aircraft registration |

#### `workstep_link` — Workstep within a WO
| Column | Type | Notes |
|---|---|---|
| `event_perfno_i` | int (PK) | FK → `wo_header.event_perfno_i` |
| `descno_i` | int (UNIQUE) | FK → `wo_text_description.descno_i` |
| `workstep_linkno_i` | int | Used to connect to actions |
| `sequenceno` | int | Order of the workstep |

#### `wo_text_description` — Workstep Description
| Column | Type | Notes |
|---|---|---|
| `descno_i` | int (PK) | FK → `workstep_link.descno_i` |
| `text` | string | Plain text description |
| `text_html` | string | HTML version |

#### `wo_text_action` — Action + Sign-off
| Column | Type | Notes |
|---|---|---|
| `actionno_i` | int (PK) | Internal action ID |
| `event_perfno_i` | int | WO reference |
| `workstep_linkno_i` | int | Connected via `workstep_link_wo_text_action` |
| `text` | string | Action text |
| `sign_performed` | string | Who performed the task |
| `sign_inspected` | string | Who inspected |
| `sign_double_inspected` | string | Who double-inspected |

#### `workstep_link_wo_text_action` — Junction Table
| Column | Type | Notes |
|---|---|---|
| `workstep_link_workstep_linkno_i` | int (PK part) | FK → `workstep_link.workstep_linkno_i` |
| `wo_text_action_workstep_linkno_i` | int (PK part) | FK → `wo_text_action.workstep_linkno_i` |

#### `time_captured_additional` — Booking ↔ Action Link
| Column | Type | Notes |
|---|---|---|
| `bookingno_i` | int (PK) | FK → `time_captured.bookingno_i` |
| `itemno_i` | int | FK → `wo_text_action.actionno_i` |

#### `time_captured` — Time Bookings
| Column | Type | Notes |
|---|---|---|
| `bookingno_i` | int (PK) | FK → `time_captured_additional.bookingno_i` |
| `primkey` | int | FK → `wo_header.event_perfno_i` (direct WO link) |
| `user_sign` | string | Who logged the time |
| `created_by` | string | Who created the record |
| `start_date` | int | Start date (days since 1971-12-31) |
| `start_time` | int | Start time (ms since midnight) |
| `end_date` | int | End date (days since 1971-12-31) |
| `end_time` | int | End time (ms since midnight) |
| `duration` | int | Duration (unit TBD — likely minutes) |

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

- [ ] Confirm the **unit of `duration`** in `time_captured` (likely minutes, but needs verification against the CSV schema).
- [ ] Find the column in `wo_header` (or linked table) that stores the WO **status** (open/closed/signed-off) — needed for completeness checks.
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
WHERE wh.ac_register = 'XY-ABC'          -- replace with aircraft registration
  AND (DATE '1971-12-31' + tc.start_date) = '2026-09-01'  -- replace with target date
ORDER BY tc.start_date, tc.start_time;
```
> ⚠️ Column names in `wo_header` may need to be verified against the full CSV schema (e.g., whether the date field is directly in `wo_header` or in a linked table).
