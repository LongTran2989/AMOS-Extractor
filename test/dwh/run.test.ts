import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { loadModel } from "../../src/schema/load.ts";
import { convertQuery, type ConvertResult } from "../../src/dwh/convert/index.ts";
import { ConvertError } from "../../src/dwh/convert/errors.ts";
import { ConfigMissing, dwhConfigFromEnv } from "../../src/dwh/db.ts";
import { runConverted } from "../../src/dwh/run.ts";
import { fakePool, neverPool, scriptedPool } from "./fakePool.ts";
import { MAPPING, ROOT, csvIndex } from "./helpers.ts";

const conv = (over: Partial<ConvertResult> = {}): ConvertResult => ({
  pretty: "",
  exec: 'SELECT X.A AS "z_A", X.B AS "z_B" FROM STG_AMOS.X ORDER BY X.A NULLS LAST',
  warnings: [],
  placeholders: [],
  outputs: [
    { name: "z_A", type: "int" },
    { name: "z_B", type: "text" },
  ],
  orderKeys: [],
  usedColumns: [],
  available: true,
  missing: [],
  ...over,
});

async function collect(rows: AsyncIterable<unknown[]>): Promise<unknown[][]> {
  const out: unknown[][] = [];
  for await (const r of rows) out.push(r);
  return out;
}

async function refusal(p: Promise<unknown>): Promise<ConvertError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvertError) return e;
    throw e;
  }
  assert.fail("expected a ConvertError");
}

test("unavailable query is refused before reaching the pool", async () => {
  const e = await refusal(runConverted(neverPool, conv({ available: false, missing: ["WP_STATUS"] }), MAPPING, { mode: "preview", params: {} }));
  assert.equal(e.code, "E_MISSING_IN_DWH");
  assert.match(e.plain, /WP_STATUS/);
});

test("query failing the Oracle scan never reaches the pool", async () => {
  const e = await refusal(runConverted(neverPool, conv({ exec: "SELECT X.A FROM STG_AMOS.X; DELETE FROM STG_AMOS.X" }), MAPPING, { mode: "preview", params: {} }));
  assert.equal(e.code, "E_FORBIDDEN");
});

test("empty result keeps column names", async () => {
  const pool = fakePool(["z_A", "z_B"], []);
  const h = await runConverted(pool, conv(), MAPPING, { mode: "preview", params: {} });
  assert.deepEqual(h.columns, [
    { name: "z_A", type: "int" },
    { name: "z_B", type: "text" },
  ]);
  assert.deepEqual(await collect(h.rows), []);
  assert.equal((await h.done).rowCount, 0);
  assert.equal(h.truncated(), false);
});

test("duplicate column names are kept by position", async () => {
  const pool = fakePool(["TEXT", "TEXT"], [["a", "b"]]);
  const c = conv({ exec: "SELECT X.TEXT, Y.TEXT FROM STG_AMOS.X JOIN STG_AMOS.Y ON (X.A = Y.A)", outputs: [{ name: "TEXT", type: "text" }, { name: "TEXT", type: "text" }] });
  const h = await runConverted(pool, c, { ...MAPPING, execMode: "exec_at" }, { mode: "preview", params: {} });
  assert.deepEqual(h.columns.map((x) => x.name), ["TEXT", "TEXT"]);
  assert.deepEqual(await collect(h.rows), [["a", "b"]]);
  assert.equal(pool.made[0]!.arrayRowMode, true);
  assert.equal(pool.made[0]!.stream, true);
  assert.match(pool.made[0]!.sent!, /^EXEC \(N'/);
});

test("openquery mode refuses duplicate, unnamed and * result columns before reaching the pool", async () => {
  const dup = conv({ outputs: [{ name: "TEXT", type: "text" }, { name: "text", type: "text" }] });
  assert.equal((await refusal(runConverted(neverPool, dup, MAPPING, { mode: "preview", params: {} }))).code, "E_DUPLICATE_OUTPUT");
  const star = conv({ exec: "SELECT * FROM STG_AMOS.X", outputs: [{ name: "*", type: "unknown" }] });
  assert.equal((await refusal(runConverted(neverPool, star, MAPPING, { mode: "preview", params: {} }))).code, "E_DUPLICATE_OUTPUT");
  const unnamed = conv({ exec: "SELECT (X.A + 1) FROM STG_AMOS.X", outputs: [{ name: "(X.A + 1)", type: "int", unnamed: true }] });
  assert.equal((await refusal(runConverted(neverPool, unnamed, MAPPING, { mode: "preview", params: {} }))).code, "E_DUPLICATE_OUTPUT");
});

test("the converter flags result columns it had to name after their formula", () => {
  const model = loadModel(path.join(ROOT, "schema"));
  const r = convertQuery("SELECT wp_header.wpno AS z_WP_NO, wp_header.start_date + 1 FROM wp_header", "t.sql", { model, csv: csvIndex(), mapping: MAPPING });
  assert.equal(r.outputs[0]!.unnamed, undefined);
  assert.equal(r.outputs[1]!.unnamed, true);
});

test("preview stops at 501 rows and cancels", async () => {
  const rows = Array.from({ length: 600 }, (_, i) => [i, `r${i}`]);
  const pool = fakePool(["z_A", "z_B"], rows);
  const h = await runConverted(pool, conv(), MAPPING, { mode: "preview", params: {} });
  const got = await collect(h.rows);
  assert.equal(got.length, 500);
  assert.equal(h.truncated(), true);
  assert.equal((await h.done).rowCount, 500);
  assert.equal(pool.made[0]!.cancelled, true);
  assert.match(pool.made[0]!.sent!, /FETCH FIRST 501 ROWS ONLY'\)$/);
});

test("export reads up to the export row limit", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => [i, "x"]);
  const pool = fakePool(["z_A", "z_B"], rows);
  const h = await runConverted(pool, conv(), { ...MAPPING, exportRowLimit: 25 }, { mode: "export", params: {} });
  assert.equal((await collect(h.rows)).length, 25);
  assert.equal(h.truncated(), true);
  assert.match(pool.made[0]!.sent!, /FETCH FIRST 26 ROWS ONLY'\)$/);
});

test("placeholder values reach the relay: inlined in openquery, bound in exec_at", async () => {
  const c = conv({ exec: "SELECT X.A AS \"z_A\", X.B AS \"z_B\" FROM STG_AMOS.X WHERE (X.W = '<WPNO>')", placeholders: [{ name: "WPNO", maxLength: 100 }] });
  const oq = fakePool(["z_A", "z_B"], []);
  await (await runConverted(oq, c, MAPPING, { mode: "preview", params: { WPNO: " A501-091026-CHK-C04 " } })).done;
  assert.match(oq.made[0]!.sent!, /\(X\.W = ''A501-091026-CHK-C04''\)/);
  const at = fakePool(["z_A", "z_B"], []);
  await (await runConverted(at, c, { ...MAPPING, execMode: "exec_at" }, { mode: "preview", params: { WPNO: "O'Brien" } })).done;
  assert.deepEqual(at.made[0]!.inputs, [{ name: "p1", value: "O'Brien" }]);
  assert.equal((await refusal(runConverted(neverPool, c, MAPPING, { mode: "preview", params: {} }))).code, "E_PARAM_MISSING");
  assert.equal((await refusal(runConverted(neverPool, c, MAPPING, { mode: "preview", params: { WPNO: "A", OTHER: "B" } }))).code, "E_UNKNOWN_PARAM");
});

test("stopping a run ends the rows with an error and rejects done", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => [i, "x"]);
  const pool = fakePool(["z_A", "z_B"], rows);
  const ac = new AbortController();
  const h = await runConverted(pool, conv(), MAPPING, { mode: "export", params: {}, signal: ac.signal });
  const done = h.done.then(() => "resolved", () => "rejected");
  let seen = 0;
  await assert.rejects(async () => {
    for await (const _r of h.rows) if (++seen === 3) ac.abort();
  });
  assert.equal(await done, "rejected");
  assert.equal(pool.made[0]!.cancelled, true);
});

