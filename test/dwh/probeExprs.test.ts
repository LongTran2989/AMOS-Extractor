import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { loadProbes, referenceValue, probeOracleText, probePgText, runProbes } from "../../src/dwh/probeExprs.ts";
import { MAPPING, ROOT } from "./helpers.ts";
import { scriptedPool } from "./fakePool.ts";

const FIXTURE = path.join(ROOT, "test", "dwh", "fixtures", "expr-probes.json");

test("JS reference matches every expected value in expr-probes.json", () => {
  const probes = loadProbes(FIXTURE);
  assert.ok(probes.length >= 20, `${probes.length} probes`);
  for (const p of probes) assert.equal(referenceValue(p.ref), p.expected, p.id);
});

test("every probe converts, and its Oracle text names the result V and passes the read-only scan", () => {
  for (const p of loadProbes(FIXTURE)) {
    const text = probeOracleText(p, ROOT);
    assert.match(text, /^SELECT .+ AS "V" FROM DUAL/, p.id);
  }
});

test("--pg prints the PostgreSQL versions for AMOS", () => {
  const p = loadProbes(FIXTURE)[0]!;
  assert.equal(probePgText(p), `SELECT DATE '2026-08-31' - INTERVAL '6' MONTH AS v; -- ${p.id}: expect 2026-02-28 00:00:00`);
});

test("runProbes reports PASS when the DWH returns the expected values and FAIL otherwise", async () => {
  const probes = loadProbes(FIXTURE).filter((p) => ["month-minus-6-clamps", "int-division", "null-order-asc", "timestamp-to-date-next-day"].includes(p.id));
  const answers: Record<string, unknown[][]> = {
    "ADD_MONTHS": [[new Date(Date.UTC(2026, 1, 28))]],
    "TRUNC((7 / 2))": [[3]],
    "UNION ALL": [[1], [2], [null]],
    "TRUNC((TIMESTAMP": [[new Date(Date.UTC(2026, 10, 18))]],
  };
  const pool = scriptedPool((tsql) => {
    const key = Object.keys(answers).find((k) => tsql.includes(k))!;
    return { columns: ["V"], rows: answers[key]! };
  });
  const results = await runProbes(pool, probes, ROOT, MAPPING);
  assert.deepEqual(results.map((r) => [r.id, r.pass]), probes.map((p) => [p.id, true]));
  for (const r of pool.made) assert.match(r.sent!, /^SELECT \* FROM OPENQUERY\(\[DWH_DB\], N'SELECT /);

  answers["TRUNC((7 / 2))"] = [[3.5]];
  const again = await runProbes(scriptedPool((tsql) => ({ columns: ["V"], rows: answers[Object.keys(answers).find((k) => tsql.includes(k))!]! })), probes, ROOT, MAPPING);
  const bad = again.find((r) => r.id === "int-division")!;
  assert.equal(bad.pass, false);
  assert.equal(bad.got, "3.5");
});
