import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { dwhRun, parseRunArgs } from "../../src/dwh/runCli.ts";
import { ROOT } from "./helpers.ts";
import { fakePool, neverPool, scriptedPool } from "./fakePool.ts";

const io = () => {
  const lines: string[] = [];
  return { lines, log: (s: string) => lines.push(s) };
};

test("parseRunArgs reads the source, --param K=V, --csv and --raw", () => {
  assert.deepEqual(parseRunArgs(["extract_all_parts.sql", "--param", "WPNO= A1 ", "--csv", "out.csv"]), { source: "extract_all_parts.sql", params: { WPNO: " A1 " }, csv: "out.csv" });
  assert.deepEqual(parseRunArgs(["--raw", "x.sql"]), { raw: "x.sql", params: {} });
  assert.throws(() => parseRunArgs([]), /Usage/);
  assert.throws(() => parseRunArgs(["a.sql", "--param", "novalue"]), /K=V/);
});

test("a source outside the query list is refused before reaching the DWH", async () => {
  for (const bad of ["../.env", "C:\\x.sql", "queries/dwh/extract_all_parts.sql"]) {
    const out = io();
    assert.equal(await dwhRun(neverPool, ROOT, [bad], out.log), 1, bad);
    assert.match(out.lines.join("\n"), /not one of the repo queries/, bad);
  }
});

test("--csv writes UTF-8 with BOM, quoted fields, CRLF and values formatted by type", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dwh-run-"));
  try {
    const csv = path.join(dir, "out.csv");
    const pool = fakePool(["PARTNO", "DESCRIPTION"], [["P-1", "Kiểm tra động cơ"], ["P-2", null]]);
    const out = io();
    assert.equal(await dwhRun(pool, ROOT, ["extract_all_parts.sql", "--csv", csv], out.log), 0, out.lines.join("\n"));
    const bytes = readFileSync(csv);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const text = bytes.subarray(3).toString("utf8");
    const lines = text.split("\r\n");
    assert.equal(lines[1], '"P-1","Kiểm tra động cơ"');
    assert.equal(lines[2], '"P-2",""');
    assert.equal(lines[3], "");
    assert.match(out.lines.join("\n"), /2 rows/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failure during a CSV download marks the file incomplete", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dwh-run-"));
  try {
    const csv = path.join(dir, "out.csv");
    let calls = 0;
    const pool = scriptedPool(() => (calls++ === 0 ? { columns: ["PARTNO"], rows: [["P-1"]], fail: new Error("ORA-03113: end-of-file on communication channel"), failAfterRows: true } : { columns: [], rows: [] }));
    const out = io();
    assert.equal(await dwhRun(pool, ROOT, ["extract_all_parts.sql", "--csv", csv], out.log), 1);
    const text = readFileSync(csv, "utf8");
    assert.match(text.trimEnd().split("\r\n").pop()!, /INCOMPLETE/);
    assert.match(out.lines.join("\n"), /link to the Oracle database failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a query not available in the DWH gets the plain message", async () => {
  const out = io();
  assert.equal(await dwhRun(neverPool, ROOT, ["extract_wp_seqs_steps.sql"], out.log), 1);
  assert.match(out.lines.join("\n"), /not available in the DWH: it needs WP_DEPARTMENT_LINK, WP_STATUS/);
});

test("--raw runs hand-written Oracle only after the read-only check", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dwh-run-"));
  try {
    const bad = path.join(dir, "bad.sql");
    const good = path.join(dir, "good.sql");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(bad, "SELECT 1 FROM DUAL; DELETE FROM STG_AMOS.X");
    writeFileSync(good, "SELECT WO_HEADER.STATE FROM STG_AMOS.WO_HEADER WHERE ROWNUM <= 1");
    const out = io();
    assert.equal(await dwhRun(neverPool, ROOT, ["--raw", bad], out.log), 1);
    assert.match(out.lines.join("\n"), /read-only safety check/);
    const pool = fakePool(["STATE"], [["O"]]);
    assert.equal(await dwhRun(pool, ROOT, ["--raw", good], io().log), 0);
    assert.equal(pool.made[0]!.sent, "SELECT * FROM OPENQUERY([DWH_DB], N'SELECT WO_HEADER.STATE FROM STG_AMOS.WO_HEADER WHERE ROWNUM <= 1 FETCH FIRST 501 ROWS ONLY')");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CSV is written under a .part name until the download has finished", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dwh-run-"));
  try {
    const csv = path.join(dir, "out.csv");
    const { existsSync } = await import("node:fs");
    const seen: boolean[][] = [];
    const base = fakePool(["PARTNO"], Array.from({ length: 10 }, (_, i) => [`P-${i}`]));
    const pool = {
      request: () => {
        const r = base.request();
        let n = 0;
        r.on("row", () => {
          if (++n === 6) seen.push([existsSync(csv), existsSync(`${csv}.part`)]);
        });
        return r;
      },
    };
    assert.equal(await dwhRun(pool, ROOT, ["extract_all_parts.sql", "--csv", csv], io().log), 0);
    assert.deepEqual(seen, [[false, true]]);
    assert.ok(existsSync(csv) && !existsSync(`${csv}.part`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an export that reaches the row limit ends with an INCOMPLETE line", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dwh-run-"));
  try {
    const csv = path.join(dir, "out.csv");
    const { loadMapping } = await import("../../src/dwh/mapping.ts");
    const mapping = { ...loadMapping(path.join(ROOT, "dwh", "mapping.yaml")), exportRowLimit: 3 };
    const pool = fakePool(["PARTNO"], Array.from({ length: 10 }, (_, i) => [`P-${i}`]));
    assert.equal(await dwhRun(pool, ROOT, ["extract_all_parts.sql", "--csv", csv], io().log, { mapping }), 0);
    const lines = readFileSync(csv, "utf8").trimEnd().split("\r\n");
    assert.equal(lines.length, 5);
    assert.match(lines[4]!, /INCOMPLETE: .*row limit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
