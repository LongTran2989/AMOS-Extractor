import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { loadCsvIndex } from "../../src/schema/csv.ts";
import { loadMapping } from "../../src/dwh/mapping.ts";
import { preprocess } from "../../src/dwh/convert/preprocess.ts";
import { parsePg, assertSupported } from "../../src/dwh/convert/guard.ts";
import { resolveScopes } from "../../src/dwh/convert/scope.ts";
import { inferType } from "../../src/dwh/convert/types.ts";
import { rewriteDateExpr } from "../../src/dwh/convert/dates.ts";
import { rewriteExpr } from "../../src/dwh/convert/rewrite.ts";
import { bin, cast, col, dateLit, extract, fn, kw, num, str, tsLit, type IrExpr } from "../../src/dwh/convert/ir.ts";
import type { RewriteCtx } from "../../src/dwh/convert/dates.ts";
import { ROOT, rejects, realSources, readSource } from "./helpers.ts";

const csv = loadCsvIndex(path.join(ROOT, "Database-Description-AMOS-csv.csv"));
const mapping = loadMapping(path.join(ROOT, "dwh", "mapping.yaml"));

function setup(expr: string, pinNow?: string) {
  const sa = parsePg(preprocess(`SELECT ${expr} FROM wp_header`).sql);
  assertSupported(sa);
  const scope = resolveScopes(sa, csv);
  const ctx: RewriteCtx = { mapping, warnings: [], ...(pinNow ? { pinNow } : {}) };
  return { e: sa.root.columns[0].expr, scope, ctx };
}
const rwDate = (expr: string, pinNow?: string) => {
  const s = setup(expr, pinNow);
  return rewriteDateExpr(s.e, s.scope, s.ctx);
};
const rw = (expr: string) => {
  const s = setup(expr);
  return rewriteExpr(s.e, s.scope, s.ctx);
};
const type = (expr: string) => {
  const s = setup(expr);
  return inferType(s.e, s.scope);
};

const NOW = fn("SYS_EXTRACT_UTC", kw("SYSTIMESTAMP"));
const TODAY = fn("TRUNC", NOW);
const EPOCH = dateLit("1971-12-31");
const iv = (n: IrExpr | number, unit: string) => fn("NUMTODSINTERVAL", typeof n === "number" ? num(n) : n, str(unit));
/** PostgreSQL month arithmetic in Oracle: keep the day, clamp to the target month's last day (A.4). */
const months = (d: IrExpr, k: number) => {
  const am = fn("ADD_MONTHS", fn("TRUNC", d, str("MM")), num(k));
  return bin("+", am, bin("-", fn("LEAST", extract("DAY", d), extract("DAY", fn("LAST_DAY", am))), num(1)));
};

test("types: AMOS ints, literals and the date algebra", () => {
  assert.equal(type("wp_header.start_date"), "int");
  assert.equal(type("wp_header.wpno"), "text");
  assert.equal(type("DATE '1971-12-31' + wp_header.start_date"), "date");
  assert.equal(type("CURRENT_DATE - DATE '1971-12-31'"), "int");
  assert.equal(type("CURRENT_TIMESTAMP + INTERVAL '7' HOUR"), "timestamp");
  assert.equal(type("DATE '2026-01-01' + INTERVAL '1' DAY"), "timestamp");
  assert.equal(type("(CURRENT_DATE - INTERVAL '6' MONTH)::date"), "date");
  assert.equal(type("COALESCE(wp_header.end_time, 0)"), "int");
  assert.equal(type("2.5"), "numeric");
  assert.equal(type("NULL"), "unknown");
});

test("A.4: date and timestamp literals", () => {
  assert.deepEqual(rwDate("DATE '1971-12-31'"), EPOCH);
  assert.deepEqual(rwDate("TIMESTAMP '2026-01-01 10:00:00'"), tsLit("2026-01-01 10:00:00"));
});

test("A.4: date ± int, int + date, date - date", () => {
  const sd = col("WP_HEADER", "START_DATE");
  assert.deepEqual(rwDate("DATE '1971-12-31' + wp_header.start_date"), bin("+", EPOCH, sd));
  assert.deepEqual(rwDate("wp_header.start_date + DATE '1971-12-31'"), bin("+", sd, EPOCH));
  assert.deepEqual(rwDate("DATE '2026-01-10' - wp_header.start_date"), bin("-", dateLit("2026-01-10"), sd));
  assert.deepEqual(rwDate("CURRENT_DATE - DATE '1971-12-31'"), bin("-", TODAY, EPOCH));
});

