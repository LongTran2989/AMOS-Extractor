import { test } from "node:test";
import assert from "node:assert/strict";
import { col, fn, num } from "../../src/dwh/convert/ir.ts";
import { irOf, exprIr, rejects } from "./helpers.ts";

const SD = col("WP_HEADER", "START_DATE");
const ST = col("WP_HEADER", "STATION");

test("#54 COUNT, SUM, MIN, MAX pass through; text MIN/MAX warn W_STRING_ORDER", () => {
  assert.deepEqual(exprIr("COUNT(*)").e, { k: "fn", name: "COUNT", args: [{ k: "star" }] });
  assert.deepEqual(exprIr("COUNT(DISTINCT wp_header.station)").e, { k: "fn", name: "COUNT", args: [ST], distinct: true });
  assert.deepEqual(exprIr("SUM(wp_header.start_date)").e, fn("SUM", SD));
  const mx = exprIr("MAX(wp_header.start_date)");
  assert.deepEqual(mx.e, fn("MAX", SD));
  assert.deepEqual(mx.codes, ["W_UNNAMED_COLUMN"]);
  assert.deepEqual(exprIr("MIN(wp_header.station)").codes, ["W_STRING_ORDER", "W_UNNAMED_COLUMN"]);
});

test("#55 AVG is rejected", () => {
  assert.equal(rejects(() => exprIr("AVG(wp_header.start_date)")).code, "E_UNSUPPORTED");
});

test("#56 FILTER (WHERE c) becomes AGG(CASE WHEN c THEN x END)", () => {
  const cond = { k: "bin", op: "=", l: ST, r: { k: "str", v: "HAN" } } as const;
  assert.deepEqual(exprIr("SUM(wp_header.start_date) FILTER (WHERE wp_header.station = 'HAN')").e, fn("SUM", { k: "case", whens: [{ cond, then: SD }] }));
  assert.deepEqual(exprIr("COUNT(*) FILTER (WHERE wp_header.station = 'HAN')").e, fn("COUNT", { k: "case", whens: [{ cond, then: num(1) }] }));
});

test("#57 GROUP BY ordinal or alias is resolved to the expression", () => {
  const r = irOf("SELECT wp_header.station AS z_WP_STATION, COUNT(*) FROM wp_header GROUP BY 1 HAVING COUNT(*) > 1");
  assert.deepEqual(r.q.branches[0]!.groupBy, [ST]);
  assert.deepEqual(r.q.branches[0]!.having, { k: "bin", op: ">", l: { k: "fn", name: "COUNT", args: [{ k: "star" }] }, r: num(1) });
  const a = irOf("SELECT wp_header.station AS z_WP_STATION, COUNT(*) FROM wp_header GROUP BY z_WP_STATION");
  assert.deepEqual(a.q.branches[0]!.groupBy, [ST]);
});
