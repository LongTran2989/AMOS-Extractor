import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { defaultAt, parseAt, pinPg, packName, verifyPackCli, writeVerifyPack } from "../../src/dwh/verifyPack.ts";
import { convertSource } from "../../src/dwh/sources.ts";
import { dwhRun } from "../../src/dwh/runCli.ts";
import { ROOT, csvIndex, readSource, rejects } from "./helpers.ts";
import { fakePool } from "./fakePool.ts";

const AT = "2026-11-10T06:00:00Z";
const CLOCK_SOURCE = "extract_wp_seqs_parameterized.sql";

/**
 * No repo query that uses the clock is available in the DWH today, so the tests use a copy of the
 * real catalogue in which WP_STATUS and WP_DEPARTMENT_LINK exist (types taken from the AMOS CSV).
 */
const CAT_DIR = mkdtempSync(path.join(tmpdir(), "verify-cat-"));
const FULL_CAT = path.join(CAT_DIR, "catalogue.json");
{
  const real = JSON.parse(readFileSync(path.join(ROOT, "dwh", "catalogue.json"), "utf8"));
  for (const t of ["wp_status", "wp_department_link"]) {
    let id = 1;
    for (const c of csvIndex().get(t)!.columns.values()) {
      const text = /char|text/.test(c.pgType);
      real.columns.push({ table: t.toUpperCase(), name: c.name.toUpperCase(), columnId: id++, dataType: text ? "VARCHAR2" : "NUMBER", dataLength: text ? 4000 : 22, charLength: text ? 4000 : 0, precision: null, scale: null, nullable: true });
    }
  }
  writeFileSync(FULL_CAT, JSON.stringify(real));
}
after(() => rmSync(CAT_DIR, { recursive: true, force: true }));

test("pinPg changes only the CURRENT_* tokens", () => {
  const src = [
    "SELECT wp_header.wpno",
    "FROM wp_header",
    "WHERE wp_header.start_date <= (CURRENT_DATE - DATE '1971-12-31')",
    "  AND wp_header.end_date >= ((current_timestamp + INTERVAL '7' HOUR)::date - DATE '1971-12-31')",
    "  AND x >= NOW ( ) AND y <= LOCALTIMESTAMP",
  ].join("\n");
  const out = pinPg(src, AT, {});
  assert.equal(
    out,
    [
      "SELECT wp_header.wpno",
      "FROM wp_header",
      "WHERE wp_header.start_date <= (DATE '2026-11-10' - DATE '1971-12-31')",
      "  AND wp_header.end_date >= ((TIMESTAMPTZ '2026-11-10 06:00:00+00' + INTERVAL '7' HOUR)::date - DATE '1971-12-31')",
      "  AND x >= TIMESTAMPTZ '2026-11-10 06:00:00+00' AND y <= TIMESTAMP '2026-11-10 06:00:00'",
    ].join("\n"),
  );
});

test("pinPg leaves CURRENT_DATE inside text, comments and qualified names alone", () => {
  const src = "-- uses CURRENT_DATE\nSELECT 'CURRENT_DATE' AS z_X, t.current_date FROM t /* NOW() */";
  assert.equal(pinPg(src, AT, {}), src);
});

test("pinPg leaves the real queries byte-for-byte outside the clock tokens", () => {
  const src = readSource(CLOCK_SOURCE);
  const out = pinPg(src, AT, {});
  const strip = (s: string) =>
    s
      .replace(/DATE '2026-11-10'|TIMESTAMPTZ '2026-11-10 06:00:00\+00'|TIMESTAMP '2026-11-10 06:00:00'/g, "@")
      .replace(/\bCURRENT_DATE\b|\bCURRENT_TIMESTAMP\b|\bLOCALTIMESTAMP\b|\bNOW\s*\(\s*\)/gi, "@");
  assert.equal(strip(out), strip(src));
  assert.doesNotMatch(out, /CURRENT_DATE|CURRENT_TIMESTAMP/);
});

test("pinPg escapes a quote in a parameter", () => {
  const src = "SELECT wp_header.wpno FROM wp_header WHERE wp_header.wpno = '<WPNO>'";
  assert.equal(pinPg(src, AT, { WPNO: " O'Brien\t" }), "SELECT wp_header.wpno FROM wp_header WHERE wp_header.wpno = 'O''Brien'");
});

test("pinPg refuses a missing or unknown parameter", () => {
  const src = "SELECT wp_header.wpno FROM wp_header WHERE wp_header.wpno = '<WPNO>'";
  assert.equal(rejects(() => pinPg(src, AT, {})).code, "E_PARAM_MISSING");
  assert.equal(rejects(() => pinPg(src, AT, { WPNO: "   " })).code, "E_PARAM_MISSING");
  assert.equal(rejects(() => pinPg(src, AT, { WPNO: "A", OTHER: "B" })).code, "E_UNKNOWN_PARAM");
});

test("--at must be a whole UTC instant; the default is the most recent whole hour", () => {
  assert.equal(parseAt("2026-11-10T06:00:00Z"), "2026-11-10T06:00:00Z");
  for (const bad of ["2026-11-10", "2026-11-10 06:00:00", "2026-11-10T06:00:00+07:00", "2026-13-10T06:00:00Z", "2026-11-10T06:00:00.5Z"])
    assert.throws(() => parseAt(bad), /UTC instant/, bad);
  assert.equal(defaultAt(new Date("2026-11-18T09:41:27.123Z")), "2026-11-18T09:00:00Z");
});

