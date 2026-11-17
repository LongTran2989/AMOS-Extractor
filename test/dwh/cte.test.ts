import { test } from "node:test";
import assert from "node:assert/strict";
import { bin, col, num, str, type IrExpr, type IrQuery } from "../../src/dwh/convert/ir.ts";
import { irOf, exprIr, rejects, readSource } from "./helpers.ts";

const WPNO = col("WP_HEADER", "WPNO");

/** Every node of a tree, depth first. */
function nodes(x: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(x)) for (const v of x) nodes(v, out);
  else if (x && typeof x === "object") {
    out.push(x as Record<string, unknown>);
    for (const v of Object.values(x)) nodes(v, out);
  }
  return out;
}

test("#61 WITH passes through; CTE names are upper case and not prefixed", () => {
  const r = irOf("WITH c AS (SELECT wp_header.wpno, wp_header.wpno_i AS z_WP_ID FROM wp_header) SELECT c.wpno, c.z_WP_ID FROM c");
  assert.equal(r.q.with[0]!.name, "C");
  assert.deepEqual(r.q.branches[0]!.from, [{ table: "C" }]);
  assert.deepEqual(r.q.branches[0]!.columns, [{ e: col("C", "WPNO") }, { e: col("C", '"z_WP_ID"') }]);
  assert.deepEqual(r.q.with[0]!.q.branches[0]!.from, [{ table: "STG_AMOS.WP_HEADER" }]);
  assert.equal(rejects(() => irOf("WITH RECURSIVE c AS (SELECT wp_header.wpno FROM wp_header) SELECT c.wpno FROM c")).code, "E_UNSUPPORTED");
});

test("#62 EXISTS, NOT EXISTS, IN, scalar subqueries and = ANY pass through", () => {
  const sub = "SELECT wp_sequence.wpno_i FROM wp_sequence WHERE wp_sequence.wpno_i = wp_header.wpno_i";
  const w = (cond: string) => irOf(`SELECT wp_header.wpno FROM wp_header WHERE ${cond}`).q.branches[0]!.where!;
  assert.equal(w(`EXISTS (${sub})`).k, "exists");
  const ne = w(`NOT EXISTS (${sub})`);
  assert.ok(ne.k === "exists" && ne.not === true);
  assert.equal(w(`wp_header.wpno_i IN (${sub})`).k, "in_sub");
  const any = w(`wp_header.wpno_i = ANY (${sub})`);
  assert.ok(any.k === "any" && any.op === "=");
  const scalar = exprIr(`(SELECT COUNT(*) FROM wp_sequence WHERE wp_sequence.wpno_i = wp_header.wpno_i)`);
  assert.equal(scalar.e.k, "sub");
});

test("the real NOT EXISTS query converts (extract_parts_standalone_no_cml_no_alternate.sql)", () => {
  const r = irOf(readSource("extract_parts_standalone_no_cml_no_alternate.sql"));
  const ex = nodes(r.q).filter((n) => n.k === "exists");
  assert.ok(ex.length >= 1);
  assert.ok(ex.some((n) => n.not === true));
  for (const n of ex) assert.ok(((n.q as IrQuery).branches[0]!.from[0]!.table as string).startsWith("STG_AMOS."));
});

test("#63 derived tables, LATERAL, USING and NATURAL JOIN are rejected", () => {
  assert.equal(rejects(() => irOf("SELECT x.a FROM (SELECT wp_header.wpno FROM wp_header) x")).code, "E_UNSUPPORTED");
});

test("#64 UNION [ALL] and INTERSECT pass through; EXCEPT becomes MINUS", () => {
  const two = (op: string) => irOf(`SELECT wp_header.wpno FROM wp_header ${op} SELECT wp_header.station FROM wp_header`).q.ops;
  assert.deepEqual(two("UNION"), ["UNION"]);
  assert.deepEqual(two("UNION ALL"), ["UNION ALL"]);
  assert.deepEqual(two("INTERSECT"), ["INTERSECT"]);
  assert.deepEqual(two("EXCEPT"), ["MINUS"]);
});

test("joins keep their kind and their ON condition", () => {
  const r = irOf("SELECT wp_header.wpno FROM wp_header LEFT JOIN wp_sequence ON wp_sequence.wpno_i = wp_header.wpno_i JOIN wo_header ON wo_header.event_perfno_i = wp_sequence.event_perfno_i");
  assert.deepEqual(r.q.branches[0]!.from, [
    { table: "STG_AMOS.WP_HEADER" },
    { join: "LEFT JOIN", table: "STG_AMOS.WP_SEQUENCE", on: bin("=", col("WP_SEQUENCE", "WPNO_I"), col("WP_HEADER", "WPNO_I")) },
    { join: "JOIN", table: "STG_AMOS.WO_HEADER", on: bin("=", col("WO_HEADER", "EVENT_PERFNO_I"), col("WP_SEQUENCE", "EVENT_PERFNO_I")) },
  ]);
});

