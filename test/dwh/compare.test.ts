import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { compareCli, compareResults, renderReport, restrictTo, restrictToListed, splitIncomplete, type DiffKind } from "../../src/dwh/compare.ts";
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

test("restrictToListed keeps the rows whose key is in the list, numbers compared after normalising", () => {
  const amos = base();
  amos.header = H.map((h) => h.toLowerCase());
  amos.rows[0]![0] = "1'596'611";
  const list = t(["z_wp_id", "z_WP_NO"], ["1596611", "x"], ["103", "y"]);
  assert.deepEqual(restrictToListed(amos, "z_WP_ID", list).rows.map((r) => r[1]), ["A-1", "B-1"]);
});

test("restrictToListed names the list file's missing column in plain words", () => {
  assert.throws(() => restrictToListed(base(), "z_WP_ID", t(["other"], ["1"]), "unchanged.csv"), /unchanged\.csv has no column z_WP_ID/);
});

test("dwh:compare --within judges also the listed rows and fails when one of them differs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cmp-"));
  try {
    const dir = path.join(root, "verify", "q");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "amos.csv"), "z_wp_id,z_wp_no,z_wp_station,z_wp_item_count\r\n101,A-1,HAN,3\r\n102,A-2,SGN,0\r\n109,Z-9,HAN,1\r\n");
    writeFileSync(path.join(dir, "dwh.csv"), '"z_WP_ID","z_WP_NO","z_WP_STATION","z_WP_ITEM_COUNT"\r\n"101","A-1","HAN","3"\r\n"102","A-2","SGN","1"\r\n"110","Z-10","HAN","1"\r\n');
    writeFileSync(path.join(dir, "unchanged.csv"), '"z_WP_ID","z_WP_NO"\r\n"101","A-1"\r\n"102","A-2"\r\n');
    const lines: string[] = [];
    const code = compareCli(root, [path.join(dir, "amos.csv"), path.join(dir, "dwh.csv"), "--within", path.join(dir, "unchanged.csv")], (s) => lines.push(s));
    const out = lines.join("\n");
    assert.equal(code, 1, out);
    assert.match(out, /Rows listed in .*unchanged\.csv \(2\)/);
    assert.match(out, /not drift/);
    assert.match(out, /z_WP_ITEM_COUNT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dwh:compare --within passes when every listed row matches", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cmp-"));
  try {
    const dir = path.join(root, "verify", "q");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "amos.csv"), "z_wp_id,z_wp_no\r\n101,A-1\r\n109,Z-9\r\n");
    writeFileSync(path.join(dir, "dwh.csv"), '"z_WP_ID","z_WP_NO"\r\n"101","A-1"\r\n"110","Z-10"\r\n');
    writeFileSync(path.join(dir, "unchanged.csv"), '"z_WP_ID"\r\n"101"\r\n');
    const lines: string[] = [];
    const code = compareCli(root, [path.join(dir, "amos.csv"), path.join(dir, "dwh.csv"), "--within", path.join(dir, "unchanged.csv")], (s) => lines.push(s));
    assert.equal(code, 0, lines.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rows that should be in both files are not called drift", () => {
  const amos = t(H, ["101", "A-1", "HAN", "3"]);
  const dwh = t(H, ["101", "A-1", "HAN", "3"], ["105", "C-2", "HAN", "1"]);
  const text = renderReport(compareResults(amos, dwh, KEYS, ORDER, { notDrift: true }));
  assert.doesNotMatch(text, /likely drift/);
  assert.match(text, /not drift/);
});

test("review: a date-order difference is not explained by W_STRING_ORDER", () => {
  const h = ["z_WP_ID", "z_WP_START_DATE"];
  const amos = t(h, ["1", "2026-01-01"], ["2", "2026-02-01"]);
  const dwh = t(h, ["2", "2026-02-01"], ["1", "2026-01-01"]);
  const r = compareResults(amos, dwh, ["z_WP_ID"], ["z_WP_START_DATE"], { stringOrderExpected: true, textColumns: [] });
  assert.equal(r.orderExplained, false);
  assert.equal(r.pass, false);
  const guessed = compareResults(amos, dwh, ["z_WP_ID"], ["z_WP_START_DATE"], { stringOrderExpected: true });
  assert.equal(guessed.pass, false, "without types, date-looking values are not text either");
});

test("review: a text-order difference is explained only on a text column", () => {
  const h = ["z_WP_ID", "z_WP_NO"];
  const amos = t(h, ["1", "a-1"], ["2", "B-1"]);
  const dwh = t(h, ["2", "B-1"], ["1", "a-1"]);
  assert.equal(compareResults(amos, dwh, ["z_WP_ID"], ["z_WP_NO"], { stringOrderExpected: true, textColumns: ["z_WP_NO"] }).pass, true);
});

test("review: nothing compared is never a PASS", () => {
  const empty = t(H);
  const r = compareResults(empty, t(H), KEYS, ORDER);
  assert.equal(r.pass, false);
  assert.match(renderReport(r), /Nothing was compared/);
});

