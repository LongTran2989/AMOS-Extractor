# WP sequences: split extraction (steps + parts) and stitching

How the "WPs down to items, worksteps and required materials" extraction works, why it is split in two, and how to run it.
Background and the other domain lessons live in [SESSION_CONTEXT.md](../SESSION_CONTEXT.md).

## Why it is split

`extract_wp_seqs_parameterized.sql` (the original) returns one flat table: one row per WP x item x workstep x part request.
Its cost is mostly the fan-out: ~33k rows, each repeating the large `text_html`, then sorted.

The split queries return the same data without the multiplication:

| Result | Query | Grain | Notes |
|---|---|---|---|
| A (steps) | `extract_wp_seqs_steps.sql` | WP x item x workstep | Last column `z_WORKSTEP_LINK_ID` (stitch key); keeps the `ORDER BY` so stitched order matches the original |
| B (parts) | `extract_wp_seqs_parts.sql` | one row per part request | `z_WORKSTEP_LINK_ID`, `z_PART_NO`, `z_PART_QTY`, `z_PART_NO_PCF`; only worksteps that have parts |

`extract_wp_seqs_parameterized.sql` stays as the reference output. The consuming app expects the **flat** shape, so the CLI rebuilds it from A + B.

## Station-department pairs

`queries/wp_seqs/pairs.json` lists the pairs; `npm run scaffold` renders `<STATION>-<DEPT>_steps.sql` and `_parts.sql` into `queries/wp_seqs/` from the root templates
(`extract_wp_seqs_steps.sql`, `extract_wp_seqs_parts.sql`, which stay HAN/NTHN). **Edit the root templates, then re-run scaffold; never edit the generated files.**

Current pairs: HAN-NTHN, HAN-NGTHN, HAN-CNBDNT, DAD-CNDN, SGN-NTHCM, SGN-NGTHCM, SGN-CNBDNT.
`npm run validate` lints the generated files too. The department codes are as given by the user; they have not been checked against the live DB.

## Running it

1. Run `<PAIR>_steps.sql` and `<PAIR>_parts.sql` in AMOS, back to back (the WP window is time-based, so a long gap can change the WP set), and export both as CSV.
2. `npm run stitch -- steps.csv parts.csv out.csv` (add `--key=COL1,COL2` for a composite key instead of `z_WORKSTEP_LINK_ID`).
   Part rows with no matching step are dropped with a warning. From another folder: `node G:\AMOS-Extractor\src\cli.ts stitch ...`.
3. Optional check against the original query: `npm run stitch:compare -- legacy.csv out.csv` (several legacy files may be given, with the stitched file last).
   It ignores row order and export formatting (see below) but not real value changes.

## Verified result (HAN-NTHN, 2026-10-28)

Original query vs steps+parts stitched: 33135 rows each, all 24 columns identical once export formatting is ignored.
The parts-query fix below was needed to get there (the first version produced 33257 rows).

## Lessons learned

**Query performance**
- Compare the raw integer date columns (`wp_header.start_date <= CURRENT_DATE - DATE '1971-12-31'`) rather than wrapping them in date math; add a coarse integer pre-filter before an exact timestamp check.
- `LEFT JOIN`s on tables that the `WHERE` clause requires (here `wp_status`, `wp_department_link`) block the planner from starting at the small filtered `wp_header` set; use inner joins.
- Most of the original ~12 s is probably row fan-out, wide `text_html` transfer and the sort, not the filter. This was not measured; confirm with `EXPLAIN ANALYZE`.

**Fan-out through `wp_sequence`**
- The same work order can be listed more than once in one WP's `wp_sequence`, so the same workstep appears on several rows (44 such keys in HAN-NTHN).
- If the parts query also joins through `wp_sequence`, each part is repeated n times and stitching multiplies it again (n x n). The parts query therefore starts at `part_request_2` and puts the WP filter in an `EXISTS`, so every part request appears once.
- Deduplicating identical part rows in the stitcher is wrong: a step can legitimately have identical part lines.

**AMOS export quirks (the stitcher and compare handle these)**
- Aliases are lowercased by the DB (`z_workstep_link_id`), so column lookup is case-insensitive.
- NULL is written as a single space in some exports and as empty in others; the stitcher mirrors the steps file's marker.
- Numbers may carry apostrophe thousands separators (`1'797'490`) and different decimal places (`10.0` vs `10.00`) depending on export settings.
- Fields containing line breaks are NOT quoted, so one record spans several lines; the CSV reader glues short records back together using the header width.
- Very large results run the export out of memory; export per-WP pieces (a `wp_header.wpno IN (...)` filter) instead. The helper queries used are in `archive/verification/`.
- Best practice: export steps and parts with the same settings as the legacy file so the stitched file also looks the same in raw text.

**Debugging method that worked**
- Per-WP row counts (`archive/verification/probe_wp_seqs_rowcount.sql`) against the stitched file located the two WPs that were off.
- Then compare column by column after sorting both files; formatting-only differences show up as whole-column mismatches.
