# DWH Runner: acceptance script

Walked by the host (plan Phase 4, Task 4.2 step 2 and Task 4.3 steps 3–4). Tick each step and note anything unexpected. The guide is [dwh-runner-guide.md](dwh-runner-guide.md).

**Before you start**

- [ ] **Freshness read (optional).** The "DWH data as of …" line needs one extra read-only query (the statement is in the guide, Part 1). It is **off** until you switch it on with `DWH_FRESHNESS=1`; it has never been run. Without it the line says "freshness unknown"; everything else works.
- Fake data: open a terminal in the repo folder, run `set DWH_FAKE=1`, then `"Start DWH Runner.cmd"`. The page shows a yellow "FAKE DATA" badge. For step 10 use `set DWH_FAKE_ROWS=300000` and `set DWH_FAKE_DELAY_MS=40` too, so the download takes long enough to stop.
- Real DWH: a new terminal (no `DWH_FAKE`), or the desktop shortcut.
- Steps 13–16 need sharing switched on (guide, "Sharing the page with colleagues"), which needs the IT certificate, the approval to share DWH data, and the access code.

| # | Do | Expected | Fake | Real |
|---|---|---|---|---|
| 1 | `npm run dwh:shortcut`, then double-click the new desktop shortcut. Double-click it a second time. | First time: a minimised "DWH Runner - close this window to stop" window and the page in the browser. Second time: only the browser (no second window). | [ ] | [ ] |
| 2 | Close the DWH Runner window. Rename `.env` to `.env.off`, double-click the shortcut, then rename it back. | The launcher says "The host PC is not set up to reach the DWH yet (the settings file is missing)." and waits for a key. | n/a | [ ] |
| 3 | With the VPN / company network off, select `extract_wp_item_counts` and press Run preview. | "Can't reach the DWH server. Is the host PC on the company network or VPN?" | n/a | [ ] |
| 4 | Select `extract_wp_item_counts` (⚠) and press Run preview. | Rows appear; "First 500 rows (more available)" (fake) or the row count and time (real: about 2,300 rows, so the first 500). Notes list W_STRING_ORDER and the WPNO length note. | [ ] | [ ] |
| 5 | A query with a placeholder: paste a value from Excel with a trailing space or tab, run. | The value is shown back without the space ("used: …"). A value with a quote mark gets a plain "may only contain …" message. *(Today no available query has a placeholder; with fake data no placeholder query is available either: check with the first one that becomes available.)* | [ ] | [ ] |
| 6 | Download all as CSV; open the file in Excel. | Saved as `<query>_DWH_<yyyymmdd-hhmm>.csv`; Excel shows the columns correctly and Vietnamese text (fake rows contain "BÌNH XỊT ĐI CAN VN512") reads correctly. | [ ] | [ ] |
| 7 | Select a ✗ query, e.g. `extract_work_order`. | "This query cannot be run in the DWH: Two result columns are both called TEXT …" with the line number; Run is greyed out. | [ ] | [ ] |
| 8 | Select a ⊘ query, e.g. `extract_all_parts`. | "Needs what the DWH doesn't have yet: PART.MANUAL_TARGET_STOCK, PART.TARGET_STOCK". | [ ] | [ ] |
| 9 | Edit a query file (e.g. add a column to a copy of a query), select it again. | The DWH version shows the change without restarting. | [ ] | [ ] |
| 10 | Start a long download, press Stop. | The download stops; the page says it is incomplete; a saved file ends with a line starting `INCOMPLETE:`. | [ ] | [ ] |
| 11 | Compare on `extract_wp_item_counts`: Make the AMOS version, run it in AMOS, export, enter the row count AMOS showed, add `verify/extract_wp_item_counts/unchanged.csv` as the list, Compare. | A report like the Phase 3 one (fixed keys, listed rows, all rows). Fake data: FAIL "nothing compared" (the fake rows are not real workpacks). Real: differences only where the DWH kept rows deleted in AMOS (known). | [ ] | [ ] |
| 12 | Press Quit (click twice). | "The DWH Runner has stopped." The minimised window closes. | [ ] | [ ] |
| 13 | On a colleague's PC open `https://<host-pc>:4870`. | Certificate warning only with a self-signed certificate; then the access-code page; the right code opens the page. | | [ ] |
| 14 | On a colleague's PC enter a wrong code five times. | "This PC is now locked out for 15 minutes."; the right code is refused until then. | | [ ] |
| 15 | On the colleague's PC look at the top right. | No Quit and no Refresh catalogue buttons. | | [ ] |
| 16 | Two people press Run preview at the same time (and one presses it twice). | Both get results, or a clear "The DWH runner is busy, try again in a minute." | | [ ] |

Results / notes:

-
