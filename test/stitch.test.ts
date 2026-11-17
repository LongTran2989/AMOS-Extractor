import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv, stitch, compareTables } from "../src/stitch/stitch.ts";

test("csv roundtrip keeps quotes, commas and newlines", () => {
  const t = { header: ["a", "b"], rows: [['x,"y"', "line1\nline2"], ["", "z"]] };
  assert.deepEqual(parseCsv(toCsv(t)), t);
});

const steps = parseCsv("z_WP_ID,z_WORKSTEP_NO,z_WORKSTEP_LINK_ID\n1,1,10\n1,2,11\n1,,\n");
const parts = parseCsv("z_WORKSTEP_LINK_ID,z_PART_NO,z_PART_QTY,z_PART_NO_PCF\n10,P1,1,\n10,P2,2,Y\n99,ORPHAN,1,\n");

test("stitch rebuilds step x part rows in step order", () => {
  const { table, orphanParts } = stitch(steps, parts);
  assert.deepEqual(table.header, ["z_WP_ID", "z_WORKSTEP_NO", "z_PART_NO", "z_PART_QTY", "z_PART_NO_PCF"]);
  assert.deepEqual(table.rows, [
    ["1", "1", "P1", "1", ""],
    ["1", "1", "P2", "2", "Y"],
    ["1", "2", "", "", ""],
    ["1", "", "", "", ""],
  ]);
  assert.equal(orphanParts, 1);
});

test("compareTables ignores row order but not content", () => {
  const a = stitch(steps, parts).table;
  const b = { header: a.header, rows: [...a.rows].reverse() };
  assert.deepEqual(compareTables(a, b), []);
  assert.equal(compareTables(a, { header: a.header, rows: a.rows.slice(1) }).length > 0, true);
});

test("headers are matched case-insensitively and NULL marker is mirrored", () => {
  const st = parseCsv("z_wp_id,z_workstep_link_id\n1,10\n1, \n");
  const pt = parseCsv("z_workstep_link_id,z_part_no\n10,P1\n");
  const { table } = stitch(st, pt);
  assert.deepEqual(table.header, ["z_wp_id", "z_part_no"]);
  assert.deepEqual(table.rows, [["1", "P1"], ["1", " "]]);
});

test("compareTables ignores export formatting but not real value changes", () => {
  const a = { header: ["id", "qty", "txt"], rows: [["1'797'490", "10.0", "a b"], ["2", " ", "x"]] };
  const same = { header: ["ID", "qty", "txt"], rows: [["2", "", "x"], ["1797490", "10.00", "a  b"]] };
  assert.deepEqual(compareTables(a, same), []);
  const changed = { header: a.header, rows: [["1797490", "11.00", "a b"], ["2", "", "x"]] };
  assert.equal(compareTables(a, changed).length > 0, true);
});

import { renderPair } from "../src/scaffold/wpSeqs.ts";

test("renderPair swaps station and department and refuses a template without the HAN/NTHN lines", () => {
  const t = "WHERE wp_header.station = 'HAN'\n  AND wp_department_link.department = 'NTHN'\n";
  const out = renderPair(t, { station: "SGN", department: "NGTHCM" }, "steps");
  assert.match(out, /station = 'SGN'/);
  assert.match(out, /department = 'NGTHCM'/);
  assert.doesNotMatch(out, /'HAN'|'NTHN'/);
  assert.throws(() => renderPair("SELECT 1", { station: "SGN", department: "X" }, "parts"));
});
