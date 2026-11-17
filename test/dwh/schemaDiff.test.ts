import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import type { Model } from "../../src/schema/types.ts";
import { loadModel } from "../../src/schema/load.ts";
import type { Catalogue, CatalogueColumn } from "../../src/dwh/catalogue.ts";
import { fetchCatalogue, catalogueStatement } from "../../src/dwh/catalogue.ts";
import { diffSchema, renderDiffMarkdown, type SchemaIssue } from "../../src/dwh/schemaDiff.ts";
import { MAPPING, ROOT, csvIndex } from "./helpers.ts";
import { fakePool } from "./fakePool.ts";

const NO_MODEL = { fieldByColumn: new Map() } as unknown as Model;

let id = 0;
function c(table: string, name: string, dataType = "NUMBER", charLength: number | null = null): CatalogueColumn {
  return { table, name, columnId: ++id, dataType, dataLength: charLength, charLength, precision: null, scale: null, nullable: true };
}
const cat = (...columns: CatalogueColumn[]): Catalogue => ({ takenAt: "2026-11-17T10:00:00Z", columns });
const WP = [c("WP_HEADER", "WPNO_I"), c("WP_HEADER", "START_DATE"), c("WP_HEADER", "STATION", "VARCHAR2", 4), c("WP_HEADER", "WPNO", "VARCHAR2", 70)];

const diff = (catalogue: Catalogue, used: string[], over: Partial<typeof MAPPING> = {}, model: Model = NO_MODEL) =>
  diffSchema(catalogue, csvIndex(), model, used, { ...MAPPING, ...over });
const kinds = (issues: SchemaIssue[]) => issues.map((i) => `${i.kind}:${i.severity}:${i.table}${i.column ? `.${i.column}` : ""}`);

test("a matching table and column gives no issue (int4 <-> NUMBER, varchar(4) <-> VARCHAR2(4))", () => {
  assert.deepEqual(diff(cat(...WP), ["wp_header.start_date", "wp_header.station"]), []);
});

test("missing_table is an error", () => {
  assert.deepEqual(kinds(diff(cat(...WP), ["wp_status.name", "wp_header.wpno"])), ["missing_table:error:WP_STATUS"]);
});

test("a table used without any column is still checked", () => {
  assert.deepEqual(kinds(diff(cat(...WP), ["wp_status"])), ["missing_table:error:WP_STATUS"]);
});

test("missing_column is an error", () => {
  assert.deepEqual(kinds(diff(cat(...WP), ["wp_header.end_date"])), ["missing_column:error:WP_HEADER.END_DATE"]);
});

test("case_only is info", () => {
  const issues = diff(cat(c("WP_HEADER", "Station", "VARCHAR2", 4)), ["wp_header.station"]);
  assert.deepEqual(kinds(issues), ["case_only:info:WP_HEADER.STATION"]);
  assert.equal(issues[0]!.dwh, "Station");
});

test("a date int stored as Oracle DATE or TIMESTAMP is retyped (error)", () => {
  for (const t of ["DATE", "TIMESTAMP(6)"]) {
    assert.deepEqual(kinds(diff(cat(c("WP_HEADER", "START_DATE", t)), ["wp_header.start_date"])), ["retyped:error:WP_HEADER.START_DATE"], t);
  }
  assert.deepEqual(kinds(diff(cat(c("WP_HEADER", "STATION", "NUMBER")), ["wp_header.station"])), ["retyped:error:WP_HEADER.STATION"]);
});

test("varchar(n) into a shorter VARCHAR2/NVARCHAR2 is a truncation_risk warning", () => {
  assert.deepEqual(kinds(diff(cat(c("WP_HEADER", "STATION", "VARCHAR2", 3)), ["wp_header.station"])), ["truncation_risk:warning:WP_HEADER.STATION"]);
  assert.deepEqual(kinds(diff(cat(c("WP_HEADER", "STATION", "NVARCHAR2", 2)), ["wp_header.station"])), ["truncation_risk:warning:WP_HEADER.STATION"]);
  assert.deepEqual(diff(cat(c("WP_HEADER", "STATION", "NVARCHAR2", 10)), ["wp_header.station"]), []);
});

test("text <-> VARCHAR2(4000) is a truncation_risk warning; text <-> CLOB is fine", () => {
  const used = ["wo_text_description.text_html"];
  assert.deepEqual(kinds(diff(cat(c("WO_TEXT_DESCRIPTION", "TEXT_HTML", "VARCHAR2", 4000)), used)), ["truncation_risk:warning:WO_TEXT_DESCRIPTION.TEXT_HTML"]);
  assert.deepEqual(diff(cat(c("WO_TEXT_DESCRIPTION", "TEXT_HTML", "CLOB")), used), []);
  assert.deepEqual(diff(cat(c("WO_TEXT_DESCRIPTION", "TEXT_HTML", "NCLOB")), used), []);
});

test("float8 <-> BINARY_DOUBLE, NUMBER or FLOAT is fine", () => {
  for (const t of ["BINARY_DOUBLE", "NUMBER", "FLOAT"]) {
    assert.deepEqual(diff(cat(c("TIME_CAPTURED", "PROD_FACTOR", t)), ["time_captured.prod_factor"]), [], t);
  }
});

