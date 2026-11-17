import { test } from "node:test";
import assert from "node:assert/strict";
import { col, type IrExpr } from "../../src/dwh/convert/ir.ts";
import { irOf, readSource, rejects } from "./helpers.ts";

const WPNO = col("WP_HEADER", "WPNO");
const SD = col("WP_HEADER", "START_DATE");

test("#36 NULL ordering is written explicitly: ASC -> NULLS LAST, DESC -> NULLS FIRST, explicit honoured", () => {
  const r = irOf("SELECT wp_header.wpno, wp_header.start_date FROM wp_header ORDER BY wp_header.start_date, wp_header.wpno_i DESC, wp_header.wpno NULLS FIRST, wp_header.end_date DESC NULLS LAST");
  assert.deepEqual(r.q.orderBy, [
    { e: SD, desc: false, nulls: "LAST" },
    { e: col("WP_HEADER", "WPNO_I"), desc: true, nulls: "FIRST" },
    { e: WPNO, desc: false, nulls: "FIRST" },
    { e: col("WP_HEADER", "END_DATE"), desc: true, nulls: "LAST" },
  ]);
});

test("#36 NULL ordering inside OVER (...)", () => {
  const r = irOf("SELECT ROW_NUMBER() OVER (PARTITION BY wp_header.station ORDER BY wp_header.start_date DESC) FROM wp_header");
  const e = r.q.branches[0]!.columns[0]!.e;
  assert.ok(e.k === "fn" && e.over);
  if (e.k === "fn") assert.deepEqual(e.over!.orderBy, [{ e: SD, desc: true, nulls: "FIRST" }]);
});

test("#36 works with DISTINCT and UNION", () => {
  const d = irOf("SELECT DISTINCT wp_header.start_date FROM wp_header ORDER BY wp_header.start_date");
  assert.equal(d.q.branches[0]!.distinct, true);
  assert.deepEqual(d.q.orderBy, [{ e: SD, desc: false, nulls: "LAST" }]);
  const u = irOf("SELECT wp_header.start_date FROM wp_header UNION SELECT wp_header.end_date FROM wp_header ORDER BY 1 DESC");
  assert.deepEqual(u.q.orderBy, [{ e: { k: "ordinal", n: 1 }, desc: true, nulls: "FIRST" }]);
  assert.deepEqual(u.q.ops, ["UNION"]);
});

test("#37 ORDER BY alias or ordinal is resolved to the select expression", () => {
  const a = irOf("SELECT wp_header.wpno AS z_WP_NO, wp_header.start_date FROM wp_header ORDER BY z_WP_NO, 2 DESC");
  assert.deepEqual(a.q.orderBy, [
    { e: WPNO, desc: false, nulls: "LAST" },
    { e: SD, desc: true, nulls: "FIRST" },
  ]);
  assert.deepEqual(a.q.orderKeys, ["z_WP_NO", "START_DATE"]);
  const u = irOf("SELECT wp_header.wpno AS z_WP_NO FROM wp_header UNION ALL SELECT wp_header.description FROM wp_header ORDER BY z_WP_NO");
  assert.deepEqual(u.q.orderBy, [{ e: { k: "ordinal", n: 1 } as IrExpr, desc: false, nulls: "LAST" }]);
});

test("#37 / #57 a position in ORDER BY or GROUP BY next to * is rejected (* expands to many columns)", () => {
  assert.equal(rejects(() => irOf("SELECT wp_header.*, wp_header.station AS z_WP_STATION FROM wp_header ORDER BY 2")).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => irOf("SELECT wp_header.*, COUNT(*) FROM wp_header GROUP BY 1")).code, "E_UNSUPPORTED");
});

test("#38 text sort keys warn W_STRING_ORDER; number keys do not", () => {
  assert.deepEqual(irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno").codes, ["W_STRING_ORDER"]);
  assert.deepEqual(irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.start_date").codes, []);
  // A C-collated AMOS would sort like Oracle BINARY.
  assert.deepEqual(irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno", { mapping: { amosCollation: "C" } }).codes, []);
});

test("the converted real steps query orders z_WP_SEQ_1ST with NULLS LAST", () => {
  const r = irOf(readSource("extract_wp_seqs_steps.sql"));
  assert.deepEqual(r.q.orderBy[1], { e: col("WP_SEQUENCE", "SEQNO_PREFIX_I"), desc: false, nulls: "LAST" });
  assert.deepEqual(r.q.orderKeys, ["z_WP_NO", "z_WP_SEQ_1ST", "z_WP_SEQ_2ND", "z_WORKSTEP_NO"]);
});
