# mStore: WP data, DWH drift and live AMOS precedence

Written for: the developers and agents building the mStore app.

Tags: **[V]** checked in a file or data in this repo. **[I]** inferred, not checked. **[D]** decided by the user. **[P]** proposed, not built, needs a decision.

## 1. Files in this folder

| File | Role | Source |
|---|---|---|
| `extract_han_wp_in_progress_or_issued.sql` | Query 0: WP list. Filters are placeholders: `STATION`, `AC_OPERATOR`, `AC_REGISTR`, `DESCRIPTION` (one value each) and `WP_STATUS_1` to `WP_STATUS_4` (one status id each, repeat a value to use fewer). Gives `z_WP_ID`, `z_WP_NO`, `z_AC_REG`. | Copy of the repo root file, with placeholders and status 115 added in the copy only |
| `extract_wp_seqs_by_wp_steps.sql` | Query 1: steps (items and worksteps) of one WP, by WP name. Last column `z_WORKSTEP_LINK_ID` is the join key. | Copy of the repo root file (DWH version) |
| `extract_wp_seqs_by_wp_parts.sql` | Query 2: part requests and pickslip bookings for the worksteps of one WP, by WP name. First column `z_WORKSTEP_LINK_ID`. | Copy of the repo root file (DWH version) |

These are the PostgreSQL-syntax sources. The app must run the generated Oracle versions in `queries/dwh/` (same names, produced by `npm run dwh:convert`). Never hand-edit those files. Check the generated copies are current with `npm run dwh:check`.

## 2. App flow

1. **List.** The user picks a station (HAN) and an AC registration. Run Query 0 with `STATION` and `AC_REGISTR` set to those values. The other placeholders are `AC_OPERATOR` (HVN), `DESCRIPTION` and the four status ids. A station-wide run (no AC) returns about 1030 rows on the DWH, and most are stale (see section 5). **Do not show the raw DWH list.** Merge it with the latest live export first (section 4).
2. **Select a WP.** Use `z_WP_NO` (the WP name, not `z_WP_ID`) as `<WP_NAME>` in Query 1 and Query 2.
3. **Steps** from Query 1, then **parts** from Query 2. Join them with `z_WORKSTEP_LINK_ID`. A part row whose `z_WORKSTEP_LINK_ID` is not in the steps result is an orphan: flag it, do not drop it silently.
4. **Steps and parts have no live source.** The live export carries only the WP header list. The live-over-DWH rule does not reach steps or parts [V]. They come from the DWH only, and the app should label them that way with the DWH read time.

Running the queries:
- `<WP_NAME>` is substituted as text. In `openquery` mode the runner accepts only `A-Z a-z 0-9`, space, `.`, `_`, `/`, `-` in placeholder values, and has no bound parameters [V, CLAUDE.md]. Check the WP name against that set before substituting it, and refuse anything else. Names such as `A514-171125 LINE-MCC` and `A874-191126/01 LINE-MCC` pass.
- The SQL text is limited to 8000 characters in `openquery` mode [V, `dwh/mapping.yaml`]. These queries are well below that.
- Query 0 has no date filter and no "now" value.

## 3. Sources and their behaviour

**DWH (Oracle staging copy of AMOS, schema `STG_AMOS`).**
- Can be queried at any time, so it is "real time" for the query. Its content is only as fresh as its last sync from AMOS [V, memory `dwh-status-is-snapshot`].
- Never deletes rows. It keeps WPs and workpack items that were deleted or closed in AMOS, so it has more rows than AMOS [V, CLAUDE.md; user, 2026-11-18].
- Can miss status changes. Example in section 5 [V].
- `WP_HEADER.MUTATION` / `MUTATION_TIME` is the last change the DWH recorded for the row. It is not the time the DWH was read, and it cannot show a change the DWH missed [V, handoff].
- Whether `MUTATION` is UTC or local is **not verified** [I]. This decides the `DWH_NEWER_THAN_EXPORT` flag (section 4, Q5).

**Live AMOS.**
- The real data. It always wins [D].
- Reachable only by a manual screen export ("Standard Table Report", xlsx), taken about every 3 hours [D]. The app cannot query it. A file is the only input.
- The export file has no status id, WP type or mutation fields. It has these columns: W/P No., Info, AC, Planned Start, Station, Description, Collection Status, Req. Link Status, New MP Revision [V, handoff].
- The file's own UTC time is in `docProps/core.xml` `dcterms:created` [V, design doc F2].

**Test AMOS copy (~2026-10-01).** Used only by the user for SQL checks. It is older than the DWH. Not a source for the app [V, memory `amos-test-copy`].

## 4. Precedence rules

### Decided [D]

- **R1.** Where the latest live export covers a WP, each field the export carries comes from the export, every time. The DWH value is not used for that field, even when the DWH row is newer.
- **R2.** Where no export covers a WP, the DWH value is the fallback.
- **R3.** Every value carries the timestamp of its source (export `created` UTC for live, `MUTATION_TIME` for DWH, DWH read time for DWH reads).
- **R4.** A WP missing from one export is not deleted without a check (section 4, scope rule).