test("pack name mirrors the source path", () => {
  assert.equal(packName("extract_wp_item_counts.sql"), "extract_wp_item_counts");
  assert.equal(packName("queries/wp_seqs/NTHN_steps.sql"), "queries__wp_seqs__NTHN_steps");
});

test("pinned Oracle uses the same instant", () => {
  const out = mkdtempSync(path.join(tmpdir(), "verify-pack-"));
  try {
    const r = writeVerifyPack(ROOT, CLOCK_SOURCE, AT, {}, { cataloguePath: FULL_CAT, outDir: out });
    assert.match(r.amosSql, /DATE '2026-11-10'/);
    assert.match(r.amosSql, /TIMESTAMPTZ '2026-11-10 06:00:00\+00'/);
    assert.match(r.dwhSql, /DATE '2026-11-10'/);
    assert.match(r.dwhSql, /TIMESTAMP '2026-11-10 06:00:00'/);
    assert.doesNotMatch(r.dwhSql, /SYS_EXTRACT_UTC|SYSTIMESTAMP|SYSDATE/);
    const dir = path.join(out, "extract_wp_seqs_parameterized");
    assert.equal(readFileSync(path.join(dir, "amos.sql"), "utf8"), r.amosSql);
    assert.equal(readFileSync(path.join(dir, "dwh.sql"), "utf8"), r.dwhSql);
    const pack = JSON.parse(readFileSync(path.join(dir, "pack.json"), "utf8"));
    assert.equal(pack.source, CLOCK_SOURCE);
    assert.equal(pack.at, AT);
    assert.deepEqual(pack.params, {});
    assert.ok(Array.isArray(pack.orderKeys));
    assert.ok(Array.isArray(pack.warnings));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("unavailable query is refused", () => {
  // With the real catalogue, the today query needs WP_STATUS, which the DWH does not have.
  const out = mkdtempSync(path.join(tmpdir(), "verify-pack-"));
  try {
    const e = rejects(() => writeVerifyPack(ROOT, "extract_han_workpacks_today.sql", AT, {}, { outDir: out }));
    assert.equal(e.code, "E_MISSING_IN_DWH");
    assert.match(e.plain, /WP_STATUS/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a source outside the query list is refused", () => {
  assert.throws(() => writeVerifyPack(ROOT, "../.env", AT, {}, { outDir: tmpdir() }), /not one of the repo queries/);
});

test("dwh:run --at sends the pinned Oracle text", async () => {
  const pool = fakePool(["z_WP_NO"], [["A"]]);
  const lines: string[] = [];
  const code = await dwhRun(pool, ROOT, [CLOCK_SOURCE, "--at", AT], (s) => lines.push(s), { cataloguePath: FULL_CAT });
  assert.equal(code, 0, lines.join("\n"));
  const sent = pool.made[0]!.sent!;
  const pinned = convertSource(ROOT, CLOCK_SOURCE, { cataloguePath: FULL_CAT, pinNow: AT });
  assert.ok(sent.includes(pinned.exec.replace(/'/g, "''")), sent);
  assert.doesNotMatch(sent, /SYS_EXTRACT_UTC/);
});

test("dwh:run refuses a bad --at", async () => {
  const lines: string[] = [];
  assert.equal(await dwhRun(fakePool([], []), ROOT, [CLOCK_SOURCE, "--at", "yesterday"], (s) => lines.push(s), { cataloguePath: FULL_CAT }), 1);
  assert.match(lines.join("\n"), /UTC instant/);
});

test("dwh:verify-pack writes the pack and prints the next steps with the exact DWH command", () => {
  const out = mkdtempSync(path.join(tmpdir(), "verify-pack-"));
  try {
    const lines: string[] = [];
    const code = verifyPackCli(ROOT, [CLOCK_SOURCE, "--at", AT], (s) => lines.push(s), { cataloguePath: FULL_CAT, outDir: out });
    assert.equal(code, 0, lines.join("\n"));
    const text = lines.join("\n");
    assert.match(text, /amos\.sql/);
    assert.ok(text.includes(`npm run dwh:run -- ${CLOCK_SOURCE} --at ${AT} --csv verify/extract_wp_seqs_parameterized/dwh.csv`), text);
    assert.match(text, /npm run dwh:compare --/);
    assert.ok(readFileSync(path.join(out, "extract_wp_seqs_parameterized", "amos.sql"), "utf8").includes("DATE '2026-11-10'"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("dwh:verify-pack explains a refusal in plain words", () => {
  const lines: string[] = [];
  assert.equal(verifyPackCli(ROOT, ["extract_han_workpacks_today.sql"], (s) => lines.push(s), { outDir: tmpdir() }), 1);
  assert.match(lines.join("\n"), /not available in the DWH/);
  lines.length = 0;
  assert.equal(verifyPackCli(ROOT, [], (s) => lines.push(s)), 1);
  assert.match(lines.join("\n"), /Usage/);
});
