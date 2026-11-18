import { test } from "node:test";
import assert from "node:assert/strict";
import { cast, col, fn, num } from "../../src/dwh/convert/ir.ts";
import { exprIr, rejects } from "./helpers.ts";

const SD = col("WP_HEADER", "START_DATE");

test("#20 ::date becomes TRUNC", () => {
  assert.deepEqual(exprIr("(DATE '1971-12-31' + wp_header.start_date)::date").e, fn("TRUNC", { k: "bin", op: "+", l: { k: "date", v: "1971-12-31" }, r: SD }));
});

test("#28 ::integer / ::bigint / ::smallint from an integer become CAST(... AS NUMBER(10|19|5))", () => {
  assert.deepEqual(exprIr("wp_header.start_date::integer").e, cast(SD, "NUMBER(10)"));
  assert.deepEqual(exprIr("wp_header.start_date::int").e, cast(SD, "NUMBER(10)"));
  assert.deepEqual(exprIr("CAST(wp_header.start_date AS bigint)").e, cast(SD, "NUMBER(19)"));
  assert.deepEqual(exprIr("wp_header.start_date::smallint").e, cast(SD, "NUMBER(5)"));
  assert.deepEqual(exprIr("5::integer").e, cast(num(5), "NUMBER(10)"));
});

test("#28 integer cast from float or numeric is rejected E_INT_CAST_FROM_NON_INT", () => {
  assert.equal(rejects(() => exprIr("2.5::integer")).code, "E_INT_CAST_FROM_NON_INT");
  assert.equal(rejects(() => exprIr("(wp_header.start_date / 2.0)::integer")).code, "E_INT_CAST_FROM_NON_INT");
  assert.equal(rejects(() => exprIr("wp_header.wpno::integer")).code, "E_UNSUPPORTED");
});

test("#29 ::numeric(p,s) becomes CAST(... AS NUMBER(p,s)); bare ::numeric is rejected", () => {
  assert.deepEqual(exprIr("wp_header.start_date::numeric(10,2)").e, cast(SD, "NUMBER(10,2)"));
  assert.deepEqual(exprIr("CAST(wp_header.start_date AS numeric(12))").e, cast(SD, "NUMBER(12)"));
  assert.equal(rejects(() => exprIr("wp_header.start_date::numeric")).code, "E_UNSUPPORTED");
});

test("#30 ::text / ::varchar(n) from an integer become TO_CHAR; anything else is rejected", () => {
  assert.deepEqual(exprIr("wp_header.start_date::text").e, fn("TO_CHAR", SD));
  assert.deepEqual(exprIr("wp_header.start_date::varchar(20)").e, fn("TO_CHAR", SD));
  assert.equal(rejects(() => exprIr("wp_header.start_date::varchar(3)")).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => exprIr("wp_header.wpno::text")).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => exprIr("(DATE '1971-12-31' + wp_header.start_date)::text")).code, "E_UNSUPPORTED");
});

test("#31 ::timestamp passes, ::timestamptz and ::boolean are rejected", () => {
  assert.deepEqual(exprIr("CURRENT_DATE::timestamp").e, cast(fn("TRUNC", fn("SYS_EXTRACT_UTC", { k: "kw", v: "SYSTIMESTAMP" })), "TIMESTAMP"));
  assert.equal(rejects(() => exprIr("CURRENT_DATE::timestamptz")).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => exprIr("wp_header.wpno::boolean")).code, "E_UNSUPPORTED");
});
