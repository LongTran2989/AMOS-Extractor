# DWH Query Runner — Design and Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Revision 2.1 (2026-11-17). Phases 0, 0b, 1 and 2 done (Phase 2 results in "Phase 2 findings" at the end). **The b6 re-test passed (2026-11-17, warm 1.4–1.6 s; see "Phase 0b findings")**. **The six missing DWH tables cannot be added (decision 2026-11-17)**: workarounds or dropping some information are decided later, per query; with the real catalogue **no repo query runs in the DWH as written today**. **Phase 3 (2026-11-18): the tools are done (`dwh:verify-pack`, `dwh:compare`, `dwh:run --at`); the live check of `extract_wp_item_counts.sql` is FAIL with two open differences, so the Phase 3 exit is not met yet (see "Phase 3 findings").** Phase 4 not started.

**Revision history**
- *Rev 1 (2026-11-17):* PostgreSQL → T-SQL converter, run as four-part linked-server queries on SQL Server.
- *Rev 2.1 (2026-11-17):* Phase 0b found RPC Out **off** (so `exec_mode: openquery`), Oracle 12.2, `NLS_COMP`/`NLS_SORT` BINARY, AL32UTF8, **no CLOB columns** (long text is `VARCHAR2(4000)`), and pass-through speed of 9–18 s for the steps query (not a clean pass). Decisions are in "Phase 0b findings"; the body below is updated to match.
- *Rev 2 (2026-11-17):* Phase 0 found that `DWH_DB` is an **Oracle** database behind a SQL Server 2016 relay, and that four-part queries are far too slow (4-table join 37–68 s, 7-table steps query timed out). The converter now emits **Oracle SQL**, which the relay passes through unchanged (`EXEC (…) AT [DWH_DB]` or `OPENQUERY`), so Oracle does the joins and only Oracle's rules apply. The Phase 0 proposals and how Rev 2 settles them are at the end ("Phase 0 findings").

**Your answers (2026-11-17)**
- *Direct AMOS access:* none from code; AMOS is reached through the AMOS application. → Verification compares an AMOS CSV export with the DWH result (A.7).
- *DWH login:* read-only (confirmed on the relay in Phase 0.4; the Oracle-side user is checked in Phase 0b).
- *Linked server is mandatory.* → All queries go through `DWH_DB`; Rev 2 sends them through it as pass-through Oracle SQL.
- *Users: anyone on a PC in the same WAN; local web page.* → Shared mode with HTTPS and an access code (A.8, A.9).
- *`test_db.js`:* deleted 2026-11-17.

**Goal:** Run any repo query that is already correct on AMOS (PostgreSQL) against the DWH staging copy (Oracle, reached through a SQL Server linked server), with a converter that never emits wrong SQL in silence, and a point-and-click page that colleagues on the WAN can use.

**Architecture:** A PostgreSQL→Oracle converter that works on the parsed query tree (the `node-sql-parser` PostgreSQL parse already used by `npm run validate`), runs an allow-list check, rewrites with type awareness, and prints Oracle SQL with its own small printer. A read-only runner (the `mssql` package, server-side only) wraps the Oracle text in a fixed pass-through statement for the relay and executes converter output only. A web page (plain `node:http`/`node:https` + vanilla JS) wraps the runner. Generated Oracle SQL is committed under `queries/dwh/` and checked for staleness like the docs.

**Tech Stack:** Node ≥ 24 running `.ts` directly, `node:test`, `node-sql-parser` (pinned to exactly 5.4.0), `mssql` (already in package.json), `yaml`. No new runtime dependencies.

**Spec:** [docs/dwh-converter-planning-prompt.md](dwh-converter-planning-prompt.md) (the original request; its "SQL Server" assumption is superseded by Rev 2) plus Part A of this file. Executors read both.

## Global Constraints

- Node ≥ 24, TypeScript run as `node file.ts`, no build step, no bundler. Browser code is plain `.js`.
- No new npm dependencies. Pin `node-sql-parser` to `5.4.0` exactly (remove the `^`).
- Every rule in CLAUDE.md applies to source queries; generated SQL keeps them (A.11 lists the one opt-in exception).
- Read-only by construction: one `SELECT`/`WITH` statement only; nothing that writes to either database is ever run, including during development.
- Credentials: only in the gitignored `.env` (`DWH_SERVER`, `DWH_USER`, `DWH_PASSWORD`), read server-side through `node --env-file=.env`. Never printed, logged, committed, or sent to the browser. Do not edit `.env`.
- The DWH is Oracle (schema `STG_AMOS`) behind the SQL Server 2016 RTM relay's linked server `DWH_DB` (`OraOLEDB.Oracle`). Queries reach it **only** as Oracle SQL passed through the linked server (`EXEC (…) AT [DWH_DB]` or `OPENQUERY([DWH_DB], …)`), never as four-part `[DWH_DB]..[STG_AMOS].[X]` queries.
- Relay connection: `trustServerCertificate: true`, login lands in `master`.
- Web server: `share: false` (default) binds `127.0.0.1` only. `share: true` binds the WAN-facing address and refuses to start without HTTPS and an access code (A.8).
- Only the host PC needs Node and `.env`; colleagues need only a browser.
- Generated files carry a "GENERATED — DO NOT EDIT" header and contain no timestamps (determinism).
- Windows 11 is the only target platform for the launcher.

## Review Focus

The five inputs or conditions most likely to hurt a person using this that no feature task naturally tests. Each has a test in the owning task.

1. **A source file edited while the page is open** → the page must re-read and re-convert on every select and every Run, never run a stale conversion. Test in Task 4.1 (`server re-converts after the source changes on disk`).
2. **A placeholder value pasted from Excel** (trailing space or tab, lower case, a quote mark) → trimmed and shown back; in `exec_at` mode bound as a parameter (a quote survives as data); in `openquery` mode a value outside `^[A-Za-z0-9 ._/-]{1,100}$` is refused with a plain message, never spliced in raw. Test in Task 2.1 (`placeholder value is trimmed; bound in exec_at; refused if unsafe in openquery`).
3. **A query that returns zero rows** → the table and the CSV still show the column headers, and "0 rows" is shown instead of a blank page. Test in Task 2.1 (`empty result keeps column names`).
4. **Vietnamese text (diacritics) in `text_html` or remarks, opened in Excel** → survives Oracle → relay → CSV; the CSV is UTF-8 **with BOM** and CRLF. Test in Task 2.1 (`csv has BOM and round-trips Vietnamese`) plus the live check in Phase 0b (b8).
5. **The network drops or the timeout hits in the middle of a CSV download** → the file must not look complete; the download ends with an error and the last line says it is incomplete. Test in Task 4.1 (`aborted export marks the file incomplete`).

---

# Part A — Design

## A.1 What this is for

You write and check queries against AMOS in PostgreSQL, under the repo's rules. Once a query is right, you and your colleagues want the same answer from the DWH without learning another SQL dialect and without a terminal. The tool has to be trustworthy in a specific sense: when it cannot translate something with certainty, it says so in plain words and refuses, instead of producing SQL that runs and returns slightly different data.

## A.2 Findings that shape the design

From the repo (before Phase 0):

1. **The real queries use a small slice of SQL.** All 15 root `*.sql` files parse with `node-sql-parser` (PostgreSQL mode). Across root files plus the generated `queries/wp_seqs/*.sql`: `DATE '1971-12-31'` ×78, `INTERVAL` ×99 (only `'7' HOUR`, `'24' HOUR`, `'6' MONTH`, `'1 minute'`), `CURRENT_DATE` ×36, `CURRENT_TIMESTAMP` ×34, `::date` ×30, `COALESCE` ×18, `EXISTS`/`NOT EXISTS`, date literals ×6, one `LIMIT`, one `<INSERT_WPNO_HERE>`. None use CTEs, window functions, `DISTINCT`, `CASE`, `GROUP BY`, `LIKE`, `||`, quoted identifiers, block comments or boolean literals. Version 1 converts this slice plus a few cheap, provably safe extras, and refuses everything else by name.
2. **`node-sql-parser` has no Oracle dialect and its printers only reprint.** Parsing PostgreSQL is reusable; printing must be ours. Checked: the Oracle subset we emit (minus `FETCH FIRST` and `N'…'`) re-parses with the library's PostgreSQL grammar, which gives a cheap offline self-check (A.4 step 10).
3. **Nothing in the repo connects to AMOS directly** (AMOS application + CSV export). Verification reuses `parseCsv`/`normalizeCell`/`compareTables` from [src/stitch/stitch.ts](../src/stitch/stitch.ts).
4. **`npm run validate` fails today** on `probe_closed_dates.sql` and `probe_workstep_duplicates.sql`; the converter refuses sources with lint errors.
5. **"Today" in AMOS is the UTC date** (session runs in UTC; still to confirm in Phase 0b): `extract_han_workpacks_today.sql` returns yesterday's workpacks between 00:00 and 07:00 local. The converter keeps the meaning exactly and warns.
6. 168 distinct columns are referenced; none is an Oracle reserved word; the longest approved alias is 18 characters (Oracle's limit is 30 before 12.2).

From Phase 0 (details at the end):

7. **Target is Oracle** behind SQL Server 2016 RTM. Relay collation is case-insensitive, but with pass-through it never touches comparisons or sorting; Oracle's own rules apply.
8. **Four-part queries are unusably slow**; single-table reads take 1–3 s, so the link itself is fine and the cost is the relay doing joins on rows it pulls across. Pass-through fixes that by construction (confirmed or refuted by Phase 0b, b6).
9. **Catalogue works only through `OPENQUERY`** (`ALL_TAB_COLUMNS`). Date/time columns are Oracle `NUMBER` holding the same day/ms counts as AMOS.
10. **Data is near real time** (within minutes).
11. **Six tables are missing from the DWH:** `wp_status`, `wp_department_link`, `cml_reference`, `oem_doc_partno`, `taskcard_coversheet_info`, `time_captured_history`. Today **only `extract_all_parts.sql`** of the 15 root queries uses no missing table (`probe_workstep_duplicates.sql` too, but it fails lint). `wp_status` + `wp_department_link` alone block 12 of 15. Until the DWH administrator adds them, the tool can run almost none of your queries.

## A.3 Approaches

**Where the SQL runs**

| Approach | Verdict |
|---|---|
| **A. Pass-through Oracle SQL (chosen).** Convert PostgreSQL → Oracle SQL; the runner sends it through the linked server unchanged (`EXEC (N'…', params) AT [DWH_DB]` when RPC Out is enabled, else `SELECT * FROM OPENQUERY([DWH_DB], N'…')`). | Oracle does joins, filters and sorting next to the data; one engine's semantics to model (Oracle's), not two; Oracle's case-sensitive comparisons and NULL ordering match PostgreSQL better than SQL Server's. Costs: no parameter binding in `OPENQUERY` mode (strict value check instead), 8000-character limit in `OPENQUERY` mode, the Oracle-side user's rights matter (checked in Phase 0b). |
| B. Four-part T-SQL (Rev 1) | Rejected: measured 37–68 s for a 4-table join with `TOP 20` and a timeout for the steps query; semantics split between the relay (case-insensitive) and Oracle. |
| C. Ask the administrator for views per query | Not under our control and needs a request per query; complements A at best. |

**How the converter works** (unchanged from Rev 1): tree-based with our own printer. Text rewriting is rejected because it cannot tell code from strings or comments, cannot infer types (`date + int` vs `int + int`, month arithmetic), cannot tell CTE names from tables, and cannot detect "something I don't recognise", so it cannot fail loudly.

**Execution mode** is a setting (`exec_mode` in `dwh/mapping.yaml`). Phase 0b (b1) found RPC Out off, so it is **`openquery`** today (no bound parameters, 4000-character limit for the `N'…'` text (Phase 2), duplicate output names refused: b7). `exec_at` (bound parameters, no length limit, duplicate names and row order untouched) stays supported in the code and is switched on by changing the setting if the administrator enables RPC Out.

## A.4 Converter design

**Pipeline** (`convertQuery(source, filename, options)`):