test("a database error rejects done and the rows", async () => {
  const pool = fakePool([], [], new Error("ORA-00942: table or view does not exist"));
  const h = await runConverted(pool, conv(), MAPPING, { mode: "preview", params: {} }).catch((e) => e);
  // The error may arrive before or after the handle exists; either way it is not swallowed.
  if (h instanceof Error) assert.match(h.message, /ORA-00942/);
  else {
    await assert.rejects(collect(h.rows), /ORA-00942/);
    await assert.rejects(h.done, /ORA-00942/);
  }
});

test("config error names the variable but not its value", () => {
  let err: unknown;
  try {
    dwhConfigFromEnv({ DWH_USER: "reader", DWH_PASSWORD: "s3cret-value" });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ConfigMissing);
  assert.equal(err.variable, "DWH_SERVER");
  assert.match(err.message, /DWH_SERVER/);
  assert.ok(!err.message.includes("s3cret-value") && !err.message.includes("reader"));
  const cfg = dwhConfigFromEnv({ DWH_SERVER: "relay", DWH_USER: "reader", DWH_PASSWORD: "pw" });
  assert.equal(cfg.server, "relay");
  assert.equal(cfg.options?.readOnlyIntent, true);
  assert.equal(cfg.options?.trustServerCertificate, true);
  assert.equal(cfg.options?.appName, "amos-dwh-runner");
  assert.equal(cfg.options?.useUTC, true);
  assert.equal(cfg.connectionTimeout, 15000);
  assert.equal(cfg.requestTimeout, 120000);
  assert.equal(cfg.pool?.max, 4);
});

test("the ORA- text the relay sends as an informational message reaches the plain error", async () => {
  const { toPlain } = await import("../../src/dwh/errorsPlain.ts");
  const pool = scriptedPool(() => ({
    columns: [],
    rows: [],
    info: [{ number: 7412, message: 'OLE DB provider "OraOLEDB.Oracle" for linked server "DWH_DB" returned message "ORA-00904: "X"."NOPE": invalid identifier".' }],
    fail: Object.assign(new Error('An error occurred while preparing the query "SELECT ..." for execution against OLE DB provider "OraOLEDB.Oracle" for linked server "DWH_DB".'), { name: "RequestError", code: "EREQUEST", number: 7321 }),
  }));
  const e = await runConverted(pool, conv(), MAPPING, { mode: "preview", params: {} }).then(() => undefined, (x) => x);
  assert.ok(e, "the run failed");
  assert.match(toPlain(e, {}).message, /no column called X\.NOPE/);
});

test("an error that arrives after the runner cancelled at the cap does not throw the preview away", async () => {
  const rows = Array.from({ length: 600 }, (_, i) => [i, "x"]);
  const pool = scriptedPool(() => ({ columns: ["z_A", "z_B"], rows, errorAfterCancel: Object.assign(new Error("OLE DB provider reported an error"), { number: 7330 }) }));
  const h = await runConverted(pool, conv(), MAPPING, { mode: "preview", params: {} });
  assert.equal((await collect(h.rows)).length, 500);
  assert.equal((await h.done).rowCount, 500);
  assert.equal(h.truncated(), true);
});