test("A.4: ± INTERVAL in days, hours, minutes, seconds and weeks becomes NUMTODSINTERVAL", () => {
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP + INTERVAL '7' HOUR"), bin("+", NOW, iv(7, "HOUR")));
  assert.deepEqual(rwDate("DATE '2026-01-01' - INTERVAL '2' DAY"), bin("-", dateLit("2026-01-01"), iv(2, "DAY")));
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP - INTERVAL '30' MINUTE"), bin("-", NOW, iv(30, "MINUTE")));
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP + INTERVAL '5 seconds'"), bin("+", NOW, iv(5, "SECOND")));
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP + INTERVAL '100' HOUR"), bin("+", NOW, iv(100, "HOUR")));
  assert.deepEqual(rwDate("CURRENT_DATE - INTERVAL '2' WEEK"), bin("-", TODAY, iv(bin("*", num(7), num(2)), "DAY")));
  assert.deepEqual(rwDate("INTERVAL '1' DAY + CURRENT_TIMESTAMP"), bin("+", NOW, iv(1, "DAY")));
});

test("A.4: e * INTERVAL 'k U' becomes NUMTODSINTERVAL(k * e, U)", () => {
  const st = col("WP_HEADER", "START_TIME");
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP + wp_header.start_time * INTERVAL '2 minutes'"), bin("+", NOW, iv(bin("*", num(2), st), "MINUTE")));
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP + INTERVAL '3' HOUR * wp_header.start_time"), bin("+", NOW, iv(bin("*", num(3), st), "HOUR")));
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP + wp_header.start_time * INTERVAL '1 minute'"), bin("+", NOW, iv(st, "MINUTE")));
});

test("A.4: month and year arithmetic uses the PostgreSQL clamp form", () => {
  assert.deepEqual(rwDate("DATE '2026-08-31' - INTERVAL '6' MONTH"), months(dateLit("2026-08-31"), -6));
  assert.deepEqual(rwDate("CURRENT_DATE + INTERVAL '1' YEAR"), months(TODAY, 12));
  assert.deepEqual(rwDate("CURRENT_DATE - INTERVAL '2 years'"), months(TODAY, -24));
});

test("A.4: the four pinned month cases have the clamp shape", () => {
  assert.deepEqual(rwDate("DATE '2026-08-31' - INTERVAL '6' MONTH"), months(dateLit("2026-08-31"), -6));
  assert.deepEqual(rwDate("DATE '2026-04-30' + INTERVAL '1' MONTH"), months(dateLit("2026-04-30"), 1));
  assert.deepEqual(rwDate("DATE '2028-01-31' + INTERVAL '1' MONTH"), months(dateLit("2028-01-31"), 1));
  assert.deepEqual(rwDate("DATE '2026-03-15' - INTERVAL '6' MONTH"), months(dateLit("2026-03-15"), -6));
});

test("A.4: CURRENT_TIMESTAMP, NOW(), LOCALTIMESTAMP and CURRENT_DATE are UTC", () => {
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP"), NOW);
  assert.deepEqual(rwDate("NOW()"), NOW);
  assert.deepEqual(rwDate("LOCALTIMESTAMP"), NOW);
  assert.deepEqual(rwDate("CURRENT_DATE"), TODAY);
});

test("A.4 / #20: ::date and CAST(... AS date) become TRUNC", () => {
  assert.deepEqual(rwDate("(CURRENT_TIMESTAMP + INTERVAL '7' HOUR)::date"), fn("TRUNC", bin("+", NOW, iv(7, "HOUR"))));
  assert.deepEqual(rwDate("CAST(CURRENT_TIMESTAMP AS date)"), fn("TRUNC", NOW));
  assert.deepEqual(rwDate("'2026-01-01'::date"), dateLit("2026-01-01"));
  assert.deepEqual(rwDate("(DATE '1971-12-31' + wp_header.start_date)::timestamp"), cast(bin("+", EPOCH, col("WP_HEADER", "START_DATE")), "TIMESTAMP"));
});

test("A.4 example line from extract_wp_seqs_steps.sql", () => {
  const got = rw("wp_header.start_date >= ((CURRENT_DATE - INTERVAL '6' MONTH)::date - DATE '1971-12-31')");
  assert.deepEqual(got, bin(">=", col("WP_HEADER", "START_DATE"), bin("-", fn("TRUNC", months(TODAY, -6)), EPOCH)));
});

test("every real (COALESCE(x.end_time, 0) * INTERVAL '1 minute') sum", () => {
  const re = /\(\(DATE '1971-12-31' \+ ([a-z_]+)\.([a-z_]+)\) \+ \(COALESCE\(\1\.([a-z_]+), 0\) \* INTERVAL '1 minute'\)\)/g;
  let count = 0;
  for (const f of realSources()) {
    for (const m of readSource(f).matchAll(re)) {
      count++;
      const [, t, d, tm] = m as unknown as [string, string, string, string];
      const T = t.toUpperCase();
      assert.deepEqual(
        rwDate(m[0]),
        bin("+", bin("+", EPOCH, col(T, d.toUpperCase())), iv(fn("COALESCE", col(T, tm.toUpperCase()), num(0)), "MINUTE")),
        f,
      );
    }
  }
  assert.equal(count, 17);
});

