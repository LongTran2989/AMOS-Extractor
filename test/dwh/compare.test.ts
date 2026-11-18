import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { compareCli, compareResults, renderReport, restrictTo, splitIncomplete, type DiffKind } from "../../src/dwh/compare.ts";
import type { Table } from "../../src/stitch/stitch.ts";

const H = ["z_WP_ID", "z_WP_NO", "z_WP_STATION", "z_WP_ITEM_COUNT"];
const t = (header: string[], ...rows: string[][]): Table => ({ header, rows });
const base = () => t(H, ["101", "A-1", "HAN", "3"], ["102", "A-2", "SGN", "0"], ["103", "B-1", "HAN", "12"]);
const KEYS = ["z_WP_ID"];
const ORDER = ["z_WP_NO"];

/** DWH = base(); AMOS = base() with one cell replaced. Returns the single diff's kind. */
function kindOf(column: string, amosValue: string, dwhValue: string): DiffKind {
  const amos = base();
  const dwh = base();
  const c = H.indexOf(column);
  amos.rows[0]![c] = amosValue;
  dwh.rows[0]![c] = dwhValue;
  const r = compareResults(amos, dwh, KEYS, ORDER);
  assert.equal(r.cellDiffs.length, 1, JSON.stringify(r.cellDiffs));
  assert.equal(r.cellDiffs[0]!.column, column);
  return r.cellDiffs[0]!.kind;
}

test("identical results pass", () => {
  const r = compareResults(base(), base(), KEYS, ORDER);
  assert.equal(r.pass, true);
  assert.deepEqual(r.counts, { amos: 3, dwh: 3 });
  assert.equal(r.onlyAmos + r.onlyDwh, 0);
  assert.deepEqual(r.cellDiffs, []);
  assert.deepEqual(r.amosIncomplete, []);
});

test("diff kind: whitespace", () => assert.equal(kindOf("z_WP_STATION", "Kiểm  tra\ncơ", "Kiểm tra cơ"), "whitespace"));
test("diff kind: case", () => assert.equal(kindOf("z_WP_STATION", "han", "HAN"), "case"));
test("diff kind: null_vs_empty", () => assert.equal(kindOf("z_WP_STATION", "   ", ""), "null_vs_empty"));
test("diff kind: number_format", () => assert.equal(kindOf("z_WP_ITEM_COUNT", "3.00", "3"), "number_format"));
test("diff kind: tz_shift_7h", () => assert.equal(kindOf("z_WP_STATION", "2026-11-10 13:00:00", "2026-11-10 06:00:00"), "tz_shift_7h"));
test("diff kind: changed", () => assert.equal(kindOf("z_WP_ITEM_COUNT", "4", "3"), "changed"));

test("truncated long text detected", () => {
  const long = "Kiểm tra động cơ ".repeat(250);
  assert.equal(kindOf("z_WP_STATION", long, long.slice(0, 3700)), "truncated");
});

test("NULL written as one space by AMOS equals an empty DWH cell", () => {
  const amos = base();
  amos.rows[1]![2] = " ";
  const dwh = base();
  dwh.rows[1]![2] = "";
  const r = compareResults(amos, dwh, KEYS, ORDER);
  assert.deepEqual(r.cellDiffs, []);
  assert.equal(r.pass, true);
});

test("lower-case AMOS header matches z_ header", () => {
  const amos = base();
  amos.header = H.map((h) => h.toLowerCase());
  const r = compareResults(amos, base(), KEYS, ORDER);
  assert.equal(r.headerMatch, true);
  assert.equal(r.pass, true);
});

test("a missing column fails and is named", () => {
  const amos = t(H.slice(0, 3), ...base().rows.map((x) => x.slice(0, 3)));
  const r = compareResults(amos, base(), KEYS, ORDER);
  assert.equal(r.headerMatch, false);
  assert.equal(r.pass, false);
  assert.match(renderReport(r), /z_WP_ITEM_COUNT/);
});

test("apostrophe thousands separators equal", () => {
  const amos = t(H, ["1'797'490", "A-1", "HAN", "1'203"]);
  const dwh = t(H, ["1797490", "A-1", "HAN", "1203"]);
  const r = compareResults(amos, dwh, KEYS, ORDER);
  assert.equal(r.onlyAmos + r.onlyDwh, 0);
  assert.deepEqual(r.cellDiffs.map((d) => d.kind), ["number_format"]);
  assert.equal(r.pass, true);
});

