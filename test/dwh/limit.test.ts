import { test } from "node:test";
import assert from "node:assert/strict";
import { irOf, rejects } from "./helpers.ts";

const v19 = { mapping: { oracleVersion: 19 } };
const v11 = { mapping: { oracleVersion: 11 } };

test("#32 LIMIT n becomes FETCH FIRST n ROWS ONLY on Oracle >= 12 (outer and subquery)", () => {
  const r = irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno_i LIMIT 20", v19);
  assert.equal(r.q.fetch, "20");
  assert.equal(r.q.offset, undefined);
  assert.deepEqual(r.codes, []);
  const sub = irOf(
    "SELECT wp_header.wpno FROM wp_header WHERE wp_header.wpno_i IN (SELECT wp_sequence.wpno_i FROM wp_sequence ORDER BY wp_sequence.wpno_i LIMIT 5)",
    v19,
  );
  const where = sub.q.branches[0]!.where!;
  assert.equal(where.k, "in_sub");
  if (where.k === "in_sub") {
    assert.equal(where.q.fetch, "5");
    assert.equal(where.q.orderBy.length, 1);
  }
});

test("#32 LIMIT ALL is dropped", () => {
  const r = irOf("SELECT wp_header.wpno FROM wp_header LIMIT ALL", v19);
  assert.equal(r.q.fetch, undefined);
  assert.deepEqual(r.codes, []);
});

test("#32/#34 LIMIT and OFFSET are rejected on Oracle 11", () => {
  assert.equal(rejects(() => irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno LIMIT 20", v11)).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno OFFSET 5", v11)).code, "E_UNSUPPORTED");
  // Without LIMIT, Oracle 11 is fine.
  assert.doesNotThrow(() => irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno", v11));
});

test("#32 a non-literal LIMIT is rejected", () => {
  assert.equal(rejects(() => irOf("SELECT wp_header.wpno FROM wp_header LIMIT (SELECT 1)", v19)).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => irOf("SELECT wp_header.wpno FROM wp_header LIMIT 5 + 1", v19)).code, "E_PARSE");
});

test("#33 LIMIT without ORDER BY warns W_LIMIT_NO_ORDER", () => {
  assert.deepEqual(irOf("SELECT wp_header.wpno FROM wp_header LIMIT 20", v19).codes, ["W_LIMIT_NO_ORDER"]);
});

test("#34 OFFSET m becomes OFFSET m ROWS [FETCH NEXT n ROWS ONLY]", () => {
  const r = irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno LIMIT 5 OFFSET 10", v19);
  assert.equal(r.q.fetch, "5");
  assert.equal(r.q.offset, "10");
  const o = irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno OFFSET 10", v19);
  assert.equal(o.q.fetch, undefined);
  assert.equal(o.q.offset, "10");
  assert.equal(rejects(() => irOf("SELECT wp_header.wpno FROM wp_header OFFSET 10 LIMIT 5", v19)).code, "E_UNSUPPORTED");
});

test("#35 ORDER BY in a subquery or CTE without LIMIT is removed with W_SUBQUERY_ORDER_DROPPED", () => {
  const r = irOf("SELECT wp_header.wpno FROM wp_header WHERE wp_header.wpno_i IN (SELECT wp_sequence.wpno_i FROM wp_sequence ORDER BY wp_sequence.wpno_i)", v19);
  const where = r.q.branches[0]!.where!;
  assert.ok(where.k === "in_sub" && where.q.orderBy.length === 0);
  assert.deepEqual(r.codes, ["W_SUBQUERY_ORDER_DROPPED"]);
  const c = irOf("WITH c AS (SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno) SELECT c.wpno FROM c", v19);
  assert.equal(c.q.with[0]!.q.orderBy.length, 0);
  assert.deepEqual(c.codes, ["W_SUBQUERY_ORDER_DROPPED"]);
});

test("#32 LIMIT ALL OFFSET n keeps only the OFFSET (no FETCH)", () => {
  const r = irOf("SELECT wp_header.wpno FROM wp_header ORDER BY wp_header.wpno_i LIMIT ALL OFFSET 10", v19);
  assert.equal(r.q.fetch, undefined);
  assert.equal(r.q.offset, "10");
});
