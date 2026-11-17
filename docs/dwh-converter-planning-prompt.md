# Prompt: plan the PostgreSQL → DWH (T-SQL) converter and a simple UI

Paste everything below the line into a fresh Claude Code session opened in `h:\AMOS-Extractor`, on the most capable model. Ask it to **plan first, not build**.

---

You are planning a small tool for a non-technical user. Do NOT write code yet. Produce a reviewed plan (use the brainstorming skill, then writing-plans), and ask me questions only where my answer would change the plan.

## Read first
`CLAUDE.md`, `SESSION_CONTEXT.md`, `README.md`, `schema/_conventions.yaml`, `src/validate/sqlLint.ts`, `scripts/dwh.ts`, `scripts/example_steps.sql`, `test_db.js`, and the root `*.sql` files (they are the real-world inputs).

## Situation
- The user explores and validates data on the **AMOS PostgreSQL database** first, writing PostgreSQL in the repo's `*.sql` files under the repo's strict querying rules (no table aliases, `z_`-prefixed approved column aliases only, no column combining, schema-checked by `npm run validate`).
- Once a query is right, the user wants to run the **same query against the remote DWH**, a **SQL Server** database that holds a staging copy of AMOS. The user does not know programming and wants a UI, not a terminal.
- Verified facts about the DWH (probed 2026-11-17):
  - Connects with the `mssql` npm package, `trustServerCertificate: true`. Credentials live in the gitignored `.env` (`DWH_SERVER`, `DWH_USER`, `DWH_PASSWORD`). Never print or commit them, and never put them in the browser.
  - Login lands in database `master`. Tables are reached through a **linked server**: `[DWH_DB]..[STG_AMOS].[WO_HEADER]` works; `[DWH_DB].[STG_AMOS].[WO_HEADER]` fails.
  - Table names are upper-case there (`WO_HEADER`, `WORKSTEP_LINK`, `WO_TEXT_DESCRIPTION`, `WO_TEXT_ACTION`); column names matched lower-case in the one query tested.
  - Data is a staging copy, so freshness depends on the ETL load. Unknown how often it runs.
  - `scripts/dwh.ts` already runs a query or `--file` and prints a table or writes CSV. Treat it as a starting point.
- Known PostgreSQL → T-SQL differences seen in the repo's files: `DATE '1971-12-31' + col::integer` (30 uses), `CURRENT_TIMESTAMP` (10, UTC assumed), `INTERVAL '7' HOUR` / `'24'` / `'6'` / `'1 minute'` (about 27), `LIMIT` (1), and the table prefix (every query).

## What I want out of your plan
1. **Converter design.** Decide between an AST approach (`node-sql-parser` already supports both `postgresql` and `transactsql`) and rule-based text rewriting, with reasons. Make it deterministic, with tests. It must **fail loudly** on anything it cannot convert safely, never silently emit wrong SQL.
2. **Edge-case catalogue.** Go beyond the list above. Research and decide the behaviour for at least: CTEs and subqueries, `LIMIT`/`OFFSET`, `COALESCE`/`NULLIF` differences, `::` casts to other types, `EXTRACT`, `date_trunc`, `to_char`, `string_agg`, `array_agg`, `FILTER (WHERE …)`, window functions, `DISTINCT ON`, `ILIKE`, boolean literals, `||`, quoted identifiers, comments, `<INSERT_WPNO_HERE>` placeholders, `ORDER BY` inside subqueries (SQL Server forbids it without TOP), integer division, NULL ordering, case sensitivity and collation, trailing semicolons, identifiers that are reserved words in T-SQL, `text`/`ntext` column handling, and time zones (`CURRENT_TIMESTAMP` is UTC on PostgreSQL but local on SQL Server). Add whatever I did not think of.
3. **Schema fidelity.** The DWH may rename, drop or retype columns versus AMOS. Plan a way to compare the DWH catalogue (`INFORMATION_SCHEMA`) against `schema/` and the physical CSV, and report mismatches before a query is run.
4. **Result verification.** Plan how to prove a converted query gives the same answer as the original (for example, run both on a small fixed key set and diff rows, counts and checksums). Decide how to handle the DWH being a different point in time from AMOS.
5. **Safety.** Read-only by construction: allow a single `SELECT`/`WITH` statement only, reject everything else, add a default `TOP` cap and a timeout, and consider a read-only DB role. Bind any server to `127.0.0.1`. Keep credentials server-side.
6. **The UI for a non-technical user.** Propose 2–3 options (for example a local web page started with one double-click, versus a desktop wrapper) with trade-offs, and recommend one. Minimum flow: pick a saved `.sql` file from `queries/`, see the converted T-SQL and any warnings, click Run, see a results table, download CSV. Plain-language error messages. Plan how I start it on Windows without a terminal, and how the AMOS-PostgreSQL side fits in if I later want it in the same screen. Check how `test_db.js` currently connects to AMOS.
7. **Repo fit.** Where the converted files go (suggest `queries/dwh/`, generated and never hand-edited), how it interacts with `npm run validate`, `scaffold` and `docs:check`, and what to add to `CLAUDE.md` so future sessions follow the same workflow.
8. **Phasing.** Order the work so I get something usable early (converter plus CLI first, UI second), with a test plan per phase.

## Constraints
- Respect every rule in `CLAUDE.md`, including no table aliases in query files. Say explicitly if any generated T-SQL would have to break a rule.
- Windows 11, Node 24, no build step for TypeScript (`node file.ts`). Prefer few dependencies.
- Do not run anything that writes to either database.
- Do not touch `.env`.

## Output
A plan file in `docs/` with phases, files to create, edge-case decisions (a table: case → behaviour → test), open questions for me, and a risk list. Then stop and wait for my approval.