test("float shortest round-trip equal", () => {
  const h = ["z_ID", "z_QTY"];
  const r = compareResults(t(h, ["1", "0.1"]), t(h, ["1", "0.10000000000000001"]), ["z_ID"], []);
  assert.deepEqual(r.cellDiffs.map((d) => d.kind), ["number_format"]);
  assert.equal(r.pass, true);
});

test("ties don't count as order differences", () => {
  const h = ["z_WP_ID", "z_WP_NO"];
  const dwh = t(h, ["1", "A"], ["2", "A"], ["3", "B"]);
  const amos = t(h, ["2", "A"], ["1", "A"], ["3", "B"]);
  assert.equal(compareResults(amos, dwh, ["z_WP_ID"], ["z_WP_NO"]).orderSame, true);
  const reordered = t(h, ["3", "B"], ["1", "A"], ["2", "A"]);
  const r = compareResults(reordered, dwh, ["z_WP_ID"], ["z_WP_NO"]);
  assert.equal(r.orderSame, false);
  assert.equal(r.pass, false);
});

test("a text-sort order difference is explained when the query warns W_STRING_ORDER", () => {
  const h = ["z_WP_ID", "z_WP_NO"];
  const dwh = t(h, ["1", "A-B"], ["2", "AB"]);
  const amos = t(h, ["2", "AB"], ["1", "A-B"]);
  const r = compareResults(amos, dwh, ["z_WP_ID"], ["z_WP_NO"], { stringOrderExpected: true });
  assert.equal(r.orderSame, false);
  assert.equal(r.orderExplained, true);
  assert.equal(r.pass, true);
  assert.match(renderReport(r), /W_STRING_ORDER/);
});

test("null_vs_empty does not fail the pass criterion", () => {
  const amos = base();
  amos.rows[0]![2] = "  ";
  const dwh = base();
  dwh.rows[0]![2] = "";
  const r = compareResults(amos, dwh, KEYS, ORDER);
  assert.deepEqual(r.cellDiffs.map((d) => d.kind), ["null_vs_empty"]);
  assert.equal(r.pass, true);
});

test("pass is false on any changed cell", () => {
  const amos = base();
  amos.rows[2]![3] = "13";
  const r = compareResults(amos, base(), KEYS, ORDER);
  assert.equal(r.pass, false);
  assert.deepEqual(r.differingColumns, ["z_WP_ITEM_COUNT"]);
  assert.equal(r.cellDiffs[0]!.key, "103");
  assert.match(renderReport(r), /FAIL/);
});

test("an export cut short is named first", () => {
  const dwh = t(H, ...Array.from({ length: 13 }, (_, i) => [String(100 + i), `A-${i}`, "HAN", "1"]));
  const amos = t(H, ...dwh.rows.slice(0, 3).map((r) => [...r]));
  const r = compareResults(amos, dwh, KEYS, [], { amosRowsShown: 13 });
  assert.equal(r.pass, false);
  assert.match(r.amosIncomplete[0]!, /13/);
  assert.match(r.amosIncomplete[0]!, /\b3\b/);
  const text = renderReport(r);
  const warn = text.indexOf("The AMOS export looks incomplete");
  assert.ok(warn >= 0, text);
  assert.ok(warn < text.indexOf("Rows only in"), text);
});

test("fewer AMOS rows, all found in the DWH, look like an incomplete export even without the shown count", () => {
  const amos = t(H, base().rows[0]!);
  const r = compareResults(amos, base(), KEYS, ORDER);
  assert.equal(r.amosIncomplete.length, 1);
  assert.match(r.amosIncomplete[0]!, /fewer rows/);
  assert.match(r.amosIncomplete[0]!, /only some rows/);
});

test("the shown row count matching the file is not a warning", () => {
  assert.deepEqual(compareResults(base(), base(), KEYS, ORDER, { amosRowsShown: 3 }).amosIncomplete, []);
});

