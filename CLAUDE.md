# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tooling for extracting and validating data from the AMOS aviation-MRO database (PostgreSQL syntax, ~45k columns, cryptic names). There is no application runtime: the deliverables are `.sql` extraction queries in the repo root, backed by a **logical schema** (`schema/*.yaml`) and a TypeScript CLI that lints every query against that schema. Queries are for probing/validating data; the end goal is software that pulls raw data and validates it in code. See [README.md](README.md) and [SESSION_CONTEXT.md](SESSION_CONTEXT.md) (accumulated domain knowledge — read it before writing queries).

## Commands

Node >= 24 (TypeScript is run directly via `node src/cli.ts`, no build step).

- `npm run validate` — lint every root `*.sql` and `queries/wp_seqs/*.sql` against `schema/` + the physical CSV (errors → exit 1)
- `npm run docs` — regenerate `docs/generated/schema.md` (tables + Mermaid ERD) from `schema/`; `npm run docs:check` fails if it is stale
- `npm run typecheck` — `tsc --noEmit`
- `npm run check` — typecheck + test + validate + docs:check
- `npm test` globs `test/**/*.test.ts`, but no `test/` directory exists yet. Single test: `node --test test/path/file.test.ts`.
- `npm run scaffold` — renders `queries/wp_seqs/<STATION>-<DEPT>_{steps,parts}.sql` from the root `extract_wp_seqs_{steps,parts}.sql` templates and `queries/wp_seqs/pairs.json`. Edit the templates, never the generated files.
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

## Known repo quirk

[.agents/hooks.json](.agents/hooks.json) points at `.\scripts\enforce_context.json`, but the file lives at `.agents/scripts/enforce_context.json`; it is an agent-hook that tells agents to read SESSION_CONTEXT.md first.