1. **Pre-process.** Normalise CRLF to LF. A small lexer (shared with the safety scanner; aware of `'…'`, `"…"`, `--`, nested `/* */`) finds placeholders `<NAME>` (pattern `<[A-Z0-9_]+>`) **inside string literals only** and swaps each for a sentinel `__PH_NAME__`. A placeholder anywhere else is an error. `E'…'`, `U&'…'` and `$$…$$` are errors.
2. **Lint gate.** Run the existing `lintSql` on the source. Any error stops conversion (`E_LINT`, with the lint messages). Warnings do not stop it.
3. **Parse.** `astify(sql, {database: 'PostgresQL', parseOptions: {includeLocations: true}})`. More than one statement → `E_MULTI_STATEMENT`; one trailing `;` is fine. Root not `select` → `E_NOT_SELECT`.
4. **Allow-list check.** Walk every node; anything not listed as converted in A.5 → `E_UNSUPPORTED` naming the construct in plain words.
5. **Scope resolution.** Scopes for the query, each CTE and each subquery. A `FROM` name matching a CTE in scope stays a CTE name; every other name must be an AMOS table in the CSV and becomes `STG_AMOS.<NAME>`. Every column must be table-qualified (house style) and exist in the CSV (anywhere, not just the select list) → else `E_UNKNOWN_COLUMN`.
6. **Type inference.** From CSV `pgType` (`int4`/`INT` → int, `float8` → float, `numeric` → numeric, `varchar`/`text` → text) and literals; derived types follow the algebra below. A rewrite that needs an unknown type → `E_TYPE_UNKNOWN`.
7. **Rewrite** into an Oracle tree (A.5).
8. **Names.** Exact spelling from `dwh/catalogue.json` (upper case today), else upper case. Printed unquoted, except Oracle reserved words (static list), which are quoted in exact catalogue case. Conversion does **not** depend on whether a table exists in the DWH; availability is reported separately (A.6).
9. **Print** two renderings of the same tree: *pretty* (committed file: one select item per line, fixed indentation, LF) and *execution* (single line, minimal spaces). Every binary expression in parentheses; no trailing `;`; no comments inside execution text.
10. **Self-check.** Re-parse the execution text with the library's PostgreSQL grammar after removing a trailing `FETCH FIRST/NEXT … ROWS ONLY` / `OFFSET … ROWS` clause and the `N` prefix of national strings (verified to parse the emitted subset). Failure means a converter bug → `E_SELF_CHECK`. Phase 2 adds a live compile check against Oracle (Task 2.2).
11. **Safety scan** of the execution text (A.8) → `E_FORBIDDEN`.
12. **Length.** In `openquery` mode, execution text over **4000** characters after quote doubling, with each placeholder counted as 100 characters and room for the run-time row cap → `E_TOO_LONG`. OPENQUERY takes 8000 *bytes*, and the text is sent as `N'…'` (2 bytes per character): confirmed live in Phase 2 (SQL Server error 103 at 7,889 characters). Largest current query: about 3,860 characters as sent.

**Date and time algebra** (`d` = time-less date, `ts` = timestamp, `i` = int):

| PostgreSQL | Type | Oracle emitted |
|---|---|---|
| `DATE 'Y-M-D'` | date | `DATE 'Y-M-D'` |
| `TIMESTAMP 'Y-M-D h:m:s'` | ts | `TIMESTAMP 'Y-M-D h:m:s'` |
| `d + i`, `i + d` | date | `(d + i)` (Oracle DATE + number = days) |
| `d - i` | date | `(d - i)` |
| `d1 - d2` | int | `(d1 - d2)` (both time-less, so a whole number) |
| `x ± INTERVAL 'n' DAY/HOUR/MINUTE/SECOND` | ts | `(x ± NUMTODSINTERVAL(n, 'HOUR'))` (never Oracle `INTERVAL` literals: their default precision rejects e.g. `INTERVAL '100' HOUR`) |
| `INTERVAL 'n' WEEK` | | `NUMTODSINTERVAL(7 * n, 'DAY')` |
| `e * INTERVAL 'k U'` (e int), then `x + …` | ts | `(x + NUMTODSINTERVAL(((k) * (e)), 'U'))` |
| `d ± INTERVAL 'n' MONTH/YEAR` | ts (midnight) | PostgreSQL's clamp rule (keep the day, clamp to the target month's last day): `(ADD_MONTHS(TRUNC(d, 'MM'), k) + (LEAST(EXTRACT(DAY FROM d), EXTRACT(DAY FROM LAST_DAY(ADD_MONTHS(TRUNC(d, 'MM'), k)))) - 1))`, k = ±n (×12 for years). Never bare `ADD_MONTHS(d, k)` (30 Apr + 1 → 31 May, PostgreSQL gives 30 May) nor `d + INTERVAL 'n' MONTH` (31 Aug − 6 months → ORA-01839). On a timestamp operand → rejected |
| `CURRENT_TIMESTAMP`, `NOW()`, `LOCALTIMESTAMP` | ts | `SYS_EXTRACT_UTC(SYSTIMESTAMP)` |
| `CURRENT_DATE` | date | `TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP))` (never Oracle `SYSDATE`/`CURRENT_DATE`: server- or session-local, and `CURRENT_DATE` carries a time) |
| `x::date`, `CAST(x AS date)` | date | `TRUNC(x)` (Oracle `CAST(… AS DATE)` keeps the time of day) |

Chains keep their order and are never folded. Month tests pinned in Task 1.4: 2026-08-31 − 6 months = 2026-02-28; 2026-04-30 + 1 month = 2026-05-30; 2028-01-31 + 1 month = 2028-02-29; 2026-03-15 − 6 months = 2025-09-15.

Example, one real line of `extract_wp_seqs_steps.sql`:

```sql
-- PostgreSQL
wp_header.start_date >= ((CURRENT_DATE - INTERVAL '6' MONTH)::date - DATE '1971-12-31')
-- Oracle (pretty rendering, wrapped here for reading)
(WP_HEADER.START_DATE >= (TRUNC((ADD_MONTHS(TRUNC(TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)), 'MM'), -6)
  + (LEAST(EXTRACT(DAY FROM TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP))),
           EXTRACT(DAY FROM LAST_DAY(ADD_MONTHS(TRUNC(TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)), 'MM'), -6)))) - 1)))
  - DATE '1971-12-31'))
```

**Errors and warnings.** `ConvertError { code, plain, detail, loc? }` stops conversion. `ConvertWarning { code, plain, loc? }` appears in the generated file's header and in yellow on the page before Run.

**Determinism.** Output depends only on: source text, converter version, `dwh/mapping.yaml`, `dwh/catalogue.json`, the CSV, `schema/`. Tested by converting twice and by the committed golden files.

**Generated file** (`queries/dwh/extract_wp_seqs_steps.sql`, Oracle SQL in the pretty rendering):

```sql
-- GENERATED by `npm run dwh:convert`. DO NOT EDIT: edit the source and re-run.
-- Oracle SQL for the DWH (STG_AMOS), sent through the DWH_DB linked server by the DWH runner.
-- Source: extract_wp_seqs_steps.sql  sha256:1a2b3c4d5e6f
-- Converter: 2   Catalogue snapshot: sha256:9f8e7d6c5b4a
-- Available in the DWH: NO (missing tables: WP_STATUS, WP_DEPARTMENT_LINK)
-- Warning W_UTC_TODAY: "today" and "now" mean UTC, the same as in AMOS.
-- Warning W_STRING_ORDER: text sorts may differ slightly from AMOS.
```

## A.5 Edge-case catalogue

"Rejected" means: conversion stops, the page shows the plain reason and the source line, no SQL is produced. Test files are under `test/dwh/`.