test("a fixed key in the DWH but not in the AMOS file is named", () => {
  const amos = restrictTo(t(H, base().rows[0]!), "z_WP_NO", ["A-1", "B-1"]);
  const dwh = restrictTo(base(), "z_WP_NO", ["A-1", "B-1"]);
  const r = compareResults(amos, dwh, KEYS, ORDER, { expected: { column: "z_WP_NO", values: ["A-1", "B-1"] } });
  assert.equal(r.pass, false);
  assert.ok(r.amosIncomplete.some((m) => m.includes("B-1")), r.amosIncomplete.join("\n"));
});

test("restrictTo keeps only the listed values, matching case-insensitive header and trimmed values", () => {
  const amos = base();
  amos.header = H.map((h) => h.toLowerCase());
  amos.rows[0]![1] = "A-1 ";
  assert.deepEqual(restrictTo(amos, "z_WP_NO", ["A-1"]).rows.map((r) => r[0]), ["101"]);
});

test("one-side rows are grouped by the first key column as drift", () => {
  const amos = t(H, ["101", "A-1", "HAN", "3"], ["104", "C-1", "HAN", "1"]);
  const dwh = t(H, ["101", "A-1", "HAN", "3"], ["105", "C-2", "HAN", "1"], ["106", "C-3", "HAN", "1"]);
  const r = compareResults(amos, dwh, KEYS, ORDER);
  assert.equal(r.onlyAmos, 1);
  assert.equal(r.onlyDwh, 2);
  assert.deepEqual(r.driftKeys, ["104", "105", "106"]);
  assert.match(renderReport(r), /3 values of z_WP_ID/);
  assert.equal(r.pass, false);
});

test("an INCOMPLETE line at the end of the DWH CSV is split off and fails the run", () => {
  const dwh = t(H, ...base().rows, ["INCOMPLETE: the download stopped after 3 rows."]);
  const s = splitIncomplete(dwh);
  assert.equal(s.table.rows.length, 3);
  assert.match(s.incomplete!, /stopped after 3 rows/);
  const r = compareResults(base(), s.table, KEYS, ORDER, { dwhIncomplete: s.incomplete! });
  assert.equal(r.pass, false);
  assert.match(renderReport(r), /DWH file is incomplete/);
});

test("dwh:compare reads the pack and the fixed keys, writes report.md, exits 0 on PASS", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cmp-"));
  try {
    const dir = path.join(root, "verify", "q");
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(root, "dwh"));
    writeFileSync(path.join(dir, "pack.json"), JSON.stringify({ source: "q.sql", at: "2026-11-10T06:00:00Z", params: {}, orderKeys: ORDER, warnings: [{ code: "W_STRING_ORDER", plain: "x" }] }));
    writeFileSync(path.join(root, "dwh", "verify-keys.yaml"), "q.sql:\n  match_on: [z_WP_ID]\n  fixed_column: z_WP_NO\n  fixed_values: [A-1, B-1]\n");
    // AMOS has only some rows (the fixed ones), lower-case headers, NULL as a space; DWH has all.
    writeFileSync(path.join(dir, "amos.csv"), "z_wp_id,z_wp_no,z_wp_station,z_wp_item_count\r\n101,A-1,HAN,3\r\n103,B-1, ,12\r\n");
    writeFileSync(path.join(dir, "dwh.csv"), '﻿"z_WP_ID","z_WP_NO","z_WP_STATION","z_WP_ITEM_COUNT"\r\n"101","A-1","HAN","3"\r\n"102","A-2","SGN","0"\r\n"103","B-1","","12"\r\n');
    const lines: string[] = [];
    const code = compareCli(root, [path.join(dir, "amos.csv"), path.join(dir, "dwh.csv"), "--amos-rows", "2"], (s) => lines.push(s));
    const out = lines.join("\n");
    assert.equal(code, 0, out);
    assert.match(out, /PASS/);
    assert.match(out, /fixed keys/i);
    const report = readFileSync(path.join(dir, "report.md"), "utf8");
    assert.match(report, /PASS/);
    assert.match(report, /All rows/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dwh:compare without arguments prints the usage", () => {
  const lines: string[] = [];
  assert.equal(compareCli(tmpdir(), [], (s) => lines.push(s)), 1);
  assert.match(lines.join("\n"), /Usage/);
});
