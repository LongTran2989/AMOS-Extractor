import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { loadModel } from "../../src/schema/load.ts";
import { loadCatalogue } from "../../src/dwh/catalogue.ts";
import { convertQuery, CONVERTER_VERSION, type ConvertOptions } from "../../src/dwh/convert/index.ts";
import { assertReadOnlyOracle } from "../../src/dwh/safety.ts";
import { ConvertError } from "../../src/dwh/convert/errors.ts";
import { MAPPING, ROOT, csvIndex, realSources, readSource, rejects } from "./helpers.ts";

const model = loadModel(path.join(ROOT, "schema"));
const opts: ConvertOptions = { model, csv: csvIndex(), mapping: MAPPING };
const fixture = loadCatalogue(path.join(ROOT, "test", "dwh", "fixtures", "catalogue.min.json"))!;
const PROBES = ["probe_closed_dates.sql", "probe_workstep_duplicates.sql"];

/** WHERE text of a converted one-table query (string-level versions of the Task 1.4 cases). */
const whereOf = (cond: string, pinNow?: string) => {
  const r = convertQuery(`SELECT wp_header.wpno_i AS z_WP_ID FROM wp_header WHERE ${cond}`, "t.sql", { ...opts, ...(pinNow ? { pinNow } : {}) });
  return r.exec.replace(/^SELECT WP_HEADER\.WPNO_I AS "z_WP_ID" FROM STG_AMOS\.WP_HEADER WHERE /, "");
};

const NOW = "SYS_EXTRACT_UTC(SYSTIMESTAMP)";
const TODAY = `TRUNC(${NOW})`;
const months = (d: string, k: number) =>
  `(ADD_MONTHS(TRUNC(${d}, 'MM'), ${k}) + (LEAST(EXTRACT(DAY FROM ${d}), EXTRACT(DAY FROM LAST_DAY(ADD_MONTHS(TRUNC(${d}, 'MM'), ${k})))) - 1))`;

test("CONVERTER_VERSION is 2", () => {
  assert.equal(CONVERTER_VERSION, 2);
});

test("probe_closed_dates.sql throws E_LINT", () => {
  const e = rejects(() => convertQuery(readSource("probe_closed_dates.sql"), "probe_closed_dates.sql", opts));
  assert.equal(e.code, "E_LINT");
  assert.match(e.detail, /\[R\d+\]/);
});

/** Real queries that repeat an output name: refused in openquery mode (relay error 492, Phase 0b b7). */
const DUPLICATE_NAMES = ["extract_work_order.sql", "list_all_seq_in_a_single_wp_3_levels_w_sts.sql"];
const execAt: ConvertOptions = { ...opts, mapping: { ...MAPPING, execMode: "exec_at" } };

test("every real query converts in exec_at mode (except the two probes, which fail lint), passes the self-check and the read-only scan", () => {
  for (const f of realSources()) {
    if (PROBES.includes(f)) continue;
    const r = convertQuery(readSource(f), f, execAt);
    assert.doesNotThrow(() => assertReadOnlyOracle(r.exec), f);
    assert.ok(!r.exec.includes("\n"), f);
    assert.ok(r.exec.length < 8000, f);
  }
});

test("openquery mode (today): the two queries with repeated column names are refused E_DUPLICATE_OUTPUT, all others convert", () => {
  for (const f of realSources()) {
    if (PROBES.includes(f)) continue;
    if (DUPLICATE_NAMES.includes(f)) assert.equal(rejects(() => convertQuery(readSource(f), f, opts)).code, "E_DUPLICATE_OUTPUT", f);
    else assert.doesNotThrow(() => convertQuery(readSource(f), f, opts), f);
  }
});

test("converting twice gives identical bytes", () => {
  for (const f of realSources()) {
    if (PROBES.includes(f)) continue;
    const a = convertQuery(readSource(f), f, execAt);
    const b = convertQuery(readSource(f), f, execAt);
    assert.equal(a.pretty, b.pretty, f);
    assert.equal(a.exec, b.exec, f);
    assert.deepEqual(a, b, f);
  }
});

test("self-check failure throws E_SELF_CHECK (broken printer injected)", () => {
  const e = rejects(() => convertQuery("SELECT wp_header.wpno_i AS z_WP_ID FROM wp_header", "t.sql", { ...opts, printer: () => "SELECT (((" }));
  assert.equal(e.code, "E_SELF_CHECK");
});