test("VARCHAR2 or CLOB in a non-Unicode database is maybe_lost_unicode; NVARCHAR2 is not", () => {
  const over = { dbCharset: "WE8MSWIN1252" };
  assert.deepEqual(kinds(diff(cat(c("WP_HEADER", "STATION", "VARCHAR2", 4)), ["wp_header.station"], over)), ["maybe_lost_unicode:warning:WP_HEADER.STATION"]);
  assert.deepEqual(kinds(diff(cat(c("WO_TEXT_DESCRIPTION", "TEXT_HTML", "CLOB")), ["wo_text_description.text_html"], over)), ["maybe_lost_unicode:warning:WO_TEXT_DESCRIPTION.TEXT_HTML"]);
  assert.deepEqual(diff(cat(c("WP_HEADER", "STATION", "NVARCHAR2", 4)), ["wp_header.station"], over), []);
});

test("extra_column is info: a DWH column of a checked table that AMOS does not have", () => {
  assert.deepEqual(kinds(diff(cat(...WP, c("WP_HEADER", "DWH_LOAD_ID")), ["wp_header.wpno"])), ["extra_column:info:WP_HEADER.DWH_LOAD_ID"]);
});

test("a rename in mapping.yaml is looked up under its DWH name", () => {
  const renamed = { columns: { "wp_header.station": { dwh: "STATION_CODE", keepOutputName: true } } };
  assert.deepEqual(diff(cat(c("WP_HEADER", "STATION_CODE", "VARCHAR2", 4)), ["wp_header.station"], renamed), []);
});

test("columns named in schema/*.yaml are checked too", () => {
  const model = loadModel(path.join(ROOT, "schema"));
  const issues = diff(cat(...WP), [], {}, model);
  assert.ok(issues.some((i) => i.kind === "missing_table" && i.table === "WO_HEADER"));
});

test("issues are sorted errors first, then by table and column", () => {
  const issues = diff(cat(c("WP_HEADER", "STATION", "VARCHAR2", 3), c("WP_HEADER", "Wpno", "VARCHAR2", 70), c("WP_HEADER", "START_DATE")), ["wp_header.station", "wp_header.wpno", "wp_header.end_date", "wp_status.name"]);
  assert.deepEqual(kinds(issues), [
    "missing_column:error:WP_HEADER.END_DATE",
    "missing_table:error:WP_STATUS",
    "truncation_risk:warning:WP_HEADER.STATION",
    "case_only:info:WP_HEADER.WPNO",
  ]);
});

test("markdown is stable", () => {
  const catalogue = cat(c("WP_HEADER", "STATION", "VARCHAR2", 3));
  const issues = diff(catalogue, ["wp_header.station", "wp_status.name"]);
  const md = renderDiffMarkdown(issues, catalogue);
  assert.equal(md, renderDiffMarkdown([...issues].reverse(), catalogue));
  assert.match(md, /^<!-- GENERATED/);
  assert.match(md, /2026-11-17T10:00:00Z/);
  assert.match(md, /\| error \| missing_table \| WP_STATUS \|/);
  assert.ok(md.endsWith("\n") && !md.includes("\r"));
});

test("fetchCatalogue sends the one fixed statement and returns sorted columns", async () => {
  const rows = [
    ["WP_HEADER", "STATION", 3, "VARCHAR2", 4, 4, null, null, "Y"],
    ["WO_HEADER", "STATE", 2, "VARCHAR2", 1, 1, null, null, "N"],
    ["WP_HEADER", "WPNO_I", 1, "NUMBER", 22, 0, 10, 0, "N"],
  ];
  const pool = fakePool(["TABLE_NAME", "COLUMN_NAME", "COLUMN_ID", "DATA_TYPE", "DATA_LENGTH", "CHAR_LENGTH", "DATA_PRECISION", "DATA_SCALE", "NULLABLE"], rows);
  const got = await fetchCatalogue(pool, MAPPING);
  assert.equal(
    pool.made[0]!.sent,
    "SELECT * FROM OPENQUERY([DWH_DB], 'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_ID, DATA_TYPE, DATA_LENGTH, CHAR_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE FROM ALL_TAB_COLUMNS WHERE OWNER = ''STG_AMOS''')",
  );
  assert.equal(catalogueStatement(MAPPING), pool.made[0]!.sent);
  assert.match(got.takenAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual(got.columns.map((x) => `${x.table}.${x.name}`), ["WO_HEADER.STATE", "WP_HEADER.WPNO_I", "WP_HEADER.STATION"]);
  assert.deepEqual(got.columns[1], { table: "WP_HEADER", name: "WPNO_I", columnId: 1, dataType: "NUMBER", dataLength: 22, charLength: 0, precision: 10, scale: 0, nullable: false });
  assert.equal(got.columns[2]!.nullable, true);
});

test("catalogueStatement refuses an odd schema name", () => {
  assert.throws(() => catalogueStatement({ ...MAPPING, oracleSchema: "STG_AMOS' OR 1=1 --" }), /schema/);
});
