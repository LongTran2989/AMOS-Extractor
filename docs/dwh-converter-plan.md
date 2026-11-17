# DWH Query Runner — Design and Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Final draft, updated with your answers (2026-11-17), waiting for approval. Nothing in here has been built.

**Your answers (2026-11-17) and what they changed:**
- *Direct AMOS access:* the only database reachable from code is the DWH; AMOS (PostgreSQL) is reached through the AMOS application. → Verification stays "export CSV from AMOS, compare with the DWH" (A.7). Phase 5 is dropped.
- *DWH login:* read-only. → R8 drops to low; Phase 0.4 only confirms it. The app-level gates stay (defence in depth).
- *Linked server is mandatory.* → The `[DWH_DB]..[STG_AMOS].[X]` prefix is fixed; speed (R1) is handled with preview caps and the Phase 0.6 timing.
- *Users: anyone on a PC in the same WAN; local web page.* → The page is served from this PC to colleagues (A.9 "Sharing on the WAN"): shared mode needs HTTPS and an access code, the DWH credentials stay on this PC, only this PC needs Node. The original "bind to 127.0.0.1" becomes the default for unshared mode only.
- *`test_db.js`:* deleted on 2026-11-17. It was an untracked, never-committed connection test with hard-coded credentials; `scripts/dwh.ts` does the same job using `.env`, which you verified works on 2026-11-17.

**Goal:** Run any repo query that is already correct on AMOS (PostgreSQL) against the DWH staging copy (SQL Server), with a converter that never emits wrong T-SQL in silence, and a point-and-click page a non-programmer can start from the Windows desktop.

**Architecture:** A PostgreSQL→T-SQL converter that works on the parsed query tree (the `node-sql-parser` PostgreSQL parse already used by `npm run validate`), runs an allow-list check, rewrites with type awareness, and prints T-SQL with its own small printer. A read-only runner (the `mssql` package, server-side only) executes converter output only. A local web page (plain `node:http` + vanilla JS, bound to 127.0.0.1) wraps the runner. Generated T-SQL is committed under `queries/dwh/` and checked for staleness like the docs.

**Tech Stack:** Node ≥ 24 running `.ts` directly, `node:test`, `node-sql-parser` (pinned to exactly 5.4.0), `mssql` (already in package.json), `yaml`. No new runtime dependencies.

**Spec:** [docs/dwh-converter-planning-prompt.md](dwh-converter-planning-prompt.md) (the request) plus Part A of this file (the design). Executors read both.

## Global Constraints

- Node ≥ 24, TypeScript run as `node file.ts`, no build step, no bundler. Browser code is plain `.js`.
- No new npm dependencies in Phases 0–4. Pin `node-sql-parser` to `5.4.0` exactly (remove the `^`).
- Every rule in CLAUDE.md applies to source queries; generated T-SQL keeps them (see A.11 for the one opt-in exception).
- Read-only by construction: one `SELECT`/`WITH` statement only; nothing that writes to either database is ever run, including during development.
- Credentials: only in the gitignored `.env` (`DWH_SERVER`, `DWH_USER`, `DWH_PASSWORD`), read server-side through `node --env-file=.env`. Never printed, logged, committed, or sent to the browser. Do not edit `.env`.
- Linked-server table form: `[DWH_DB]..[STG_AMOS].[<TABLE>]` (three-part `[DWH_DB].[STG_AMOS].[X]` fails).
- Connection: `trustServerCertificate: true`, login lands in `master`.
- Local server: `share: false` (default) binds `127.0.0.1` only. `share: true` binds the WAN-facing address and refuses to start without HTTPS and an access code (A.9).
- Only the host PC needs Node and `.env`; colleagues need only a browser.
- Generated files carry a "GENERATED — DO NOT EDIT" header and contain no timestamps (determinism).
- Windows 11 is the only target platform for the launcher.

## Review Focus

The five inputs or conditions most likely to hurt a person using this that no feature task naturally tests. Each has a test in the owning task.

1. **A source file edited while the page is open** → the page must re-read and re-convert on every select and every Run, never run a stale conversion. Test in Task 4.1 (`server re-converts after the source changes on disk`).
2. **A placeholder value pasted from Excel** (trailing space or tab, lower case, a quote mark) → trimmed, sent as a bound parameter, never spliced into SQL; the trimmed value is shown back. Test in Task 2.1 (`placeholder value is trimmed and bound, quote survives`).
3. **A query that returns zero rows** → the table and the CSV still show the column headers, and "0 rows" is shown instead of a blank page. Test in Task 2.1 (`empty result keeps column names`).
4. **Vietnamese text (diacritics) in `text_html` or remarks, opened in Excel** → the CSV is UTF-8 **with BOM** and CRLF, so Excel shows it correctly. Test in Task 2.1 (`csv has BOM and round-trips Vietnamese`).
5. **The network drops or the timeout hits in the middle of a CSV download** → the file must not look complete; the download ends with an error and the last line of the file says it is incomplete. Test in Task 4.1 (`aborted export marks the file incomplete`).

---

# Part A — Design

## A.1 What this is for

You write and check queries against AMOS in PostgreSQL, under the repo's rules. Once a query is right, you want the same answer from the DWH (a SQL Server staging copy of AMOS) without learning T-SQL and without a terminal. The tool has to be trustworthy in a specific sense: when it cannot translate something with certainty, it says so in plain words and refuses, instead of producing T-SQL that runs and returns slightly different data.

## A.2 What I found in the repo that shapes the plan

1. **The real queries use a small slice of SQL.** All 15 root `*.sql` files parse with `node-sql-parser` (PostgreSQL mode). Across root files plus the generated `queries/wp_seqs/*.sql`: `DATE '1971-12-31'` ×78, `INTERVAL` ×99 (only the forms `'7' HOUR`, `'24' HOUR`, `'6' MONTH`, `'1 minute'`), `CURRENT_DATE` ×36, `CURRENT_TIMESTAMP` ×34, `::date` ×30, `COALESCE` ×18, `EXISTS`/`NOT EXISTS`, date literals `DATE '2026-09-30'` ×6, one `LIMIT`, one `<INSERT_WPNO_HERE>`. **None** use CTEs, window functions, `DISTINCT`, `CASE`, `GROUP BY`, `LIKE`, `||`, quoted identifiers, block comments or boolean literals. (Correction to the prompt: there is no `col::integer` anywhere; all 30 casts are `::date`.) So version 1 converts this slice plus a few cheap, provably safe extras, and refuses everything else by name.
2. **The library cannot translate on its own.** `parser.sqlify(ast, {database: 'TransactSQL'})` only prints. It passed `LIMIT`, `ILIKE`, `::`, `INTERVAL`, `DISTINCT ON`, `NULLS LAST` and `TRUE` through unchanged, all invalid T-SQL. Its T-SQL parser also rejects `[DWH_DB]..[STG_AMOS].[WO_HEADER]`. Parsing is reusable; printing is not.
3. **`test_db.js` did not connect to AMOS.** It was a SQL Server (DWH) connection test with the server address, user name and **password hard-coded in plain text**, gitignored and never committed. Its contents, password included, passed through this session's tool output. Deleted on 2026-11-17 at your request; asking the DBA to change that password is recommended.
4. **Nothing in the repo connects to AMOS directly.** AMOS queries run in the AMOS application and come out as CSV exports ([docs/wp-seqs-split-extraction.md](wp-seqs-split-extraction.md)). So result verification compares an AMOS CSV export with a DWH result, reusing `parseCsv`/`normalizeCell`/`compareTables` from [src/stitch/stitch.ts](../src/stitch/stitch.ts), which already handle export quirks (lower-cased aliases, NULL written as a space, `1'797'490`).
5. **`npm run validate` fails today**, so `npm run check` fails too: `probe_closed_dates.sql` and `probe_workstep_duplicates.sql` have lint errors (missing `z_` aliases, an undeclared join). The converter refuses sources with lint errors, so these two get no DWH version until they are fixed.
6. **NULL ordering will change real output.** PostgreSQL sorts NULLs last when ascending; SQL Server sorts them first. In `extract_wp_seqs_steps.sql`, `wp_sequence.seqno_prefix_i` is NULL for unsequenced items (LEFT JOIN), so a naive translation moves those rows from the bottom to the top, and the stitched row order depends on that.
7. **`DATEADD(minute, n, <date>)` is an error in SQL Server.** The six `(COALESCE(end_time, 0) * INTERVAL '1 minute')` expressions add minutes to a `date`; the converter must cast to `datetime2` first. Doing that requires knowing expression types, which text rewriting cannot do.
8. **"Today" in AMOS is the UTC date.** The AMOS session runs in UTC, so `CURRENT_DATE` in `extract_han_workpacks_today.sql` is UTC today: between 00:00 and 07:00 local time it returns yesterday's workpacks. The converter keeps the meaning exactly (it maps to the UTC date on SQL Server too) and shows a plain warning. Whether the source should change is a separate decision for you.
9. The queries reference 168 distinct columns: 8 are PostgreSQL `text` (e.g. `text_html`), 7 are `float8`, none is a T-SQL reserved word (all identifiers get brackets regardless).
10. `npm run docs:check` regenerates instead of checking (already noted in CLAUDE.md). The new `dwh:check` will check properly; fixing `docs:check` is a one-line change offered separately, outside this plan.

## A.3 Converter approaches

