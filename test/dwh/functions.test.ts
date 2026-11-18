import { test } from "node:test";
import assert from "node:assert/strict";
import { cast, col, extract, fn, num, str } from "../../src/dwh/convert/ir.ts";
import { exprIr, rejects } from "./helpers.ts";

const EPOCH_SD = { k: "bin", op: "+", l: { k: "date", v: "1971-12-31" }, r: col("WP_HEADER", "START_DATE") } as const;

test("#23 EXTRACT(YEAR|MONTH|DAY) passes; HOUR|MINUTE use CAST(x AS TIMESTAMP); others are rejected", () => {
  assert.deepEqual(exprIr("EXTRACT(YEAR FROM (DATE '1971-12-31' + wp_header.start_date))").e, extract("YEAR", EPOCH_SD));
  assert.deepEqual(exprIr("EXTRACT(DAY FROM (DATE '1971-12-31' + wp_header.start_date))").e, extract("DAY", EPOCH_SD));
  assert.deepEqual(exprIr("EXTRACT(HOUR FROM (DATE '1971-12-31' + wp_header.start_date))").e, extract("HOUR", cast(EPOCH_SD, "TIMESTAMP")));
  assert.deepEqual(exprIr("EXTRACT(MONTH FROM DATE '2026-01-31')").e, extract("MONTH", { k: "date", v: "2026-01-31" }));
  // The parser mis-reads this form (it types only the literal), so it is refused with a hint.
  const e = rejects(() => exprIr("EXTRACT(YEAR FROM DATE '1971-12-31' + wp_header.start_date)"));
  assert.equal(e.code, "E_UNSUPPORTED");
  assert.match(e.plain, /parentheses/);
  for (const f of ["DOW", "ISODOW", "WEEK", "EPOCH", "SECOND"]) {
    assert.equal(rejects(() => exprIr(`EXTRACT(${f} FROM CURRENT_TIMESTAMP)`)).code, "E_UNSUPPORTED", f);
  }
  assert.equal(rejects(() => exprIr("EXTRACT(YEAR FROM wp_header.start_date)")).code, "E_UNSUPPORTED");
});

test("#24 date_trunc, to_char and format are rejected", () => {
  for (const e of ["date_trunc('day', CURRENT_TIMESTAMP)", "to_char(CURRENT_DATE, 'YYYY')", "format('%s', wp_header.wpno)"]) {
    assert.equal(rejects(() => exprIr(e)).code, "E_UNSUPPORTED", e);
  }
});

test("#25 string_agg, array_agg and arrays are rejected", () => {
  for (const e of ["string_agg(wp_header.wpno, ',')", "array_agg(wp_header.wpno)", "ARRAY[1, 2]"]) {
    assert.equal(rejects(() => exprIr(e)).code, "E_UNSUPPORTED", e);
  }
});

test("#26 COALESCE and NULLIF pass through", () => {
  assert.deepEqual(exprIr("COALESCE(wp_header.end_time, 0)").e, fn("COALESCE", col("WP_HEADER", "END_TIME"), num(0)));
  assert.deepEqual(exprIr("NULLIF(wp_header.station, 'X')").e, fn("NULLIF", col("WP_HEADER", "STATION"), str("X")));
  assert.deepEqual(exprIr("UPPER(wp_header.station)").e, fn("UPPER", col("WP_HEADER", "STATION")));
  assert.deepEqual(exprIr("ABS(wp_header.start_date)").e, fn("ABS", col("WP_HEADER", "START_DATE")));
});

test("#74 functions not on the allow-list are rejected", () => {
  assert.equal(rejects(() => exprIr("length(wp_header.wpno)")).code, "E_UNSUPPORTED_FUNCTION");
});

test("#75 GREATEST and LEAST are rejected", () => {
  assert.equal(rejects(() => exprIr("GREATEST(wp_header.start_date, 1)")).code, "E_UNSUPPORTED");
});