### Proposed [P] (design in `docs/design-dwh-live-precedence.md`, nothing built)

- **Key.** Match on `W/P No.` = `z_WP_NO`. Trim and collapse whitespace; keep case.
- **Newest complete export only.** Choose the export with the newest `dcterms:created`. It counts as complete only if its row count equals the on-screen count (133 in the example). If the newest fails, use the previous one. Exports are never combined.
- **Scope "declared".** The AMOS screen filter is fixed to station HAN, operator HVN, status In Progress + Issued, and saved as a named variant. Under this scope, a DWH WP missing from the export means "not In Progress / Issued in live AMOS at export time". Such rows leave the main list and go to a "dropped by live" list, with DWH status and last change shown.
- **Scope "unknown"** (one-off exports only). Keep the DWH row and flag `NOT_CONFIRMED_BY_LIVE`.
- **Fields the export does not carry** (status id, hidden, end date, AC type, MP number and revision) come from the DWH and are marked DWH-sourced, even on a live row.
- **Output columns** (names need approval): `z_ROW_SOURCE` (`LIVE`, `LIVE_NEW`, `DWH`), `z_LIVE_EXPORT_UTC`, `z_DWH_LAST_CHANGE_UTC`, `z_DWH_READ_UTC`, `z_STATUS_SOURCE`, `z_FLAGS` (`DWH_NEWER_THAN_EXPORT`, `NOT_CONFIRMED_BY_LIVE`, `EXPORT_STALE`).
- **Staleness.** `EXPORT_STALE` after 4 h (3 h cycle plus 1 h grace) [P]. Live still wins after that; only the flag changes.
- **Where the merge lives.** TypeScript, not SQL, so the merge adds no SQL aliases [P].

## 5. Evidence of drift

All of these are from the user's checks, 2026-11-18/19 [V unless marked].

- **A514-171125 LINE-MCC.** Closed in live AMOS on 17 Nov 2025 22:00 UTC. The DWH's last recorded change is 17 Nov 2025 19:01 UTC, and it still shows In Progress (status 11). The DWH missed the close.
- **Export vs DWH (19 Nov 2026).** The export has 133 rows and 133 distinct WP numbers. 132 are in the DWH; the DWH values for Description and AC match exactly [V, computed].
- **The one export-only WP** is `A874-191126/01 LINE-MCC` (planned start 19 Nov 2026). It is new and not yet in the DWH: `LIVE_NEW` [V].
- **DWH-only rows.** The in-scope DWH list has 1030 rows. 898 are DWH-only. Of those, 885 start in 2022–2025 and 13 start in 2026 [V, computed]. Most are probably closed or deleted in AMOS [I].
- **Sample.** Of 19 sampled 2024–2025 DWH-only WPs, the user found 1 in live AMOS (Closed) and could not find 18 [V, user].
- **Last-change dates are not a cut-off.** Last recorded DWH change by month: Sep–Nov 2025 311 rows, Dec 2025 11, Jan 2026 0, Feb–Oct 2026 1–6 each, Nov 2026 120. The DWH does record changes after the test-copy date [V]. Whether it missed changes in 2026 is unknown [I].
- **Status ids are not one-to-one with names** [V, `schema/workpack.yaml`]: 11 and 115 are both "In Progress"; 112 and 114 are both "Issued"; -2 and 116 are "Closed"; -4 and -1 are "Open"; 111 and 113 are "In Preparation". Filter by the full list of ids.
- **`wp_type` is defined two ways** [V, CSV]: 0 = PLANNING / 1 = CRM in one place, 0 = Aircraft / 1 = Component in another. The user's AMOS shows 0 = aircraft and 2 = component. Value 1 is not confirmed. Status ids depend on WP type, so the status filter in Query 0 carries this risk [I].

## 6. Open questions for the user

1. **Scope.** Set the AMOS screen filter to the `declared` scope and check its count against the DWH query. Is that acceptable? (`[P]` recommended.)
2. **Screen columns.** Can the export show status name, WP type, last change and end date? Without status, two exports split by status would carry the same information.
3. **Status 115.** Resolved in the mStore copy: 115 is now in the list (`WP_STATUS_1` to `WP_STATUS_4`). The repo root file still leaves 115 out and its comment says so; decide whether the root file should follow [V].
   - **Description filter.** `DESCRIPTION` is an exact match. Confirm that, or change it to a `LIKE` pattern.
4. **`wp_type` value 1.** Confirm it, then fix the enum before any query filters on WP type [P].
5. **`MUTATION` time zone.** UTC or local? It decides `DWH_NEWER_THAN_EXPORT` [I, not verified].
6. **Steps and parts.** Accept that they come from the DWH only (section 2, step 4), or find a live source for them [P].
7. **Staleness.** Confirm the 4 h `EXPORT_STALE` threshold [P].
8. **Output names.** Approve the `z_` column names in section 4 [P].
9. **Companion query.** Query 0 finds only WPs the DWH holds as 11/112/114. A WP that the DWH holds under another status (for example one reopened in AMOS) is missed. A companion "all status" query would fix this. It needs approval to run [P].