test("the 7 h / 24 h chain keeps its order", () => {
  assert.deepEqual(
    rwDate("CURRENT_TIMESTAMP + INTERVAL '7' HOUR - INTERVAL '24' HOUR"),
    bin("-", bin("+", NOW, iv(7, "HOUR")), iv(24, "HOUR")),
  );
});

test("pinNow freezes the clock", () => {
  assert.deepEqual(rwDate("CURRENT_DATE", "2026-11-10T00:00:00Z"), dateLit("2026-11-10"));
  assert.deepEqual(rwDate("CURRENT_TIMESTAMP", "2026-11-10T00:00:00Z"), tsLit("2026-11-10 00:00:00"));
  assert.deepEqual(rwDate("NOW()", "2026-11-10T13:05:09Z"), tsLit("2026-11-10 13:05:09"));
});

test("not date-related returns undefined", () => {
  assert.equal(rwDate("wp_header.start_date + 1"), undefined);
  assert.equal(rwDate("wp_header.wpno"), undefined);
});

test("#15 month arithmetic on a timestamp is rejected", () => {
  assert.equal(rejects(() => rwDate("CURRENT_TIMESTAMP - INTERVAL '6' MONTH")).code, "E_UNSUPPORTED");
  assert.equal(rejects(() => rwDate("CURRENT_DATE - wp_header.start_date * INTERVAL '1 month'")).code, "E_UNSUPPORTED");
});

test("#16 fractional or compound intervals are rejected", () => {
  for (const e of ["CURRENT_TIMESTAMP + INTERVAL '1.5 hours'", "CURRENT_TIMESTAMP + INTERVAL '1 day 2 hours'", "CURRENT_TIMESTAMP + INTERVAL '1.5' HOUR", "CURRENT_TIMESTAMP + INTERVAL '5'"]) {
    assert.equal(rejects(() => rwDate(e)).code, "E_UNSUPPORTED", e);
  }
});

test("#17 interval + interval, bare interval output and ts - ts are rejected", () => {
  for (const e of ["INTERVAL '1' DAY + INTERVAL '1' HOUR", "INTERVAL '1' DAY", "CURRENT_TIMESTAMP - CURRENT_TIMESTAMP", "wp_header.start_date * INTERVAL '1 minute'"]) {
    assert.equal(rejects(() => rwDate(e)).code, "E_UNSUPPORTED", e);
  }
});

test("#18 CURRENT_TIME, LOCALTIME, AT TIME ZONE and timezone() are rejected with the +7 h hint", () => {
  for (const e of ["CURRENT_TIME", "LOCALTIME", "CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh'", "timezone('UTC', CURRENT_TIMESTAMP)"]) {
    const err = rejects(() => rwDate(e));
    assert.equal(err.code, "E_UNSUPPORTED", e);
    assert.match(err.plain, /INTERVAL '7' HOUR/, e);
  }
});

test("other mixes of dates and numbers are rejected", () => {
  for (const e of ["CURRENT_TIMESTAMP + 1", "DATE '2026-01-01' + 1.5", "DATE '2026-01-01' + DATE '2026-01-02'", "'Dec 31 1971'::date", "wp_header.start_date::date"]) {
    assert.equal(rejects(() => rwDate(e)).code, "E_UNSUPPORTED", e);
  }
  assert.equal(rejects(() => rwDate("DATE 'Dec 31 1971'")).code, "E_UNSUPPORTED");
});

test("#19 W_UTC_TODAY is added once per query", () => {
  const s = setup("(CURRENT_DATE - DATE '1971-12-31') + (CURRENT_DATE - DATE '1971-12-31') + EXTRACT(DAY FROM CURRENT_TIMESTAMP)");
  rewriteExpr(s.e, s.scope, s.ctx);
  assert.deepEqual(s.ctx.warnings.map((w) => w.code), ["W_UTC_TODAY"]);
  const pinned = setup("CURRENT_DATE", "2026-11-10T00:00:00Z");
  rewriteDateExpr(pinned.e, pinned.scope, pinned.ctx);
  assert.deepEqual(pinned.ctx.warnings, []);
});

test("E_TYPE_UNKNOWN when a date rewrite meets an untyped subquery", () => {
  assert.equal(rejects(() => rwDate("DATE '1971-12-31' + (SELECT NULL FROM wp_status)")).code, "E_TYPE_UNKNOWN");
});
