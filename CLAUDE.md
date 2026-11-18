# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tooling for extracting and validating data from the AMOS aviation-MRO database (PostgreSQL syntax, ~45k columns, cryptic names). There is no application runtime: the deliverables are `.sql` extraction queries in the repo root, backed by a **logical schema** (`schema/*.yaml`) and a TypeScript CLI that lints every query against that schema. Queries are for probing/validating data; the end goal is software that pulls raw data and validates it in code. See [README.md](README.md) and [SESSION_CONTEXT.md](SESSION_CONTEXT.md) (accumulated domain knowledge — read it before writing queries).

## Commands

Node >= 24 (TypeScript is run directly via `node src/cli.ts`, no build step).

- `npm run validate` — lint every root `*.sql` and `queries/wp_seqs/*.sql` against `schema/` + the physical CSV (errors → exit 1)
- `npm run docs` — regenerate `docs/generated/schema.md` (tables + Mermaid ERD) from `schema/`; `npm run docs:check` fails if it is stale
- `npm run typecheck` — `tsc --noEmit`
- `npm run check` — typecheck + test + validate + docs:check + dwh:check
- `npm test` globs `test/**/*.test.ts` (converter tests live in `test/dwh/`). Single test: `node --test test/path/file.test.ts`.
- `npm run dwh:convert` — converts every root `*.sql` and `queries/wp_seqs/*.sql` into Oracle SQL under `queries/dwh/` plus `queries/dwh/_manifest.json` (no database). `npm run dwh:check` fails if those files are stale or hand-edited. Order: scaffold → validate → dwh:convert.
- DWH, read-only through the relay (settings from `.env`; ask before running any of them): `npm run dwh:run -- <source.sql> [--param NAME=value] [--at 2026-11-10T06:00:00Z] [--csv out.csv]` (preview 500 rows, or the whole result as a UTF-8 CSV; `--at` freezes "now"), `npm run dwh:run -- --raw <oracle.sql> [--csv out.csv]` (a hand-written Oracle file, still read-only checked), `npm run dwh:catalogue` (writes `dwh/catalogue.json`), `npm run dwh:compile-all` (zero-row check of every available query), `npm run dwh:probe-exprs` (`--pg` prints the AMOS versions, offline). Offline: `npm run dwh:schema-diff` (writes `docs/generated/dwh-schema-diff.md` from the catalogue).
- Result verification (AMOS vs DWH, offline; plan A.7): `npm run dwh:verify-pack -- <source.sql> [--at …] [--param K=V]` writes `verify/<name>/{amos.sql,dwh.sql,pack.json}` with "now" frozen and prints the next steps; the user runs `amos.sql` in AMOS and exports `amos.xlsx` or `amos.csv`; then `npm run dwh:compare -- <amos.xlsx|amos.csv> <dwh.csv> [--key=COL] [--amos-rows N] [--within rows.csv]` writes `report.md`. Fixed keys per query live in `dwh/verify-keys.yaml`; `--within` limits the check to listed keys (e.g. rows unchanged since an AMOS test copy was taken). `verify/` is git-ignored. The AMOS the user can query is a test copy (~2026-10-01), older than the DWH.
- The page (plan Phase 4; guide: [docs/dwh-runner-guide.md](docs/dwh-runner-guide.md)): `Start DWH Runner.cmd` or `npm run dwh:ui` serves `src/dwh/server.ts` + `src/dwh/ui/` on `http://localhost:4870` (127.0.0.1 only unless `dwh/local/share.json` switches sharing on; `DWH_FAKE=1` = made-up rows, no DWH). It reads the DWH (runs, downloads, compare, and, only with `DWH_FRESHNESS=1`, a 5-minute freshness read of `WP_HEADER.MUTATION`), so the same approval rule applies. `npm run dwh:shortcut` / `dwh:autostart` make Windows shortcuts; `npm run dwh:share-setup` (asks for the access code, makes or takes a certificate) is the host's to run. Tests use fake engines only.
- `npm run scaffold` — renders `queries/wp_seqs/<DEPT>_{steps,parts}.sql` from the root `extract_wp_seqs_{steps,parts}.sql` templates and `queries/wp_seqs/pairs.json`. Edit the templates, never the generated files.
- `npm run stitch -- steps.csv parts.csv out.csv` rebuilds the flat WP-sequences output from the split queries; `npm run stitch:compare -- legacy.csv [more.csv] stitched.csv` checks it. See [docs/wp-seqs-split-extraction.md](docs/wp-seqs-split-extraction.md).
- `npm run docs:check` currently regenerates the docs instead of only checking (the script passes `--check`, the CLI expects the `docs:check` command).

## Architecture

Two sources of truth, deliberately split (see [schema/_conventions.yaml](schema/_conventions.yaml)):

