// A.8 #2: read-only scan of Oracle text before it may run. Defence in depth: the converter
// only emits SELECT/WITH, and this scan re-checks the final text with the shared lexer.
import { lex, type Token } from "./lex.ts";
import { ConvertError } from "./convert/errors.ts";

const FORBIDDEN_WORDS = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "INTO", "CREATE", "DROP", "ALTER", "TRUNCATE", "GRANT", "REVOKE",
  "COMMIT", "ROLLBACK", "SAVEPOINT", "LOCK", "BEGIN", "DECLARE", "EXECUTE", "EXEC", "CALL", "FOR",
]);

/** Functions the converter may emit (A.8 #2). Anything else called as a function is refused. */
export const EMITTED_FUNCTIONS = new Set([
  "NUMTODSINTERVAL", "ADD_MONTHS", "TRUNC", "LAST_DAY", "LEAST", "EXTRACT", "SYS_EXTRACT_UTC", "SYSTIMESTAMP",
  "CAST", "TO_CHAR", "COALESCE", "NULLIF", "LOWER", "UPPER", "ABS", "MOD", "COUNT", "SUM", "MIN", "MAX",
  "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD",
]);

/** Keywords that may stand right before "(" without being a function call. */
const KEYWORDS_BEFORE_PAREN = new Set([
  "SELECT", "WHERE", "AND", "OR", "NOT", "IN", "EXISTS", "ANY", "AS", "OVER", "FROM", "ON", "BY", "THEN", "ELSE",
  "WHEN", "HAVING", "DISTINCT", "NUMBER", "LIKE", "BETWEEN", "UNION", "ALL", "MINUS", "INTERSECT", "JOIN", "CASE",
]);

function forbid(why: string, detail = ""): never {
  throw new ConvertError("E_FORBIDDEN", `The generated DWH query failed the read-only safety check: ${why}.`, detail);
}

export function assertReadOnlyOracle(text: string): void {
  let tokens: Token[];
  try {
    tokens = lex(text, "oracle");
  } catch (e) {
    forbid("the text could not be read", e instanceof Error ? e.message : String(e));
  }
  const sig = tokens.filter((t) => t.kind !== "space");
  const first = sig[0];
  if (!first || first.kind !== "word" || !["SELECT", "WITH"].includes(first.text.toUpperCase())) {
    forbid("it must start with SELECT or WITH");
  }
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]!;
    const prev = sig[i - 1];
    const next = sig[i + 1];
    const touches = (a: Token, b: Token | undefined) => !!b && a.offset + a.text.length === b.offset;
    switch (t.kind) {
      case "comment":
        forbid("it contains a comment", t.text);
      case "symbol":
        if (t.text === ";") forbid("it contains ';'");
        if (t.text === "@") forbid("it refers to a database link ('@')");
        break;
      case "string":
        if (prev && prev.kind === "word" && touches(prev, t)) forbid("it uses Oracle alternative quoting", prev.text);
        break;
      case "quoted_ident":
        if (next && next.kind === "symbol" && next.text === "(") forbid("it calls a function by a quoted name", t.text);
        break;
      case "word": {
        const w = t.text.toUpperCase();
        const qualified = (prev?.kind === "symbol" && prev.text === ".") || (next?.kind === "symbol" && next.text === ".");
        if (/^(DBMS_|UTL_)/.test(w)) forbid("it uses an Oracle system package", t.text);
        if (!qualified && FORBIDDEN_WORDS.has(w)) forbid(`it contains the keyword ${w}`);
        const isCall = next?.kind === "symbol" && next.text === "(";
        if (isCall && !EMITTED_FUNCTIONS.has(w) && (qualified || !KEYWORDS_BEFORE_PAREN.has(w))) {
          forbid(`it calls the function ${t.text}, which the converter never emits`);
        }
        break;
      }
      default:
        break;
    }
  }
}
