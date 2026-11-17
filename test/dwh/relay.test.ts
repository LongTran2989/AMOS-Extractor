import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPreviewCap, buildRelayStatement } from "../../src/dwh/relay.ts";
import { rejects } from "./helpers.ts";

const P = (name: string, value: string) => ({ name, value, maxLength: 100 });
const OQ = /^SELECT \* FROM OPENQUERY\(\[DWH_DB\], N'([\s\S]*)'\)$/;
const AT = /^EXEC \(N'([\s\S]*)'(, @p\d+)*\) AT \[DWH_DB\]$/;

test("relay statement doubles quotes and uses N-strings", () => {
  const exec = "SELECT X.A FROM STG_AMOS.X WHERE (X.B = 'O''Brien') AND (X.C = N'Kiểm tra')";
  const oq = buildRelayStatement(exec, "openquery", [], "DWH_DB");
  assert.equal(oq.tsql, "SELECT * FROM OPENQUERY([DWH_DB], N'SELECT X.A FROM STG_AMOS.X WHERE (X.B = ''O''''Brien'') AND (X.C = N''Kiểm tra'')')");
  assert.deepEqual(oq.inputs, []);
  const at = buildRelayStatement(exec, "exec_at", [], "DWH_DB");
  assert.equal(at.tsql, "EXEC (N'SELECT X.A FROM STG_AMOS.X WHERE (X.B = ''O''''Brien'') AND (X.C = N''Kiểm tra'')') AT [DWH_DB]");
});

test("relay statement is one of the two templates", () => {
  const exec = "SELECT X.A FROM STG_AMOS.X WHERE (X.B = '<WPNO>')";
  assert.match(buildRelayStatement(exec, "openquery", [P("WPNO", "A1")], "DWH_DB").tsql, OQ);
  assert.match(buildRelayStatement(exec, "exec_at", [P("WPNO", "A1")], "DWH_DB").tsql, AT);
  assert.throws(() => buildRelayStatement(exec, "openquery", [P("WPNO", "A1")], "DWH_DB]; DROP TABLE x --"), /linked server/);
});

test("placeholder value is trimmed; bound in exec_at; refused if unsafe in openquery", () => {
  const exec = "SELECT X.A FROM STG_AMOS.X WHERE (X.B = '<INSERT_WPNO_HERE>')";
  const pasted = " 2-VNAB-090926-CHK-STO\t";
  const oq = buildRelayStatement(exec, "openquery", [P("INSERT_WPNO_HERE", pasted)], "DWH_DB");
  assert.equal(oq.tsql, "SELECT * FROM OPENQUERY([DWH_DB], N'SELECT X.A FROM STG_AMOS.X WHERE (X.B = ''2-VNAB-090926-CHK-STO'')')");
  const at = buildRelayStatement(exec, "exec_at", [P("INSERT_WPNO_HERE", "O'Brien ")], "DWH_DB");
  assert.equal(at.tsql, "EXEC (N'SELECT X.A FROM STG_AMOS.X WHERE (X.B = ?)', @p1) AT [DWH_DB]");
  assert.deepEqual(at.inputs, [{ name: "p1", value: "O'Brien", maxLength: 100 }]);
  for (const bad of ["O'Brien", "a;b", "x\ny", "ĐI", "x".repeat(101)]) {
    assert.equal(rejects(() => buildRelayStatement(exec, "openquery", [P("INSERT_WPNO_HERE", bad)], "DWH_DB")).code, "E_UNSAFE_PARAM_VALUE", bad);
  }
});

test("empty placeholder value is refused", () => {
  const exec = "SELECT X.A FROM STG_AMOS.X WHERE (X.B = '<WPNO>')";
  for (const mode of ["openquery", "exec_at"] as const) {
    assert.equal(rejects(() => buildRelayStatement(exec, mode, [P("WPNO", "  \t")], "DWH_DB")).code, "E_PARAM_MISSING");
    assert.equal(rejects(() => buildRelayStatement(exec, mode, [], "DWH_DB")).code, "E_PARAM_MISSING");
  }
});

