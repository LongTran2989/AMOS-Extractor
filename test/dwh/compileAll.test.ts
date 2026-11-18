import { test } from "node:test";
import assert from "node:assert/strict";
import { compileAll } from "../../src/dwh/compileAll.ts";
import { MAPPING, ROOT } from "./helpers.ts";
import { scriptedPool } from "./fakePool.ts";
import * as path from "node:path";

/** As if dwh:catalogue had not run: availability from the missing tables in mapping.yaml only. */
const NO_CAT = path.join(ROOT, "no-such-catalogue.json");

test("compileAll reports an Oracle error per query without stopping", async () => {
  let n = 0;
  const pool = scriptedPool(() => (n++ === 0 ? { columns: [], rows: [], fail: new Error("ORA-00942: table or view does not exist") } : { columns: ["A"], rows: [] }));
  // Pretend no table is missing so that several queries are run.
  const results = await compileAll(pool, ROOT, { mapping: { ...MAPPING, knownMissingTables: [] }, cataloguePath: NO_CAT });
  assert.ok(results.length > 3, `ran ${results.length}`);
  assert.equal(results[0]!.ok, false);
  assert.match(results[0]!.message!, /ORA-00942/);
  assert.ok(results.slice(1).every((r) => r.ok), JSON.stringify(results.slice(1).filter((r) => !r.ok)));
  for (const r of pool.made) assert.match(r.sent!, /FETCH FIRST 0 ROWS ONLY'\)$/);
});

test("compileAll skips queries that are not available in the DWH and those it cannot convert", async () => {
  const pool = scriptedPool(() => ({ columns: ["A"], rows: [] }));
  const results = await compileAll(pool, ROOT, { cataloguePath: NO_CAT });
  const ran = results.map((r) => r.source);
  assert.ok(ran.includes("extract_all_parts.sql"));
  assert.ok(!ran.includes("extract_wp_seqs_steps.sql")); // needs WP_STATUS
  assert.ok(!ran.includes("probe_closed_dates.sql")); // fails lint
  assert.equal(pool.made.length, results.length);
});

test("compileAll fills placeholders with a safe dummy value", async () => {
  const pool = scriptedPool(() => ({ columns: ["A"], rows: [] }));
  // The only placeholder query has two TYPE columns, so it converts only in exec_at mode.
  const results = await compileAll(pool, ROOT, { mapping: { ...MAPPING, execMode: "exec_at", knownMissingTables: [] }, cataloguePath: NO_CAT });
  const i = results.findIndex((r) => r.source === "list_all_seq_in_a_single_wp_3_levels_w_sts.sql");
  assert.ok(i >= 0);
  assert.deepEqual(pool.made[i]!.inputs, [{ name: "p1", value: "X" }]);
  assert.ok(pool.made.every((r) => !r.sent!.includes("<INSERT_WPNO_HERE>")));
  assert.match(pool.made[i]!.sent!, /^EXEC \(N'/);
});

test("compileAll messages are plain and never show the .env values", async () => {
  const before = { ...process.env };
  process.env.DWH_SERVER = "relay-host-17";
  process.env.DWH_USER = "dwh_reader_x";
  try {
    const pool = scriptedPool(() => ({
      columns: [],
      rows: [],
      fail: Object.assign(new Error("ORA-00942: table or view does not exist (on relay-host-17 as dwh_reader_x)"), { name: "RequestError", code: "EREQUEST", number: 7321 }),
    }));
    const [r] = await compileAll(pool, ROOT, { cataloguePath: NO_CAT });
    assert.equal(r!.ok, false);
    assert.match(r!.message!, /^The DWH has no table called/);
    assert.ok(!r!.message!.includes("relay-host-17") && !r!.message!.includes("dwh_reader_x"), String(r!.message));
  } finally {
    process.env.DWH_SERVER = before.DWH_SERVER;
    process.env.DWH_USER = before.DWH_USER;
    if (before.DWH_SERVER === undefined) delete process.env.DWH_SERVER;
    if (before.DWH_USER === undefined) delete process.env.DWH_USER;
  }
});
