import { test } from "node:test";
import assert from "node:assert/strict";
import { bin, col, fn, num } from "../../src/dwh/convert/ir.ts";
import { exprIr, rejects } from "./helpers.ts";

const SD = col("WP_HEADER", "START_DATE");
const ED = col("WP_HEADER", "END_DATE");

test("#50 integer division becomes TRUNC(a / b); % becomes MOD(a, b)", () => {
  assert.deepEqual(exprIr("wp_header.start_date / 2").e, fn("TRUNC", bin("/", SD, num(2))));
  assert.deepEqual(exprIr("wp_header.start_date / wp_header.end_date").e, fn("TRUNC", bin("/", SD, ED)));
  assert.deepEqual(exprIr("wp_header.start_date % 7").e, fn("MOD", SD, num(7)));
  assert.deepEqual(exprIr("wp_header.start_date / 2").codes, ["W_UNNAMED_COLUMN"]);
});

test("#51 division involving numeric passes through with W_DECIMAL_SCALE", () => {
  const r = exprIr("wp_header.start_date / 2.0");
  assert.deepEqual(r.e, bin("/", SD, num("2.0")));
  assert.deepEqual(r.codes, ["W_DECIMAL_SCALE", "W_UNNAMED_COLUMN"]);
  assert.equal(rejects(() => exprIr("NULL / 2")).code, "E_TYPE_UNKNOWN");
});

test("#52 bit, JSON and other operators are rejected", () => {
  for (const op of ["^", "&", "|", "#", "<<", ">>", "->", "->>", "@>"]) {
    assert.equal(rejects(() => exprIr(`wp_header.start_date ${op} 2`)).code, "E_UNSUPPORTED", op);
  }
  assert.equal(rejects(() => exprIr("~ wp_header.start_date")).code, "E_UNSUPPORTED");
});

test("+ - * and unary minus pass through", () => {
  assert.deepEqual(exprIr("wp_header.start_date + 1 - 2 * wp_header.end_date").e, bin("-", bin("+", SD, num(1)), bin("*", num(2), ED)));
  assert.deepEqual(exprIr("-wp_header.start_date").e, { k: "un", op: "-", e: SD });
});

test("#77 very large integer literals pass through", () => {
  assert.deepEqual(exprIr("wp_header.start_date + 12345678901234567890").e, bin("+", SD, num("12345678901234567890")));
});

test("#81 float8 values pass through", () => {
  const r = exprIr("time_captured.prod_factor * 2", "time_captured");
  assert.deepEqual(r.e, bin("*", col("TIME_CAPTURED", "PROD_FACTOR"), num(2)));
});
