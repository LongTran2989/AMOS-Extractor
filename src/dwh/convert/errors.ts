// Error and warning model of the PostgreSQL -> Oracle converter (plan A.4, A.5).
// Single source of every E_* / W_* code. A task that needs a new code adds it here.

export type ErrorCode =
  | "E_PARSE" // the source (or a scanned text) cannot be read
  | "E_PLACEHOLDER" // <NAME> outside a string literal
  | "E_UNSUPPORTED" // a construct the converter does not translate (named in the message)
  | "E_UNSUPPORTED_FUNCTION" // #74
  | "E_LINT" // #82: source has `npm run validate` errors
  | "E_MULTI_STATEMENT" // #70
  | "E_NOT_SELECT" // root is not SELECT / WITH
  | "E_UNQUALIFIED_COLUMN" // #4
  | "E_UNKNOWN_COLUMN" // #5
  | "E_UNKNOWN_TABLE" // FROM name that is neither a CTE nor an AMOS table
  | "E_TYPE_UNKNOWN" // a rewrite needs a type that cannot be inferred
  | "E_RENAMED_NEEDS_APPROVAL" // #78
  | "E_RETYPED_COLUMN" // #79
  | "E_ALIAS_TOO_LONG" // #10
  | "E_DUPLICATE_OUTPUT" // #11 (openquery mode)
  | "E_INT_CAST_FROM_NON_INT" // #28
  | "E_EMPTY_STRING" // #41
  | "E_CONCAT" // #46
  | "E_BOOLEAN" // #49
  | "E_SELF_CHECK" // A.4 step 10: converter bug
  | "E_FORBIDDEN" // A.8 #2: Oracle text failed the read-only scan
  | "E_TOO_LONG" // #83
  | "E_MISSING_IN_DWH"; // #6, raised by the runner (Phase 2)

export type WarningCode =
  | "W_UTC_TODAY" // #19
  | "W_STRING_ORDER" // #38, #54
  | "W_UNNAMED_COLUMN" // #12
  | "W_SELECT_STAR" // #13
  | "W_LIMIT_NO_ORDER" // #33
  | "W_SUBQUERY_ORDER_DROPPED" // #35
  | "W_CHAR_PADDED" // #40
  | "W_STRING_COMPARE" // #40
  | "W_EMPTY_IS_NULL" // #42
  | "W_DECIMAL_SCALE" // #51
  | "W_MAYBE_LOST_UNICODE" // #80
  | "W_RETYPED_COLUMN" // #79 (when no rewrite depends on the type)
  | "W_NO_CATALOGUE"; // no DWH catalogue snapshot: names upper-cased, availability unknown

export interface SourceLoc {
  line: number;
  column: number;
}

export class ConvertError extends Error {
  code: ErrorCode;
  plain: string;
  detail: string;
  loc?: SourceLoc;

  constructor(code: ErrorCode, plain: string, detail = "", loc?: SourceLoc) {
    super(`${code}: ${plain}${loc ? ` (line ${loc.line}, column ${loc.column})` : ""}${detail ? ` — ${detail}` : ""}`);
    this.name = "ConvertError";
    this.code = code;
    this.plain = plain;
    this.detail = detail;
    if (loc) this.loc = loc;
  }
}

export interface ConvertWarning {
  code: WarningCode;
  plain: string;
  loc?: SourceLoc;
}

/** 1-based line and column of a character offset. */
export function locAt(text: string, offset: number): SourceLoc {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** Adds a warning unless the same code with the same text is already listed. */
export function addWarning(list: ConvertWarning[], w: ConvertWarning): void {
  if (!list.some((x) => x.code === w.code && x.plain === w.plain)) list.push(w);
}
