import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePg, assertSupported } from "../../src/dwh/convert/guard.ts";
import { preprocess } from "../../src/dwh/convert/preprocess.ts";
import { rejects, realSources, readSource } from "./helpers.ts";

const guard = (sql: string) => assertSupported(parsePg(sql));

/** Asserts the query is refused with this code, and that the error points at `line`. */
function refused(sql: string, code: string, line: number) {
  const e = rejects(() => guard(sql));
  assert.equal(e.code, code, e.message);
  assert.equal(e.loc?.line, line, `line of: ${e.message}`);
  assert.ok(e.plain.length > 10);
}

test("#3 schema-qualified source name is rejected", () => {
  refused("SELECT wp_header.wpno\nFROM public.wp_header", "E_UNSUPPORTED", 2);
});

test("#9 quoted identifier is rejected", () => {
  refused('SELECT wp_header.wpno\nFROM wp_header\nWHERE wp_header."Order" = 1', "E_UNSUPPORTED", 3);
});

test("#27 ISNULL / NOTNULL postfix is rejected", () => {
  refused("SELECT wp_header.wpno\nFROM wp_header\nWHERE wp_header.wpno ISNULL", "E_UNSUPPORTED", 3);
  refused("SELECT wp_header.wpno NOTNULL\nFROM wp_header", "E_UNSUPPORTED", 1);
});

test("#49 boolean literals are rejected", () => {
  refused("SELECT wp_header.wpno\nFROM wp_header\nWHERE true", "E_BOOLEAN", 3);
  refused("SELECT wp_header.wpno\nFROM wp_header\nWHERE (wp_header.wpno = 'x') = FALSE", "E_BOOLEAN", 3);
});

test("#59 DISTINCT ON is rejected, #60 plain DISTINCT passes", () => {
  refused("SELECT\nDISTINCT ON (wp_header.wpno) wp_header.wpno FROM wp_header", "E_UNSUPPORTED", 2);
  assert.deepEqual(guard("SELECT DISTINCT wp_header.wpno FROM wp_header"), []);
});

test("#63 derived table, LATERAL, USING and NATURAL JOIN are rejected", () => {
  refused("SELECT x.a\nFROM (SELECT wp_header.wpno FROM wp_header) x", "E_UNSUPPORTED", 2);
  refused("SELECT wp_header.wpno\nFROM wp_header, LATERAL (SELECT 1) l", "E_UNSUPPORTED", 2);
  refused("SELECT wp_header.wpno\nFROM wp_header\nJOIN wp_sequence USING (wpno_i)", "E_UNSUPPORTED", 3);
  refused("SELECT wp_header.wpno\nFROM wp_header NATURAL JOIN wp_sequence", "E_UNSUPPORTED", 2);
});

test("table aliases are rejected", () => {
  refused("SELECT h.wpno\nFROM wp_header h", "E_UNSUPPORTED", 2);
});

test("#73 writes and side effects are rejected", () => {
  assert.equal(rejects(() => guard("DELETE FROM wp_header")).code, "E_NOT_SELECT");
  assert.equal(rejects(() => guard("UPDATE wp_header SET wpno = 'x'")).code, "E_NOT_SELECT");
  refused("SELECT wp_header.wpno\nINTO new_table FROM wp_header", "E_UNSUPPORTED", 2);
  refused("SELECT wp_header.wpno FROM wp_header\nFOR UPDATE", "E_UNSUPPORTED", 2);
  refused("SELECT\nnextval('s')", "E_UNSUPPORTED_FUNCTION", 2);
  refused("SELECT wp_header.wpno FROM wp_header\nWHERE pg_sleep(5) IS NULL", "E_UNSUPPORTED_FUNCTION", 2);
  refused("SELECT\nset_config('a', 'b', 'x')", "E_UNSUPPORTED_FUNCTION", 2);
  refused("SELECT\ndblink('x', 'y')", "E_UNSUPPORTED_FUNCTION", 2);
});

test("#74 function not on the allow-list is rejected", () => {
  refused("SELECT wp_header.wpno,\nlength(wp_header.wpno)\nFROM wp_header", "E_UNSUPPORTED_FUNCTION", 2);
  refused("SELECT wp_header.wpno FROM wp_header\nWHERE upper(wp_header.wpno) = 'X' AND md5(wp_header.wpno) = 'y'", "E_UNSUPPORTED_FUNCTION", 2);
});

test("#75 IS DISTINCT FROM, GREATEST and LEAST are rejected", () => {
  refused("SELECT wp_header.wpno FROM wp_header\nWHERE wp_header.wpno IS DISTINCT FROM 'x'", "E_UNSUPPORTED", 2);
  refused("SELECT\nGREATEST(wp_header.start_date, 1) FROM wp_header", "E_UNSUPPORTED", 2);
  refused("SELECT\nLEAST(wp_header.start_date, 1) FROM wp_header", "E_UNSUPPORTED", 2);
});

test("#76 BETWEEN passes, BETWEEN SYMMETRIC is rejected", () => {
  assert.deepEqual(guard("SELECT wp_header.wpno FROM wp_header WHERE wp_header.start_date BETWEEN 1 AND 2"), []);
  refused("SELECT wp_header.wpno FROM wp_header\nWHERE wp_header.start_date BETWEEN SYMMETRIC 1 AND 2", "E_UNSUPPORTED", 2);
});

test("#13 SELECT * passes with W_SELECT_STAR", () => {
  const w = guard("SELECT * FROM wp_header");
  assert.deepEqual(w.map((x) => x.code), ["W_SELECT_STAR"]);
  assert.deepEqual(guard("SELECT wp_header.* FROM wp_header").map((x) => x.code), ["W_SELECT_STAR"]);
});

test("#46 || is rejected as E_CONCAT", () => {
  refused("SELECT\nwp_header.wpno || 'x' FROM wp_header", "E_CONCAT", 2);
});

test("#70 one trailing ; is fine, two statements are rejected", () => {
  assert.deepEqual(guard("SELECT wp_header.wpno FROM wp_header;"), []);
  assert.equal(rejects(() => guard("SELECT 1; SELECT 2")).code, "E_MULTI_STATEMENT");
});

test("unreadable SQL throws E_PARSE with a line", () => {
  const e = rejects(() => guard("SELECT wp_header.wpno\nFROM wp_header\nWHERE ((("));
  assert.equal(e.code, "E_PARSE");
  assert.equal(e.loc?.line, 3);
});

test("named WINDOW, window frames, RECURSIVE and MATERIALIZED are rejected", () => {
  refused("SELECT wp_header.wpno FROM wp_header\nWINDOW w AS (ORDER BY wp_header.wpno)", "E_UNSUPPORTED", 2);
  refused("SELECT\nSUM(wp_header.start_date) OVER (ORDER BY wp_header.wpno ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM wp_header", "E_UNSUPPORTED", 2);
  refused("WITH RECURSIVE c AS (SELECT wp_header.wpno FROM wp_header)\nSELECT c.wpno FROM c", "E_UNSUPPORTED", 1);
  refused("WITH c AS\nMATERIALIZED (SELECT wp_header.wpno FROM wp_header) SELECT c.wpno FROM c", "E_UNSUPPORTED", 2);
});

test("all 15 root queries and 12 generated queries pass the guard", () => {
  const files = realSources();
  assert.equal(files.length, 27);
  for (const f of files) {
    const warnings = guard(preprocess(readSource(f)).sql);
    assert.deepEqual(warnings, [], f);
  }
});