| # | Case | Behaviour | Test |
|---|---|---|---|
| 1 | Table reference `wo_header` | `STG_AMOS.WO_HEADER` in `FROM`/`JOIN`; columns `WO_HEADER.EVENT_PERFNO_I` (table name, no alias; form confirmed in Phase 0b, b5) | `names.test.ts` |
| 2 | CTE name in `FROM` | Not prefixed; scope-resolved, incl. inside subqueries | `names.test.ts` |
| 3 | Schema-qualified source name (`public.wp_header`) | Rejected | `guard.test.ts` |
| 4 | Unqualified column | Rejected `E_UNQUALIFIED_COLUMN` | `names.test.ts` |
| 5 | Column not in the AMOS CSV (anywhere) | Rejected `E_UNKNOWN_COLUMN` | `names.test.ts` |
| 6 | Table or column missing from the DWH snapshot | Converts; marked "not available in the DWH" with the missing names in the file header, manifest and page; the runner refuses it (`E_MISSING_IN_DWH`) | `names.test.ts`, `cli.test.ts` |
| 7 | Identifier case | Exact catalogue case (upper), unquoted | `names.test.ts` |
| 8 | Oracle reserved word as identifier (`LEVEL`, `COMMENT`, `SIZE`, `USER`…) | Quoted in exact catalogue case (`"LEVEL"`); none used today | `print.test.ts` |
| 9 | Quoted identifier in the source (`"Order"`) | Rejected (AMOS has no mixed-case names) | `guard.test.ts` |
| 10 | Column alias `AS z_WP_ID` | `AS "z_WP_ID"` (quoted so Oracle keeps the case); over 30 characters → `E_ALIAS_TOO_LONG` | `print.test.ts` |
| 11 | Duplicate output names (two `text` columns) | Allowed in `exec_at` mode; in `openquery` mode the relay rejects them (confirmed, Phase 0b b7), so `E_DUPLICATE_OUTPUT` (needs `exec_at`, i.e. RPC Out enabled) | `print.test.ts`, Task 2.1 |
| 12 | Select expression without alias | Allowed, `W_UNNAMED_COLUMN` (Oracle names it by its text) | `print.test.ts` |
| 13 | `SELECT *` | Allowed, `W_SELECT_STAR` | `guard.test.ts` |
| 14 | Date arithmetic, `CURRENT_*`, intervals | Per A.4 | `dates.test.ts`: every row, the A.4 example, all six real `* INTERVAL '1 minute'` lines, the 7 h / 24 h chain |
| 15 | Month/year arithmetic | PostgreSQL clamp form (A.4); timestamp operand → rejected | `dates.test.ts`: the four pinned dates |
| 16 | Fractional or compound interval | Rejected | `dates.test.ts` |
| 17 | `interval + interval`, bare interval output, `ts - ts` | Rejected | `dates.test.ts` |
| 18 | `CURRENT_TIME`, `LOCALTIME`, `AT TIME ZONE`, `timezone()` | Rejected; suggest the repo's `+ INTERVAL '7' HOUR` idiom | `dates.test.ts` |
| 19 | Time zones | Both sides in UTC; `W_UTC_TODAY` when `CURRENT_*` appears; assumes AMOS `TimeZone` = UTC (Phase 0b, b10) | `dates.test.ts` |
| 20 | `::date` | `TRUNC(x)` | `dates.test.ts` |
| 21 | Date-typed output columns | Oracle DATE carries 00:00:00; the converter reports output types and the runner prints them as `YYYY-MM-DD` | `convert.test.ts`, Task 2.1 |
| 22 | Date range | Oracle DATE ends 9999-12-31; DWH max is 2200 (Phase 0.5); error message mapped | `errorsPlain.test.ts` |
| 23 | `EXTRACT(YEAR|MONTH|DAY FROM x)` | Passed through; `HOUR|MINUTE` from a date → `EXTRACT(HOUR FROM CAST(x AS TIMESTAMP))`; `DOW|ISODOW|WEEK|EPOCH|SECOND` → rejected | `functions.test.ts` |
| 24 | `date_trunc`, `to_char`, `FORMAT` | Rejected (formatting belongs in code) | `functions.test.ts` |
| 25 | `string_agg`, `array_agg`, arrays | Rejected | `functions.test.ts` |
| 26 | `COALESCE`, `NULLIF` | Passed through | `functions.test.ts` |
| 27 | `ISNULL`/`NOTNULL` postfix | Rejected | `guard.test.ts` |
| 28 | `::integer/bigint/smallint` | From an integer → `CAST(x AS NUMBER(10|19|5))`; from float/numeric → rejected `E_INT_CAST_FROM_NON_INT` | `casts.test.ts` |
| 29 | `::numeric(p,s)` / bare `::numeric` | `CAST(x AS NUMBER(p,s))` / rejected | `casts.test.ts` |
| 30 | `::text`, `::varchar(n)` | From an integer → `TO_CHAR(x)`; anything else → rejected | `casts.test.ts` |
| 31 | `::timestamp` / `::timestamptz` / `::boolean` | `CAST(x AS TIMESTAMP)` / rejected / rejected | `casts.test.ts` |
| 32 | `LIMIT n` (outer or subquery) | Oracle ≥ 12c: `FETCH FIRST n ROWS ONLY`; older → rejected (version from Phase 0b, b2); `LIMIT ALL` dropped; non-literal → rejected | `limit.test.ts` |
| 33 | `LIMIT` without `ORDER BY` | As #32 plus `W_LIMIT_NO_ORDER` | `limit.test.ts` |
| 34 | `OFFSET m` | `OFFSET m ROWS FETCH NEXT n ROWS ONLY` (≥ 12c); older → rejected | `limit.test.ts` |
| 35 | `ORDER BY` in a subquery/CTE without `LIMIT` | Removed, `W_SUBQUERY_ORDER_DROPPED` (Oracle refuses it inside `IN`/`EXISTS`; never guarantees order anyway) | `limit.test.ts` |
| 36 | NULL ordering | Oracle's defaults equal PostgreSQL's; the printer still writes them explicitly (ASC → `NULLS LAST`, DESC → `NULLS FIRST`, explicit honoured), also inside `OVER (…)`; works with `DISTINCT`/`UNION` | `order.test.ts`, incl. the real steps query (NULL `z_WP_SEQ_1ST` last) |
| 37 | `ORDER BY` alias or ordinal | Resolved to the select expression | `order.test.ts` |
| 38 | String sort order | Oracle `NLS_SORT` (Phase 0b, b3) differs from AMOS `en_US.UTF-8` → `W_STRING_ORDER` on text sort keys | `order.test.ts` |
| 39 | Ties in `ORDER BY` | Verification compares order on sort-key values only | `compare.test.ts` |
| 40 | String `=`, `IN`, `<>` | Passed through. With `NLS_COMP = BINARY` (expected; Phase 0b, b3) Oracle is case-sensitive and keeps trailing spaces on `VARCHAR2`, like PostgreSQL: no warning. `CHAR(n)` column → `W_CHAR_PADDED`; `NLS_COMP = LINGUISTIC` → `W_STRING_COMPARE` | `strings.test.ts` |
| 41 | Empty string literal `''` anywhere | Rejected `E_EMPTY_STRING`: Oracle treats `''` as NULL, so `= ''` never matches and `COALESCE(x, '')` returns NULL | `strings.test.ts` |
| 42 | `IS NULL`/`IS NOT NULL` on text columns | `W_EMPTY_IS_NULL`: values that are `''` in AMOS are NULL in Oracle | `strings.test.ts` |
| 43 | `LIKE` | Passed through; pattern containing `\` → rejected (PostgreSQL's default escape character) | `strings.test.ts` |
| 44 | `ILIKE` | `LOWER(x) LIKE LOWER('pat')` | `strings.test.ts` |
| 45 | `SIMILAR TO`, `~`, regex | Rejected | `strings.test.ts` |
| 46 | `||` | Rejected `E_CONCAT` | `strings.test.ts` |
| 47 | Non-ASCII literal (Vietnamese) | `N'…'`; the runner also sends the whole text as an `N'…'` string to the relay (Phase 0b, b8 confirms) | `strings.test.ts` |
| 48 | `''` quote doubling | Kept; doubled again by the runner inside the relay statement | `strings.test.ts`, Task 2.1 |
| 49 | Boolean literals / boolean in output | Rejected `E_BOOLEAN` | `guard.test.ts` |
| 50 | Integer division (both int) | `TRUNC(a / b)` (Oracle `/` gives 3.5 for 7/2); `%` → `MOD(a, b)` (same sign rule) | `arith.test.ts` |
| 51 | Division involving numeric | Passed through, `W_DECIMAL_SCALE` | `arith.test.ts` |
| 52 | `^`, `~`, `&`, `|`, `#`, `<<`, `->`, `->>`, `@>` | Rejected | `arith.test.ts` |
| 53 | Operator precedence | Every binary/unary expression parenthesised | `print.test.ts` |
| 54 | `COUNT`, `SUM`, `MIN`, `MAX` | Passed through (Oracle `NUMBER` does not overflow); `W_STRING_ORDER` on text `MIN`/`MAX` | `aggregates.test.ts` |
| 55 | `AVG` | Rejected (result precision differs; compute in code) | `aggregates.test.ts` |
| 56 | `FILTER (WHERE c)` | `AGG(CASE WHEN c THEN x END)`; `COUNT(*) FILTER` → `COUNT(CASE WHEN c THEN 1 END)` | `aggregates.test.ts` |
| 57 | `GROUP BY` ordinal or alias | Resolved to the expression (Oracle allows neither) | `aggregates.test.ts` |
| 58 | Window functions | `row_number`, `rank`, `dense_rank`, `lag`, `lead`, `COUNT/SUM/MIN/MAX OVER (…)` without a frame: passed through with #36; other frames, named `WINDOW` → rejected | `window.test.ts` |
| 59 | `DISTINCT ON` | Rejected (needs a derived table alias, which the rules forbid) | `guard.test.ts` |
| 60 | Plain `DISTINCT` | Passed through | `guard.test.ts` |
| 61 | CTE (`WITH`) | Passed through; `RECURSIVE`, `MATERIALIZED` → rejected | `cte.test.ts` |
| 62 | Subqueries (`EXISTS`, `NOT EXISTS`, `IN`, scalar, `= ANY`) | Passed through | `cte.test.ts`, incl. the real `NOT EXISTS` query |
| 63 | Derived table in `FROM`, `LATERAL`, `USING`, `NATURAL JOIN` | Rejected | `guard.test.ts` |
| 64 | `UNION [ALL]`, `INTERSECT`, `EXCEPT` | Passed through; `EXCEPT` → `MINUS` | `cte.test.ts` |
| 65 | CLOB columns | **Not built.** Phase 0b (b8) found no CLOB columns in `STG_AMOS` (only `VARCHAR2` ≤ 4000 and `NUMBER`), so there is no `E_TEXT_COLUMN` rule. If a CLOB ever appears, the schema diff reports it as `retyped` (error) and the queries using it are refused until the rule is added | `schemaDiff.test.ts` |
| 66 | Long text values | Long text is `VARCHAR2(4000)`, so the schema diff reports `truncation_risk` for every `text`-typed AMOS column (a live risk: the three longest `text_html` values all stop at exactly 3700 characters; not verifiable in AMOS yet). Page and CSV note it on queries that select such a column; verification reports text-length differences prominently | `schemaDiff.test.ts`, Task 3.2 |
| 67 | `SELECT` without `FROM` | `FROM DUAL` added | `print.test.ts` |
| 68 | Comments | Dropped; header names the source; placeholders or `;` inside comments ignored | `preprocess.test.ts` |
| 69 | Placeholders | Only inside string literals; kept literally in the committed file; at run time `exec_at` binds them as `?` parameters, `openquery` inlines a value only if it matches `^[A-Za-z0-9 ._/-]{1,100}$` after trimming, else refuses; empty → Run disabled | `preprocess.test.ts`, Task 2.1 |
| 70 | Trailing `;`, several statements | One trailing `;` dropped; two → `E_MULTI_STATEMENT` | `preprocess.test.ts` |
| 71 | CRLF | Normalised; output LF | `preprocess.test.ts` |
| 72 | `E'…'`, `U&'…'`, `$$…$$` | Rejected | `preprocess.test.ts` |
| 73 | Writes or side effects (DML, `SELECT … INTO`, `FOR UPDATE`, data-modifying CTEs, `nextval`, `set_config`, `pg_sleep`, `dblink`, …) | Rejected by the allow-list and by the Oracle-text scan (A.8) | `safety.test.ts` |
| 74 | Function not on the allow-list | Rejected `E_UNSUPPORTED_FUNCTION`. Source allow-list: `COALESCE`, `NULLIF`, `LOWER`, `UPPER`, `ABS`, the date items, the aggregates/windows above | `functions.test.ts` |
| 75 | `IS DISTINCT FROM`, `GREATEST`, `LEAST` | Rejected (Oracle `GREATEST` returns NULL if any argument is NULL; PostgreSQL ignores NULLs) | `functions.test.ts` |
| 76 | `BETWEEN` / `BETWEEN SYMMETRIC` | Passed through / rejected | `guard.test.ts` |
| 77 | Very large integer literals | Passed through | `arith.test.ts` |
| 78 | Column renamed in the DWH | Rejected `E_RENAMED_NEEDS_APPROVAL` unless approved in `mapping.yaml` (A.6) | `names.test.ts` |
| 79 | Column retyped in the DWH (e.g. a date int stored as Oracle `DATE`) | Rejected `E_RETYPED_COLUMN` when a rewrite depends on the type, else warning | `names.test.ts` |
| 80 | `VARCHAR2` text in a non-Unicode database charset | `W_MAYBE_LOST_UNICODE` from the schema diff (charset from Phase 0b, b3) | `schemaDiff.test.ts` |
| 81 | `float8` values | Passed through; verification compares shortest round-trip strings | `compare.test.ts` |
| 82 | Source with lint errors | Not converted (`E_LINT`), listed as such | `cli.test.ts` |
| 83 | Execution text length | `openquery` mode: over 4000 characters (`N'…'` text; see A.4 step 12) → `E_TOO_LONG`, at convert time and again at run time with the real values; `exec_at` has no such limit | `convert.test.ts`, `relay.test.ts` |
| 84 | Row order across the relay | `exec_at` returns Oracle's order unchanged; `openquery` keeps it in practice but not by guarantee → verification checks order | `compare.test.ts` |
| 85 | Oracle `NUMBER` without precision as mapped by the relay | Runner formats each column by the converter's output type (int columns as whole numbers), not by the relay's type | Task 2.1 |

## A.6 Schema fidelity (DWH vs AMOS)