test("a placeholder used twice gets two bound parameters in exec_at", () => {
  const exec = "SELECT X.A FROM STG_AMOS.X WHERE (X.B = '<W>') OR (X.C = '<W>')";
  const at = buildRelayStatement(exec, "exec_at", [P("W", "A1")], "DWH_DB");
  assert.equal(at.tsql, "EXEC (N'SELECT X.A FROM STG_AMOS.X WHERE (X.B = ?) OR (X.C = ?)', @p1, @p2) AT [DWH_DB]");
  assert.equal(at.inputs.length, 2);
});

test("openquery text over 8000 characters with the real values is refused (E_TOO_LONG)", () => {
  // 7,990 characters once quotes are doubled with a 1-character value; over 8000 with 100 characters.
  const head = "SELECT X.A FROM STG_AMOS.X WHERE (X.B = '<W>') OR X.C IN (";
  const filler = "'W', ".repeat(Math.floor((7990 - 4 - (head.length + 1)) / 7));
  const exec = `${head}${filler}'W')`;
  const inner = (t: string) => OQ.exec(t)![1]!.length;
  const fits = inner(buildRelayStatement(exec, "openquery", [P("W", "A")], "DWH_DB").tsql);
  assert.ok(fits <= 8000 && fits + 99 > 8000, `length ${fits}`);
  assert.equal(rejects(() => buildRelayStatement(exec, "openquery", [P("W", "A".repeat(100))], "DWH_DB")).code, "E_TOO_LONG");
  assert.ok(buildRelayStatement(exec, "exec_at", [P("W", "A".repeat(100))], "DWH_DB"));
});

test("preview cap appends FETCH FIRST on 19, ROWNUM wrap on 11", () => {
  const q = "SELECT X.A FROM STG_AMOS.X ORDER BY X.A NULLS LAST";
  assert.equal(applyPreviewCap(q, 19, 501, false), `${q} FETCH FIRST 501 ROWS ONLY`);
  assert.equal(applyPreviewCap(q, 12, 501, false), `${q} FETCH FIRST 501 ROWS ONLY`);
  assert.equal(applyPreviewCap(q, 11, 501, false), `SELECT * FROM (${q}) WHERE ROWNUM <= 501`);
  // Duplicate names cannot be wrapped: the text is left alone and the runner stops reading.
  assert.equal(applyPreviewCap(q, 11, 501, true), q);
});

test("preview cap lowers an existing FETCH FIRST and keeps a smaller one", () => {
  const q = "SELECT X.A FROM STG_AMOS.X ORDER BY X.A NULLS LAST";
  assert.equal(applyPreviewCap(`${q} FETCH FIRST 2000 ROWS ONLY`, 12, 501, false), `${q} FETCH FIRST 501 ROWS ONLY`);
  assert.equal(applyPreviewCap(`${q} FETCH FIRST 20 ROWS ONLY`, 12, 501, false), `${q} FETCH FIRST 20 ROWS ONLY`);
  assert.equal(applyPreviewCap(`${q} OFFSET 5 ROWS FETCH NEXT 900 ROWS ONLY`, 12, 501, false), `${q} OFFSET 5 ROWS FETCH NEXT 501 ROWS ONLY`);
  assert.equal(applyPreviewCap(`${q} OFFSET 5 ROWS`, 12, 501, false), `${q} OFFSET 5 ROWS FETCH NEXT 501 ROWS ONLY`);
  // A FETCH inside a subquery is not the outer one.
  const sub = "SELECT X.A FROM STG_AMOS.X WHERE X.A IN (SELECT Y.A FROM STG_AMOS.Y FETCH FIRST 5 ROWS ONLY)";
  assert.equal(applyPreviewCap(sub, 12, 501, false), `${sub} FETCH FIRST 501 ROWS ONLY`);
});
