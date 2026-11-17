import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { loadCsvIndex } from "../../src/schema/csv.ts";
import { loadMapping, type DwhMapping } from "../../src/dwh/mapping.ts";
import { loadCatalogue, type Catalogue } from "../../src/dwh/catalogue.ts";
import { resolveScopes, oracleTableName, oracleColumnName, availability } from "../../src/dwh/convert/scope.ts";
import { parsePg } from "../../src/dwh/convert/guard.ts";
import { preprocess } from "../../src/dwh/convert/preprocess.ts";
import type { ConvertWarning } from "../../src/dwh/convert/errors.ts";
import { ROOT, rejects, readSource } from "./helpers.ts";

const csv = loadCsvIndex(path.join(ROOT, "Database-Description-AMOS-csv.csv"));
const mapping = loadMapping(path.join(ROOT, "dwh", "mapping.yaml"));
const fixture = loadCatalogue(path.join(ROOT, "test", "dwh", "fixtures", "catalogue.min.json"))!;
const scope = (sql: string) => resolveScopes(parsePg(preprocess(sql).sql), csv);

function catalogueWith(...cols: [string, string, string][]): Catalogue {
  return {
    takenAt: "2026-11-17T00:00:00Z",
    columns: cols.map(([table, name, dataType], i) => ({
      table, name, columnId: i + 1, dataType, dataLength: 22, charLength: null, precision: null, scale: null, nullable: true,
    })),
  };
}

test("mapping.yaml loads with the Phase 0b values", () => {
  assert.equal(mapping.linkedServer, "DWH_DB");
  assert.equal(mapping.oracleSchema, "STG_AMOS");
  assert.equal(mapping.execMode, "openquery");
  assert.equal(mapping.oracleVersion, 12);
  assert.equal(mapping.nlsComp, "BINARY");
  assert.equal(mapping.nlsSort, "BINARY");
  assert.equal(mapping.dbCharset, "AL32UTF8");
  assert.deepEqual(mapping.columns, {});
  assert.equal(mapping.amosCollation, "other");
  assert.equal(mapping.exportRowLimit, 2000000);
});

test("a missing catalogue file loads as undefined", () => {
  assert.equal(loadCatalogue(path.join(ROOT, "dwh", "no-such-catalogue.json")), undefined);
});

test("#1 table and column references use STG_AMOS.<TABLE> and <TABLE>.<COLUMN>", () => {
  const ctx = { mapping, catalogue: fixture, csv };
  assert.equal(oracleTableName("wo_header", ctx), "STG_AMOS.WO_HEADER");
  assert.deepEqual(oracleColumnName("wo_header.event_perfno_i", ctx), { name: "EVENT_PERFNO_I" });
  const s = scope("SELECT wo_header.event_perfno_i, wo_header.state FROM wo_header");
  assert.deepEqual(s.usedTables(), ["wo_header"]);
  assert.deepEqual(s.usedColumns(), ["wo_header.event_perfno_i", "wo_header.state"]);
});

test("#2 CTE names are not prefixed and resolve inside subqueries", () => {
  const s = scope(
    "WITH c AS (SELECT wo_header.state, wo_header.event_perfno_i AS z_X FROM wo_header)\n" +
      "SELECT c.state FROM c WHERE EXISTS (SELECT 1 FROM c WHERE c.z_x = 1)",
  );
  assert.equal(s.isCte("c"), true);
  assert.equal(s.isCte("wo_header"), false);
  assert.deepEqual(s.usedTables(), ["wo_header"]);
  assert.equal(s.pgTypeOf(s.root.columns[0].expr), "text");
  assert.equal(s.tableOf(s.root.columns[0].expr), "c");
});

test("#4 unqualified column is rejected", () => {
  const e = rejects(() => scope("SELECT wo_header.state\nFROM wo_header\nWHERE state = 'O'"));
  assert.equal(e.code, "E_UNQUALIFIED_COLUMN");
  assert.equal(e.loc?.line, 3);
});

test("#4 ORDER BY may name a select alias without a table", () => {
  assert.doesNotThrow(() => scope("SELECT wo_header.state AS z_X FROM wo_header ORDER BY z_X"));
});

test("#5 column not in the AMOS CSV is rejected anywhere in the query", () => {
  let e = rejects(() => scope("SELECT wo_header.no_such_col FROM wo_header"));
  assert.equal(e.code, "E_UNKNOWN_COLUMN");
  e = rejects(() => scope("SELECT wo_header.state\nFROM wo_header\nWHERE wo_header.no_such_col = 1"));
  assert.equal(e.code, "E_UNKNOWN_COLUMN");
  assert.equal(e.loc?.line, 3);
  e = rejects(() => scope("SELECT no_such_table.x FROM no_such_table"));
  assert.equal(e.code, "E_UNKNOWN_TABLE");
  e = rejects(() => scope("SELECT wp_header.wpno FROM wo_header"));
  assert.equal(e.code, "E_UNKNOWN_TABLE");
});