- **Catalogue snapshot.** `npm run dwh:catalogue` runs one read-only `OPENQUERY([DWH_DB], 'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_ID, DATA_TYPE, DATA_LENGTH, CHAR_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE FROM ALL_TAB_COLUMNS WHERE OWNER = ''STG_AMOS''')` (the only form that works cleanly; Phase 0.3) and writes `dwh/catalogue.json` (committed; names and types only), sorted for stable diffs.
- **Availability vs convertibility.** Conversion uses the AMOS CSV; availability uses the snapshot. Each converted query gets `available: true` or `available: false, missing: [...]` in the manifest and header (#6).
- **Diff.** `npm run dwh:schema-diff` (offline) compares tables/columns used by any source query, everything in `schema/*.yaml`, and the CSV, writes `docs/generated/dwh-schema-diff.md`, and returns issues: `missing_table`, `missing_column` (error); `case_only` (info); `retyped`; `truncation_risk`; `maybe_lost_unicode`; `extra_column` (info). Oracle compatibility table: AMOS `int4` ↔ `NUMBER(p,0)` or `NUMBER` holding whole numbers → OK (Phase 0.3 confirmed); `int4` date/time int ↔ `DATE`/`TIMESTAMP` → retyped (error); `varchar(n)` ↔ `VARCHAR2(m)`/`NVARCHAR2(m)` with m < n → `truncation_risk`; `text` ↔ `CLOB`/`NCLOB` → OK, but #65 applies; `text` ↔ `VARCHAR2(4000)` → `truncation_risk`; `float8` ↔ `BINARY_DOUBLE`/`NUMBER`/`FLOAT` → OK; `VARCHAR2`/`CLOB` with a non-Unicode database charset → `maybe_lost_unicode`.
- **Renames.** `dwh/mapping.yaml` per-column overrides `{ dwh: NEW_NAME, keep_output_name: true }` print `NEW_NAME AS "old_name"` (the one rule exception, A.11).
- **Before every run** the page shows that query's availability, the column check and the snapshot's age, with "Refresh DWH catalogue" (host only, read-only).

**Mapping file** after Phase 0b (fields used by the converter and runner):

```yaml
linked_server: DWH_DB
oracle_schema: STG_AMOS
exec_mode: openquery          # b1: RPC Out is off; exec_at only if the administrator enables it
oracle_version: 12            # b2 (12.2): FETCH FIRST allowed, decides #32/#34
nls_comp: BINARY              # b3
nls_sort: BINARY              # b3
db_charset: AL32UTF8          # b3
columns: {}                   # renames, e.g. wo_header.x: { dwh: X_NEW, keep_output_name: true }
amos_collation: other         # Phase 0.7
export_row_limit: 2000000
```

## A.7 Result verification

The AMOS side is a CSV exported from AMOS.

1. **Freeze the clock.** `npm run dwh:verify-pack -- <source.sql> --at <UTC instant> [--param K=V]` writes `verify/<name>/amos.sql` (PostgreSQL; `CURRENT_DATE`/`CURRENT_TIMESTAMP` replaced by `DATE '…'` / `TIMESTAMPTZ '… +00'` by splicing at the parser's offsets, so the rest stays byte-for-byte) and `verify/<name>/dwh.sql` (converter output with `pinNow`, i.e. `DATE '…'` / `TIMESTAMP '…'` instead of `SYS_EXTRACT_UTC(SYSTIMESTAMP)`). Because the DWH is near real time, the default `--at` is the most recent whole hour.
2. **Fixed keys.** `dwh/verify-keys.yaml` lists, per query, a few workpacks closed more than a few days ago. Parameterised queries use them as parameters; time-window queries use the frozen clock.
3. **Run.** You paste `amos.sql` into AMOS and export `verify/<name>/amos.csv`; the tool runs `dwh.sql`.
4. **Compare** (`npm run dwh:compare -- amos.csv dwh.csv [--key=…]`, also in the page): headers equal ignoring case; row counts; multiset equality of normalised rows (reusing `normalizeCell`); per-column SHA-256 checksums; row order on sort-key values (#39); cell differences classified as whitespace, case, NULL vs empty (expected, #41/#42), number formatting, truncated text, ±7 h shift, or real change.
5. **Drift.** Freshness = `MAX(mutation)` + `mutation_time` (near real time, Phase 0.5); rows found on one side only are grouped by the first key column so drift reads as "2 workpacks changed between the two runs".
6. **Pass criterion:** zero differences other than number formatting, whitespace and NULL-vs-empty on the fixed-key run, for every available query.
7. **Engine-level proof of the date algebra.** `test/dwh/fixtures/expr-probes.json`: ~25 table-free expressions (the four month cases, minutes on a date, day differences across years, integer division, NULL ordering on a small `UNION ALL` of `FROM DUAL` rows). Expected values from a JS reference; you run the PostgreSQL versions once in AMOS; `npm run dwh:probe-exprs` runs the Oracle versions (`… FROM DUAL`, read-only).

## A.8 Safety

1. **Source gate:** lint must pass; single statement; root is `SELECT`/`WITH`; allow-list.
2. **Oracle-text gate:** `assertReadOnlyOracle(text)` scans the execution text with the shared lexer, outside strings and quoted identifiers: must start with `SELECT` or `WITH`; no `;`, no `@` (database links), no `/*`/`--`; none of `INSERT UPDATE DELETE MERGE INTO CREATE DROP ALTER TRUNCATE GRANT REVOKE COMMIT ROLLBACK SAVEPOINT LOCK BEGIN DECLARE EXECUTE EXEC CALL FOR` (`FOR UPDATE`); every function name must be on the **emitted** allow-list (`NUMTODSINTERVAL ADD_MONTHS TRUNC LAST_DAY LEAST EXTRACT SYS_EXTRACT_UTC SYSTIMESTAMP CAST TO_CHAR COALESCE NULLIF LOWER UPPER ABS MOD COUNT SUM MIN MAX ROW_NUMBER RANK DENSE_RANK LAG LEAD`), so `DBMS_*`, `UTL_*` and anything else is refused. The runner calls it again just before executing.
3. **Fixed relay statements.** The runner builds exactly one of two templates and nothing else: `EXEC (N'<oracle text, quotes doubled>'[, @p1, …]) AT [DWH_DB]` or `SELECT * FROM OPENQUERY([DWH_DB], N'<oracle text, quotes doubled>')`. The catalogue refresh uses one more fixed statement (A.6). No other T-SQL is ever sent.
4. **Only converter output runs.** The page sends a source path and parameter values, never SQL. The server checks the path against the known source list, re-reads and re-converts, then runs. No free-text SQL box. `scripts/dwh.ts` is retired; `npm run dwh:run --raw <file>` (for maintainers) runs hand-written Oracle SQL only after the same Oracle-text gate.
5. **Connection:** `readOnlyIntent: true`, `appName: 'amos-dwh-runner'`, `connectionTimeout: 15000`, `requestTimeout` 120 s preview / 900 s export, default `textsize` (no CLOB columns), `useUTC: true`, pool max 4.
6. **Caps:** preview 500 rows: the runner appends `FETCH FIRST 501 ROWS ONLY` (or lowers an existing one) when Oracle ≥ 12c, else wraps `SELECT * FROM (<q>) WHERE ROWNUM <= 501` (not for queries with duplicate output names); it always stops reading at 501 and cancels. Exports stream with the `export_row_limit` and a Stop button.
7. **Database rights:** the relay login is read-only (Phase 0.4). With pass-through, the **Oracle user** behind the link matters too; Phase 0b (b4) lists its privileges. If it can write, the app gates still hold, but we ask the administrator for a read-only mapping.
8. **Web server:** port 4870 (next free up to 4880).
   - **Unshared (default):** `127.0.0.1`; `Host` must be `127.0.0.1:<port>` or `localhost:<port>`.
   - **Shared (`share: true` in `dwh/local/share.json`):** `0.0.0.0`, **HTTPS** only; refuses to start without a certificate and an access code. `Host` must be one of `share.json`'s names (PC name, DNS name, IP), blocking DNS rebinding. Visitors enter the access code once; the server keeps a scrypt hash only and issues a session cookie (`HttpOnly; Secure; SameSite=Strict`, 12 h). Five wrong codes from one IP lock it for 15 minutes. Optional `allow_cidrs`.
   - **Both:** every `/api/*` call needs the session (shared) or per-launch token (unshared) plus header `X-Runner-Token`; no CORS headers; JSON bodies only; `Content-Security-Policy: default-src 'self'`.
   - **Host-only:** Quit and Refresh catalogue only from `127.0.0.1`.
   - **Fair use:** one running query per visitor, four in total; extra requests get "The DWH runner is busy, try again in a minute". Compare uploads ≤ 200 MB.
   - **Audit:** `logs/runner.log` records time, visitor IP, source path, parameters, row count, duration.
   - **Certificate:** an IT-issued one if possible; otherwise `npm run dwh:share-setup` creates a self-signed one with PowerShell `New-SelfSignedCertificate`.
9. **Credentials:** read only by the server process; responses and logs go through the plain-error mapper, which never includes server, user or password.

## A.9 The page

**Options considered** (unchanged): **A. local web page (chosen)**, B. Electron desktop app (heavy dependencies and a build step), C. Excel + Power Query (no safety gate, credentials per workbook, no warnings).

**Screen sketch**

```
┌ DWH Runner ──────────────────────────────── DWH data as of 17 Nov 09:22 UTC ┐
│ Queries                 │ extract_all_parts.sql                              │
│ ✓ extract_all_parts     │ [AMOS version] [DWH version] [Compare]             │
│ ⊘ extract_work_order    │ ✓ All 31 columns found in the DWH (snapshot 2d)    │
│ ⊘ extract_wp_seqs_steps │ [Run preview] [Download all as CSV] [Stop]         │
│ ✗ probe_closed_dates    │ First 500 rows (more available) · 3.1 s            │
│ ▸ WP sequences (12) ⊘   │ partno │ description │ …                           │
└─────────────────────────┴────────────────────────────────────────────────────┘
 ✓ ready   ⚠ ready, with notes   ⊘ not available in the DWH (tables missing)   ✗ cannot convert
```

**Flow:** the list shows every source (root `*.sql` and `queries/wp_seqs/*.sql`) with its state. Selecting one shows both SQL versions (read-only), the notes, availability ("Needs tables the DWH doesn't have yet: WP_STATUS, WP_DEPARTMENT_LINK"), the column check and one input per placeholder. **Run preview** shows 500 rows. **Download all as CSV** saves `<query>_DWH_<yyyymmdd-hhmm>.csv`: UTF-8 with BOM, CRLF, every field quoted, date-typed columns `YYYY-MM-DD`, timestamps `YYYY-MM-DD HH:MM:SS` in UTC, integers without decimals. **Compare** takes an AMOS CSV export.

**Plain-language errors** (Oracle errors arrive wrapped in relay errors 7320/7321/7399 with an `ORA-` code in the text):

| Situation | Message |
|---|---|
| Relay login failed (18456) | "The DWH did not accept the username or password saved on the host PC. Ask whoever set up the .env file to check them." |
| Cannot reach the relay (`ESOCKET`, connect `ETIMEOUT`) | "Can't reach the DWH server. Is the host PC on the company network or VPN?" |
| Request timeout | "The DWH took longer than 2 minutes. Try fewer workpacks or a shorter date range, or try again later." |
| ORA-00942 | "The DWH has no table called X. It may not have been copied to the DWH yet." |
| ORA-00904 | "The DWH has no column called X. It may have been renamed. Ask the host to refresh the DWH catalogue." |
| ORA-00932 | "A long-text column was used in a comparison or sort, which the DWH can't do." |
| ORA-01013 | "The query was stopped." |
| ORA-12170, ORA-12541, ORA-03113, ORA-03135 | "The DWH's link to the Oracle database failed. Try again in a few minutes; if it keeps happening, tell the DWH administrator." |
| Other 7399/7303/7330 | Same as above |
| `.env` missing | "The host PC is not set up to reach the DWH yet (the settings file is missing)." |
| Node missing or older than 24 (launcher) | "Node.js 24 or newer is needed on the host PC. Ask IT to install it." |
| Anything else | "Something went wrong. The details below can help whoever maintains this tool." |

**Sharing on the WAN.** The host PC runs the server; colleagues open `https://<host-pc-name>:4870` and enter the access code. The host must be on and awake (`npm run dwh:autostart` adds the launcher to the Startup folder); Windows Firewall must allow TCP 4870 (the guide gives IT the `netsh advfirewall firewall add rule name="DWH Runner" dir=in action=allow protocol=TCP localport=4870 profile=domain` command); everyone shares the one read-only login, with the audit log as the per-person record; only the host adds or changes queries.

**Starting it (host PC):** `Start DWH Runner.cmd` checks `node` ≥ 24 and `.env`, starts `node --env-file=.env src/dwh/server.ts` minimised ("DWH Runner — close this window to stop"), and the server opens the browser. If `/health` already answers with our signature, it only opens the browser. `npm run dwh:shortcut` adds a desktop shortcut.

**AMOS in the same screen:** "AMOS version" has **Copy for AMOS**; Compare takes the exported CSV. The `QueryEngine` interface keeps a direct AMOS engine possible later; not planned.

## A.10 Repo fit

- **Generated SQL:** `queries/dwh/` mirrors source paths and holds Oracle SQL (pretty rendering); `queries/dwh/_manifest.json` lists every source with `converted` (+ warnings, `available`, `missing`) or `refused` (+ code, plain reason), and hashes. Committed, never hand-edited.
- **Commands** (through `src/cli.ts` → `src/dwh/cli.ts`): `dwh:convert`, `dwh:check` (no database; added to `npm run check`), `dwh:catalogue` (read-only), `dwh:schema-diff` (offline), `dwh:compile-all` (read-only live compile check), `dwh:run <source.sql> [--param K=V] [--csv out.csv] [--raw]`, `dwh:verify-pack`, `dwh:compare`, `dwh:probe-exprs`, `dwh:ui`, `dwh:shortcut`, `dwh:autostart`, `dwh:share-setup`.
- **`npm run validate`:** unchanged; it never reads `queries/dwh/` (a comment in `src/cli.ts` says so).
- **`npm run scaffold`:** unchanged. Order: scaffold → validate → `dwh:convert`.
- **`.gitignore`:** add `verify/`, `logs/`, `dwh/local/`.
- **`scripts/`** (untracked): retired after Task 2.4; `example_steps.sql` becomes a fixture.
- **CLAUDE.md addition** (Task 1.7):

  > ## DWH workflow
  > - The DWH is an **Oracle** staging copy of AMOS (schema `STG_AMOS`) behind a SQL Server 2016 linked server `DWH_DB`. Queries go through it as pass-through Oracle SQL, never as four-part T-SQL. Credentials only in `.env`; never print, log or commit them.
  > - Write and validate queries in PostgreSQL as usual, then `npm run dwh:convert`. Never hand-edit `queries/dwh/`; `npm run dwh:check` (part of `npm run check`) fails if it is stale.
  > - The converter refuses sources with lint errors and anything it cannot translate exactly (catalogue: docs/dwh-converter-plan.md §A.5). Change the source or extend the converter with a test; never edit generated files.
  > - Some AMOS tables are missing in the DWH; see `docs/generated/dwh-schema-diff.md`. Refresh with `npm run dwh:catalogue` then `npm run dwh:schema-diff`.
  > - Only `SELECT`/`WITH` ever runs, through `dwh:run` or the page. Never run writes on either database.
  > - "Now"/"today" are UTC on both sides (`SYS_EXTRACT_UTC(SYSTIMESTAMP)`); never emit `SYSDATE` or Oracle `CURRENT_DATE`. Oracle treats `''` as NULL.

## A.11 Rule compliance of generated SQL

- **No table aliases:** kept (`WO_HEADER.STATE`). The preview cap's `ROWNUM` wrapper (Oracle < 12c only) is an unnamed inline view added at run time, not a table alias, and never in committed files.
- **Approved `z_` aliases:** kept, quoted to preserve case (`"z_WP_ID"`).
- **No column combining:** kept.
- **1:1 output:** kept; rewrites change only how the source's own expressions are written. Explicit `NULLS LAST/FIRST` is added to every `ORDER BY` key (same meaning as the source).
- **The one opt-in exception:** an approved renamed column prints `NEW_NAME AS "old_name"`, a non-`z_` alias.

---

# Part B — Implementation plan

## Phase 0 — Read-only probes (done 2026-11-17)

- [x] 0.1–0.8 (see "Phase 0 findings" at the end).

## Phase 0b — Pass-through probes (done 2026-11-17; conditional go)

Read-only. I run the DWH ones through `scripts/dwh.ts` after you approve each (each is a `SELECT` or a `sys.servers` read); you run b10 in AMOS. **Go/no-go:** b6 must show the pass-through steps query returning its first 50 rows in under 15 s. If it doesn't, stop: the speed problem is on the Oracle side, and we take it to the DWH administrator before building anything.

**Outcome (2026-11-17): all probes done, results in "Phase 0b findings". b6 was not a clean pass; conditional go approved: Phase 1 may start now; Phases 2–4 wait for the b6 re-test below.**

**b6 re-test (gate for Phase 2):** the missing tables will not be added, so do not wait for them. Run the closest real steps query the DWH can run (all seven existing tables, the narrowest filter available such as one workpack number or a short date window, first 50 rows) through `OPENQUERY`, three runs. Pass = first rows in under 15 s on at least the warm runs and under 30 s cold. If it fails, take the numbers to the DWH administrator (indexes and statistics on the join columns) before building Phase 2.

- [x] **b1 RPC Out:** `SELECT is_rpc_out_enabled, is_data_access_enabled FROM sys.servers WHERE name = 'DWH_DB'` → `exec_at` possible?
- [x] **b2 Oracle version:** `SELECT * FROM OPENQUERY([DWH_DB], 'SELECT BANNER FROM V$VERSION')` (fallback `PRODUCT_COMPONENT_VERSION`) → `oracle_version`.
- [x] **b3 NLS and time:** via `OPENQUERY`: `NLS_SESSION_PARAMETERS` (`NLS_COMP`, `NLS_SORT`), `NLS_DATABASE_PARAMETERS` (`NLS_CHARACTERSET`, `NLS_NCHAR_CHARACTERSET`), `SELECT DBTIMEZONE, SESSIONTIMEZONE, SYS_EXTRACT_UTC(SYSTIMESTAMP) FROM DUAL`.
- [x] **b4 Oracle-side rights:** via `OPENQUERY`: `SELECT PRIVILEGE FROM SESSION_PRIVS`, `SELECT ROLE FROM SESSION_ROLES`.
- [x] **b5 Column-reference form:** `SELECT WO_HEADER.EVENT_PERFNO_I FROM STG_AMOS.WO_HEADER WHERE ROWNUM <= 1` through `OPENQUERY`.
- [x] **b6 Speed (go/no-go):** a hand-written Oracle version of `scripts/example_steps.sql` (first 20 rows) and of the trimmed 7-table steps query from Phase 0.6 (first 50 rows, only tables that exist), each through `OPENQUERY` (and `EXEC … AT` if b1 allows), three runs each; record times.
- [x] **b7 Duplicate column names:** `SELECT * FROM OPENQUERY([DWH_DB], 'SELECT 1 AS "a", 2 AS "a" FROM DUAL')`, and the same through `EXEC … AT` if b1 allows.
- [x] **b8 Long text and Vietnamese:** catalogue type of `WO_TEXT_DESCRIPTION.TEXT_HTML`; for the three longest values, Oracle `DBMS_LOB.GETLENGTH` (a read-only function, used in this manual probe only) vs the length received through the relay; and one row with Vietnamese text compared by you with the AMOS application.
- [x] **b9 Types through the relay:** the SQL Server types reported for a `NUMBER` column, a `DATE '1971-12-31' + START_DATE` expression and a CLOB.
- [x] **b10 AMOS (you, in AMOS):** `SELECT current_setting('TimeZone');`.
- [x] **b11 Record** results in `dwh/mapping.yaml` (the fields in A.6) and a "Phase 0b findings" section at the end of this file. Commit and push.

**Exit:** go/no-go passed; every mapping field in A.6 has a value; anything that contradicts Rev 2 is written up and agreed before Phase 1.

## Phase 1 — Converter and offline CLI

### Task 1.1: Lexer, pre-processing, error model

**Files:**
- Create: `src/dwh/convert/errors.ts`, `src/dwh/lex.ts`, `src/dwh/convert/preprocess.ts`
- Modify: `package.json` (pin `"node-sql-parser": "5.4.0"`)
- Test: `test/dwh/preprocess.test.ts`

**Interfaces:**
- Produces:
  - `class ConvertError extends Error { code: ErrorCode; plain: string; detail: string; loc?: { line: number; column: number } }`
  - `interface ConvertWarning { code: WarningCode; plain: string; loc?: { line: number; column: number } }`
  - `type ErrorCode` / `type WarningCode`: unions of every `E_*` / `W_*` code named in this document (single source; a later task needing a new code adds it here)
  - `lex(text: string, dialect: "pg" | "oracle"): Token[]`, `Token { kind: "word" | "string" | "nstring" | "quoted_ident" | "number" | "symbol" | "comment" | "space"; text: string; offset: number }`
  - `preprocess(source: string): { sql: string; placeholders: string[] }` (sentinel `__PH_<NAME>__`)
  - `restorePlaceholders(text: string, placeholders: string[]): string`

- [ ] **Step 1: Write failing tests**: `placeholder in string is replaced and listed`; `placeholder outside a string throws E_PLACEHOLDER`; `placeholder inside a comment is ignored`; `CRLF becomes LF`; `E-string, U&-string and dollar quoting throw E_UNSUPPORTED`; `nested block comment lexes as one comment`; `restorePlaceholders round-trips`.
- [ ] **Step 2: Run** `node --test test/dwh/preprocess.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): lexer, placeholder pre-processing and error model`.

### Task 1.2: Allow-list guard and Oracle-text safety scan

**Files:**
- Create: `src/dwh/convert/guard.ts`, `src/dwh/safety.ts`
- Test: `test/dwh/guard.test.ts`, `test/dwh/safety.test.ts`

**Interfaces:**
- Consumes: `ConvertError`, `lex` (1.1)
- Produces:
  - `parsePg(sql: string): SelectAst` (wraps `astify` with `includeLocations`; throws `E_PARSE`, `E_MULTI_STATEMENT`, `E_NOT_SELECT`)
  - `assertSupported(ast: SelectAst): ConvertWarning[]`
  - `assertReadOnlyOracle(text: string): void` (throws `E_FORBIDDEN`; rules in A.8 #2)

- [ ] **Step 1: Write failing tests.** `guard.test.ts`: one test per node-level "Rejected" row of A.5 (#3, #9, #27, #49, #59, #63, #73, #74, #75, #76) asserting the code and `loc.line`; `all 15 root queries and 12 generated queries pass the guard`. `safety.test.ts`: at least 30 Oracle strings that must throw (each forbidden keyword, `; DROP TABLE X`, `@DBLINK`, `DBMS_LOCK.SLEEP(5)`, `UTL_HTTP.REQUEST('x')`, `FOR UPDATE`, `/**/DELETE`, a function not on the emitted list) and ones that must pass (`'DROP'` inside a string, `"COMMENT"` as a quoted identifier, every converted real query).
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement.** The guard is a recursive walk with an explicit `switch` on node `type` whose `default` throws.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): allow-list guard and read-only Oracle scan`.

### Task 1.3: Mapping, catalogue model, scopes and names

**Files:**
- Modify: `dwh/mapping.yaml` (add any A.6 field Phase 0b left out, with its documented default)
- Create: `src/dwh/mapping.ts`, `src/dwh/catalogue.ts` (types + `loadCatalogue`; fetching is Task 2.2), `src/dwh/convert/scope.ts`, `src/dwh/convert/oracleWords.ts` (reserved words)
- Test: `test/dwh/names.test.ts`, `test/dwh/fixtures/catalogue.min.json`

**Interfaces:**
- Consumes: `parsePg` (1.2), `loadCsvIndex`/`CsvIndex` (`src/schema/csv.ts`)
- Produces:
  - `interface DwhMapping { linkedServer: string; oracleSchema: string; execMode: "exec_at" | "openquery"; oracleVersion: number; nlsComp: string; nlsSort: string; dbCharset: string; columns: Record<string, { dwh: string; keepOutputName?: boolean }>; amosCollation: "C" | "other" | "unknown"; exportRowLimit: number }`; `loadMapping(path: string): DwhMapping`
  - `interface CatalogueColumn { table: string; name: string; columnId: number; dataType: string; dataLength: number | null; charLength: number | null; precision: number | null; scale: number | null; nullable: boolean }`; `type Catalogue = { takenAt: string; columns: CatalogueColumn[] }`; `loadCatalogue(path: string): Catalogue | undefined`
  - `resolveScopes(ast: SelectAst, csv: CsvIndex): ScopeInfo` with `tableOf(columnRef)`, `isCte(name)`, `pgTypeOf(columnRef): SqlType`, `usedTables(): string[]`, `usedColumns(): string[]` (lower-case)
  - `oracleTableName(amosTable: string, ctx): string`, `oracleColumnName(ref: string, ctx): { name: string; aliasAs?: string }` (throw `E_RENAMED_NEEDS_APPROVAL`, `E_RETYPED_COLUMN`)
  - `availability(scope: ScopeInfo, cat?: Catalogue): { available: boolean; missing: string[] }`
  - `type SqlType = "int" | "numeric" | "float" | "text" | "date" | "timestamp" | "interval" | "unknown"`

- [ ] **Step 1: Write failing tests** for A.5 #1, #2, #4–#8, #78, #79, and `availability lists WP_STATUS and WP_DEPARTMENT_LINK for extract_wp_seqs_steps.sql`.
- [ ] **Step 2: Run** `node --test test/dwh/names.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Without a catalogue: upper-case names, availability `unknown`, one `W_NO_CATALOGUE`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): mapping, catalogue model, scopes and availability`.

### Task 1.4: Type inference and Oracle date/time rewrites

**Files:**
- Create: `src/dwh/convert/ir.ts` (Oracle tree types), `src/dwh/convert/types.ts`, `src/dwh/convert/dates.ts`
- Test: `test/dwh/dates.test.ts`

**Interfaces:**
- Consumes: `ScopeInfo`, `SqlType` (1.3)
- Produces:
  - `inferType(expr: PgExpr, scope: ScopeInfo): SqlType`
  - `rewriteDateExpr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr | undefined` (`undefined` when not date-related)
  - `interface RewriteCtx { mapping: DwhMapping; catalogue?: Catalogue; pinNow?: string; warnings: ConvertWarning[] }`

- [ ] **Step 1: Write failing tests** comparing the returned IR with `assert.deepEqual` (Task 1.6 adds string-level tests for the same cases): every row of the A.4 algebra table; the A.4 example line; all six real `(COALESCE(x.end_time, 0) * INTERVAL '1 minute')` sums → `((DATE '1971-12-31' + X.END_DATE) + NUMTODSINTERVAL(COALESCE(X.END_TIME, 0), 'MINUTE'))`; the 7 h / 24 h chain order; the four pinned month cases (as IR shape; values are proven in Task 2.4); `pinNow: "2026-11-10T00:00:00Z"` → `DATE '2026-11-10'` / `TIMESTAMP '2026-11-10 00:00:00'`; rejections #15 (timestamp operand), #16, #17, #18; `W_UTC_TODAY` once per query; `E_TYPE_UNKNOWN` for `DATE '1971-12-31' + (SELECT …)` with an untyped subquery.
- [ ] **Step 2: Run** `node --test test/dwh/dates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the A.4 table exactly; no constant folding.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): type inference and Oracle date rewrites`.

### Task 1.5: Remaining rewrites

**Files:**
- Create: `src/dwh/convert/rewrite.ts`
- Test: `test/dwh/casts.test.ts`, `limit.test.ts`, `order.test.ts`, `strings.test.ts`, `arith.test.ts`, `aggregates.test.ts`, `functions.test.ts`, `window.test.ts`, `cte.test.ts`

**Interfaces:**
- Consumes: 1.2–1.4
- Produces: `rewriteQuery(ast: SelectAst, scope: ScopeInfo, ctx: RewriteCtx): IrQuery` (`IrQuery` carries `outputs: { name: string; type: SqlType }[]` and `orderKeys: string[]`)

- [ ] **Step 1: Write failing tests**, one per A.5 row #10–#13, #20, #21, #23–#64, #67, #77, #81 in the matching file; `limit.test.ts` covers both `oracleVersion: 19` and `oracleVersion: 11`; `order.test.ts` asserts the converted real steps query orders `z_WP_SEQ_1ST` with `NULLS LAST`; `cte.test.ts` converts the real `NOT EXISTS` query.
- [ ] **Step 2: Run** `node --test "test/dwh/*.test.ts"`. Expected: the new files FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): LIMIT/ORDER/cast/string/aggregate rewrites for Oracle`.

### Task 1.6: Printer, self-check, `convertQuery`

**Files:**
- Create: `src/dwh/convert/print.ts`, `src/dwh/convert/index.ts`
- Test: `test/dwh/print.test.ts`, `test/dwh/convert.test.ts`

**Interfaces:**
- Consumes: everything above; `lintSql` (`src/validate/sqlLint.ts`), `loadModel`
- Produces:
  - `printOracle(q: IrQuery, style: "pretty" | "exec"): string`
  - `interface ConvertOptions { model: Model; csv: CsvIndex; mapping: DwhMapping; catalogue?: Catalogue; pinNow?: string }`
  - `interface ConvertResult { pretty: string; exec: string; warnings: ConvertWarning[]; placeholders: { name: string; maxLength: number }[]; outputs: { name: string; type: SqlType }[]; orderKeys: string[]; usedColumns: string[]; available: boolean | "unknown"; missing: string[] }`
  - `convertQuery(source: string, filename: string, opts: ConvertOptions): ConvertResult` (throws `ConvertError`)
  - `CONVERTER_VERSION = 2`

- [ ] **Step 1: Write failing tests.** `print.test.ts`: #8, #10, #11, #12, #53, #67; pretty layout; exec is single-line. `convert.test.ts`: `converting twice gives identical bytes`; `every converted real query passes the self-check re-parse`; `self-check failure throws E_SELF_CHECK` (inject a broken printer); `probe_closed_dates.sql throws E_LINT`; `openquery mode: exec text over 8000 chars after quote doubling throws E_TOO_LONG` (#83); `exec text passes assertReadOnlyOracle`; `date-typed outputs are reported as date` (#21); string-level versions of the Task 1.4 cases.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Self-check per A.4 step 10; if the grammar rejects a construct we legitimately emit, add a targeted normalisation with a test, never skip the check.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): Oracle printer, self-check and convertQuery`.

### Task 1.7: `dwh:convert` / `dwh:check`, manifest, docs

**Files:**
- Create: `src/dwh/cli.ts`, `src/dwh/sources.ts`, `queries/dwh/**` and `queries/dwh/_manifest.json` (generated)
- Modify: `src/cli.ts` (dispatch `dwh:*` via dynamic import; comment that `validate` skips `queries/dwh/`), `package.json` (scripts from A.10; `check` gains `&& npm run dwh:check`), `.gitignore` (`verify/`, `logs/`, `dwh/local/`), `CLAUDE.md` (A.10 text, plus a Commands line)
- Test: `test/dwh/cli.test.ts`

**Interfaces:**
- Consumes: `convertQuery` (1.6)
- Produces: `listSources(root: string): string[]`; `generateAll(root: string): Map<string, string>`; `dwhConvert(root: string): { written: string[]; removed: string[]; refused: string[] }`; `dwhCheck(root: string): string[]`

- [ ] **Step 1: Write failing tests**: `generateAll is stable across runs`; `manifest lists the two probe files as refused with E_LINT`; `manifest marks extract_wp_seqs_steps as converted but not available, missing WP_STATUS and WP_DEPARTMENT_LINK` (with the fixture catalogue); `dwhCheck reports a hand-edited generated file`; `dwhCheck reports a generated file whose source was deleted`; `header has source hash, availability and warning codes, and no date`.
- [ ] **Step 2: Run** `node --test test/dwh/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then `npm run dwh:convert`. (Until Task 2.2 commits a real snapshot, availability shows `unknown`.)
- [ ] **Step 4: Run** `npm test && npm run dwh:check && npm run typecheck`. Expected: PASS. (`npm run validate` still fails on the two probe files.)
- [ ] **Step 5: Review by hand** `extract_wp_seqs_steps`, `extract_parts_standalone_no_cml_no_alternate`, `list_all_seq_in_a_single_wp_3_levels_w_sts` against their sources; show one to the user.
- [ ] **Step 6: Commit** `feat(dwh): dwh:convert and dwh:check with generated queries/dwh`.

**Phase 1 test plan:** unit tests for the A.5 rows, golden checks over all 27 real sources, determinism, the safety list. Exit: `npm test`, `npm run typecheck`, `npm run dwh:check` pass; the user has seen one converted file.

## Phase 2 — Runner, catalogue, schema diff

> **Gate:** do not start until the b6 re-test (Phase 0b) has passed with the closest real steps query the DWH can run (the missing tables will not be added). Phase 1 has no such dependency. Build the `openquery` path first; keep `exec_at` behind `exec_mode` (RPC Out is off today).

### Task 2.1: Connection, relay wrapper, runner, value formatting

**Files:**
- Create: `src/dwh/db.ts`, `src/dwh/relay.ts`, `src/dwh/format.ts`, `src/dwh/run.ts`
- Test: `test/dwh/relay.test.ts`, `test/dwh/run.test.ts` (fake `mssql` request; no network), `test/dwh/format.test.ts`

**Interfaces:**
- Consumes: `convertQuery`, `assertReadOnlyOracle`
- Produces:
  - `dwhConfigFromEnv(env: NodeJS.ProcessEnv): sql.config` (throws `ConfigMissing` naming the variable, never its value; settings from A.8 #5)
  - `buildRelayStatement(exec: string, mode: "exec_at" | "openquery", params: { name: string; value: string; maxLength: number }[], linkedServer: string): { tsql: string; inputs: { name: string; value: string; maxLength: number }[] }` (the two templates in A.8 #3; `exec_at` replaces each `'<NAME>'` literal token, found with `lex`, by `?` and adds `@p1…`; `openquery` validates and inlines, throwing `E_UNSAFE_PARAM_VALUE`)
  - `applyPreviewCap(exec: string, version: number, cap: number, hasDuplicateNames: boolean): string`
  - `interface RunOptions { mode: "preview" | "export"; params: Record<string, string>; signal?: AbortSignal }`
  - `interface RunHandle { columns: { name: string; type: SqlType }[]; rows: AsyncIterable<unknown[]>; truncated: () => boolean; done: Promise<{ rowCount: number; ms: number }> }`
  - `runConverted(pool: sql.ConnectionPool, conv: ConvertResult, mapping: DwhMapping, opts: RunOptions): Promise<RunHandle>` (refuses `available === false` with `E_MISSING_IN_DWH`; streaming; `arrayRowMode`; cap 501 / `exportRowLimit`; cancels on abort or cap)
  - `formatCell(v: unknown, type: SqlType): string`, `csvHeaderBytes(): Buffer` (BOM), `csvLine(cells: string[]): string` (all quoted, CRLF)

- [x] **Step 1: Write failing tests**: `relay statement doubles quotes and uses N-strings`; `relay statement is one of the two templates`; `placeholder value is trimmed; bound in exec_at; refused if unsafe in openquery` (`" 2-VNAB-090926-CHK-STO\t"`, `O'Brien`); `empty placeholder value is refused`; `preview cap appends FETCH FIRST on 19, ROWNUM wrap on 11`; `unavailable query is refused before reaching the pool`; `empty result keeps column names`; `duplicate column names are kept by position`; `preview stops at 501 rows and cancels`; `query failing the Oracle scan never reaches the pool`; `csv has BOM and round-trips Vietnamese` (`"Kiểm tra động cơ"`); `date-typed column prints YYYY-MM-DD even though the relay returns a datetime` (with `process.env.TZ = "Asia/Ho_Chi_Minh"`); `int column from a NUMBER prints without decimals` (#85); `timestamp prints YYYY-MM-DD HH:MM:SS`; `config error names the variable but not its value`.
- [x] **Step 2: Run.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expected: PASS.
- [x] **Step 5: Live smoke test** (read-only, with the user's OK): `npm run dwh:run -- extract_all_parts.sql`. Expected: rows and a count.
- [x] **Step 6: Commit** `feat(dwh): relay wrapper, read-only runner and CSV formatting`.

### Task 2.2: Catalogue fetch, schema diff, live compile check

**Files:**
- Modify: `src/dwh/catalogue.ts` (fetch)
- Create: `src/dwh/schemaDiff.ts`, `src/dwh/compileAll.ts`, `dwh/catalogue.json` (generated), `docs/generated/dwh-schema-diff.md` (generated)
- Test: `test/dwh/schemaDiff.test.ts`, `test/dwh/compileAll.test.ts` (fake pool)

**Interfaces:**
- Produces:
  - `fetchCatalogue(pool: sql.ConnectionPool, mapping: DwhMapping): Promise<Catalogue>` (the fixed `OPENQUERY … ALL_TAB_COLUMNS` statement of A.6; sorted)
  - `interface SchemaIssue { kind: "missing_table" | "missing_column" | "case_only" | "retyped" | "truncation_risk" | "maybe_lost_unicode" | "extra_column"; severity: "error" | "warning" | "info"; table: string; column?: string; amos?: string; dwh?: string; plain: string }`
  - `diffSchema(cat: Catalogue, csv: CsvIndex, model: Model, used: string[], mapping: DwhMapping): SchemaIssue[]`; `renderDiffMarkdown(issues: SchemaIssue[], cat: Catalogue): string`
  - `compileAll(pool, root): Promise<{ source: string; ok: boolean; message?: string }[]>` (each available query run with zero rows: `FETCH FIRST 0 ROWS ONLY` on ≥ 12c, else `WHERE 1 = 0` wrap)

- [x] **Step 1: Write failing tests**: one per issue kind and per row of the A.6 Oracle compatibility table (fixture catalogue); `markdown is stable`; `compileAll reports an Oracle error per query without stopping`.
- [x] **Step 2: Run.** Expected: FAIL.
- [x] **Step 3: Implement**; wire `dwh:catalogue`, `dwh:schema-diff`, `dwh:compile-all`; add the diff file to `dwhCheck`.
- [x] **Step 4: Run** tests, then (with the user's OK) `npm run dwh:catalogue && npm run dwh:schema-diff && npm run dwh:convert && npm run dwh:compile-all`. Expected: snapshot and diff written; manifest shows real availability; every available query compiles.
- [x] **Step 5: Commit** `feat(dwh): catalogue snapshot, schema diff and live compile check`.

### Task 2.3: Plain-language errors

**Files:**
- Create: `src/dwh/errorsPlain.ts`
- Test: `test/dwh/errorsPlain.test.ts`

**Interfaces:**
- Produces: `toPlain(err: unknown): { message: string; detail: string }` (the A.9 table; finds `ORA-\d{5}` inside relay errors; `detail` scrubbed of `DWH_SERVER`, `DWH_USER`, `DWH_PASSWORD` values)

- [x] **Step 1: Write failing tests**: one per A.9 row using fake errors (incl. a 7320 relay error wrapping ORA-00942 with the table name extracted); `detail never contains the fake env values`.
- [x] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [x] **Step 5: Commit** `feat(dwh): plain-language error messages`.

### Task 2.4: `dwh:run` CLI, expression probes, retire old scripts

**Files:**
- Modify: `src/dwh/cli.ts`
- Create: `test/dwh/fixtures/expr-probes.json`, `src/dwh/probeExprs.ts`, `test/dwh/fixtures/example_steps.sql` (moved from `scripts/`)
- Delete: `scripts/dwh.ts`, `scripts/example_steps.sql`
- Test: `test/dwh/probeExprs.test.ts`

**Interfaces:**
- Produces: `dwh:run <source.sql> [--param K=V] [--csv out.csv] [--raw <oracle.sql>]`; `dwh:probe-exprs [--pg]` (PASS/FAIL per probe; `--pg` prints the PostgreSQL versions for AMOS)

- [x] **Step 1: Write failing test** `JS reference matches every expected value in expr-probes.json` (the four month cases, minutes on a date, day differences across a year boundary, integer division, NULL ordering).
- [x] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [x] **Step 5: Live run** (with the user's OK) `npm run dwh:probe-exprs`; the user runs `--pg` output in AMOS once. Expected: all three agree.
- [x] **Step 6: Commit** `feat(dwh): dwh:run CLI and engine expression probes`.

**Phase 2 test plan:** unit tests with fakes; live read-only smoke runs; compile check over every available query; expression probes on both engines. Exit: any available converted query runs from the command line into a CSV that opens correctly in Excel.

## Phase 3 — Result verification

### Task 3.1: Frozen-clock verification pack

**Files:**
- Create: `src/dwh/verifyPack.ts`, `dwh/verify-keys.yaml` (the user picks; candidates from a read-only query)
- Test: `test/dwh/verifyPack.test.ts`

**Interfaces:**
- Produces: `pinPg(source: string, at: string, params: Record<string, string>): string` (offset splicing); `writeVerifyPack(root: string, source: string, at: string, params: Record<string, string>): { amosSql: string; dwhSql: string }`

- [x] **Step 1: Write failing tests**: `pinPg changes only the CURRENT_* tokens`; `pinPg escapes a quote in a parameter`; `pinned Oracle uses the same instant`; `unavailable query is refused`.
- [x] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [x] **Step 5: Commit** `feat(dwh): frozen-clock verification packs`.

### Task 3.2: Compare and report

**Files:**
- Create: `src/dwh/compare.ts`
- Modify: `src/stitch/stitch.ts` only to export what is needed (no behaviour change; `test/stitch.test.ts` still passes)
- Test: `test/dwh/compare.test.ts`

**Interfaces:**
- Consumes: `parseCsv`, `normalizeCell`
- Produces: `interface CompareReport { headerMatch: boolean; counts: { amos: number; dwh: number }; onlyAmos: number; onlyDwh: number; differingColumns: string[]; cellDiffs: { key: string; column: string; amos: string; dwh: string; kind: DiffKind }[]; orderSame: boolean; driftKeys: string[]; pass: boolean }`; `compareResults(amos: Table, dwh: Table, keys: string[], orderKeys: string[]): CompareReport`; `renderReport(r: CompareReport): string`; `DiffKind = "whitespace" | "case" | "null_vs_empty" | "number_format" | "truncated" | "tz_shift_7h" | "changed"`

- [x] **Step 1: Write failing tests**: one per `DiffKind`; `lower-case AMOS header matches z_ header`; `apostrophe thousands separators equal`; `ties don't count as order differences`; `float shortest round-trip equal`; `truncated long text detected`; `null_vs_empty does not fail the pass criterion`; `pass is false on any changed cell`.
- [x] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Live verification** of every available query with the user's AMOS exports. Expected: PASS, or every difference explained. *(2026-11-18: run; FAIL with two differences not yet explained, see "Phase 3 findings".)*
- [x] **Step 6: Commit** `feat(dwh): AMOS vs DWH result comparison`.

**Phase 3 test plan:** unit tests above; live verification of every available query. Exit: a PASS report per available query.

## Phase 4 — The page

### Task 4.1: Server

**Files:**
- Create: `src/dwh/server.ts`, `src/dwh/share.ts`
- Test: `test/dwh/server.test.ts` (random port, fake engine)

**Interfaces:**
- Consumes: `listSources`, `convertQuery`, `runConverted`, `toPlain`, `diffSchema`, `compareResults`
- Produces:
  - `interface ShareConfig { share: boolean; hostNames: string[]; allowCidrs: string[]; pfxPath?: string; codeHash?: string; codeSalt?: string }`; `loadShareConfig(path: string): ShareConfig` (missing file → unshared)
  - `startServer(opts: { root: string; share: ShareConfig; engine: QueryEngine; port?: number }): Promise<{ url: string; close(): Promise<void> }>` (throws `ShareNotReady` naming what is missing)
  - Routes: `GET /`, `POST /login {code}`, `GET /health` → `{ app: "amos-dwh-runner", version }`, `GET /api/sources`, `POST /api/convert {path}` → `{ pg, oracle, warnings, placeholders, available, missing, schemaIssues, freshness }`, `POST /api/run`, `POST /api/export` (CSV stream), `POST /api/stop`, `POST /api/compare` (≤ 200 MB), `POST /api/catalogue/refresh` (host only), `POST /api/quit` (host only)

- [ ] **Step 1: Write failing tests**: `unshared binds to 127.0.0.1 only`; `shared without certificate or code refuses to start`; `shared serves HTTPS only` (fixture PFX); `wrong Host → 403` (both modes); `missing or wrong token → 403`; `shared: no session → login page; wrong code → 401; right code → HttpOnly, Secure, SameSite=Strict cookie`; `five wrong codes lock the IP for 15 minutes`; `IP outside allowCidrs → 403`; `quit and catalogue refresh from a non-loopback address → 403`; `second run by the same visitor → 429 with the busy message`; `fifth concurrent run → 429`; `path outside the source list → 400` (`../.env`, `C:\x.sql`); `unavailable query → plain "not available" message`; `server re-converts after the source changes on disk`; `aborted export marks the file incomplete`; `no response contains the fake DWH_PASSWORD`; `log line has time, IP, path, params, row count`; `/health signature`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(dwh): runner server with sharing`.

### Task 4.2: Page

**Files:**
- Create: `src/dwh/ui/index.html`, `src/dwh/ui/app.js`, `src/dwh/ui/style.css`
- Test: `server.test.ts` smoke (`/` serves the page with token and CSP); acceptance script below

- [ ] **Step 1:** Build the layout from the A.9 sketch with the four states (✓ ⚠ ⊘ ✗); system font, no external assets; works at 1280×720 and wider.
- [ ] **Step 2:** Walk the acceptance script with a fake engine (`DWH_FAKE=1`), then the real DWH.
- [ ] **Step 3: Commit** `feat(dwh): runner page`.

### Task 4.3: Launcher, shortcut, sharing setup, guide

**Files:**
- Create: `Start DWH Runner.cmd`, `src/dwh/shortcut.ts` (desktop `.lnk`; `--startup` for the Startup folder), `src/dwh/shareSetup.ts` (prompts for the code without echo, stores scrypt hash + salt; uses an IT PFX if given, else PowerShell `New-SelfSignedCertificate`; writes `dwh/local/share.json`), `docs/dwh-runner-guide.md` (host part and colleague part, with screenshots), `docs/dwh-runner-acceptance.md`
- Modify: `package.json` (`dwh:shortcut`, `dwh:autostart`, `dwh:share-setup`)
- Test: `test/dwh/shareSetup.test.ts` (hash verifies; no plain code written; PowerShell command line built correctly without running it)

- [ ] **Step 1:** Write failing `shareSetup.test.ts`, run (FAIL), implement, run (PASS).
- [ ] **Step 2:** Write the launcher (A.9); in shared mode it prints the address for colleagues.
- [ ] **Step 3:** `npm run dwh:shortcut`; double-click twice. Expected: browser opens; second time only the browser.
- [ ] **Step 4:** With the user: `npm run dwh:share-setup`, restart, open from a second PC.
- [ ] **Step 5: Commit** `feat(dwh): Windows launcher, sharing setup and guide`.

**Acceptance script** (done by the user): (1) shortcut opens the page; (2) `.env` renamed → plain message; (3) VPN off → plain message; (4) a ✓ query: preview rows; (5) a placeholder query with a pasted value with a trailing space; (6) download CSV, open in Excel, Vietnamese reads correctly; (7) a ✗ query shows why; (8) a ⊘ query names the missing tables; (9) edit a source, re-select, see the change; (10) Stop a long download; (11) Compare with an AMOS export; (12) Quit; (13) colleague's PC: address, certificate notice, code; (14) five wrong codes → locked; (15) colleague sees no Quit/Refresh; (16) two people run at once → results or a clear "busy".

**Phase 4 test plan:** server tests above; the acceptance script.

---

# Part C — Open items and risks

## Open items

1. **Missing tables: decided they cannot be added (2026-11-17).** Open work, later: for each query that needs `wp_status`, `wp_department_link`, `cml_reference`, `oem_doc_partno`, `taskcard_coversheet_info` or `time_captured_history`, decide a workaround (for example filtering by the numeric status id in `wp_header` instead of the status name, if the ids are known) or dropping the information; the converter's availability report (#6) lists exactly what each query lacks. **Ask the DWH administrator** (draft message given in the session) about: whether RPC Out can be enabled on `DWH_DB` for our login (enables `exec_at`); confirm the Oracle user behind the link is read-only (Phase 0b b4 showed no system-level write rights, table grants unknown); whether the copy truncates long text (three `text_html` values stop at exactly 3700 characters; `text` columns are `VARCHAR2(4000)`); indexes and statistics on the join columns (b6: 9–18 s for the steps query). **Phases 2–4 have little value until workarounds exist**: today only `extract_all_parts.sql` can run.
1a. **Choose verification keys from documents visible in AMOS** (the AMOS query tool shows only some documents; e.g. work order 8802418 is not found in `wo_text_description` there), and re-check the Vietnamese and 3700-character questions once such rows are available.
2. **Before Phase 4:** a certificate from IT for the host PC (else a one-time browser warning) and approval to share DWH data this way; choose the access code.

Decisions I made that you may want to override: output names keep the source spelling (`z_WP_ID`, quoted in Oracle); preview 500 rows, export limit 2,000,000; the query list covers root files plus `queries/wp_seqs/`; generated files in `queries/dwh/` hold Oracle SQL.

## Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Pass-through is also slow (no indexes on the staging tables) | Medium / high | Phase 0b b6: 9–18 s, not clean. Conditional go: Phase 1 offline only; b6 re-test with the real query gates Phase 2; then the administrator |
| R2 | Six missing tables stay missing | **Certain (decided 2026-11-17) / high** | Per-query workaround or drop the information, decided later; the converter still works and shows ⊘ with the reason |
| R3 | DWH renames/retypes columns, or the snapshot goes stale | Medium / medium | Schema diff, live compile check, refresh button, #78/#79 |
| R4 | Oracle `''` = NULL changes results | Present / medium | `E_EMPTY_STRING`, `W_EMPTY_IS_NULL`, verification treats NULL vs empty as expected |
| R5 | String sort order differs (`NLS_SORT` vs `en_US.UTF-8`) | High / low | `W_STRING_ORDER`; verification compares order on keys |
| R6 | `node-sql-parser` mis-parses or changes AST shape | Low / high | Exact pin; allow-list `default` throws; golden tests; self-check; live compile check |
| R7 | Relay type mapping (NUMBER, DATE, CLOB) changes values | Medium / medium | Phase 0b b8/b9; formatting by converter output types; length checks |
| R8 | An app bug sends a write | Very low / high | Read-only relay login; Oracle user checked (b4); two gates; fixed relay templates |
| R9 | DWH password appeared in plain text (old `test_db.js`, this session's output) | Present / medium | File deleted; ask the DBA to change the password, then update `.env` |
| R10 | Source quirks (UTC "today") copied faithfully | Present / low | `W_UTC_TODAY` |
| R11 | AMOS export formatting adds noise | Medium / low | Stitcher normalisation; classified diffs |
| R12 | Host setup failures (Node, port, `.env`) | Medium / medium | Launcher checks; single instance; acceptance script |
| R13 | Large downloads exhaust memory | Low / medium | Streaming; row limit |
| R14 | Shared access under one login | Medium / medium | Access code, lockout, optional CIDRs, HTTPS, audit log, IT approval |
| R15 | Host PC asleep or off | High / low | Autostart; power setting in the guide |
| R16 | Firewall/certificate need IT | Medium / medium | One `netsh` command for IT; self-signed fallback; unshared mode meanwhile |
| R17 | One person's huge export slows everyone | Medium / low | One query per visitor, four in total, timeouts, row limit |
| R18 | `openquery` mode limits (4000 characters as `N'…'`, no parameters, duplicate names) | Present / medium | Real today (RPC Out off, b1/b7): `openquery` is the mode; `E_TOO_LONG`, strict values, `E_DUPLICATE_OUTPUT`; ask for RPC Out |

---

# Phase 0 findings (2026-11-17)

Probes 0.1–0.6 were read-only SELECTs and catalogue procedures run through `scripts/dwh.ts`; 0.7 was run by you in AMOS. Values are recorded in `dwh/mapping.yaml`.

## What we found

| Probe | Result |
|---|---|
| 0.1 | Relay is **SQL Server 2016 RTM** (Enterprise). Collation `SQL_Latin1_General_CP1_CI_AS` (case-insensitive). Server local clock is UTC+7; `SYSUTCDATETIME()` is UTC. |
| 0.2 | `DWH_DB` is a linked **Oracle** database (`OraOLEDB.Oracle`), not SQL Server. `uses_remote_collation = true`, `is_collation_compatible = false`. |
| 0.3 | `[DWH_DB]..INFORMATION_SCHEMA.COLUMNS` fails (error 7314). `EXEC sp_columns_ex` works but repeats text columns once per Oracle type name. `OPENQUERY(DWH_DB, 'SELECT … FROM ALL_TAB_COLUMNS WHERE OWNER = ''STG_AMOS''')` works and is clean. Names are upper case; date/time columns are Oracle `NUMBER` (whole numbers). Lower-case names also resolve in four-part queries. |
| 0.4 | Not sysadmin, no CONTROL SERVER: the login is read-only. |
| 0.5 | `WP_HEADER.mutation` max = 2026-11-17, `mutation_time` max = 09:22:10 UTC: the DWH is **current to within minutes**. `start_date` 2001-03-07 … 2200-07-03, `end_date` max 2200-07-04 (far below 9999-12-31). |
| 0.6 | Single-table count: 1–3 s. Hand-converted 4-table `example_steps.sql` (`TOP 20`): **37–68 s**. Trimmed 7-table steps query (`TOP 50`): **timed out at 120 s**. The slowness is in multi-table joins and `ORDER BY`, not the link itself. |
| 0.7 | AMOS `datcollate = datctype = en_US.UTF-8` → `amos_collation: other`. `current_setting('TimeZone')` not yet provided. |
| extra | `STG_AMOS` holds 59 objects. **6 of the 20 tables used by repo queries are missing:** `wp_status`, `wp_department_link`, `cml_reference`, `oem_doc_partno`, `taskcard_coversheet_info`, `time_captured_history`. |

## How Rev 2 settles the Phase 0 proposals

1. *Oracle target; warn on every text comparison and sort.* → Settled differently: pass-through (A.3) means only Oracle's rules apply, so the relay's case-insensitive collation never decides anything. Text comparisons warn only if Phase 0b finds `NLS_COMP = LINGUISTIC` or a `CHAR` column (#40); sorts warn (#38); Oracle `''` = NULL handled (#41, #42); Oracle types in the schema diff (A.6).
2. *Use `OPENQUERY` for the catalogue.* → Accepted (A.6). It is one of the runner's fixed relay statements (A.8 #3).
3. *Refuse queries with missing tables; ask the administrator.* → Accepted with one change: conversion does not depend on availability, so every query is still converted and tested; availability is reported and enforced by the runner (#6). Ask the administrator now (Part C).
4. *Speed: ask the administrator before building.* → Pass-through (A.3) is the fix to test first; Phase 0b b6 is the go/no-go before Phase 1. The administrator comes in only if pass-through is slow too.
5. *Freshness.* → Accepted (A.7 #1, #5).
6. *SQL Server 2016 limits.* → No longer relevant: SQL Server only relays.
7. *AMOS `TimeZone` still open.* → Phase 0b b10.

---

# Phase 0b findings (2026-11-17)

All DWH probes were read-only `SELECT`s sent through `scripts/dwh.ts`; b10 and the AMOS comparisons were run by you in AMOS. Values are recorded in `dwh/mapping.yaml`. **Decision (2026-11-17): C3 option (a), the conditional go, was approved, and C1, C2, C4 were applied to the plan body (Rev 2.1).** The text under "Proposed changes" is kept as the record of what was proposed.

## Results

| Probe | Result | Effect on Rev 2 |
|---|---|---|
| b1 | `is_rpc_out_enabled = false`, `is_data_access_enabled = true` | `EXEC … AT` is not possible. `exec_mode: openquery` (see C1). |
| b2 | Oracle Database 12c Enterprise Edition **12.2.0.1.0** | `FETCH FIRST n ROWS ONLY` and `OFFSET … ROWS` are allowed (#32, #34); `oracle_version: 12`. |
| b3 | `NLS_COMP = BINARY`, `NLS_SORT = BINARY`; `NLS_CHARACTERSET = AL32UTF8`, `NLS_NCHAR_CHARACTERSET = AL16UTF16`; `DBTIMEZONE` and `SESSIONTIMEZONE` both `+07:00`; `SYS_EXTRACT_UTC(SYSTIMESTAMP)` returned the correct UTC time | As expected: text `=` is case-sensitive like PostgreSQL (#40, no `W_STRING_COMPARE`); no `W_MAYBE_LOST_UNICODE` (#80); `W_STRING_ORDER` stays because BINARY order differs from AMOS `en_US.UTF-8` (#38). The +07:00 clock does not matter because the converter uses `SYS_EXTRACT_UTC(SYSTIMESTAMP)` (A.4). |
| b4 | Oracle user has `SET CONTAINER`, `CREATE DATABASE LINK`, `CREATE SESSION`; role `CONNECT` | No system-level write privileges. Rights granted on single tables are not shown by these views, so the app gates (A.8) remain the real protection. |
| b5 | `SELECT WO_HEADER.EVENT_PERFNO_I FROM STG_AMOS.WO_HEADER WHERE ROWNUM <= 1` works | Form in #1 confirmed. |
| b6 | See the speed table below | **Not a clean pass** (see C3). |
| b7 | `OPENQUERY` refuses two output columns with the same name (SQL Server error 492). `EXEC … AT` not testable (b1) | In `openquery` mode `E_DUPLICATE_OUTPUT` applies (#11). |
| b8 | `WO_TEXT_DESCRIPTION.TEXT_HTML` (and `TEXT`) are **`VARCHAR2(4000)`, not CLOB**. Across all of `STG_AMOS` only `VARCHAR2` (1122 columns, longest 4000) and `NUMBER` (877) exist: **no CLOB columns at all**. The three longest `TEXT_HTML` values (`DESCNO_I` 4430989, 4430990, 4340938) are all exactly 3700 characters in Oracle and arrive through the relay as 3700 characters (7400 bytes, `nvarchar`): nothing is lost between Oracle and the relay. Vietnamese text arrives intact (e.g. `DESCNO_I` 4296886 `BÌNH XỊT ĐI CAN VN512`, 21 characters / 25 bytes in Oracle) | See C2. Not compared with AMOS: the AMOS tool you use shows only some documents (e.g. 8802418, a real work order, is not found in `wo_text_description` there), so neither the Vietnamese rows nor the 3700 figure could be checked. Both stay **open**. |
| b9 | Through the relay: Oracle `NUMBER` → `float`; `DATE '1971-12-31' + MUTATION` → `datetime2(7)`; `VARCHAR2(4000)` → `nvarchar(4000)` | The runner formats integers by the converter's output type (#85), which is needed because `float` is not exact above 2^53 (the current ids are about 7 digits, so this is a safeguard, not a present problem). |
| b10 | AMOS: PostgreSQL 14.19, `TimeZone` = UTC | Confirms A.2 #5 and #19: `W_UTC_TODAY` assumption holds. `amos_collation: other` unchanged. |

**b6 speed (seconds, each run includes about 1 s of Node start-up and login; a trivial `SELECT 1 FROM DUAL` takes under 1 s):**

| Query (hand-written Oracle, through `OPENQUERY`) | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| 6a: `example_steps`, 4 tables, first 20 rows | 59 | 17.5 | 16.6 |
| 6b: trimmed steps query, 7 tables, first 50 rows | 18.0 | 8.8 | 8.8 |

Caveats: 6b had no status or department filter (those tables are missing in the DWH) and used a 6-month start-date window with a global `ORDER BY`; the real query is narrower in one way and untested in others. The first run of each is slower (cold cache on the Oracle side).

**b6 re-test, the gate for Phase 2 (2026-11-17): passed.** Query: the `npm run dwh:convert` output of `extract_wp_seqs_steps.sql`, with only the seven tables the DWH has (`WP_STATUS`, `WP_DEPARTMENT_LINK` and their three columns and conditions removed), `WHERE WP_HEADER.WPNO = 'A501-091026-CHK-C04'`, the original `ORDER BY`, `FETCH FIRST 50 ROWS ONLY`, through `OPENQUERY`.

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Warm (seconds, incl. about 1 s Node start-up and login) | 1.6 | 1.6 | 1.4 |

All runs returned the same 50 rows (19 columns, items 1.1.1, 1.1.2, 2.1.1, …). The cold run was **not measured**: the first three runs completed but their timing failed (a missing tool on the PC), and by then the workpack was cached. You accepted the warm numbers (option 1). The warm runs are about ten times under the 15 s limit; the earlier, much wider 6b query's cold run was 18 s, under the 30 s cold limit. One-workpack queries are fast; wide date windows without the department filter remain slower (6b).

## Proposed changes (all approved and applied, Rev 2.1; C3 = option (a))

**C1. Run in `openquery` mode (RPC Out is off).** Consequences already in the plan as R18: no bound parameters (placeholder values are checked against `^[A-Za-z0-9 ._/-]{1,100}$` and refused otherwise), 8000-character limit (largest current query about 3.3 KB), duplicate output names refused. Proposal: build `openquery` first; ask the DWH administrator whether RPC Out can be turned on, which would remove these limits (a one-setting change on the relay).

**C2. There are no CLOB columns; text is `VARCHAR2(4000)`.** Rows #65 (`E_TEXT_COLUMN`) and #66 (`textsize`, CLOB length comparison) do not apply and the runner's `textsize` setting is irrelevant; the schema-diff rule `text` ↔ `VARCHAR2(4000)` is **`truncation_risk`**, and it is now a live risk because three longest values tie at exactly 3700. Proposal: keep #65 as dormant code only if cheap, otherwise drop it; keep `truncation_risk` as a visible warning on every query that selects a `text`-typed column; make A.7's compare report text-length differences prominently; and ask the DWH administrator whether the copy truncates long text. A second consequence: because the AMOS tool shows only some documents, the fixed keys in `dwh/verify-keys.yaml` (A.7 #2) must be chosen from documents visible in AMOS.

**C3. b6 did not pass cleanly, so by the plan's own rule Phase 1 may not start yet.** Pass-through is far faster than the old four-part form (the steps-style query dropped from a 120 s timeout to 9–18 s), but the cold run was 18 s (over the 15 s limit) and the 4-table example stays at 17 s even when warm. Options:
  - **(a) Conditional go (recommended).** Phase 1 is the offline converter and needs no database; start it. Re-run the b6 steps query once the missing tables (`WP_STATUS`, `WP_DEPARTMENT_LINK`) exist in the DWH, and make that re-run the gate for Phase 2 (the runner and page). Meanwhile ask the administrator about indexes and statistics on the join columns, since single round trips are fast and the time is spent inside Oracle.
  - **(b) Stop** until the administrator has looked at the Oracle side, as the plan says.
  - **(c) Loosen the limit** (for example "under 30 s warm") and proceed with everything. I don't recommend it without knowing how people will use the page.

**C4. The six missing tables are still missing** (`wp_status`, `wp_department_link`, `cml_reference`, `oem_doc_partno`, `taskcard_coversheet_info`, `time_captured_history`). Unchanged from Phase 0; Part C's request to the administrator now has three items: the six tables, RPC Out, and the speed/truncation questions above.

---

# Phase 2 findings (2026-11-17)

All live steps were read-only `SELECT`s, each approved by you, run through the new commands (`dwh:run`, `dwh:catalogue`, `dwh:probe-exprs`). The deferred Phase 1 review items were fixed first (`3ec9591`); Phase 2 was reviewed by a fresh reviewer and its Important findings fixed with tests (`e55b178`).

| Step | Result | Effect |
|---|---|---|
| 2.1 step 5: `dwh:run -- extract_all_parts.sql` | Refused by Oracle: `ORA-00904: "PART"."MANUAL_TARGET_STOCK": invalid identifier`, shown as the plain message "The DWH has no column called PART.MANUAL_TARGET_STOCK…" | The plain-error path works live (the ORA text arrives as an informational relay message, a review fix). The query itself cannot run in the DWH as written. |
| 2.2 step 4: `dwh:catalogue` | 1,999 columns in 59 tables (same as Phase 0b, b8), committed as `dwh/catalogue.json` | Availability is now exact (tables and columns). |
| 2.2 step 4: `dwh:schema-diff` / `dwh:convert` | 17 errors, 8 warnings, 6 notes (`docs/generated/dwh-schema-diff.md`) | See below. **No repo query is available in the DWH as written**: 23 convert, all need a missing table or column; 4 are refused (2 duplicate names in openquery mode, 2 lint errors). |
| 2.2 step 4: `dwh:compile-all` | First run found nothing available. After the status workaround (below, 2026-11-18): **1 of 1 available queries compile** | |
| Exit check, 2026-11-18: `dwh:run -- extract_wp_item_counts.sql --csv …` | **2,281 rows in 1.5 s**; UTF-8 with BOM, CRLF, every field quoted, whole numbers, no INCOMPLETE line | **Phase 2 exit criterion met live**: an available converted query runs from the command line into a CSV that opens correctly in Excel. |
| 2.4 step 5: `dwh:probe-exprs` | **24 of 24 PASS** (month clamping, minutes on a date, hour chains, `::date`, day differences, integer division and modulo with negatives, `EXTRACT`, NULL ordering) | The converter's date and number rules give AMOS's answers on the real Oracle engine. You may still run `npm run dwh:probe-exprs -- --pg` in AMOS once. |
| Review follow-up: 7,889-character `N'…'` text through `OPENQUERY` | SQL Server error 103: "… is too long. Maximum length is 8000." | The limit is 8000 **bytes**, i.e. **4000 characters** for the `N'…'` text. `OPENQUERY_MAX_LENGTH` is now 4000 (A.4 step 12, #83); the longest current query is about 3,860 characters as sent, so nothing is refused today. |

**New schema facts from the catalogue** (beyond the six missing tables):
- `PART.MANUAL_TARGET_STOCK` and `PART.TARGET_STOCK` do not exist in the DWH (blocks `extract_all_parts.sql` and `extract_parts_standalone_no_cml_no_alternate.sql`).
- `PART.ALERT_QTY`, `MAX_PURCH`, `MIN_SAFETY_STOCK`, `REORD_LEVEL`, `SAFETY_STOCK`, `WEIGHT` and `PART_REQUEST_2.QTY` are numbers (`float8`) in AMOS but `VARCHAR2` text in the DWH (`retyped`): selecting them works with a warning; computing with them is refused.
- `WORK_TEMPLATE` and `WP_HISTORY` (described in `schema/`, not used by repo queries) are also missing.
- `WP_HEADER.WPNO` is `VARCHAR2(50)` in the DWH; AMOS allows 70 characters (`truncation_risk`). Long text columns are `VARCHAR2(1000–4000)` (`truncation_risk`, as known from b8).

**First workaround (2026-11-18): filter by status number.** The DWH has no `WP_STATUS` table, so `wp_header.wp_status` (now an approved name, `z_WP_STATUS_ID`) is compared with the ids read from AMOS: In Progress = 11, 115; Issued = 112, 114 (full list in `schema/workpack.yaml` notes; several ids share a name). New query `extract_wp_item_counts.sql`: items (work orders in `wp_assignment`) per In Progress or Issued workpack. Result: 835 In Progress workpacks with 10,487 items, 1,446 Issued with 5,970 items (16,457 items in 2,281 workpacks; 105 have none). It has no date window, so long-open workpacks (e.g. from early 2025) are included. The status only reflects today, as CLAUDE.md says.

**Open, for you to decide:**
1. Workarounds for the other queries (Part C, item 1): the same status-number filter can replace `WP_STATUS` in most of them; `WP_DEPARTMENT_LINK` (department filter) and the two `PART` columns still need a decision.
2. `scripts/dwh.ts` and `scripts/example_steps.sql` were not deleted (untracked; your call).
3. The deferred review minors are listed in the session summary and in the executor's ledger.

## Phase 3 findings (2026-11-18)

New commands (offline unless noted): `npm run dwh:verify-pack -- <source.sql> [--at …] [--param K=V]` writes `verify/<name>/{amos.sql, dwh.sql, pack.json}` with "now" frozen to one UTC instant (default: the last whole hour); `npm run dwh:run -- <source.sql> --at <instant>` runs the same frozen query in the DWH (live, read-only); `npm run dwh:compare -- <amos.xlsx|amos.csv> <dwh.csv> [--key …] [--amos-rows N] [--within rows.csv]` writes `report.md` next to the DWH CSV. The xlsx reader uses built-in Node only. Fixed keys are in `dwh/verify-keys.yaml`.

**The AMOS the user can query is a test copy, taken around 2026-10-01, older than the DWH.** The DWH cannot be rewound to that day: `wp_header.wp_status` is today's status, and `MUTATION` is only the last-change day. So the check compares the rows that should not have changed: the DWH workpacks whose header and items all have `MUTATION` before 2026-10-01 (read-only query `verify/extract_wp_item_counts/unchanged-since-2026-10-01.oracle.sql`, 1,975 rows), passed to the compare as `--within`. Two of the three fixed keys the user picked (COMP-251026 BASE-MCC-TSV321-01, A327-031126 LINE-MCC-TSV) were created after the test copy; they were replaced by a rule fixed before comparing (per station, the lowest `z_WP_ID` that is in the AMOS export and unchanged since before 1 Oct): A397-070824CIHALCS (HAN), A354-260425 (SGN); A616-200326 (DAD) kept.

| Check (`extract_wp_item_counts.sql`) | Result |
|---|---|
| AMOS export (test copy) | 416 rows; AMOS showed 416 on screen, so the export is not cut short. Read from xlsx: lower-case headers matched, no formatting differences. |
| DWH (`dwh:run … --at 2026-11-18T03:00:00Z`) | 2,350 rows (2,281 on 2026-11-17). |
| All rows | FAIL as expected for two different days: 290 rows only in AMOS, 2,224 only in the DWH, 66 cells differ. Shown as possible drift. |
| Fixed keys (3) | **FAIL**: A397-070824CIHALCS equal; A354-260425 has 23 items in AMOS, 40 in the DWH; A616-200326 has 0 vs 1. |
| Unchanged since before 1 Oct (1,975) | **FAIL**: 99 are in the AMOS export; **56 equal, 43 differ, only in the item count, and the DWH always has more**. 1,876 are not in the AMOS export. |

**Open difference 1: the DWH counts more items in 43 unchanged workpacks.** A read-only look at their items (`extra-items.oracle.sql`): 447 items, all `WP_ASSIGNMENT.STATUS` 0, all created between April 2025 and 15 Sep 2026, none created or changed on or after 1 Oct. So the extra items are not new work (not drift). Either the DWH still holds items that were removed in AMOS (a delete that the staging copy never received), or the test copy itself was changed after it was taken. 41 of the 43 are SGN line workpacks (A354-, A359-, A363- … L), where items are often moved. **To settle it**, someone with production AMOS opens A616-200326 LINE-MCC-TSV: the DWH shows 1 item, the test copy 0. If production also shows 0, the DWH keeps removed items, and every item count from the DWH is too high until that is fixed.

**Open difference 2: 1,876 open, unchanged DWH workpacks are not in the AMOS export.** For example 16851-241025-BASE-MCC (HAN, status 11). The export is complete for what AMOS showed (416 = 416). So either the test copy does not have them, or has them with another status, or the AMOS query tool shows the user only some workpacks (for example by station or rights). The test copy cannot tell which.

**Phase 3 exit is not met**: the tools work and every difference is named, but these two are not explained yet. They need either a production-AMOS check (difference 1) or a check of how the test copy and the AMOS query tool select rows (difference 2).
