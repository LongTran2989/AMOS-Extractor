import { test } from "node:test";
import assert from "node:assert/strict";
import { printOracle } from "../../src/dwh/convert/print.ts";
import { oracleIdent } from "../../src/dwh/convert/oracleWords.ts";
import { col, type IrQuery } from "../../src/dwh/convert/ir.ts";
import { irOf } from "./helpers.ts";

const exec = (sql: string, opts = {}) => printOracle(irOf(sql, opts).q, "exec");
const pretty = (sql: string, opts = {}) => printOracle(irOf(sql, opts).q, "pretty");

function oneColumn(e: ReturnType<typeof col>): IrQuery {
  return { with: [], branches: [{ distinct: false, columns: [{ e }], from: [{ table: "STG_AMOS.WO_HEADER" }], groupBy: [] }], ops: [], orderBy: [], outputs: [], orderKeys: [] };
}

test("#8 an Oracle reserved word is printed quoted in catalogue case (none in AMOS today)", () => {
  assert.equal(printOracle(oneColumn(col("WO_HEADER", oracleIdent("LEVEL"))), "exec"), 'SELECT WO_HEADER."LEVEL" FROM STG_AMOS.WO_HEADER');
});

test("#10 an alias is printed AS \"z_...\" (quoted to keep its case)", () => {
  assert.equal(exec("SELECT wp_header.wpno_i AS z_WP_ID FROM wp_header"), 'SELECT WP_HEADER.WPNO_I AS "z_WP_ID" FROM STG_AMOS.WP_HEADER');
});

test("#11 duplicate output names print as they are in exec_at mode", () => {
  const sql = "SELECT wo_text_description.text, wo_text_action.text FROM wo_text_description JOIN wo_text_action ON wo_text_action.actionno_i = wo_text_description.descno_i";
  assert.equal(
    exec(sql, { mapping: { execMode: "exec_at" } }),
    "SELECT WO_TEXT_DESCRIPTION.TEXT, WO_TEXT_ACTION.TEXT FROM STG_AMOS.WO_TEXT_DESCRIPTION JOIN STG_AMOS.WO_TEXT_ACTION ON (WO_TEXT_ACTION.ACTIONNO_I = WO_TEXT_DESCRIPTION.DESCNO_I)",
  );
});

test("#12 a select expression without alias prints without AS", () => {
  assert.equal(exec("SELECT wp_header.start_date + 1 FROM wp_header"), "SELECT (WP_HEADER.START_DATE + 1) FROM STG_AMOS.WP_HEADER");
});

test("#53 every binary and unary expression is parenthesised", () => {
  assert.equal(exec("SELECT wp_header.start_date + wp_header.end_date * 2 FROM wp_header"), "SELECT (WP_HEADER.START_DATE + (WP_HEADER.END_DATE * 2)) FROM STG_AMOS.WP_HEADER");
  assert.equal(exec("SELECT (wp_header.start_date + wp_header.end_date) * 2 FROM wp_header"), "SELECT ((WP_HEADER.START_DATE + WP_HEADER.END_DATE) * 2) FROM STG_AMOS.WP_HEADER");
  assert.equal(
    exec("SELECT wp_header.wpno_i FROM wp_header WHERE NOT wp_header.start_date = 1 AND -wp_header.end_date < 0 OR wp_header.station = 'X'"),
    "SELECT WP_HEADER.WPNO_I FROM STG_AMOS.WP_HEADER WHERE (((NOT (WP_HEADER.START_DATE = 1)) AND ((-WP_HEADER.END_DATE) < 0)) OR (WP_HEADER.STATION = 'X'))",
  );
});

test("#67 SELECT without FROM gets FROM DUAL", () => {
  assert.equal(exec("SELECT 1 AS z_ONE"), 'SELECT 1 AS "z_ONE" FROM DUAL');
});

test("#48 / #47 quotes are doubled; non-ASCII text is N'...'", () => {
  assert.equal(exec("SELECT wp_header.wpno_i FROM wp_header WHERE wp_header.wpno = 'it''s'"), "SELECT WP_HEADER.WPNO_I FROM STG_AMOS.WP_HEADER WHERE (WP_HEADER.WPNO = 'it''s')");
  assert.equal(exec("SELECT wp_header.wpno_i FROM wp_header WHERE wp_header.description = 'Bình'"), "SELECT WP_HEADER.WPNO_I FROM STG_AMOS.WP_HEADER WHERE (WP_HEADER.DESCRIPTION = N'Bình')");
});