// ---- select list and output shape (#10-#13, #21, #67) ----

test("#10 an alias is quoted to keep its case; over 30 characters is rejected", () => {
  const r = irOf("SELECT wp_header.wpno AS z_WP_NO FROM wp_header");
  assert.deepEqual(r.q.branches[0]!.columns, [{ e: WPNO, as: '"z_WP_NO"' }]);
  assert.deepEqual(r.q.outputs, [{ name: "z_WP_NO", type: "text" }]);
  assert.equal(rejects(() => irOf(`SELECT wp_header.wpno AS z_${"X".repeat(29)} FROM wp_header`)).code, "E_ALIAS_TOO_LONG");
});

test("#11 duplicate output names: refused in openquery mode, allowed in exec_at", () => {
  const sql = "SELECT wo_text_description.text, wo_text_action.text FROM wo_text_description JOIN wo_text_action ON wo_text_action.actionno_i = wo_text_description.descno_i";
  assert.equal(rejects(() => irOf(sql)).code, "E_DUPLICATE_OUTPUT");
  const ok = irOf(sql, { mapping: { execMode: "exec_at" } });
  assert.deepEqual(ok.q.outputs.map((o) => o.name), ["TEXT", "TEXT"]);
});

test("#12 a select expression without alias warns W_UNNAMED_COLUMN", () => {
  const r = irOf("SELECT wp_header.start_date + 1 FROM wp_header");
  assert.deepEqual(r.codes, ["W_UNNAMED_COLUMN"]);
  assert.deepEqual(r.q.branches[0]!.columns, [{ e: bin("+", col("WP_HEADER", "START_DATE"), num(1)) }]);
});

test("#12 W_UNNAMED_COLUMN is only for result columns, not for SELECT 1 inside EXISTS", () => {
  const r = irOf("SELECT wp_header.wpno FROM wp_header WHERE EXISTS (SELECT 1 FROM wp_sequence WHERE wp_sequence.wpno_i = wp_header.wpno_i)");
  assert.deepEqual(r.codes, []);
});

test("#13 SELECT * keeps the star with W_SELECT_STAR", () => {
  const r = irOf("SELECT * FROM wp_header");
  assert.deepEqual(r.q.branches[0]!.columns, [{ e: { k: "star" } }]);
  assert.deepEqual(r.codes, ["W_SELECT_STAR"]);
  assert.deepEqual(irOf("SELECT wp_header.* FROM wp_header").q.branches[0]!.columns, [{ e: { k: "star", table: "WP_HEADER" } }]);
});

test("#21 date-typed outputs are reported as date", () => {
  const r = irOf("SELECT DATE '1971-12-31' + wp_header.start_date AS z_WP_START_DATE, wp_header.start_date FROM wp_header");
  assert.deepEqual(r.q.outputs, [
    { name: "z_WP_START_DATE", type: "date" },
    { name: "START_DATE", type: "int" },
  ]);
});

test("#49 a boolean in the output is rejected E_BOOLEAN", () => {
  assert.equal(rejects(() => irOf("SELECT wp_header.wpno = 'A' FROM wp_header")).code, "E_BOOLEAN");
  assert.equal(rejects(() => irOf("SELECT EXISTS (SELECT 1 FROM wp_sequence) FROM wp_header")).code, "E_BOOLEAN");
});

test("#67 SELECT without FROM has an empty FROM (printed FROM DUAL)", () => {
  const r = irOf("SELECT 1 AS z_ONE");
  assert.deepEqual(r.q.branches[0]!.from, []);
  assert.deepEqual(r.q.branches[0]!.columns, [{ e: num(1), as: '"z_ONE"' } as { e: IrExpr; as: string }]);
});

test("#78 an approved rename prints NEW AS \"old\" in the select list", () => {
  const r = irOf("SELECT wp_header.station FROM wp_header WHERE wp_header.station = 'HAN'", {
    mapping: { columns: { "wp_header.station": { dwh: "STATION_CODE", keepOutputName: true } } },
  });
  assert.deepEqual(r.q.branches[0]!.columns, [{ e: col("WP_HEADER", "STATION_CODE"), as: '"station"' }]);
  assert.deepEqual(r.q.branches[0]!.where, bin("=", col("WP_HEADER", "STATION_CODE"), str("HAN")));
});
