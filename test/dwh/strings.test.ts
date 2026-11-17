import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalogue } from "../../src/dwh/catalogue.ts";
import { bin, col, fn, nstr, str } from "../../src/dwh/convert/ir.ts";
import { irOf, rejects } from "./helpers.ts";

const WPNO = col("WP_HEADER", "WPNO");
const where = (sql: string, opts = {}) => {
  const r = irOf(`SELECT wp_header.wpno_i FROM wp_header WHERE ${sql}`, opts);
  return { w: r.q.branches[0]!.where!, codes: r.codes };
};

test("#40 string =, IN, <> pass through without a warning under NLS_COMP = BINARY", () => {
  assert.deepEqual(where("wp_header.wpno = 'A'"), { w: bin("=", WPNO, str("A")), codes: [] });
  assert.deepEqual(where("wp_header.wpno <> 'A'").w, bin("<>", WPNO, str("A")));
  assert.deepEqual(where("wp_header.wpno != 'A'").w, bin("<>", WPNO, str("A")));
  assert.deepEqual(where("wp_header.wpno IN ('A', 'B')"), { w: { k: "in", not: false, e: WPNO, list: [str("A"), str("B")] }, codes: [] });
  assert.deepEqual(where("wp_header.wpno NOT IN ('A')").w, { k: "in", not: true, e: WPNO, list: [str("A")] });
});

test("#40 W_STRING_COMPARE under NLS_COMP = LINGUISTIC; W_CHAR_PADDED for a CHAR column", () => {
  assert.deepEqual(where("wp_header.wpno = 'A'", { mapping: { nlsComp: "LINGUISTIC" } }).codes, ["W_STRING_COMPARE"]);
  const cat: Catalogue = {
    takenAt: "x",
    columns: [{ table: "WP_HEADER", name: "WPNO", columnId: 1, dataType: "CHAR", dataLength: 70, charLength: 70, precision: null, scale: null, nullable: true }],
  };
  assert.deepEqual(where("wp_header.wpno = 'A'", { catalogue: cat }).codes, ["W_CHAR_PADDED"]);
});

test("#41 an empty string literal is rejected E_EMPTY_STRING", () => {
  assert.equal(rejects(() => where("wp_header.wpno = ''")).code, "E_EMPTY_STRING");
  assert.equal(rejects(() => irOf("SELECT COALESCE(wp_header.wpno, '') FROM wp_header")).code, "E_EMPTY_STRING");
});

test("#42 IS NULL / IS NOT NULL on text warns W_EMPTY_IS_NULL; on numbers it does not", () => {
  assert.deepEqual(where("wp_header.wpno IS NULL"), { w: { k: "isnull", not: false, e: WPNO }, codes: ["W_EMPTY_IS_NULL"] });
  assert.deepEqual(where("wp_header.end_date IS NOT NULL"), { w: { k: "isnull", not: true, e: col("WP_HEADER", "END_DATE") }, codes: [] });
});

test("#43 LIKE passes; a pattern with a backslash is rejected", () => {
  assert.deepEqual(where("wp_header.wpno LIKE 'A%'").w, { k: "like", not: false, e: WPNO, pat: str("A%") });
  assert.deepEqual(where("wp_header.wpno NOT LIKE 'A_'").w, { k: "like", not: true, e: WPNO, pat: str("A_") });
  assert.equal(rejects(() => where("wp_header.wpno LIKE 'A\\%'")).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => where("wp_header.wpno LIKE wp_header.description")).code, "E_UNSUPPORTED");
});

test("#44 ILIKE becomes LOWER(x) LIKE LOWER('pat')", () => {
  assert.deepEqual(where("wp_header.wpno ILIKE 'a%'").w, { k: "like", not: false, e: fn("LOWER", WPNO), pat: fn("LOWER", str("a%")) });
  assert.deepEqual(where("wp_header.wpno NOT ILIKE 'a%'").w, { k: "like", not: true, e: fn("LOWER", WPNO), pat: fn("LOWER", str("a%")) });
});

test("#45 SIMILAR TO and regular expressions are rejected", () => {
  assert.equal(rejects(() => where("wp_header.wpno SIMILAR TO 'a'")).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => where("wp_header.wpno ~ 'a'")).code, "E_UNSUPPORTED");
});

test("#46 || is rejected E_CONCAT", () => {
  assert.equal(rejects(() => irOf("SELECT wp_header.wpno || wp_header.station FROM wp_header")).code, "E_CONCAT");
});

test("#47 a non-ASCII literal becomes N'...'", () => {
  assert.deepEqual(where("wp_header.description = 'BÌNH XỊT ĐI CAN VN512'").w, bin("=", col("WP_HEADER", "DESCRIPTION"), nstr("BÌNH XỊT ĐI CAN VN512")));
});

test("#48 a quote inside a literal is kept as data (the printer doubles it)", () => {
  assert.deepEqual(where("wp_header.wpno = 'it''s'").w, bin("=", WPNO, str("it's")));
});