| Approach | How | Verdict |
|---|---|---|
| **A. Tree-based, own printer (chosen)** | Parse with `node-sql-parser` (PostgreSQL), walk every node against an allow-list, infer types, rewrite into a small T-SQL tree, print with our own printer, re-parse the result as a self-check. | Chosen. Sees strings, comments and scopes as what they are; knows `date + int` from `int + int`; can refuse any node it does not know; deterministic; each rule is unit-testable. |
| B. Text rewriting (regex) | Search-and-replace `DATE '1971-12-31' + x` → `DATEADD(...)`, `LIMIT n` → `TOP n`, etc. | Rejected. Cannot tell code from strings or comments, cannot infer types (the `datetime2` cast in A.2 #7), cannot tell CTE names from tables, and cannot detect "something I don't recognise", so it cannot fail loudly. |
| C. Tree-based, library printer | As A, but print with `sqlify(..., TransactSQL)`. | Rejected. The printer emits PostgreSQL-only syntax as-is (A.2 #2), cannot print `..` four-part names, and its output format is not ours to keep stable. |

Costs of A: comments are lost (the generated header points to the source file); a grammar gap or AST change in `node-sql-parser` could break things, so the version is pinned and golden tests over every real query catch changes.

## A.4 Converter design

**Pipeline** (`convertQuery(source, options)`):

1. **Pre-process.** Normalise CRLF to LF. A small lexer (shared with the safety scanner, aware of `'…'`, `"…"`, `--`, nested `/* */`) finds placeholders `<NAME>` (pattern `<[A-Z0-9_]+>`) **inside string literals only** and swaps each for a sentinel `__PH_NAME__`. A placeholder anywhere else is an error. `E'…'`, `U&'…'` and `$$…$$` are errors.
2. **Lint gate.** Run the existing `lintSql` on the source. Any error stops conversion with code `E_LINT` and the lint messages. Lint warnings do not stop it.
3. **Parse.** `astify(sql, {database: 'PostgresQL', parseOptions: {includeLocations: true}})` (locations verified to work, so errors can say "line 12, column 5"). More than one statement → `E_MULTI_STATEMENT`; a single trailing `;` is fine. Root type not `select` → `E_NOT_SELECT`.
4. **Allow-list check.** Walk every node. Any node type, operator, function or keyword not listed in A.5 as converted → `E_UNSUPPORTED` naming the construct, in plain words.
5. **Scope resolution.** Build scopes for the query, each CTE and each subquery. A name in `FROM` that matches a CTE in scope stays a CTE name; every other name must be an AMOS table in the CSV, and becomes `[DWH_DB]..[STG_AMOS].[<DWH name>]`. Every column must be table-qualified (house style) and must exist in the CSV (stricter than lint, which only checks the select list) → otherwise `E_UNKNOWN_COLUMN`.
6. **Type inference.** Types come from the CSV `pgType` (`int4`/`INT` → int, `float8` → float, `numeric` → numeric, `varchar`/`text` → text) and from literals; derived types follow the algebra below. Where a rewrite depends on a type that cannot be inferred → `E_TYPE_UNKNOWN`.
7. **Rewrite** into a T-SQL tree (A.5).
8. **Name mapping.** Table and column spelling comes from the DWH catalogue snapshot `dwh/catalogue.json` (exact case) when present, else the defaults from `dwh/mapping.yaml` (table names upper-case, columns as written). A column missing from the snapshot → `E_MISSING_IN_DWH`; renamed → see A.6.
9. **Print** with our printer: every identifier in brackets, every binary expression in parentheses (removes all operator-precedence differences), one select item per line, fixed indentation, LF line endings, no trailing semicolon.
10. **Self-check.** Re-parse the output with `node-sql-parser` in TransactSQL mode after replacing `[DWH_DB]..` with nothing (the parser cannot read `..`). Failure means a converter bug → `E_SELF_CHECK`, nothing is emitted.
11. **Safety scan** of the printed T-SQL (A.8) → `E_FORBIDDEN`.

**Date and time algebra** (the core of the real queries; `d` = date, `ts` = timestamp, `i` = int, `U` = unit):

| PostgreSQL | Type | T-SQL emitted |
|---|---|---|
| `DATE 'Y-M-D'` | date | `CAST('Y-M-D' AS date)` (never `datetime`: its string parsing depends on `DATEFORMAT`) |
| `TIMESTAMP 'Y-M-D h:m:s'` | ts | `CAST('Y-M-DTh:m:s' AS datetime2)` |
| `d + i`, `i + d` | date | `DATEADD(day, i, d)` |
| `d - i` | date | `DATEADD(day, -(i), d)` |
| `d1 - d2` | int | `DATEDIFF(day, d2, d1)` |
| `d ± INTERVAL 'n' U` | ts | `DATEADD(U, ±n, CAST(d AS datetime2))` |
| `ts ± INTERVAL 'n' U` | ts | `DATEADD(U, ±n, ts)` |
| `e * INTERVAL 'k U'` (e int) then `ts + …` | ts | `DATEADD(U, ((k) * (e)), ts)`; with k = 1, `DATEADD(U, e, ts)` |
| `CURRENT_TIMESTAMP`, `NOW()`, `LOCALTIMESTAMP` | ts | `SYSUTCDATETIME()` (UTC on both sides; never `GETDATE()`/`CURRENT_TIMESTAMP`, which are server-local on SQL Server) |
| `CURRENT_DATE` | date | `CAST(SYSUTCDATETIME() AS date)` |
| `x::date`, `CAST(x AS date)` | date | `CAST(x AS date)` |

Interval units: year, month, week, day, hour, minute, second, singular or plural, in either the `'n' UNIT` or the `'n unit'` form. `n` must be an integer literal (sign allowed). Chains keep their left-to-right order and are never folded (`CURRENT_TIMESTAMP + INTERVAL '7' HOUR - INTERVAL '24' HOUR` → `DATEADD(hour, -24, DATEADD(hour, 7, SYSUTCDATETIME()))`). End-of-month behaviour of month arithmetic is the same on both engines (31 Aug − 6 months = 28 Feb), pinned by a live probe in Task 2.4.

Example, one real line of `extract_wp_seqs_steps.sql`:

```sql
-- PostgreSQL
wp_header.start_date >= ((CURRENT_DATE - INTERVAL '6' MONTH)::date - DATE '1971-12-31')
-- T-SQL
([WP_HEADER].[start_date] >= DATEDIFF(day, CAST('1971-12-31' AS date), CAST(DATEADD(month, -6, CAST(CAST(SYSUTCDATETIME() AS date) AS datetime2)) AS date)))
```

**Errors and warnings.** `ConvertError { code, plain, detail, loc? }` stops conversion. `ConvertWarning { code, plain, loc? }` is printed in the generated file's header and shown in yellow in the page before Run. `plain` is one or two sentences for a non-programmer; `detail` is for us.

**Determinism.** Output depends only on: source text, converter version, `dwh/mapping.yaml`, `dwh/catalogue.json`, the CSV, `schema/`. No clock, no environment, no map-iteration order. Tested by converting twice and comparing bytes, and by the committed golden files.

**Generated file header:**

```sql
-- GENERATED by `npm run dwh:convert`. DO NOT EDIT: edit the source and re-run.
-- Source: extract_wp_seqs_steps.sql  sha256:1a2b3c4d5e6f
-- Converter: 1   Catalogue snapshot: sha256:9f8e7d6c5b4a
-- Warning W_NULL_ORDER: NULLs are sorted the AMOS way (last when ascending).
-- Warning W_UTC_TODAY: "today" and "now" mean UTC, the same as in AMOS.
```

## A.5 Edge-case catalogue

"Rejected" always means: conversion stops, the page shows the plain reason and the source line, no T-SQL is produced. Test files are under `test/dwh/`.

| # | Case | Behaviour | Test |
|---|---|---|---|
| 1 | Table reference `wo_header` | `[DWH_DB]..[STG_AMOS].[WO_HEADER]` in `FROM`/`JOIN`; column refs `[WO_HEADER].[col]` (the exposed name, still no alias) | `names.test.ts`: table prefix and column ref |
| 2 | CTE name used in `FROM` | Not prefixed; resolved by scope, including inside subqueries | `names.test.ts`: CTE not prefixed, shadowing |
| 3 | Schema-qualified source name (`public.wp_header`) | Rejected `E_UNSUPPORTED` | `guard.test.ts` |
| 4 | Unqualified column (`SELECT wpno FROM …`) | Rejected `E_UNQUALIFIED_COLUMN` (house style; avoids scope guessing) | `names.test.ts` |
| 5 | Column not in the AMOS CSV (anywhere, incl. `WHERE`) | Rejected `E_UNKNOWN_COLUMN` | `names.test.ts` |
| 6 | Column missing from DWH snapshot | Rejected `E_MISSING_IN_DWH` naming table.column | `names.test.ts` with fixture catalogue |
| 7 | Identifier case | Exact case from snapshot; defaults: tables upper, columns as written | `names.test.ts` |
| 8 | T-SQL reserved words as identifiers (`[key]`, `[user]`, `[plan]`) | Every identifier and alias bracketed; `]` escaped as `]]` | `print.test.ts` |
| 9 | Quoted identifier `"Order"` | `[Order]`; must match the snapshot case-exactly, else `E_MISSING_IN_DWH` | `names.test.ts` |
| 10 | Column alias `AS z_WP_ID` | `AS [z_WP_ID]`, spelling kept. (AMOS lower-cases it to `z_wp_id`; verification compares names case-insensitively) | `print.test.ts` |
| 11 | Duplicate output names (two `text` columns) | Allowed, kept by position | `print.test.ts`; runner test in Task 2.1 |
| 12 | Select expression without alias | Allowed, warning `W_UNNAMED_COLUMN` (PostgreSQL names it e.g. `coalesce`, SQL Server leaves it blank) | `print.test.ts` |
| 13 | `SELECT *` | Allowed, warning `W_SELECT_STAR` (DWH may add ETL columns or reorder) | `guard.test.ts` |
| 14 | Date arithmetic, `CURRENT_*`, intervals | Per the algebra table in A.4 | `dates.test.ts`: one case per row, plus all six real `* INTERVAL '1 minute'` lines |
| 15 | `DATEADD` minute/hour on a `date` | Always `CAST(d AS datetime2)` first | `dates.test.ts` |
| 16 | Fractional or compound interval (`'1.5 hours'`, `'1 day 2 hours'`) | Rejected | `dates.test.ts` |
| 17 | `interval + interval`, bare interval in output, `ts - ts` | Rejected | `dates.test.ts` |
| 18 | `CURRENT_TIME`, `LOCALTIME`, `AT TIME ZONE`, `timezone()` | Rejected; suggest the repo's `+ INTERVAL '7' HOUR` idiom (Vietnam has no DST) | `dates.test.ts` |
| 19 | Time zones in general | Both sides compute in UTC (`SYSUTCDATETIME()`); warning `W_UTC_TODAY` whenever `CURRENT_DATE`/`CURRENT_TIMESTAMP` appears. Assumes the AMOS session `TimeZone` is UTC, checked once in Phase 0 | `dates.test.ts` |
| 20 | AMOS date ints far in the future (T-SQL `date` ends 9999-12-31, ≈2.92 M days after 1971-12-31) | Converted normally; Phase 0 probes `MAX()` of the used date columns; runtime overflow error gets a plain message (A.9) | `errorsPlain.test.ts` |
| 21 | `EXTRACT(YEAR|MONTH|DAY|HOUR|MINUTE FROM x)` | `DATEPART(<unit>, x)` | `functions.test.ts` |
| 22 | `EXTRACT(DOW|ISODOW|WEEK|EPOCH|SECOND …)` | Rejected (week day numbering and fractional seconds differ) | `functions.test.ts` |
| 23 | `date_trunc` | Rejected in v1 (`DATETRUNC` needs SQL Server 2022; return type differs) | `functions.test.ts` |
| 24 | `to_char`, `FORMAT` | Rejected: formatting belongs in code (`_conventions.yaml`: "sql: raw columns only … no conversion") | `functions.test.ts` |
| 25 | `string_agg`, `array_agg`, any array syntax | Rejected (combines values, which the querying rules forbid; arrays don't exist in T-SQL) | `functions.test.ts` |
| 26 | `COALESCE`, `NULLIF` | Passed through. Same semantics; result type follows each engine's precedence, the same for the int/varchar mixes AMOS uses | `functions.test.ts` |
| 27 | `ISNULL`/`NOTNULL` postfix (PostgreSQL) | Rejected (would be misread in T-SQL) | `guard.test.ts` |
| 28 | `::integer`, `::bigint`, `::smallint` | `CAST(x AS int/bigint/smallint)` only when `x` is already an integer; from float/numeric → rejected `E_INT_CAST_FROM_NON_INT` (PostgreSQL rounds, SQL Server truncates) | `casts.test.ts` |
| 29 | `::numeric(p,s)` / `::numeric` | `CAST(x AS decimal(p,s))`; bare `numeric` rejected (unbounded in PostgreSQL, `decimal(18,0)` in SQL Server) | `casts.test.ts` |
| 30 | `::text`, `::varchar(n)` | From int or text only → `CAST(x AS nvarchar(max))` / `nvarchar(n)`; from date/timestamp/float → rejected (formats differ) | `casts.test.ts` |
| 31 | `::timestamp` / `::timestamptz` / `::boolean` | `CAST(x AS datetime2)` / rejected / rejected | `casts.test.ts` |
| 32 | `LIMIT n` (outer or inside a subquery) | `SELECT TOP (n)`; `LIMIT ALL` dropped; non-literal `n` rejected | `limit.test.ts` |
| 33 | `LIMIT n` without `ORDER BY` | `TOP (n)` plus warning `W_LIMIT_NO_ORDER` (both engines pick arbitrary rows, maybe different ones) | `limit.test.ts` |
| 34 | `OFFSET m` (with or without `LIMIT`) | `ORDER BY … OFFSET m ROWS FETCH NEXT n ROWS ONLY`; no `ORDER BY` → rejected `E_OFFSET_NO_ORDER` | `limit.test.ts` |
| 35 | `ORDER BY` inside a subquery/CTE without `LIMIT` | Removed with warning `W_SUBQUERY_ORDER_DROPPED` (SQL Server forbids it; it never guarantees order in either engine); with `LIMIT` it stays next to `TOP` | `limit.test.ts` |
| 36 | NULL ordering | Emulate PostgreSQL in every `ORDER BY`, including inside `OVER (…)`: ASC → `CASE WHEN e IS NULL THEN 1 ELSE 0 END, e ASC`; DESC → `CASE WHEN e IS NULL THEN 0 ELSE 1 END, e DESC`; explicit `NULLS FIRST/LAST` honoured; info warning `W_NULL_ORDER` | `order.test.ts`, incl. the real steps query |
| 37 | `ORDER BY` with `SELECT DISTINCT` or a `UNION` | The CASE trick is illegal there (items must be in the select list) → rejected `E_NULL_ORDER_IMPOSSIBLE` unless the snapshot says every key is NOT NULL and comes from a non-outer-joined table, in which case no CASE is needed | `order.test.ts` |
| 38 | `ORDER BY` alias or ordinal (`ORDER BY 1`, `ORDER BY z_WP_NO`) | Resolved to the select expression (T-SQL cannot use an alias inside the CASE) | `order.test.ts` |
| 39 | String sort order | If Phase 0 shows AMOS collation `C`/`POSIX`: add `COLLATE Latin1_General_100_BIN2` to string `ORDER BY` keys (same byte order). Otherwise warning `W_STRING_ORDER` | `order.test.ts` (both settings) |
| 40 | Ties in `ORDER BY` | Not fixable; verification checks order only on the sort-key values (A.7) | `compare.test.ts` |
| 41 | String equality, `IN`, `<>` | Passed through, warning `W_STRING_COMPARE` when the snapshot shows a case-insensitive collation on that column (`'Closed' = 'closed'` is true there) or the column could carry trailing spaces (SQL Server ignores them in `=`). An opt-in `strict_string_compare: true` in mapping adds `COLLATE Latin1_General_100_BIN2` to the literal side; off by default because it may stop the linked server from filtering remotely (risk R1) | `strings.test.ts` |
| 42 | `LIKE` | Passed through; pattern literal containing `[` or `\` rejected (`[` is a wildcard class in T-SQL; PostgreSQL's default escape is `\`); `W_STRING_COMPARE` as #41 | `strings.test.ts` |
| 43 | `ILIKE` | `LOWER(x) LIKE LOWER('pat')` (correct under any collation) | `strings.test.ts` |
| 44 | `SIMILAR TO`, `~`, `!~`, regex | Rejected | `strings.test.ts` |
| 45 | `||` anywhere | Rejected `E_CONCAT` (rules forbid combining; T-SQL `+` would also add numbers) | `strings.test.ts` |
| 46 | Non-ASCII string literal (Vietnamese) | `N'…'`; ASCII literals stay `'…'` so `varchar` columns keep using indexes | `strings.test.ts` |
| 47 | `''` quote doubling | Kept as-is (same in both) | `strings.test.ts` |
| 48 | Boolean literals `TRUE`/`FALSE`, `IS TRUE`, `WHERE TRUE`, boolean in select list | Rejected `E_BOOLEAN` (T-SQL has no boolean values; AMOS uses `'Y'/'N'` anyway) | `guard.test.ts` |
| 49 | Integer division `a / b` (both int) | Passed through (both truncate toward zero); `%` passed through (same sign rule) | `arith.test.ts` |
| 50 | Division involving numeric | Passed through, warning `W_DECIMAL_SCALE` (result scale differs) | `arith.test.ts` |
| 51 | `^`, `~`, `&`, `|`, `#`, `<<`, `->`, `->>`, `@>` | Rejected (`^` is power in PostgreSQL, XOR in T-SQL) | `arith.test.ts` |
| 52 | Operator precedence | Printer parenthesises every binary/unary expression | `print.test.ts` |
| 53 | `COUNT(*)`, `COUNT(x)`, `COUNT(DISTINCT x)` | `COUNT_BIG(…)` (bigint like PostgreSQL) | `aggregates.test.ts` |
| 54 | `SUM(int)` | `SUM(CAST(x AS bigint))` (PostgreSQL returns bigint; SQL Server int overflows) | `aggregates.test.ts` |
| 55 | `AVG(int)`, `AVG(numeric)` | Rejected (SQL Server `AVG(int)` returns an int: 1.5 → 1); compute in code | `aggregates.test.ts` |
| 56 | `MIN`/`MAX` | Passed through; `W_STRING_ORDER` on strings | `aggregates.test.ts` |
| 57 | `FILTER (WHERE c)` on COUNT/SUM/MIN/MAX | `AGG(CASE WHEN c THEN x END)`; `COUNT(*) FILTER` → `COUNT_BIG(CASE WHEN c THEN 1 END)` | `aggregates.test.ts` |
| 58 | `GROUP BY` ordinal or alias | Resolved to the expression (T-SQL allows neither) | `aggregates.test.ts` |
| 59 | Window functions | `row_number`, `rank`, `dense_rank`, `lag`, `lead`, and `COUNT/SUM/MIN/MAX OVER (…)` without a frame: passed through with #36 inside `OVER`. Frames other than `ROWS …`, `GROUPS`, `EXCLUDE`, named `WINDOW` → rejected | `window.test.ts` |
| 60 | `DISTINCT ON` | Rejected: the T-SQL equivalent needs a derived table, which needs a table alias, which the rules forbid | `guard.test.ts` |
| 61 | Plain `DISTINCT` | Passed through; `E_TEXT_COLUMN` on `text/ntext` (#66); `W_STRING_COMPARE` on CI collation | `guard.test.ts` |
| 62 | CTE (`WITH`) | Passed through; `WITH RECURSIVE` rejected (different limits: SQL Server stops at 100 levels); `MATERIALIZED` rejected | `cte.test.ts` |
| 63 | Subqueries: `EXISTS`, `NOT EXISTS`, `IN (SELECT…)`, scalar, `= ANY (SELECT…)` | Passed through (same three-valued logic) | `cte.test.ts` incl. the real NOT EXISTS query |
| 64 | Derived table in `FROM`, `LATERAL`, `JOIN … USING`, `NATURAL JOIN` | Rejected (derived tables need aliases in T-SQL; the others have no direct equivalent) | `guard.test.ts` |
| 65 | `UNION [ALL]`, `INTERSECT`, `EXCEPT` | Passed through; `LIMIT` on the whole set → OFFSET/FETCH (#34); preview cap by streaming only (A.8) | `cte.test.ts` |
| 66 | `text`/`ntext` columns on the DWH | Allowed in the select list, `IS NULL` and `LIKE`; in `=`, `<>`, `IN`, `ORDER BY`, `GROUP BY`, `DISTINCT`, `UNION` → rejected `E_TEXT_COLUMN` (SQL Server cannot compare them). `nvarchar(max)` is fine | `names.test.ts` with fixture catalogue |
| 67 | Long text values (`text_html`) | Runner sets `textsize` to 2147483647 so nothing is cut; verification compares lengths | Task 2.1 runner test, Task 3.2 compare |
| 68 | Comments | Dropped by parsing; header names the source; a placeholder or `;` inside a comment is ignored | `preprocess.test.ts` |
| 69 | `<INSERT_WPNO_HERE>`-style placeholders | Only inside string literals; kept literally in `queries/dwh/`; at run time the literal is replaced by `@INSERT_WPNO_HERE`, bound as `VarChar(n)` (n from the CSV column it is compared with, else 4000; `VarChar` not `NVarChar` so the index can be used). Empty value → Run disabled | `preprocess.test.ts`, Task 2.1 |
| 70 | Trailing `;`, several statements | One trailing `;` dropped; two statements → `E_MULTI_STATEMENT` | `preprocess.test.ts` |
| 71 | CRLF line endings | Normalised; output always LF | `preprocess.test.ts` |
| 72 | `E'…'`, `U&'…'`, `$$…$$` | Rejected | `preprocess.test.ts` |
| 73 | Writes or side effects: `INSERT/UPDATE/DELETE/MERGE`, `SELECT … INTO`, `FOR UPDATE`, data-modifying CTEs, `nextval`, `set_config`, `pg_sleep`, `dblink`, `lo_import`, `OPENQUERY/OPENROWSET/OPENDATASOURCE`, `EXEC` | Rejected twice: by the allow-list (PostgreSQL side) and by the T-SQL token scan (A.8) | `safety.test.ts` (list of 30+ attacks) |
| 74 | Function not on the allow-list | Rejected `E_UNSUPPORTED_FUNCTION` naming it. v1 allow-list: `COALESCE`, `NULLIF`, `LOWER`, `UPPER`, `ABS`, the date items above, the aggregates above | `functions.test.ts` |
| 75 | `IS DISTINCT FROM`, `GREATEST`, `LEAST` | Rejected in v1 (need SQL Server 2022; version known after Phase 0, revisit then) | `functions.test.ts` |
| 76 | `BETWEEN`, `BETWEEN SYMMETRIC` | Passed through / rejected | `guard.test.ts` |
| 77 | Very large integer literals | Passed through (SQL Server types `3000000000` as decimal; values compare equal) | `arith.test.ts` |
| 78 | A column renamed in the DWH | Rejected `E_RENAMED_NEEDS_APPROVAL` unless `dwh/mapping.yaml` approves that column (A.6) | `names.test.ts` |
| 79 | A column retyped in the DWH (e.g. AMOS int date → DWH `date`) | Rejected `E_RETYPED_COLUMN` when the rewrite depends on the type (date algebra, casts); otherwise warning | `names.test.ts` |
| 80 | `varchar` in DWH where AMOS has `text`/Unicode | Warning `W_MAYBE_LOST_UNICODE` from schema diff (ETL may have dropped diacritics) | `schemaDiff.test.ts` |
| 81 | `float8` values | Passed through; verification compares floats by shortest round-trip string | `compare.test.ts` |
| 82 | A source with lint errors | Not converted (`E_LINT`), listed as such in the manifest and the page | `cli.test.ts` |

## A.6 Schema fidelity (DWH vs AMOS)

- **Catalogue snapshot.** `npm run dwh:catalogue` runs one read-only catalogue query and writes `dwh/catalogue.json` (committed; table and column names and types only, no data): for every table in schema `STG_AMOS`, each column's exact name, ordinal, data type, max length, precision, scale, nullability, collation. Sorted for stable diffs. The query form is chosen in Phase 0, in this order of preference: `[DWH_DB]..INFORMATION_SCHEMA.COLUMNS`, `EXEC sp_columns_ex 'DWH_DB', …` (linked-server catalogue procedure), `OPENQUERY(DWH_DB, 'SELECT … FROM INFORMATION_SCHEMA.COLUMNS')`.
- **Diff.** `npm run dwh:schema-diff` (offline, uses the snapshot) compares three things: tables/columns used by any source query (from the converter's scope pass), everything in `schema/*.yaml`, and the CSV. It writes `docs/generated/dwh-schema-diff.md` and returns issues:
  - `missing_table`, `missing_column` (error);
  - `case_only` (info: recorded so the converter prints the exact case);
  - `retyped` (error when it is a date/time int column or a column used in arithmetic, otherwise warning). Compatibility table: `int4` ↔ `int`/`bigint`/`decimal(p,0)` OK; `int4` date-int ↔ `date`/`datetime*` → retyped; `varchar(n)` ↔ `(n)varchar(m)`: m < n → `W_TRUNCATION_RISK`; `text` ↔ `(n)varchar(max)` OK, ↔ `text`/`ntext` → `W_LEGACY_TEXT`; `float8` ↔ `float` OK, ↔ `real` → warning; Unicode loss as #80;
  - `extra_column` (info; ETL columns such as load timestamps, useful for freshness, A.7).
- **Renames.** `dwh/mapping.yaml` (hand-edited, committed) holds the prefix, the default name case, and per-column overrides:

  ```yaml
  prefix: "[DWH_DB]..[STG_AMOS]"
  table_case: upper
  columns:
    wo_header.some_col: { dwh: some_col_renamed, keep_output_name: true }
  strict_string_compare: false
  amos_collation: unknown   # set after Phase 0: C | other
  ```

  `keep_output_name: true` prints `[some_col_renamed] AS [some_col]` so the output stays 1:1 with AMOS. That is a non-`z_` alias, the one rule exception (A.11), so it only happens for columns you approve in this file.
- **Before every run** the page shows the diff for that query's columns ("All 24 columns found in the DWH" or the list of problems) and the snapshot's age, with a "Refresh DWH catalogue" button (read-only).

## A.7 Result verification

There is no programmatic AMOS connection (A.2 #4), so the AMOS side is a CSV exported from AMOS, as you do today.

1. **Freeze the clock.** `npm run dwh:verify-pack -- <source.sql> --at 2026-11-10T00:00:00Z [--param INSERT_WPNO_HERE=…]` writes `verify/<name>/amos.sql` and `verify/<name>/dwh.sql` (`verify/` is gitignored). In `amos.sql`, every `CURRENT_DATE`/`CURRENT_TIMESTAMP` is replaced by `DATE '2026-11-10'` / `TIMESTAMPTZ '2026-11-10 00:00:00+00'` by splicing at the parser's character offsets, so the rest of your text stays byte-for-byte; placeholders are filled with the escaped value. `dwh.sql` is the converter output with `pinNow` set, so both sides evaluate the same window. The `--at` time must be earlier than the DWH freshness estimate; the default is that estimate minus one day, rounded down to midnight UTC.
2. **Fixed keys.** `dwh/verify-keys.yaml` lists, per query, a few workpacks closed more than a week before the freshness estimate (closed WPs rarely change). Parameterised queries are verified with those as parameters; time-window queries are verified with the frozen clock, and only their closed-WP rows are expected to match exactly.
3. **Run.** You paste `amos.sql` into AMOS and export `verify/<name>/amos.csv`; the tool runs `dwh.sql` itself.
4. **Compare** (`npm run dwh:compare -- amos.csv dwh.csv [--key=z_WP_NO,z_WORKSTEP_LINK_ID]`, also in the page): headers equal ignoring case; row counts; multiset equality of normalised rows (reusing `normalizeCell`); per-column checksums (SHA-256 over sorted normalised values) to point at differing columns; row order compared on the sort-key values only (#40); matched-by-key cell differences classified as whitespace only, case only, NULL vs empty, number formatting, text truncated (DWH value is a prefix), exactly ±7 h shifted (a time-zone bug), or real change. Output: `verify/<name>/report.md` plus a summary in the page.
5. **Point-in-time drift.** The freshness estimate is `MAX(mutation)` (with `mutation_time`) per table used, read from the DWH; most AMOS tables carry `mutation`/`mutation_time` (checked in the CSV), or an ETL load column if the snapshot shows one. The report groups rows found on one side only by the first key column (e.g. `z_WP_NO`) so drift shows up as "3 workpacks changed after the last DWH load" instead of thousands of row diffs.
6. **Pass criterion:** zero differences other than "number formatting" and "whitespace only" on the fixed-key run, for every query in `queries/dwh/`.
7. **Engine-level proof of the date algebra.** `test/dwh/fixtures/expr-probes.json` lists ~25 table-free expressions (month-end, minutes on a date, DATEDIFF across years, `COUNT_BIG`, integer division, NULL ordering on a `VALUES` list). Expected values are computed by a small JS reference, checked once by you in AMOS (one `SELECT` without a table), and checked on the DWH by `npm run dwh:probe-exprs` (read-only `SELECT`s with no `FROM`).

## A.8 Safety

1. **Source gate:** lint must pass; single statement; root is `SELECT`/`WITH`; allow-list (A.4 step 4).
2. **Output gate:** `assertReadOnlyTsql(tsql)` scans the emitted T-SQL with the shared lexer, outside strings, brackets and comments: it must start with `SELECT` or `WITH`; no `;`; no `#`; no `@` except parameter names the runner bound; none of `INSERT UPDATE DELETE MERGE INTO EXEC EXECUTE DROP ALTER CREATE TRUNCATE GRANT REVOKE DENY OPENQUERY OPENROWSET OPENDATASOURCE OPENXML BULK WAITFOR SHUTDOWN KILL RECONFIGURE BACKUP RESTORE DBCC SET USE DECLARE BEGIN COMMIT ROLLBACK SAVE TRAN TRANSACTION`. The runner calls it again just before executing.
3. **Only converter output runs.** The page sends a source path plus parameter values, never SQL. The server checks the path against the list of known sources (no `..`, no absolute paths), re-reads and re-converts the file, then runs it. There is no free-text SQL box in v1. `scripts/dwh.ts` (runs arbitrary SQL) is retired; `npm run dwh:run` replaces it, and its `--raw <file.sql>` option for hand-written T-SQL still goes through the output gate.
4. **Connection settings:** `readOnlyIntent: true`, `appName: 'amos-dwh-runner'` (visible to the DBA), `connectionTimeout: 15000`, `requestTimeout` 120 s for preview and 900 s for downloads, `textsize: 2147483647`, `useUTC: true`, pool max 2.
5. **Caps:** preview shows 500 rows. The runner adds `TOP (501)` to the outermost select when it is a single `SELECT` without `TOP`/`OFFSET` (at run time only; the committed file is uncapped), and always stops reading at 501 rows and cancels the request. Downloads stream straight to the browser with a hard limit of 2,000,000 rows (in `mapping.yaml`), and a Stop button cancels.
6. **Database role:** the login is read-only (your answer). Phase 0.4 confirms it (`IS_SRVROLEMEMBER('sysadmin')`, `HAS_PERMS_BY_NAME(NULL, NULL, 'CONTROL SERVER')`). The app gates stay anyway. No transaction wrapper: on a linked server it can escalate to a distributed transaction, and a gated `SELECT` doesn't need one.
7. **Web server:** port 4870 (next free up to 4880).
   - **Unshared (default):** listens on `127.0.0.1`; `Host` must be `127.0.0.1:<port>` or `localhost:<port>`.
   - **Shared (`share: true` in `dwh/local/share.json`):** listens on `0.0.0.0` over **HTTPS** only, and refuses to start without a certificate and an access code. `Host` must be one of the names listed in `share.json` (the PC name, its full DNS name, its IP), which blocks DNS rebinding. Every visitor enters the access code once; the server stores only a scrypt hash of it, and issues a session cookie (`HttpOnly; Secure; SameSite=Strict`, 12 h). Five wrong codes from one IP lock that IP out for 15 minutes. An optional `allow_cidrs` list restricts which networks may connect.
   - **Both modes:** every `/api/*` call needs the session (shared) or the per-launch token (unshared) plus header `X-Runner-Token` against cross-site requests; no CORS headers; JSON bodies only; `Content-Security-Policy: default-src 'self'`.
   - **Host-only actions:** Quit and "Refresh DWH catalogue" (which writes files in the repo) work only from `127.0.0.1`; remote visitors don't see the buttons.
   - **Fair use:** at most one running query per visitor and four in total (pool max 4); further requests get "The DWH runner is busy, try again in a minute" instead of waiting silently. Uploads for Compare are limited to 200 MB.
   - **Audit:** `logs/runner.log` records time, visitor IP, source path, parameters, row count and duration, because everyone shares one DWH login.
   - **Certificate:** if IT can issue one from the company CA, use it (no browser warning). Otherwise `npm run dwh:share-setup` creates a self-signed certificate with the built-in PowerShell `New-SelfSignedCertificate` (no dependency); colleagues then see a one-time browser warning, explained with screenshots in the guide.
8. **Credentials:** read only by the server process; API responses and logs go through the plain-error mapper, which never includes server, user or password; the log `logs/runner.log` (gitignored) records source path, parameters, row count and duration, never `.env` values.
9. **`test_db.js`:** deleted (A.2 #3).

## A.9 The page, for a non-technical user

**Options considered**

| Option | What you get | Trade-offs |
|---|---|---|
| **A. Local web page (recommended)** | Double-click "DWH Runner" on the desktop; a small minimised window starts the server and your browser opens the page | Zero new dependencies, no build step, reuses the converter in-process, works in any browser. A minimised console window stays open while it runs; closing it (or the Quit button) stops it |
| B. Desktop app (Electron) | A real window with its own icon | ~150 MB of dependencies, a packaging/build step, rebuilds for every change, more to break on updates. Against "few dependencies, no build step" |
| C. Excel + Power Query | Paste the generated `queries/dwh/*.sql` into Excel's SQL Server connector | Familiar, nothing to maintain, but no read-only gate (Power Query native queries run anything), credentials stored per workbook/user, placeholders edited by hand, no warnings or verification. Could still be a later output route |

**Recommendation: A.** It is the only option that keeps the safety gate and the converter in one place without adding a build.

**Screen sketch**

```
┌ DWH Runner ─────────────────────────────── DWH data as of ~16 Nov 23:10 ┐
│ Queries                 │ extract_wp_seqs_steps.sql                       │
│ ✓ extract_work_order    │ [AMOS version] [DWH version] [Compare]          │
│ ⚠ extract_wp_seqs_steps │ ⚠ Good to know (2):                             │
│ ✗ probe_closed_dates    │   • "Today" and "now" mean UTC, like in AMOS.   │
│ ▸ WP sequences (12)     │   • Empty sequence numbers sort last, like AMOS.│
│                         │ ✓ All 24 columns found in the DWH (snapshot 3d) │
│                         │ WPNO: [_____________________]                   │
│                         │ [Run preview] [Download all as CSV] [Stop]      │
│                         │ First 500 rows (more available) · 8.2 s         │
│                         │ z_WP_ID │ z_WP_NO        │ z_WP_DESC │ …        │
│                         │ 81234   │ A620-040326-…  │ …         │          │
└─────────────────────────┴─────────────────────────────────────────────────┘
```

**Flow:** the left list shows every source query (root `*.sql` and the generated `queries/wp_seqs/*.sql`; the prompt said `queries/`, but most real queries live at the root, so the list covers both), each with ✓ (converts), ⚠ (converts with notes), ✗ (cannot convert, reason on hover and in the panel). Selecting one shows both SQL versions (read-only, plain monospace), the notes, the column check, and an input box per placeholder. **Run preview** shows the first 500 rows in a table with a sticky header. **Download all as CSV** saves `<query>_DWH_<yyyymmdd-hhmm>.csv` to your Downloads folder: UTF-8 with BOM, CRLF, every field quoted, dates as `YYYY-MM-DD` and timestamps as `YYYY-MM-DD HH:MM:SS` formatted in UTC (never shifted to local time), `bit` as `1/0`, decimals as exact strings. **Compare** (Phase 3): pick an AMOS CSV export and see the verification summary.

**Plain-language errors** (technical detail in a collapsed "Details" line):

| Situation (mssql/SQL Server signal) | Message |
|---|---|
| Login failed (18456) | "The DWH did not accept the username or password saved on this computer. Ask whoever set up the .env file to check them." |
| Cannot reach server (`ESOCKET`, `ETIMEOUT` on connect) | "Can't reach the DWH server. Are you on the company network or VPN?" |
| Query timeout (`ETIMEOUT` on request) | "The DWH took longer than 2 minutes. Try a narrower query (fewer workpacks or a shorter date range) or try again later." |
| Invalid column (207) / object (208) | "The DWH copy has no column/table called X. It may have been renamed. Click Refresh DWH catalogue, then pick the query again." |
| Date overflow (517) | "A date in column X is too far in the future for SQL Server to handle." |
| Conversion failed (245, 8114) | "A value in the data could not be read as a number or date. The DWH may store this column with a different type." |
| Linked server errors (7399, 7303, 7330) | "The DWH's link to the staging database failed. Try again in a few minutes; if it keeps happening, tell the DWH administrator." |
| `.env` missing or incomplete | "This computer is not set up to reach the DWH yet (the settings file is missing)." |
| Node missing or older than 24 (launcher) | "Node.js 24 or newer is needed. Ask IT to install it." |
| Anything else | "Something went wrong. The details below can help whoever maintains this tool." |

**Sharing on the WAN.** This PC (the host) runs the server; colleagues open `https://<host-pc-name>:4870` in their browser and type the access code. They need nothing installed. Consequences planned for:
- The host PC must be on, logged in and awake while others use it. `npm run dwh:autostart` puts the launcher in the Windows Startup folder (no admin rights needed); the guide covers the power setting "never sleep when plugged in".
- Windows Firewall must allow inbound TCP 4870. The first shared start triggers the Windows "Allow access" prompt; if it needs an administrator, the guide gives IT the one command (`netsh advfirewall firewall add rule name="DWH Runner" dir=in action=allow protocol=TCP localport=4870 profile=domain`).
- Everyone runs queries under the one read-only DWH login on this PC; the audit log is the only per-person record (risk R14).
- Only the host can add or change queries (they are files in this repo); colleagues pick from the list.

**Starting it on Windows without a terminal** (host PC only): `Start DWH Runner.cmd` in the repo root: changes to its own folder, checks that `node` exists and is ≥ 24 and that `.env` exists (otherwise shows the matching message and waits for a key), then starts `node --env-file=.env src/dwh/server.ts` in a minimised window titled "DWH Runner — close this window to stop". The server opens the default browser once it is listening. If the port already answers `/health` with our signature, the launcher only opens the browser (no second copy). `npm run dwh:shortcut` (run once during setup) puts a "DWH Runner" shortcut on the desktop.

**AMOS in the same screen:** AMOS is reached only through the AMOS application, so the "AMOS version" tab has **Copy for AMOS** (puts the PostgreSQL text, or the frozen-clock verification version, on the clipboard) and the Compare tab takes the CSV you export from AMOS. The server talks to databases through one interface (`QueryEngine.run(sql, params, options)`), so if direct read-only AMOS access ever appears, an AMOS engine (`pg` package, `default_transaction_read_only = on`, `statement_timeout`) plugs in with a Run button and one-click Compare. Not planned now.

## A.10 Repo fit

- **Generated T-SQL:** `queries/dwh/` mirrors the source path: `extract_work_order.sql` → `queries/dwh/extract_work_order.sql`, `queries/wp_seqs/NTHN_steps.sql` → `queries/dwh/wp_seqs/NTHN_steps.sql`. Plus `queries/dwh/_manifest.json`: every source, its result (`converted` + warning codes, or `refused` + error code and plain reason), hashes. Committed, never hand-edited.
- **Commands** (all through `src/cli.ts`, delegating to `src/dwh/cli.ts`, like the existing ones):
  - `dwh:convert`: converts every source, writes `queries/dwh/`, deletes generated files whose source is gone. No database.
  - `dwh:check`: fails if `queries/dwh/` or `docs/generated/dwh-schema-diff.md` differs from what would be generated. No database. Added to `npm run check`.
  - `dwh:catalogue` (database, read-only), `dwh:schema-diff` (offline), `dwh:run <source.sql> [--param K=V] [--csv out.csv] [--raw]` (database, read-only), `dwh:verify-pack`, `dwh:compare`, `dwh:probe-exprs` (database, read-only), `dwh:ui`, `dwh:shortcut`.
- **`npm run validate`:** unchanged. It only scans root `*.sql` and `queries/wp_seqs/*.sql`, so T-SQL in `queries/dwh/` is never fed to the PostgreSQL linter; a comment in `src/cli.ts` will say this is deliberate. The converter calls `lintSql` itself.
- **`npm run scaffold`:** unchanged. Order of work: scaffold → validate → `dwh:convert`.
- **`npm run docs`:** unchanged; the DWH diff is a separate generated doc.
- **`.gitignore`:** add `verify/`, `logs/`, `dwh/local/` (certificate, access-code hash, share settings).
- **`scripts/`:** `scripts/dwh.ts` and `scripts/example_steps.sql` (both untracked) are retired once `dwh:run` exists; the example becomes a fixture in `test/dwh/fixtures/`.
- **CLAUDE.md addition** (Task 1.7):

  > ## DWH (SQL Server) workflow
  > - The DWH is a SQL Server staging copy of AMOS reached through a linked server: `[DWH_DB]..[STG_AMOS].[TABLE]`. Credentials only in `.env`; never print, log or commit them.
  > - Write and validate queries in PostgreSQL as usual. Then `npm run dwh:convert`. Never hand-edit `queries/dwh/`; `npm run dwh:check` (part of `npm run check`) fails if it is stale.
  > - The converter refuses sources with lint errors and any construct it cannot translate exactly (catalogue: docs/dwh-converter-plan.md §A.5). Don't work around a refusal by editing generated files; change the source or extend the converter with a test.
  > - DWH name/type differences go in `dwh/mapping.yaml`; refresh the snapshot with `npm run dwh:catalogue` after ETL schema changes, then `npm run dwh:schema-diff`.
  > - Only `SELECT`/`WITH` ever runs on the DWH, through `dwh:run` or the page. Never run writes on either database.
  > - "Now"/"today" are UTC on both sides (`SYSUTCDATETIME()`); never emit `GETDATE()`.

## A.11 Rule compliance of generated T-SQL

- **No table aliases:** kept. Columns are referenced by the table's exposed name (`[WO_HEADER].[state]`).
- **Approved `z_` aliases:** kept verbatim.
- **No column combining:** kept; nothing concatenates, `||` is refused.
- **1:1 output:** kept. Rewrites only change *how* the source's own expressions are written (date arithmetic, `TOP`, casts). Additions that are not output: NULL-order `CASE` keys in `ORDER BY` (#36) and optional `COLLATE` (#39, #41).
- **The one exception, opt-in only:** a column renamed in the DWH and approved in `mapping.yaml` with `keep_output_name: true` produces `[new_name] AS [old_name]`, a non-`z_` alias. Without that approval the converter refuses (#78).

---

# Part B — Implementation plan

Phases are in delivery order. Phase 1 needs no database and can start right away using the facts already verified; Phase 0 runs in parallel and only fills in `dwh/mapping.yaml` and the snapshot.

## Phase 0 — Read-only probes (one sitting, about an hour)

Nothing here writes. I run the DWH ones through the existing `scripts/dwh.ts` after you approve each; you run the AMOS ones in the AMOS application.

- [x] **0.1 DWH server facts:** `SELECT @@VERSION, SERVERPROPERTY('Collation'), SYSUTCDATETIME(), SYSDATETIME()` → version (decides #75 later), server collation, server clock offset.
- [x] **0.2 Linked server:** `SELECT name, product, provider, is_collation_compatible, uses_remote_collation, collation_name, is_data_access_enabled FROM sys.servers WHERE name = 'DWH_DB'` → is the target SQL Server, what collation (decides #41).
- [x] **0.3 Catalogue access:** try the three forms in A.6 with `TOP 5`; record which works.
- [x] **0.4 Login rights:** `SELECT IS_SRVROLEMEMBER('sysadmin'), HAS_PERMS_BY_NAME(NULL, NULL, 'CONTROL SERVER')`.
- [x] **0.5 Freshness and ranges:** `SELECT MAX(mutation), MIN(start_date), MAX(start_date), MAX(end_date) FROM [DWH_DB]..[STG_AMOS].[WP_HEADER]` (#20, A.7 step 5).
- [x] **0.6 Speed:** time the hand-converted `scripts/example_steps.sql` (already `TOP 20`) and one hand-converted steps query with `TOP 50` → decides whether risk R1 is real.
- [x] **0.7 AMOS (you, in AMOS):** `SELECT current_setting('TimeZone'), version();` and `SELECT datcollate, datctype FROM pg_database WHERE datname = current_database();` → confirms the UTC assumption (#19) and sets `amos_collation` (#39).
- [x] **0.8 Record** results in `dwh/mapping.yaml` and a short "Phase 0 findings" section appended to this file. Commit.

**Test plan:** none (facts only). Exit: every value marked "set after Phase 0" above has a value.

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
  - `type ErrorCode` / `type WarningCode`: string unions of every `E_*` / `W_*` code named anywhere in this document (single source; a later task that needs a new code adds it here)
  - `lex(text: string, dialect: "pg" | "tsql"): Token[]` with `Token { kind: "word" | "string" | "nstring" | "quoted_ident" | "bracket_ident" | "number" | "symbol" | "comment" | "space"; text: string; offset: number }`
  - `preprocess(source: string): { sql: string; placeholders: string[] }` (sentinel `__PH_<NAME>__`)
  - `restorePlaceholders(tsql: string, placeholders: string[]): string`

- [ ] **Step 1: Write failing tests** in `test/dwh/preprocess.test.ts`: `placeholder in string is replaced and listed` (`'<INSERT_WPNO_HERE>'` → `'__PH_INSERT_WPNO_HERE__'`, placeholders `["INSERT_WPNO_HERE"]`); `placeholder outside a string throws E_PLACEHOLDER`; `placeholder inside a comment is ignored`; `CRLF becomes LF`; `E-string, U&-string and dollar quoting throw E_UNSUPPORTED`; `nested block comment lexes as one comment`; `restorePlaceholders round-trips`.
- [ ] **Step 2: Run** `node --test test/dwh/preprocess.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three files. PostgreSQL block comments nest; T-SQL `[ident]` escapes `]]`.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): lexer, placeholder pre-processing and error model`.

### Task 1.2: Allow-list guard and output safety scan

**Files:**
- Create: `src/dwh/convert/guard.ts`, `src/dwh/safety.ts`
- Test: `test/dwh/guard.test.ts`, `test/dwh/safety.test.ts`

**Interfaces:**
- Consumes: `ConvertError`, `lex` (Task 1.1)
- Produces:
  - `parsePg(sql: string): SelectAst` (wraps `astify` with `includeLocations`; throws `E_PARSE`, `E_MULTI_STATEMENT`, `E_NOT_SELECT`)
  - `assertSupported(ast: SelectAst): ConvertWarning[]` (throws on the first unsupported node; returns `W_SELECT_STAR` etc.)
  - `assertReadOnlyTsql(tsql: string, boundParams?: string[]): void` (throws `E_FORBIDDEN`)

- [ ] **Step 1: Write failing tests.** `guard.test.ts`: one test per "Rejected" row of A.5 handled at node level (#3, #27, #48, #60, #64, #73 PostgreSQL side, #74, #75, #76 symmetric) asserting the error code and that `loc.line` points at the construct; `all 15 root queries and 12 generated queries pass the guard` (reads the real files; the two lint-failing probes are still guard-clean). `safety.test.ts`: a table of at least 30 T-SQL strings that must throw (each forbidden keyword, `; DROP`, a `#temp`, `@x` not bound, `/**/DROP` (a comment right before a real keyword), `SELECT … INTO`, `WAITFOR DELAY`, `OPENQUERY`) and ones that must pass (`'DROP'` inside a string, `-- DROP` inside a comment, `[delete]` as a bracketed identifier, `@INSERT_WPNO_HERE` when bound).
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.** The guard is a recursive walk with an explicit `switch` on node `type`; the `default` branch throws (that is what makes unknown things fail loudly).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): allow-list guard and read-only T-SQL scan`.

### Task 1.3: Mapping, catalogue model, scopes and names

**Files:**
- Create: `dwh/mapping.yaml` (values from A.6; `amos_collation: unknown` until Phase 0), `src/dwh/mapping.ts`, `src/dwh/catalogue.ts` (types + `loadCatalogue` only; fetching comes in Task 2.2), `src/dwh/convert/scope.ts`
- Test: `test/dwh/names.test.ts`, `test/dwh/fixtures/catalogue.min.json`

**Interfaces:**
- Consumes: `parsePg` (1.2), `loadCsvIndex`/`CsvIndex` (`src/schema/csv.ts`)
- Produces:
  - `interface DwhMapping { prefix: string; tableCase: "upper" | "asis"; columns: Record<string, { dwh: string; keepOutputName?: boolean }>; strictStringCompare: boolean; amosCollation: "C" | "other" | "unknown"; exportRowLimit: number }`; `loadMapping(path: string): DwhMapping`
  - `interface CatalogueColumn { table: string; name: string; ordinal: number; dataType: string; maxLength: number | null; precision: number | null; scale: number | null; nullable: boolean; collation: string | null }`; `type Catalogue = { takenAt: string; columns: CatalogueColumn[] }`; `loadCatalogue(path: string): Catalogue | undefined`
  - `resolveScopes(ast: SelectAst, csv: CsvIndex): ScopeInfo` where `ScopeInfo` answers `tableOf(columnRef)`, `isCte(name)`, `pgTypeOf(columnRef): SqlType`, `usedColumns(): string[]` (`table.column`, lower-case)
  - `dwhTableName(amosTable: string, ctx): string`, `dwhColumnName(ref: string, ctx): { name: string; aliasAs?: string }` (throw `E_MISSING_IN_DWH`, `E_RENAMED_NEEDS_APPROVAL`)
  - `type SqlType = "int" | "numeric" | "float" | "text" | "date" | "timestamp" | "interval" | "unknown"`

- [ ] **Step 1: Write failing tests** for A.5 rows #1, #2, #4–#7, #9, #66 (E_TEXT_COLUMN, with an `ntext` column in the fixture), #78, #79, using the fixture catalogue.
- [ ] **Step 2: Run** `node --test test/dwh/names.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Without a catalogue, names fall back to mapping defaults and a single `W_NO_CATALOGUE` warning is returned.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): name mapping, catalogue model and scope resolution`.

### Task 1.4: Type inference and date/time rewrites

**Files:**
- Create: `src/dwh/convert/ir.ts` (T-SQL tree types), `src/dwh/convert/types.ts`, `src/dwh/convert/dates.ts`
- Test: `test/dwh/dates.test.ts`

**Interfaces:**
- Consumes: `ScopeInfo`, `SqlType` (1.3)
- Produces:
  - `inferType(expr: PgExpr, scope: ScopeInfo): SqlType`
  - `rewriteDateExpr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr | undefined` (returns `undefined` when the node is not date-related)
  - `interface RewriteCtx { mapping: DwhMapping; catalogue?: Catalogue; pinNow?: string; warnings: ConvertWarning[] }`

- [ ] **Step 1: Write failing tests**, comparing the returned IR with `assert.deepEqual` (the printed strings below show the intended shape; Task 1.6 adds string-level tests for the same cases): every row of the algebra table in A.4; the example line from A.4 exactly; all six real `(COALESCE(x.end_time, 0) * INTERVAL '1 minute')` sums produce `DATEADD(minute, COALESCE(...), CAST(DATEADD(day, ..., CAST('1971-12-31' AS date)) AS datetime2))`; the 7 h / 24 h chain order; `pinNow: "2026-11-10T00:00:00Z"` turns `CURRENT_DATE` into `CAST('2026-11-10' AS date)`; rejections #16, #17, #18; `W_UTC_TODAY` emitted once per query; `E_TYPE_UNKNOWN` for `DATE '1971-12-31' + (SELECT …)` when the subquery type is unknown.
- [ ] **Step 2: Run** `node --test test/dwh/dates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the algebra exactly as tabulated in A.4; no constant folding.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): type inference and date/interval rewrites`.

### Task 1.5: Remaining rewrites

**Files:**
- Create: `src/dwh/convert/rewrite.ts` (walks the whole query, delegates dates to 1.4)
- Test: `test/dwh/casts.test.ts`, `limit.test.ts`, `order.test.ts`, `strings.test.ts`, `arith.test.ts`, `aggregates.test.ts`, `functions.test.ts`, `window.test.ts`, `cte.test.ts`

**Interfaces:**
- Consumes: 1.2–1.4
- Produces: `rewriteQuery(ast: SelectAst, scope: ScopeInfo, ctx: RewriteCtx): IrQuery`

- [ ] **Step 1: Write failing tests**, one per A.5 row #10–#13, #21–#59, #61–#65, #77, #81, in the matching file. Real-query cases: `order.test.ts` asserts that the converted `extract_wp_seqs_steps.sql` orders `z_WP_SEQ_1ST` NULLs last; `cte.test.ts` converts the real `NOT EXISTS` query.
- [ ] **Step 2: Run** `node --test "test/dwh/*.test.ts"`. Expected: the new files FAIL.
- [ ] **Step 3: Implement.** `#37` needs `nullable` from the catalogue and "not from an outer-joined table" from the scope.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): LIMIT/ORDER/cast/string/aggregate rewrites`.

### Task 1.6: Printer, self-check, `convertQuery`

**Files:**
- Create: `src/dwh/convert/print.ts`, `src/dwh/convert/index.ts`
- Test: `test/dwh/print.test.ts`, `test/dwh/convert.test.ts`

**Interfaces:**
- Consumes: everything above; `lintSql` (`src/validate/sqlLint.ts`), `loadModel`
- Produces:
  - `printTsql(q: IrQuery): string`
  - `interface ConvertOptions { model: Model; csv: CsvIndex; mapping: DwhMapping; catalogue?: Catalogue; pinNow?: string; previewTop?: number }`
  - `interface ConvertResult { tsql: string; warnings: ConvertWarning[]; placeholders: { name: string; maxLength: number }[]; usedColumns: string[]; orderKeys: string[] }` (`maxLength` from the CSV column the placeholder literal is compared with, else 4000)
  - `convertQuery(source: string, filename: string, opts: ConvertOptions): ConvertResult` (throws `ConvertError`)
  - `CONVERTER_VERSION = 1`

- [ ] **Step 1: Write failing tests.** `print.test.ts`: #8, #10, #11, #12, #52; layout (one select item per line, LF, no trailing `;`). `convert.test.ts`: `converting twice gives identical bytes`; `every converted real query re-parses as T-SQL` (self-check); `self-check failure throws E_SELF_CHECK` (inject a printer that emits garbage); `probe_closed_dates.sql throws E_LINT with the lint messages`; `previewTop adds TOP (501) only to a plain outer SELECT without TOP`; `output passes assertReadOnlyTsql`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Self-check: replace the configured prefix's server part (`[DWH_DB]..`) with nothing, then `astify(..., {database: 'TransactSQL'})`. If the T-SQL grammar rejects a construct we legitimately emit, add a targeted normalisation in the self-check with a test, never skip it.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dwh): T-SQL printer, self-check and convertQuery`.

### Task 1.7: `dwh:convert` / `dwh:check`, manifest, docs

**Files:**
- Create: `src/dwh/cli.ts`, `src/dwh/sources.ts`, `queries/dwh/**` (generated), `queries/dwh/_manifest.json` (generated)
- Modify: `src/cli.ts` (dispatch `dwh:*` with a dynamic import, as for `stitch`; comment that `validate` deliberately skips `queries/dwh/`), `package.json` (scripts in A.10; `check` gains `&& npm run dwh:check`), `.gitignore` (`verify/`, `logs/`), `CLAUDE.md` (A.10 text, plus a line under Commands)
- Test: `test/dwh/cli.test.ts`

**Interfaces:**
- Consumes: `convertQuery` (1.6)
- Produces:
  - `listSources(root: string): string[]` (root `*.sql` except `AMOS-WO.sql`, plus `queries/wp_seqs/*.sql`; sorted; the same list `validate` uses)
  - `generateAll(root: string): Map<string, string>` (output path → content, including the manifest)
  - `dwhConvert(root: string): { written: string[]; removed: string[]; refused: string[] }`
  - `dwhCheck(root: string): string[]` (stale paths; empty = fresh)

- [ ] **Step 1: Write failing tests**: `generateAll is stable across runs`; `manifest lists the two probe files as refused with E_LINT`; `dwhCheck reports a hand-edited generated file`; `dwhCheck reports a generated file whose source was deleted`; `header contains source hash and warning codes and no date`.
- [ ] **Step 2: Run** `node --test test/dwh/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run dwh:convert` to create `queries/dwh/`.
- [ ] **Step 4: Run** `npm test && npm run dwh:check && npm run typecheck`. Expected: all PASS. (`npm run check` will still fail at `validate` because of the two probe files, A.2 #5.)
- [ ] **Step 5: Review by hand** three generated files (`extract_wp_seqs_steps`, `extract_parts_standalone_no_cml_no_alternate`, `list_all_seq_in_a_single_wp_3_levels_w_sts`) against their sources, and paste one into this conversation for you to look at.
- [ ] **Step 6: Commit** `feat(dwh): dwh:convert and dwh:check with generated queries/dwh`.

**Phase 1 test plan:** about 150 unit tests across the A.5 rows, golden checks over all 27 real sources, determinism, safety list. Exit: `npm test`, `npm run typecheck`, `npm run dwh:check` all pass; you have seen one converted file.

## Phase 2 — Runner, catalogue, schema diff

### Task 2.1: Connection, read-only runner, value formatting

**Files:**
- Create: `src/dwh/db.ts`, `src/dwh/format.ts`, `src/dwh/run.ts`
- Test: `test/dwh/run.test.ts` (with a fake `mssql` request object; no network), `test/dwh/format.test.ts`

**Interfaces:**
- Consumes: `convertQuery`, `assertReadOnlyTsql`
- Produces:
  - `dwhConfigFromEnv(env: NodeJS.ProcessEnv): sql.config` (throws `ConfigMissing` naming the missing variable, never its value; settings from A.8 #4)
  - `interface RunOptions { mode: "preview" | "export"; params: Record<string, string>; signal?: AbortSignal }`
  - `interface RunHandle { columns: { name: string; type: string }[]; rows: AsyncIterable<unknown[]>; truncated: () => boolean; done: Promise<{ rowCount: number; ms: number }> }`
  - `runConverted(pool: sql.ConnectionPool, conv: ConvertResult, opts: RunOptions): Promise<RunHandle>` (replaces each string-literal token `'<NAME>'`, found with `lex`, by `@NAME` and binds it as `VarChar(maxLength)`; streaming, `arrayRowMode`, cap 501 / `exportRowLimit`, cancels on abort or cap)
  - `formatCell(v: unknown, type: string): string`, `csvHeaderBytes(): Buffer` (BOM), `csvLine(cells: string[]): string` (all quoted, CRLF)

- [ ] **Step 1: Write failing tests**: `placeholder value is trimmed and bound, quote survives` (`" 2-VNAB-090926-CHK-STO\t"` → bound `2-VNAB-090926-CHK-STO`; `O'Brien` stays a parameter value); `empty placeholder value is refused`; `empty result keeps column names`; `duplicate column names are kept by position`; `preview stops at 501 rows and cancels`; `query that fails the safety scan never reaches the pool`; `csv has BOM and round-trips Vietnamese` (`"Kiểm tra động cơ"`); `date formats as YYYY-MM-DD in UTC regardless of TZ` (run with `process.env.TZ = "Asia/Ho_Chi_Minh"`); `datetime2 formats YYYY-MM-DD HH:MM:SS.fff`; `decimal kept as exact string`; `bit → 1/0`; `config error names the variable but not its value`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Live smoke test** (read-only, with your OK): `npm run dwh:run -- list_all_seq_in_a_single_wp_3_levels_w_sts.sql --param INSERT_WPNO_HERE=<a WP you choose>`. Expected: a table and a row count.
- [ ] **Step 6: Commit** `feat(dwh): read-only runner and CSV formatting`.

### Task 2.2: Catalogue fetch and schema diff

**Files:**
- Modify: `src/dwh/catalogue.ts` (add fetch)
- Create: `src/dwh/schemaDiff.ts`, `dwh/catalogue.json` (generated), `docs/generated/dwh-schema-diff.md` (generated)
- Test: `test/dwh/schemaDiff.test.ts`

**Interfaces:**
- Produces:
  - `fetchCatalogue(pool: sql.ConnectionPool, mapping: DwhMapping): Promise<Catalogue>` (query form chosen in Phase 0.3; result sorted by table, ordinal)
  - `interface SchemaIssue { kind: "missing_table" | "missing_column" | "case_only" | "retyped" | "truncation_risk" | "legacy_text" | "maybe_lost_unicode" | "extra_column"; severity: "error" | "warning" | "info"; table: string; column?: string; amos?: string; dwh?: string; plain: string }`
  - `diffSchema(cat: Catalogue, csv: CsvIndex, model: Model, used: string[]): SchemaIssue[]`; `renderDiffMarkdown(issues: SchemaIssue[], cat: Catalogue): string`

- [ ] **Step 1: Write failing tests**, one per issue kind and per compatibility-table row in A.6, from a fixture catalogue; `markdown is stable`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, wire `dwh:catalogue` and `dwh:schema-diff`, add the diff file to `dwhCheck`.
- [ ] **Step 4: Run** tests, then (with your OK) `npm run dwh:catalogue && npm run dwh:schema-diff && npm run dwh:convert`. Expected: snapshot written, diff doc written, `queries/dwh/` regenerated with exact-case names.
- [ ] **Step 5: Commit** `feat(dwh): catalogue snapshot and schema diff`.

### Task 2.3: Plain-language errors

**Files:**
- Create: `src/dwh/errorsPlain.ts`
- Test: `test/dwh/errorsPlain.test.ts`

**Interfaces:**
- Produces: `toPlain(err: unknown): { message: string; detail: string }` (the table in A.9; `detail` is scrubbed of server, user and password values from `process.env`)

- [ ] **Step 1: Write failing tests**: one per table row in A.9 using fake errors with the listed numbers/codes; `detail never contains DWH_SERVER, DWH_USER or DWH_PASSWORD values` (set fake env values and include them in the error text).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(dwh): plain-language error messages`.

### Task 2.4: `dwh:run` CLI, expression probes, retire old scripts

**Files:**
- Modify: `src/dwh/cli.ts`
- Create: `test/dwh/fixtures/expr-probes.json`, `src/dwh/probeExprs.ts`, `test/dwh/fixtures/example_steps.sql` (moved from `scripts/`)
- Delete: `scripts/dwh.ts`, `scripts/example_steps.sql` (`test_db.js` is already gone)
- Test: `test/dwh/probeExprs.test.ts` (the JS reference against the fixture)

**Interfaces:**
- Produces: `dwh:run <source.sql> [--param K=V] [--csv out.csv] [--raw]`; `dwh:probe-exprs` printing PASS/FAIL per probe.

- [ ] **Step 1: Write failing test** `JS reference matches every expected value in expr-probes.json` (month-end clamp, minutes on a date, DATEDIFF across a year boundary, NULL ordering on a VALUES list, integer division, `COUNT_BIG` type).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Live run** (with your OK) `npm run dwh:probe-exprs`. Expected: all PASS. You run the PostgreSQL versions once in AMOS (one `SELECT`, printed by `dwh:probe-exprs --pg`) and confirm the values.
- [ ] **Step 6: Commit** `feat(dwh): dwh:run CLI and engine expression probes`.

**Phase 2 test plan:** unit tests with fakes for everything above; live, read-only smoke runs of three real queries with `TOP` preview; expression probes on both engines. Exit: you can run any converted query from the command line and get a CSV that opens correctly in Excel.

## Phase 3 — Result verification

### Task 3.1: Frozen-clock verification pack

**Files:**
- Create: `src/dwh/verifyPack.ts`, `dwh/verify-keys.yaml` (you pick the WPs; I propose candidates from a read-only query)
- Test: `test/dwh/verifyPack.test.ts`

**Interfaces:**
- Produces: `pinPg(source: string, at: string, params: Record<string, string>): string` (splices at parser offsets); `writeVerifyPack(root: string, source: string, at: string, params: Record<string, string>): { amosSql: string; dwhSql: string }`

- [ ] **Step 1: Write failing tests**: `pinPg changes only the CURRENT_* tokens` (diff of input and output touches only those offsets); `pinPg escapes a quote in a parameter`; `pinned T-SQL uses the same instant`; `--at later than the freshness estimate is refused` (estimate passed in).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(dwh): frozen-clock verification packs`.

### Task 3.2: Compare and report

**Files:**
- Create: `src/dwh/compare.ts`
- Modify: `src/stitch/stitch.ts` only to export what is needed (no behaviour change; `test/stitch.test.ts` must still pass)
- Test: `test/dwh/compare.test.ts`

**Interfaces:**
- Consumes: `parseCsv`, `normalizeCell` (stitch)
- Produces: `interface CompareReport { headerMatch: boolean; counts: { amos: number; dwh: number }; onlyAmos: number; onlyDwh: number; differingColumns: string[]; cellDiffs: { key: string; column: string; amos: string; dwh: string; kind: DiffKind }[]; orderSame: boolean; driftKeys: string[]; pass: boolean }`; `compareResults(amos: Table, dwh: Table, keys: string[], orderKeys: string[]): CompareReport`; `renderReport(r: CompareReport): string`. `DiffKind = "whitespace" | "case" | "null_vs_empty" | "number_format" | "truncated" | "tz_shift_7h" | "changed"`.

- [ ] **Step 1: Write failing tests**: one per `DiffKind`; `lower-case AMOS header matches z_ header`; `apostrophe thousands separators equal`; `ties in sort keys don't count as order differences` (#40); `float shortest round-trip equal` (#81); `long text truncated is detected` (#67); `pass is true only with no diffs beyond number_format/whitespace`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Live verification** of `list_all_seq_in_a_single_wp_3_levels_w_sts.sql` and `extract_wp_seqs_steps.sql` with your AMOS exports. Expected: PASS, or every difference explained by drift.
- [ ] **Step 6: Commit** `feat(dwh): AMOS vs DWH result comparison`.

**Phase 3 test plan:** unit tests above; live verification of every query in `queries/dwh/` on the fixed keys. Exit: a `verify/<name>/report.md` with PASS for each, and the freshness estimate recorded.

## Phase 4 — The page

### Task 4.1: Local server

**Files:**
- Create: `src/dwh/server.ts`
- Test: `test/dwh/server.test.ts` (starts the server on a random port against a fake engine)

**Interfaces:**
- Consumes: `listSources`, `convertQuery`, `runConverted`, `toPlain`, `diffSchema`, `compareResults`
- Produces:
  - `interface ShareConfig { share: boolean; hostNames: string[]; allowCidrs: string[]; pfxPath?: string; codeHash?: string; codeSalt?: string }`; `loadShareConfig(path: string): ShareConfig` (missing file → `{ share: false, ... }`)
  - `startServer(opts: { root: string; share: ShareConfig; engine: QueryEngine; port?: number }): Promise<{ url: string; close(): Promise<void> }>` (throws `ShareNotReady` naming what is missing when `share` is true without certificate or code)
  - HTTP routes (JSON unless noted): `GET /` (page; login form in shared mode until the session exists), `POST /login {code}`, `GET /health` → `{ app: "amos-dwh-runner", version }`, `GET /api/sources`, `POST /api/convert {path}` → `{ pg, tsql, warnings, placeholders, schemaIssues, freshness }`, `POST /api/run {path, params}` → rows (preview), `POST /api/export {path, params}` → CSV stream, `POST /api/stop`, `POST /api/compare` (multipart CSV upload, 200 MB limit), `POST /api/catalogue/refresh` (host only), `POST /api/quit` (host only).

- [ ] **Step 1: Write failing tests**: `unshared binds to 127.0.0.1 only`; `shared without certificate or code refuses to start`; `shared serves HTTPS only` (test certificate generated in the test with `node:crypto` + fixture PFX); `wrong Host header → 403` (both modes); `missing or wrong token → 403`; `shared: no session → login page; wrong code → 401; right code → cookie with HttpOnly, Secure, SameSite=Strict`; `five wrong codes lock the IP for 15 minutes`; `IP outside allowCidrs → 403`; `quit and catalogue refresh from a non-loopback address → 403`; `a second run from the same visitor while one is running → 429 with the busy message`; `fifth concurrent run overall → 429`; `path outside the source list → 400` (`../.env`, `C:\x.sql`); `server re-converts after the source changes on disk`; `aborted export marks the file incomplete` (last line `"-- INCOMPLETE: <plain reason>"` and the response ends with an error); `no response ever contains the fake DWH_PASSWORD value`; `log line has time, IP, path, params, row count`; `/health signature lets the launcher detect a running copy`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(dwh): local runner server`.

### Task 4.2: Page

**Files:**
- Create: `src/dwh/ui/index.html`, `src/dwh/ui/app.js`, `src/dwh/ui/style.css`
- Test: manual acceptance script `docs/dwh-runner-acceptance.md` (below); a smoke test in `server.test.ts` that `/` serves the page with the token and the CSP header

- [ ] **Step 1:** Build the layout from the sketch in A.9; system font, no external assets (CSP `self`), works at 1280×720 and wider.
- [ ] **Step 2:** Walk through the acceptance script with a fake engine (`DWH_FAKE=1`), then with the real DWH.
- [ ] **Step 3: Commit** `feat(dwh): runner page`.

### Task 4.3: Launcher, shortcut, sharing setup, user guide

**Files:**
- Create: `Start DWH Runner.cmd`, `src/dwh/shortcut.ts` (PowerShell `WScript.Shell` call that writes `%USERPROFILE%\Desktop\DWH Runner.lnk`; `--startup` writes it to the Startup folder instead), `src/dwh/shareSetup.ts` (prompts for the access code without echo, stores the scrypt hash and salt; uses an IT-supplied PFX if given, else runs PowerShell `New-SelfSignedCertificate` for the PC's names and exports a PFX into `dwh/local/`; writes `dwh/local/share.json`), `docs/dwh-runner-guide.md` (plain-language guide with screenshots: host part and colleague part)
- Modify: `package.json` (`dwh:shortcut`, `dwh:autostart`, `dwh:share-setup`)
- Test: `test/dwh/shareSetup.test.ts` (hash verifies the code; no plain code is written anywhere; the PowerShell command line is built correctly, without running it); acceptance script items 1–3 and 12–15

- [ ] **Step 1:** Write failing `shareSetup.test.ts`, run (FAIL), implement, run (PASS).
- [ ] **Step 2:** Write the launcher with the checks and messages in A.9; it starts shared mode when `dwh/local/share.json` says so and prints the address colleagues should use.
- [ ] **Step 3:** Run `npm run dwh:shortcut`; double-click the shortcut. Expected: browser opens on the page; a second double-click opens the browser only.
- [ ] **Step 4:** With you: `npm run dwh:share-setup`, restart, open the page from a second PC on the WAN.
- [ ] **Step 5: Commit** `feat(dwh): Windows launcher, sharing setup and guide`.

**Acceptance script (`docs/dwh-runner-acceptance.md`)**, done by you, not me: (1) double-click the shortcut, page opens; (2) rename `.env` temporarily → plain message; (3) disconnect VPN → plain message; (4) pick a ✓ query, Run preview, see rows; (5) pick the WPNO query, run with a pasted value with a trailing space; (6) Download all as CSV, open in Excel, Vietnamese text reads correctly; (7) pick a ✗ query, see why; (8) edit a source in VS Code, re-select, see the change; (9) Stop a long download; (10) Compare with an AMOS export; (11) Quit; (12) from a colleague's PC, open the address, get past the certificate notice, enter the code; (13) wrong code five times → locked message; (14) colleague does not see Quit or Refresh catalogue; (15) two people run at once, both get results or a clear "busy" message.

**Phase 4 test plan:** server security and behaviour tests above; the acceptance script. Exit: you complete the script without help.

## Phase 5 — dropped

Direct AMOS access is not available (your answer to Q1), so there is no AMOS engine. The `QueryEngine` interface keeps the door open (A.9).

---

# Part C — Open questions and risks

## Open questions

All five were answered on 2026-11-17 (see the top of this file). No open questions remain that block Phase 0 or Phase 1. Two things to settle before Phase 4, neither changes earlier phases:
- Ask IT whether they can issue a certificate for the host PC (otherwise colleagues see a one-time browser warning), and whether sharing DWH data this way, under one login, is allowed.
- Choose the access code and who receives it.

Decisions I made that you may want to override: output column names keep the source spelling (`z_WP_ID`), not AMOS's lower case; preview is 500 rows, downloads are capped at 2,000,000; string comparisons get a warning rather than forced case-sensitivity (#41); the query list covers root files plus `queries/wp_seqs/`; generated files live in `queries/dwh/`; the plan and design share this one file instead of `docs/superpowers/...`.

## Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Linked-server queries (mandatory) pull whole remote tables before joining, so real queries are very slow or time out | Medium / high | Phase 0.6 timing; preview `TOP`; keep `strict_string_compare` off by default; if too slow, ask the DWH administrator about the linked server's "collation compatible" and remote-query settings |
| R2 | Unknown ETL schedule: DWH results differ from AMOS because of timing, and look like converter bugs | High / medium | Freshness estimate in the page header; frozen-clock verification; drift grouping in reports |
| R3 | DWH renames/retypes columns, or the snapshot goes stale | Medium / medium | Schema diff before every run; refresh button; refusal codes #78/#79 |
| R4 | Collation differences: case-insensitive equality, trailing spaces, string sort order | Medium / medium | Warnings #39/#41/#42; BIN2 ordering when AMOS is `C`; verification catches the rest |
| R5 | `node-sql-parser` mis-parses something, or changes AST shape on upgrade | Low / high | Exact version pin; allow-list `default` throws; golden tests over all real queries; T-SQL self-check |
| R6 | Silent value changes in the driver: decimals beyond 15 digits, `datetime2` truncated to ms, dates shifted by local time | Medium / medium | Type-aware `formatCell` (decimals as strings, UTC getters); tests with `TZ=Asia/Ho_Chi_Minh` |
| R7 | AMOS date sentinels beyond 9999-12-31 make SQL Server error out | Low / low | Phase 0.5 range probe; plain message |
| R8 | An app bug sends a write | Very low / high | The login is read-only (confirmed in Phase 0.4); plus two independent app gates (allow-list + token scan); only converter output runs |
| R9 | The DWH password was in plain text in `test_db.js` and appeared in this session's output | Present / medium | File deleted; ask the DBA to change the password, then update `.env` |
| R10 | Source queries carry their own semantic quirks (UTC "today", A.2 #8) that the converter faithfully copies | Present / low | `W_UTC_TODAY` warning; fixing sources is a separate decision |
| R11 | AMOS CSV export formatting makes comparisons noisy | Medium / low | Reuse the stitcher's proven normalisation; classified diff kinds |
| R12 | Non-technical setup failures: Node missing or upgraded, port taken, `.env` absent | Medium / medium | Launcher checks with plain messages; single-instance detection; acceptance script |
| R13 | Large downloads exhaust memory | Low / medium | Streaming end to end; hard row limit |
| R14 | Shared on the WAN: anyone with the access code reads DWH data under one login, with no per-person DWH audit | Medium / medium | Access code + lockout + optional network allow-list; HTTPS; audit log with IP; confirm with IT that this is allowed |
| R15 | Host PC asleep, off or restarted: colleagues can't use the page | High / low | Autostart in the Startup folder; power setting in the guide; colleagues get the browser's "can't connect" page, explained in the guide |
| R16 | Firewall or certificate setup needs IT / admin rights | Medium / medium | One `netsh` command for IT; self-signed fallback; unshared mode works for you meanwhile |
| R17 | One person's huge export slows the DWH for everyone | Medium / low | One running query per visitor, four in total, timeouts, export row limit |

---

# Phase 0 findings (2026-11-17)

Probes 0.1–0.6 were read-only SELECTs and catalogue procedures run through `scripts/dwh.ts`; 0.7 was run by you in AMOS. Values are recorded in `dwh/mapping.yaml`.

## What we found

| Probe | Result |
|---|---|
| 0.1 | Relay is **SQL Server 2016 RTM** (Enterprise). Collation `SQL_Latin1_General_CP1_CI_AS` (case-insensitive). Server local clock is UTC+7; `SYSUTCDATETIME()` is UTC. |
| 0.2 | `DWH_DB` is a linked **Oracle** database (`OraOLEDB.Oracle`), not SQL Server. `uses_remote_collation = true`, `is_collation_compatible = false`. |
| 0.3 | `[DWH_DB]..INFORMATION_SCHEMA.COLUMNS` fails (error 7314). `EXEC sp_columns_ex` works but repeats text columns once per Oracle type name. `OPENQUERY(DWH_DB, 'SELECT … FROM ALL_TAB_COLUMNS WHERE OWNER = ''STG_AMOS''')` works and is clean. Names are upper case; date/time columns are Oracle `NUMBER` (whole numbers). Lower-case names also resolve in four-part queries. |
| 0.4 | Not sysadmin, no CONTROL SERVER: the login is read-only (R8 stays low). |
| 0.5 | `WP_HEADER.mutation` is a date int: max = 2026-11-17, `mutation_time` max = 09:22:10 UTC, i.e. the DWH is **current to within minutes** (R2 is much smaller than feared). `start_date` 2001-03-07 … 2200-07-03, `end_date` max 2200-07-04: sentinel-like but far below 9999-12-31 (R7 low). |
| 0.6 | Single-table count: 1–3 s. Hand-converted 4-table `example_steps.sql` (`TOP 20`): **37–68 s**. Trimmed 7-table steps query (`TOP 50`): **timed out at 120 s**. R1 is real; the slowness is in multi-table joins and `ORDER BY`, not the link itself. |
| 0.7 | AMOS `datcollate = datctype = en_US.UTF-8` (not C/POSIX) → `amos_collation: other`. The `current_setting('TimeZone')` result was **not provided**; the UTC assumption (#19) is still unconfirmed on the AMOS side. |
| extra | `STG_AMOS` holds only 59 objects. **6 of the 20 tables used by repo queries are missing:** `wp_status`, `wp_department_link`, `cml_reference`, `oem_doc_partno`, `taskcard_coversheet_info`, `time_captured_history`. Affected: both split WP-sequences templates (so all 12 generated files), `extract_han_workpacks_*`, `extract_wp_materials`, `extract_wp_seqs_parameterized`, the timebookings-history queries, the parts and taskcard queries. |

## Where this contradicts the plan, and the proposed changes (NOT applied, awaiting approval)

1. **The target is Oracle, not SQL Server.** The plan assumes SQL Server behaviour behind the link. Proposed: add a short "Oracle target" note to Part A and keep the converter's output as T-SQL for the relay, but (a) treat every string comparison, `DISTINCT`, `ORDER BY` and `GROUP BY` on text as possibly decided by Oracle (case-sensitive, binary) or by the relay (case-insensitive), so `W_STRING_COMPARE` and `W_STRING_ORDER` apply to all of them; (b) the schema diff (A.6) must read Oracle types as the relay reports them (`NUMBER`, `VARCHAR2`, `NVARCHAR2`, `CLOB`, `DATE`), not SQL Server types; (c) Oracle treats an empty string as NULL, so add a warning for `= ''` and `IS NULL` on text.
2. **Catalogue form.** Use `OPENQUERY … ALL_TAB_COLUMNS` (third in A.6's list, now first choice). The output gate (A.8) must allow `OPENQUERY` for this one fixed query only.
3. **Missing tables.** Six AMOS tables do not exist in the DWH, so many source queries can never run there. Proposed: the converter checks tables against the catalogue first and refuses with `E_MISSING_IN_DWH` naming the table; the manifest and the page show those queries as "not available in the DWH"; ask the DWH administrator whether the six tables can be added to `STG_AMOS`. Until then Phase 1's golden tests only cover queries whose tables exist.
4. **Speed (R1).** Plan mitigations (preview caps, `TOP`) are not enough: `TOP` does not stop SQL Server pulling the joined tables across the link. Options to decide before Phase 2: (a) accept and show a "slow" notice; (b) have the converter send the whole query to Oracle with `OPENQUERY` (Oracle does the joins; needs an Oracle-SQL printer, a large addition); (c) ask the DWH administrator about linked-server settings or a view. I recommend asking the administrator first and deciding after seeing the answer.
5. **Freshness (A.7 #5).** Use `MAX(mutation)` + `MAX(mutation_time)` on one table (done above), but since the DWH is near real time, the frozen-clock step can use a recent time and "drift" is expected to be small.
6. **SQL Server 2016 limits.** No `STRING_AGG`, `GREATEST`/`LEAST`, `DATETRUNC`, `IS DISTINCT FROM`: all are already rejected (#23, #25, #75), so no change.
7. **Still open:** AMOS `TimeZone` (probe 0.7, first statement).
