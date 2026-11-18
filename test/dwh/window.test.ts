import { test } from "node:test";
import assert from "node:assert/strict";
import { col, num } from "../../src/dwh/convert/ir.ts";
import { exprIr, rejects } from "./helpers.ts";

const SD = col("WP_HEADER", "START_DATE");
const ST = col("WP_HEADER", "STATION");

test("#58 row_number, rank, dense_rank, lag, lead pass through with explicit NULL order", () => {
  for (const f of ["ROW_NUMBER", "RANK", "DENSE_RANK"]) {
    assert.deepEqual(exprIr(`${f}() OVER (PARTITION BY wp_header.station ORDER BY wp_header.start_date)`).e, {
      k: "fn", name: f, args: [], over: { partitionBy: [ST], orderBy: [{ e: SD, desc: false, nulls: "LAST" }] },
    });
  }
  assert.deepEqual(exprIr("LAG(wp_header.start_date, 1) OVER (ORDER BY wp_header.start_date DESC)").e, {
    k: "fn", name: "LAG", args: [SD, num(1)], over: { partitionBy: [], orderBy: [{ e: SD, desc: true, nulls: "FIRST" }] },
  });
  assert.equal(exprIr("LEAD(wp_header.start_date) OVER (ORDER BY wp_header.start_date)").e.k, "fn");
});

test("#58 COUNT/SUM/MIN/MAX OVER (...) without a frame pass through", () => {
  assert.deepEqual(exprIr("SUM(wp_header.start_date) OVER (PARTITION BY wp_header.station)").e, {
    k: "fn", name: "SUM", args: [SD], over: { partitionBy: [ST], orderBy: [] },
  });
});

test("#58 window frames, named windows and other window functions are rejected", () => {
  assert.equal(rejects(() => exprIr("SUM(wp_header.start_date) OVER (ORDER BY wp_header.start_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)")).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => exprIr("NTILE(4) OVER (ORDER BY wp_header.start_date)")).code, "E_UNSUPPORTED_FUNCTION");
});