test("ORDER BY, NULLS, LIMIT/OFFSET, set operations, IN, BETWEEN, LIKE, EXISTS, CTE print as Oracle", () => {
  assert.equal(
    exec("SELECT wp_header.wpno_i FROM wp_header ORDER BY wp_header.start_date DESC, wp_header.wpno_i LIMIT 5 OFFSET 10"),
    "SELECT WP_HEADER.WPNO_I FROM STG_AMOS.WP_HEADER ORDER BY WP_HEADER.START_DATE DESC NULLS FIRST, WP_HEADER.WPNO_I NULLS LAST OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY",
  );
  assert.equal(exec("SELECT wp_header.wpno_i FROM wp_header ORDER BY wp_header.wpno_i LIMIT 20"), "SELECT WP_HEADER.WPNO_I FROM STG_AMOS.WP_HEADER ORDER BY WP_HEADER.WPNO_I NULLS LAST FETCH FIRST 20 ROWS ONLY");
  assert.equal(
    exec("SELECT wp_header.wpno_i FROM wp_header EXCEPT SELECT wp_sequence.wpno_i FROM wp_sequence ORDER BY 1"),
    "SELECT WP_HEADER.WPNO_I FROM STG_AMOS.WP_HEADER MINUS SELECT WP_SEQUENCE.WPNO_I FROM STG_AMOS.WP_SEQUENCE ORDER BY 1 NULLS LAST",
  );
  assert.equal(
    exec("SELECT wp_header.wpno_i FROM wp_header WHERE wp_header.station IN ('HAN', 'SGN') AND wp_header.start_date BETWEEN 1 AND 2 AND wp_header.wpno LIKE 'A%' AND wp_header.end_date IS NOT NULL"),
    "SELECT WP_HEADER.WPNO_I FROM STG_AMOS.WP_HEADER WHERE ((((WP_HEADER.STATION IN ('HAN', 'SGN')) AND (WP_HEADER.START_DATE BETWEEN 1 AND 2)) AND (WP_HEADER.WPNO LIKE 'A%')) AND (WP_HEADER.END_DATE IS NOT NULL))",
  );
  assert.equal(
    exec("WITH c AS (SELECT wp_header.wpno_i FROM wp_header) SELECT c.wpno_i FROM c WHERE NOT EXISTS (SELECT 1 FROM wp_sequence WHERE wp_sequence.wpno_i = c.wpno_i)"),
    "WITH C AS (SELECT WP_HEADER.WPNO_I FROM STG_AMOS.WP_HEADER) SELECT C.WPNO_I FROM C WHERE (NOT EXISTS (SELECT 1 FROM STG_AMOS.WP_SEQUENCE WHERE (WP_SEQUENCE.WPNO_I = C.WPNO_I)))",
  );
  assert.equal(
    exec("SELECT COUNT(*) FILTER (WHERE wp_header.station = 'HAN') AS z_N, ROW_NUMBER() OVER (PARTITION BY wp_header.station ORDER BY wp_header.wpno_i) AS z_R FROM wp_header GROUP BY wp_header.station, wp_header.wpno_i"),
    "SELECT COUNT(CASE WHEN (WP_HEADER.STATION = 'HAN') THEN 1 END) AS \"z_N\", ROW_NUMBER() OVER (PARTITION BY WP_HEADER.STATION ORDER BY WP_HEADER.WPNO_I NULLS LAST) AS \"z_R\" FROM STG_AMOS.WP_HEADER GROUP BY WP_HEADER.STATION, WP_HEADER.WPNO_I",
  );
});

test("pretty layout: one select item per line, fixed indentation, LF", () => {
  const p = pretty("SELECT wp_header.wpno_i AS z_WP_ID, wp_header.wpno FROM wp_header LEFT JOIN wp_sequence ON wp_sequence.wpno_i = wp_header.wpno_i WHERE wp_header.station = 'HAN' ORDER BY wp_header.wpno_i");
  assert.equal(
    p,
    [
      "SELECT",
      '    WP_HEADER.WPNO_I AS "z_WP_ID",',
      "    WP_HEADER.WPNO",
      "FROM STG_AMOS.WP_HEADER",
      "LEFT JOIN STG_AMOS.WP_SEQUENCE",
      "    ON (WP_SEQUENCE.WPNO_I = WP_HEADER.WPNO_I)",
      "WHERE (WP_HEADER.STATION = 'HAN')",
      "ORDER BY",
      "    WP_HEADER.WPNO_I NULLS LAST",
    ].join("\n"),
  );
});

test("exec is the pretty text on a single line", () => {
  const sql = "WITH c AS (SELECT wp_header.wpno_i FROM wp_header) SELECT c.wpno_i, wp_sequence.seqno FROM c JOIN wp_sequence ON wp_sequence.wpno_i = c.wpno_i WHERE wp_sequence.seqno > 1 AND wp_sequence.seqno < 9 ORDER BY 1";
  const e = exec(sql);
  assert.ok(!e.includes("\n"));
  assert.ok(!/ {2}/.test(e));
  assert.equal(e, pretty(sql).replace(/\(\n\s*/g, "(").replace(/\n\s*\)/g, ")").replace(/\s*\n\s*/g, " "));
});