test("review: --within with a list that matches no row fails", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cmp-"));
  try {
    const dir = path.join(root, "verify", "q");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "amos.csv"), "z_wp_id,z_wp_no\r\n101,A-1\r\n");
    writeFileSync(path.join(dir, "dwh.csv"), '"z_WP_ID","z_WP_NO"\r\n"101","A-1"\r\n');
    writeFileSync(path.join(dir, "list.csv"), '"z_WP_ID"\r\n"999"\r\n');
    const lines: string[] = [];
    assert.equal(compareCli(root, [path.join(dir, "amos.csv"), path.join(dir, "dwh.csv"), "--within", path.join(dir, "list.csv")], (s) => lines.push(s)), 1, lines.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("review: --amos-rows that disagrees with the file fails the overall verdict", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cmp-"));
  try {
    const dir = path.join(root, "verify", "q");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "amos.csv"), "z_wp_id,z_wp_no\r\n101,A-1\r\n");
    writeFileSync(path.join(dir, "dwh.csv"), '"z_WP_ID","z_WP_NO"\r\n"101","A-1"\r\n');
    writeFileSync(path.join(dir, "list.csv"), '"z_WP_ID"\r\n"101"\r\n');
    const lines: string[] = [];
    const code = compareCli(root, [path.join(dir, "amos.csv"), path.join(dir, "dwh.csv"), "--within", path.join(dir, "list.csv"), "--amos-rows", "500"], (s) => lines.push(s));
    const out = lines.join("\n");
    assert.equal(code, 1, out);
    assert.match(out.split("## ")[0]!, /cut short/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("review: text keys 3.10 and 3.1 are different rows; 1'596'611 still pairs with 1596611", () => {
  const h = ["z_SEQ", "z_TITLE"];
  const r = compareResults(t(h, ["3.10", "x"]), t(h, ["3.1", "x"]), ["z_SEQ"], []);
  assert.equal(r.onlyAmos, 1);
  assert.equal(r.pass, false);
  const ok = compareResults(t(h, ["1'596'611", "x"]), t(h, ["1596611", "x"]), ["z_SEQ"], []);
  assert.equal(ok.pass, true);
});

// Phase 4 (deferred Phase 3 minors the page's Compare would expose).
test("phase 4: a text column's 007 vs 7 and 3.50 vs 3.5 are real changes, not number formatting", () => {
  const h = ["z_WP_ID", "z_CODE"];
  for (const [a, d] of [["007", "7"], ["3.50", "3.5"], ["1'000", "1000"]] as const) {
    const r = compareResults(t(h, ["1", a]), t(h, ["1", d]), ["z_WP_ID"], [], { textColumns: ["z_CODE"] });
    assert.equal(r.cellDiffs[0]?.kind, "changed", `${a} vs ${d}`);
    assert.deepEqual(r.differingColumns, ["z_CODE"], `${a} vs ${d}`);
    assert.equal(r.pass, false, `${a} vs ${d}`);
  }
  // A number column keeps the export-formatting rule.
  const n = compareResults(t(h, ["1", "3.50"]), t(h, ["1", "3.5"]), ["z_WP_ID"], [], { textColumns: [] });
  assert.equal(n.cellDiffs[0]?.kind, "number_format");
  assert.equal(n.pass, true);
});

test("phase 4: a text key 1'000 does not pair with 1000", () => {
  const h = ["z_CODE", "z_X"];
  const r = compareResults(t(h, ["1'000", "x"]), t(h, ["1000", "x"]), ["z_CODE"], [], { textColumns: ["z_CODE", "z_X"] });
  assert.equal(r.onlyAmos, 1);
  assert.equal(r.pass, false);
});

/** A verify folder with amos.csv/dwh.csv that match, plus optional pack and source. */
function packRoot(pack: object | undefined, sourceText?: string): { root: string; dir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "cmp-"));
  const dir = path.join(root, "verify", "q");
  mkdirSync(dir, { recursive: true });
  if (sourceText !== undefined) writeFileSync(path.join(root, "q.sql"), sourceText);
  if (pack) writeFileSync(path.join(dir, "pack.json"), JSON.stringify(pack));
  writeFileSync(path.join(dir, "amos.csv"), "z_wp_id,z_wp_no\r\n101,A-1\r\n");
  writeFileSync(path.join(dir, "dwh.csv"), '"z_WP_ID","z_WP_NO"\r\n"101","A-1"\r\n');
  return { root, dir };
}

test("phase 4: dwh:compare names a missing pack.json and what it means", () => {
  const { root, dir } = packRoot(undefined);
  try {
    const lines: string[] = [];
    compareCli(root, [path.join(dir, "amos.csv"), path.join(dir, "dwh.csv")], (s) => lines.push(s));
    const head = lines.join("\n").split("## ")[0]!;
    assert.match(head, /No pack\.json/);
    assert.match(head, /row order was not checked/);
    assert.match(head, /dwh:verify-pack/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("phase 4: dwh:compare fails and says so when the query file changed after the pack was made", () => {
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const { root, dir } = packRoot({ source: "q.sql", sourceSha256: sha("SELECT 1\n"), at: "2026-11-10T06:00:00Z", params: {}, orderKeys: [], outputs: [], warnings: [] }, "SELECT 2\n");
  try {
    const lines: string[] = [];
    const code = compareCli(root, [path.join(dir, "amos.csv"), path.join(dir, "dwh.csv")], (s) => lines.push(s));
    const out = lines.join("\n");
    assert.equal(code, 1, out);
    assert.match(out.split("## ")[0]!, /q\.sql changed after the pack was made/);
    // Unchanged source (CRLF on disk = LF in the pack): no complaint, PASS.
    writeFileSync(path.join(root, "q.sql"), "SELECT 1\r\n");
    const again: string[] = [];
    assert.equal(compareCli(root, [path.join(dir, "amos.csv"), path.join(dir, "dwh.csv")], (s) => again.push(s)), 0, again.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
