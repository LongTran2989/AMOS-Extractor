import { test } from "node:test";
import assert from "node:assert/strict";
import { preprocess, restorePlaceholders } from "../../src/dwh/convert/preprocess.ts";
import { lex } from "../../src/dwh/lex.ts";
import { ConvertError } from "../../src/dwh/convert/errors.ts";

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ConvertError, `expected ConvertError, got ${e}`);
    return e.code;
  }
  assert.fail("expected a ConvertError");
}

test("placeholder in string is replaced and listed", () => {
  const r = preprocess("SELECT t.a FROM t WHERE t.b = '<INSERT_WPNO_HERE>' AND t.c IN ('<X_1>', '<INSERT_WPNO_HERE>')");
  assert.equal(r.sql, "SELECT t.a FROM t WHERE t.b = '__PH_INSERT_WPNO_HERE__' AND t.c IN ('__PH_X_1__', '__PH_INSERT_WPNO_HERE__')");
  assert.deepEqual(r.placeholders, ["INSERT_WPNO_HERE", "X_1"]);
});

test("placeholder outside a string throws E_PLACEHOLDER", () => {
  assert.equal(code(() => preprocess("SELECT t.a FROM t WHERE t.b = <INSERT_WPNO_HERE>")), "E_PLACEHOLDER");
});

test("placeholder inside a comment is ignored", () => {
  const r = preprocess("-- replace <INSERT_WPNO_HERE>; first\nSELECT t.a /* <X> ; */ FROM t");
  assert.deepEqual(r.placeholders, []);
  assert.ok(!r.sql.includes("<"));
  assert.ok(!r.sql.includes(";"));
  assert.ok(r.sql.includes("SELECT t.a"));
  // Comments become blanks, so line numbers stay the same.
  assert.equal(r.sql.split("\n").length, 2);
});

test("CRLF becomes LF", () => {
  const r = preprocess("SELECT t.a\r\nFROM t\r\n");
  assert.equal(r.sql, "SELECT t.a\nFROM t\n");
});

test("E-string, U&-string and dollar quoting throw E_UNSUPPORTED", () => {
  assert.equal(code(() => preprocess("SELECT E'x\\n' FROM t")), "E_UNSUPPORTED");
  assert.equal(code(() => preprocess("SELECT e'x' FROM t")), "E_UNSUPPORTED");
  assert.equal(code(() => preprocess("SELECT U&'x' FROM t")), "E_UNSUPPORTED");
  assert.equal(code(() => preprocess("SELECT $$x$$ FROM t")), "E_UNSUPPORTED");
  assert.equal(code(() => preprocess("SELECT $tag$x$tag$ FROM t")), "E_UNSUPPORTED");
});

test("an error carries the source line and column", () => {
  try {
    preprocess("SELECT t.a\nFROM t\nWHERE t.b = <X>");
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof ConvertError);
    assert.deepEqual(e.loc, { line: 3, column: 13 });
    assert.ok(e.plain.length > 0);
  }
});

test("nested block comment lexes as one comment", () => {
  const toks = lex("a /* x /* y */ z */ b", "pg").filter((t) => t.kind !== "space");
  assert.deepEqual(toks.map((t) => t.kind), ["word", "comment", "word"]);
  assert.equal(toks[1]!.text, "/* x /* y */ z */");
  assert.equal(toks[2]!.offset, 20);
});

test("lexer: strings with doubled quotes, quoted identifiers, national strings", () => {
  const pg = lex(`'it''s' "Col""x" N'a' -- c\n1.5 <= ::`, "pg").filter((t) => t.kind !== "space");
  assert.deepEqual(pg.map((t) => [t.kind, t.text]), [
    ["string", "'it''s'"],
    ["quoted_ident", '"Col""x"'],
    ["word", "N"],
    ["string", "'a'"],
    ["comment", "-- c"],
    ["number", "1.5"],
    ["symbol", "<="],
    ["symbol", "::"],
  ]);
  const ora = lex("N'Bình' 'x'", "oracle").filter((t) => t.kind !== "space");
  assert.deepEqual(ora.map((t) => t.kind), ["nstring", "string"]);
});

test("unterminated string or comment throws E_PARSE", () => {
  assert.equal(code(() => lex("SELECT 'abc", "pg")), "E_PARSE");
  assert.equal(code(() => lex("SELECT /* abc", "pg")), "E_PARSE");
});

test("INTERVAL 'n' WEEK is kept as 'n week' (the parser would drop WEEK)", () => {
  const r = preprocess("SELECT t.a FROM t WHERE t.d > CURRENT_DATE - INTERVAL '2' WEEK");
  assert.equal(r.sql, "SELECT t.a FROM t WHERE t.d > CURRENT_DATE - INTERVAL '2 week'");
});

test("restorePlaceholders round-trips", () => {
  const src = "SELECT t.a FROM t WHERE t.b = '<INSERT_WPNO_HERE>' AND t.c = 'x<Y>'";
  const r = preprocess(src);
  assert.equal(restorePlaceholders(r.sql, r.placeholders), src);
  // Inside Oracle output text, the sentinels are restored the same way.
  assert.equal(restorePlaceholders("(X.B = '__PH_INSERT_WPNO_HERE__')", ["INSERT_WPNO_HERE"]), "(X.B = '<INSERT_WPNO_HERE>')");
});