test("a read-only scan failure throws E_FORBIDDEN (broken printer injected)", () => {
  const e = rejects(() => convertQuery("SELECT wp_header.wpno_i AS z_WP_ID FROM wp_header", "t.sql", { ...opts, printer: () => "SELECT 1 FROM DUAL FOR UPDATE" }));
  assert.ok(e.code === "E_SELF_CHECK" || e.code === "E_FORBIDDEN");
  const f = rejects(() => convertQuery("SELECT wp_header.wpno_i AS z_WP_ID FROM wp_header", "t.sql", { ...opts, printer: () => "SELECT DBMS_RANDOM.VALUE(1, 2) FROM DUAL" }));
  assert.equal(f.code, "E_FORBIDDEN");
});

test("#83 openquery mode: exec text over 8000 chars after quote doubling throws E_TOO_LONG; exec_at has no limit", () => {
  const list = Array.from({ length: 900 }, (_, i) => `'W${String(i).padStart(4, "0")}'`).join(", ");
  const sql = `SELECT wp_header.wpno_i AS z_WP_ID FROM wp_header WHERE wp_header.wpno IN (${list})`;
  const e = rejects(() => convertQuery(sql, "t.sql", opts));
  assert.equal(e.code, "E_TOO_LONG");
  assert.ok(convertQuery(sql, "t.sql", { ...opts, mapping: { ...MAPPING, execMode: "exec_at" } }).exec.length > 8000);
  // Under 8000 characters before doubling, over after: still too long.
  const near = Array.from({ length: 800 }, (_, i) => `'W${String(i).padStart(4, "0")}'`).join(", ");
  const r = convertQuery(`SELECT wp_header.wpno_i AS z_WP_ID FROM wp_header WHERE wp_header.wpno IN (${near})`, "t.sql", { ...opts, mapping: { ...MAPPING, execMode: "exec_at" } });
  assert.ok(r.exec.length < 8000 && r.exec.replace(/'/g, "''").length > 8000, `length ${r.exec.length}`);
  assert.equal(rejects(() => convertQuery(`SELECT wp_header.wpno_i AS z_WP_ID FROM wp_header WHERE wp_header.wpno IN (${near})`, "t.sql", opts)).code, "E_TOO_LONG");
});

test("#28 / #29 number casts go through the whole pipeline (self-check included)", () => {
  assert.match(whereOf("wp_header.start_date::integer = 1"), /^\(CAST\(WP_HEADER\.START_DATE AS NUMBER\(10\)\) = 1\)$/);
  assert.match(whereOf("wp_header.start_date::bigint = 1"), /NUMBER\(19\)/);
  assert.match(whereOf("wp_header.start_date::smallint = 1"), /NUMBER\(5\)/);
  assert.match(whereOf("wp_header.start_date::numeric(10,2) = 1"), /CAST\(WP_HEADER\.START_DATE AS NUMBER\(10,2\)\)/);
  assert.match(whereOf("CAST(wp_header.start_date AS numeric(12)) = 1"), /NUMBER\(12\)/);
  assert.match(whereOf("DATE '1971-12-31' + wp_header.start_date::integer = CURRENT_DATE"), /NUMBER\(10\)/);
});

test("#21 date-typed outputs are reported as date", () => {
  const r = convertQuery("SELECT wp_header.wpno_i AS z_WP_ID, wp_header.start_date AS z_WP_START_DATE FROM wp_header", "t.sql", opts);
  assert.deepEqual(r.outputs, [
    { name: "z_WP_ID", type: "int" },
    { name: "z_WP_START_DATE", type: "int" },
  ]);
  const d = convertQuery("SELECT DATE '1971-12-31' + wp_header.start_date FROM wp_header", "t.sql", opts);
  assert.deepEqual(d.outputs, [{ name: "(DATE '1971-12-31' + WP_HEADER.START_DATE)", type: "date" }]);
});

test("result fields: placeholders, warnings, used columns, availability", () => {
  const f = "list_all_seq_in_a_single_wp_3_levels_w_sts.sql";
  const r = convertQuery(readSource(f), f, execAt);
  assert.deepEqual(r.placeholders, [{ name: "INSERT_WPNO_HERE", maxLength: 100 }]);
  assert.ok(r.pretty.includes("'<INSERT_WPNO_HERE>'"));
  assert.ok(r.exec.includes("'<INSERT_WPNO_HERE>'"));
  assert.ok(!r.exec.includes("__PH_"));
  assert.equal(r.available, "unknown");
  assert.ok(r.warnings.some((w) => w.code === "W_NO_CATALOGUE"));
  assert.ok(r.usedColumns.includes("wp_header.wpno"));
  const withCat = convertQuery(readSource("extract_wp_seqs_steps.sql"), "extract_wp_seqs_steps.sql", { ...opts, catalogue: fixture });
  assert.equal(withCat.available, false);
  assert.deepEqual(withCat.missing, ["WP_DEPARTMENT_LINK", "WP_STATUS"]);
  assert.ok(!withCat.warnings.some((w) => w.code === "W_NO_CATALOGUE"));
  assert.ok(withCat.warnings.some((w) => w.code === "W_UTC_TODAY"));
  assert.deepEqual(convertQuery(readSource("extract_all_parts.sql"), "extract_all_parts.sql", { ...opts, catalogue: fixture }).available, true);
});

test("errors carry a plain message and a source line", () => {
  try {
    convertQuery("SELECT wp_header.wpno_i AS z_WP_ID\nFROM wp_header\nWHERE wp_header.wpno = ''", "t.sql", opts);
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof ConvertError);
    assert.equal(e.code, "E_EMPTY_STRING");
    assert.equal(e.loc?.line, 3);
  }
});

// ---- string-level versions of the Task 1.4 cases ----

test("string: the A.4 example line", () => {
  assert.equal(
    whereOf("wp_header.start_date >= ((CURRENT_DATE - INTERVAL '6' MONTH)::date - DATE '1971-12-31')"),
    `(WP_HEADER.START_DATE >= (TRUNC(${months(TODAY, -6)}) - DATE '1971-12-31'))`,
  );
});

test("string: the real minute sums, the 7 h / 24 h chain, and day arithmetic", () => {
  assert.equal(
    whereOf("((DATE '1971-12-31' + wp_header.end_date) + (COALESCE(wp_header.end_time, 0) * INTERVAL '1 minute')) >= (CURRENT_TIMESTAMP + INTERVAL '7' HOUR - INTERVAL '24' HOUR)"),
    `(((DATE '1971-12-31' + WP_HEADER.END_DATE) + NUMTODSINTERVAL(COALESCE(WP_HEADER.END_TIME, 0), 'MINUTE')) >= ((${NOW} + NUMTODSINTERVAL(7, 'HOUR')) - NUMTODSINTERVAL(24, 'HOUR')))`,
  );
  assert.equal(whereOf("wp_header.start_date <= (CURRENT_DATE - DATE '1971-12-31')"), `(WP_HEADER.START_DATE <= (${TODAY} - DATE '1971-12-31'))`);
  assert.equal(
    whereOf("(DATE '1971-12-31' + wp_header.start_date) > CURRENT_DATE - INTERVAL '2' WEEK"),
    `((DATE '1971-12-31' + WP_HEADER.START_DATE) > (${TODAY} - NUMTODSINTERVAL((7 * 2), 'DAY')))`,
  );
});

test("string: the four pinned month cases", () => {
  const d = (v: string) => `DATE '${v}'`;
  assert.equal(whereOf("(DATE '1971-12-31' + wp_header.start_date) = DATE '2026-08-31' - INTERVAL '6' MONTH"), `((DATE '1971-12-31' + WP_HEADER.START_DATE) = ${months(d("2026-08-31"), -6)})`);
  assert.equal(whereOf("(DATE '1971-12-31' + wp_header.start_date) = DATE '2026-04-30' + INTERVAL '1' MONTH"), `((DATE '1971-12-31' + WP_HEADER.START_DATE) = ${months(d("2026-04-30"), 1)})`);
  assert.equal(whereOf("(DATE '1971-12-31' + wp_header.start_date) = DATE '2028-01-31' + INTERVAL '1' MONTH"), `((DATE '1971-12-31' + WP_HEADER.START_DATE) = ${months(d("2028-01-31"), 1)})`);
  assert.equal(whereOf("(DATE '1971-12-31' + wp_header.start_date) = DATE '2026-03-15' - INTERVAL '6' MONTH"), `((DATE '1971-12-31' + WP_HEADER.START_DATE) = ${months(d("2026-03-15"), -6)})`);
});

test("string: pinNow", () => {
  assert.equal(whereOf("(DATE '1971-12-31' + wp_header.start_date) = CURRENT_DATE", "2026-11-10T00:00:00Z"), "((DATE '1971-12-31' + WP_HEADER.START_DATE) = DATE '2026-11-10')");
  assert.equal(whereOf("(DATE '1971-12-31' + wp_header.start_date) < CURRENT_TIMESTAMP", "2026-11-10T00:00:00Z"), "((DATE '1971-12-31' + WP_HEADER.START_DATE) < TIMESTAMP '2026-11-10 00:00:00')");
});
