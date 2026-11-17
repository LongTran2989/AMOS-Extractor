import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReadOnlyOracle } from "../../src/dwh/safety.ts";
import { rejects } from "./helpers.ts";

const BASE = "SELECT WP_HEADER.WPNO FROM STG_AMOS.WP_HEADER";

const MUST_THROW: string[] = [
  // Each forbidden keyword (A.8 #2).
  "INSERT INTO STG_AMOS.X VALUES (1)",
  `${BASE} WHERE (WP_HEADER.WPNO = 'a') UPDATE`,
  "DELETE FROM STG_AMOS.WP_HEADER",
  "MERGE INTO STG_AMOS.X USING DUAL ON (1 = 1)",
  `${BASE} INTO X`,
  "CREATE TABLE X (A NUMBER)",
  "DROP TABLE STG_AMOS.WP_HEADER",
  "ALTER SESSION SET NLS_SORT = BINARY",
  "TRUNCATE TABLE STG_AMOS.WP_HEADER",
  "GRANT SELECT ON X TO Y",
  "REVOKE SELECT ON X FROM Y",
  `${BASE} COMMIT`,
  `${BASE} ROLLBACK`,
  `${BASE} SAVEPOINT A`,
  "LOCK TABLE STG_AMOS.WP_HEADER IN EXCLUSIVE MODE",
  "BEGIN NULL; END",
  "DECLARE X NUMBER",
  "EXECUTE IMMEDIATE 'DROP TABLE X'",
  `${BASE} EXEC`,
  "CALL DBMS_OUTPUT.PUT_LINE('x')",
  `${BASE} FOR UPDATE`,
  // Statement separators, comments, database links.
  `${BASE}; DROP TABLE X`,
  `${BASE};`,
  `${BASE}@DBLINK`,
  `SELECT X.A FROM STG_AMOS.X@REMOTE`,
  `${BASE} -- comment`,
  `${BASE} /* comment */`,
  `/**/DELETE FROM X`,
  // Functions that are not on the emitted list.
  `SELECT DBMS_LOCK.SLEEP(5) FROM DUAL`,
  `SELECT UTL_HTTP.REQUEST('x') FROM DUAL`,
  `SELECT SYS_CONTEXT('USERENV', 'SESSION_USER') FROM DUAL`,
  `${BASE} WHERE (LENGTH(WP_HEADER.WPNO) = 1)`,
  `SELECT "DBMS_LOCK"."SLEEP"(5) FROM DUAL`,
  `SELECT DBMS_RANDOM.VALUE FROM DUAL`,
  // Must start with SELECT or WITH.
  `(SELECT 1 FROM DUAL)`,
  `VALUES (1)`,
  // Oracle alternative quoting could hide text from the scan.
  `SELECT q'[x' DROP ]' FROM DUAL`,
  // Unterminated text.
  `SELECT 'abc FROM DUAL`,
];

const MUST_PASS: string[] = [
  BASE,
  `${BASE} WHERE (WP_HEADER.WPNO = 'DROP TABLE X; --')`,
  `SELECT X."COMMENT" FROM STG_AMOS.X`,
  `SELECT N'Bình' AS "z_X" FROM DUAL`,
  `WITH C AS (SELECT X.A FROM STG_AMOS.X) SELECT C.A FROM C`,
  `SELECT TRUNC(SYS_EXTRACT_UTC(SYSTIMESTAMP)) FROM DUAL`,
  `SELECT (ADD_MONTHS(TRUNC(DATE '2026-01-31', 'MM'), -6) + (LEAST(EXTRACT(DAY FROM DATE '2026-01-31'), EXTRACT(DAY FROM LAST_DAY(DATE '2026-01-31'))) - 1)) FROM DUAL`,
  `SELECT (SYS_EXTRACT_UTC(SYSTIMESTAMP) + NUMTODSINTERVAL(7, 'HOUR')) FROM DUAL`,
  `SELECT COUNT(CASE WHEN (X.A = 1) THEN 1 END), SUM(X.A), MIN(X.A), MAX(X.A) FROM STG_AMOS.X`,
  `SELECT ROW_NUMBER() OVER (PARTITION BY X.A ORDER BY X.B DESC NULLS FIRST) FROM STG_AMOS.X`,
  `SELECT CAST(X.A AS NUMBER(10)), TO_CHAR(X.A), MOD(X.A, 2), COALESCE(X.A, 0), NULLIF(X.A, 0), ABS(X.A) FROM STG_AMOS.X`,
  `SELECT X.A FROM STG_AMOS.X WHERE ((LOWER(X.B) LIKE LOWER('a%')) AND EXISTS (SELECT 1 FROM STG_AMOS.Y WHERE (Y.A = X.A)) AND (X.C IN ('a', 'b')))`,
  `SELECT X.A FROM STG_AMOS.X ORDER BY X.A NULLS LAST FETCH FIRST 20 ROWS ONLY`,
  `SELECT X.A FROM STG_AMOS.X MINUS SELECT Y.A FROM STG_AMOS.Y`,
  `SELECT X.FOR_X, X.UPDATED FROM STG_AMOS.X`,
];

test("at least 30 Oracle texts are refused with E_FORBIDDEN", () => {
  assert.ok(MUST_THROW.length >= 30);
  for (const sql of MUST_THROW) {
    const e = rejects(() => assertReadOnlyOracle(sql));
    assert.equal(e.code, "E_FORBIDDEN", sql);
  }
});

test("read-only Oracle texts pass, including keywords inside strings and quoted names", () => {
  for (const sql of MUST_PASS) assert.doesNotThrow(() => assertReadOnlyOracle(sql), sql);
});