- **Physical truth** — `Database-Description-AMOS-csv.csv` (raw AMOS export). Never copied into `schema/`; [src/schema/csv.ts](src/schema/csv.ts) indexes it at load time to confirm tables/columns exist.
- **Logical truth** — `schema/*.yaml` (one file per entity: workpack, wp_item, workorder, workstep, timebooking, part_request), validated by `schema/entity.schema.json` (ajv). Holds logical names, approved aliases, joins/cardinality, trust levels, findings. [src/schema/load.ts](src/schema/load.ts) builds the model; [src/validate/sqlLint.ts](src/validate/sqlLint.ts) parses SQL with `node-sql-parser` and checks it; [src/docs/generate.ts](src/docs/generate.ts) emits the docs.

Key schema semantics: a field's `name_status` is `approved` / `proposed` / `unnamed`; only `approved` names may be aliased in SQL, as `z_` + UPPERCASE(name) (e.g. `wp_id` → `z_WP_ID`). Names are globally unique across entity files. Trust levels: `documented` (in CSV), `probed` (verified on live DB), `unusable` (see `use_instead`).

The `extract_*.sql` files with `<INSERT_WPNO_HERE>` placeholders are substituted by the CLI before parsing. `docs/legacy/AMOS-WO.sql` is superseded — don't use it. Ad-hoc `scratch_probe.ts` / `search_*.ts` at the root are throwaway probes.

## Querying rules (enforced; from `.agents/rules/querying_rules.md`)

- Read `schema/` and `docs/generated/schema.md` first; never invent columns, aliases or JOINs. If the schema lacks the needed relationship, stop and tell the user: *"I do not have the knowledge in the schema to fulfill this request. I need to know how X connects to Y."*
- **No table aliases** — always full table names. Column aliases only when user-approved, and then `z_`-prefixed + CAPITALIZED. You may *propose* names but cannot use them until approved.
- **No column combining** (no `CONCAT`, `||`); ask first if a request implies it. Keep extraction 1:1 with the DB.
- On a new discovery: verify against the CSV → update the YAML in `schema/` → `npm run docs` → `npm run validate` → then write the SQL.

## AMOS data gotchas

- Dates are ints = days since **1971-12-31**: `DATE '1971-12-31' + col::integer`. `TIMI` columns are ms since midnight; `TIME` columns (e.g. `time_captured.start_time`, `duration`) are **minutes**.
- DB `CURRENT_TIMESTAMP` is UTC; offset (e.g. `+ INTERVAL '7' HOUR`) before comparing to local-time AMOS ints.
- `wp_header.wp_status` is present-day status — for historical "active on date" queries filter by `start_date`/`end_date`, not status. Closed WPs only populate `end_date`, not `act_end_date`/`act_end_time`.
- `wo_header` is a universal container (work orders, templates, event pendings, jobcards, shopcards).
- Step text: always select `wo_text_description.header`, `.text`, `.text_html` together (`text` is NULL unless saved as plain text).
- `wp_history` is an append-only log; joining it multiplies rows 1:N. Use `wo_event_link` for sequence titles.
- Item numbering: `wp_sequence.seqno_prefix_i` . `wp_sequence.seqno` (e.g. 3.23), then `workstep_link.sequenceno` orders worksteps within the item.

## DWH workflow

- The DWH is an **Oracle** staging copy of AMOS (schema `STG_AMOS`) behind a SQL Server 2016 linked server `DWH_DB`. Queries go through it as pass-through Oracle SQL, never as four-part T-SQL. Credentials only in `.env`; never print, log or commit them.
- Write and validate queries in PostgreSQL as usual, then `npm run dwh:convert`. Never hand-edit `queries/dwh/`; `npm run dwh:check` (part of `npm run check`) fails if it is stale.
- The converter refuses sources with lint errors and anything it cannot translate exactly (catalogue: docs/dwh-converter-plan.md §A.5). Change the source or extend the converter with a test; never edit generated files.
- Some AMOS tables are missing in the DWH; see `docs/generated/dwh-schema-diff.md`. Refresh with `npm run dwh:catalogue`, then `npm run dwh:schema-diff` and `npm run dwh:convert`. Until `dwh/catalogue.json` exists, availability comes from `dwh_facts.amos_tables_missing_in_dwh` in `dwh/mapping.yaml` (tables only).
- In `openquery` mode (RPC Out off) the runner refuses duplicate result names, `SELECT *` and unnamed formulas, and placeholder values outside `A-Z a-z 0-9 space . _ / -`.
- Only `SELECT`/`WITH` ever runs, through `dwh:run` or the page. Never run writes on either database.
- The DWH keeps rows that were deleted in AMOS (seen 2026-11-18: removed workpack items in `WP_ASSIGNMENT`, and apparently deleted workpacks), so DWH counts are equal to or higher than AMOS. Known and accepted; never report it as a converter error.
- "Now"/"today" are UTC on both sides (`SYS_EXTRACT_UTC(SYSTIMESTAMP)`); never emit `SYSDATE` or Oracle `CURRENT_DATE`. Oracle treats `''` as NULL.

## Known repo quirk

[.agents/hooks.json](.agents/hooks.json) points at `.\scripts\enforce_context.json`, but the file lives at `.agents/scripts/enforce_context.json`; it is an agent-hook that tells agents to read SESSION_CONTEXT.md first.