test("#6 tables and columns missing from the DWH are listed, conversion is unaffected", () => {
  const s = scope("SELECT wp_header.wpno, wp_status.name FROM wp_header JOIN wp_status ON wp_status.wp_status_id = wp_header.wp_status");
  assert.deepEqual(availability(s, fixture), { available: false, missing: ["WP_STATUS"] });
  const cat = catalogueWith(["WP_HEADER", "WPNO", "VARCHAR2"], ["WP_STATUS", "NAME", "VARCHAR2"], ["WP_STATUS", "WP_STATUS_ID", "NUMBER"]);
  assert.deepEqual(availability(s, cat), { available: false, missing: ["WP_HEADER.WP_STATUS"] });
  assert.deepEqual(availability(s, undefined), { available: "unknown", missing: [] });
  assert.deepEqual(availability(scope("SELECT wp_header.wpno FROM wp_header"), fixture), { available: true, missing: [] });
});

test("mapping.yaml lists the six AMOS tables missing in the DWH", () => {
  assert.deepEqual(mapping.knownMissingTables, ["wp_status", "wp_department_link", "cml_reference", "oem_doc_partno", "taskcard_coversheet_info", "time_captured_history"]);
});

test("without a catalogue, availability uses the missing tables recorded in mapping.yaml", () => {
  const steps = scope(readSource("extract_wp_seqs_steps.sql"));
  assert.deepEqual(availability(steps, undefined, mapping), { available: false, missing: ["WP_DEPARTMENT_LINK", "WP_STATUS"] });
  // No known missing table: columns are not checked yet, so it stays unknown.
  assert.deepEqual(availability(scope("SELECT wp_header.wpno FROM wp_header"), undefined, mapping), { available: "unknown", missing: [] });
});

test("availability lists WP_STATUS and WP_DEPARTMENT_LINK for extract_wp_seqs_steps.sql", () => {
  const s = scope(readSource("extract_wp_seqs_steps.sql"));
  assert.deepEqual(availability(s, fixture), { available: false, missing: ["WP_DEPARTMENT_LINK", "WP_STATUS"] });
});

test("#7 names use the exact catalogue case; upper case without a catalogue", () => {
  assert.equal(oracleTableName("wo_header", { mapping, csv }), "STG_AMOS.WO_HEADER");
  assert.deepEqual(oracleColumnName("wo_header.state", { mapping, csv }), { name: "STATE" });
  const mixed = catalogueWith(["Wo_Header", "State", "VARCHAR2"]);
  assert.equal(oracleTableName("wo_header", { mapping, catalogue: mixed, csv }), 'STG_AMOS."Wo_Header"');
  assert.deepEqual(oracleColumnName("wo_header.state", { mapping, catalogue: mixed, csv }), { name: '"State"' });
});

test("#8 Oracle reserved words are quoted in catalogue case", () => {
  const cat = catalogueWith(["WO_HEADER", "LEVEL", "NUMBER"]);
  assert.deepEqual(oracleColumnName("wo_header.level", { mapping, catalogue: cat, csv }), { name: '"LEVEL"' });
  assert.deepEqual(oracleColumnName("wo_header.comment", { mapping, csv }), { name: '"COMMENT"' });
});

test("#78 a renamed column needs approval in mapping.yaml", () => {
  const renamed: DwhMapping = { ...mapping, columns: { "wo_header.state": { dwh: "STATE_NEW" } } };
  assert.equal(rejects(() => oracleColumnName("wo_header.state", { mapping: renamed, csv })).code, "E_RENAMED_NEEDS_APPROVAL");
  const approved: DwhMapping = { ...mapping, columns: { "wo_header.state": { dwh: "STATE_NEW", keepOutputName: true } } };
  assert.deepEqual(oracleColumnName("wo_header.state", { mapping: approved, csv }), { name: "STATE_NEW", aliasAs: "state" });
});

test("#79 a retyped column is rejected when a rewrite depends on its type, else warned", () => {
  const cat = catalogueWith(["WP_HEADER", "START_DATE", "DATE"]);
  const e = rejects(() => oracleColumnName("wp_header.start_date", { mapping, catalogue: cat, csv, usage: "expr" }));
  assert.equal(e.code, "E_RETYPED_COLUMN");
  const warnings: ConvertWarning[] = [];
  assert.deepEqual(oracleColumnName("wp_header.start_date", { mapping, catalogue: cat, csv, usage: "output", warnings }), { name: "START_DATE" });
  assert.deepEqual(warnings.map((w) => w.code), ["W_RETYPED_COLUMN"]);
  // NUMBER for an int4 column and VARCHAR2 for a varchar column are not retyped.
  const ok = catalogueWith(["WP_HEADER", "START_DATE", "NUMBER"], ["WP_HEADER", "WPNO", "VARCHAR2"]);
  assert.doesNotThrow(() => oracleColumnName("wp_header.start_date", { mapping, catalogue: ok, csv, usage: "expr" }));
  assert.doesNotThrow(() => oracleColumnName("wp_header.wpno", { mapping, catalogue: ok, csv, usage: "expr" }));
});
