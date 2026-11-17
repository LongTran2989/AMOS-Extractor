// A.4 step 6: type inference over the PostgreSQL tree. Column types come from the AMOS CSV,
// literal types from the literal, derived types from PostgreSQL's operator rules for the
// small set of operators the guard allows. "unknown" means "cannot tell": a rewrite that
// needs the type then refuses (E_TYPE_UNKNOWN).
import { functionName, isSubquery, type PgExpr } from "./guard.ts";
import { setExprTyper, type ScopeInfo, type SqlType } from "./scope.ts";

const NUMERIC_RANK: Record<string, number> = { int: 1, numeric: 2, float: 3 };

function numericResult(a: SqlType, b: SqlType): SqlType {
  const ra = NUMERIC_RANK[a];
  const rb = NUMERIC_RANK[b];
  if (!ra || !rb) return "unknown";
  return ra >= rb ? a : b;
}

export function castTargetType(dataType: string): SqlType {
  switch (dataType.toUpperCase()) {
    case "INTEGER":
    case "INT":
    case "INT4":
    case "BIGINT":
    case "INT8":
    case "SMALLINT":
    case "INT2":
      return "int";
    case "NUMERIC":
    case "DECIMAL":
      return "numeric";
    case "TEXT":
    case "VARCHAR":
      return "text";
    case "DATE":
      return "date";
    case "TIMESTAMP":
      return "timestamp";
    default:
      return "unknown";
  }
}

function numberLiteralType(v: unknown): SqlType {
  const s = String(v);
  return /^-?\d+$/.test(s) ? "int" : "numeric";
}

export function inferType(expr: PgExpr, scope: ScopeInfo): SqlType {
  if (expr === null || expr === undefined) return "unknown";
  if (isSubquery(expr)) {
    const cols = expr.ast?.columns;
    if (expr.ast?._next || !Array.isArray(cols) || cols.length !== 1) return "unknown";
    const e = cols[0].expr;
    if (e?.type === "column_ref" && e.column === "*") return "unknown";
    return inferType(e, scope);
  }
  switch (expr.type) {
    case "column_ref":
      return scope.pgTypeOf(expr);
    case "number":
    case "bigint":
      return numberLiteralType(expr.value);
    case "single_quote_string":
      return "text";
    case "date":
      return "date";
    case "timestamp":
      return "timestamp";
    case "interval":
      return "interval";
    case "null":
      return "unknown";
    case "cast":
      return castTargetType(String(expr.target?.[0]?.dataType ?? ""));
    case "extract":
      return "int";
    case "unary_expr":
      return expr.operator === "-" || expr.operator === "+" ? inferType(expr.expr, scope) : "unknown";
    case "function": {
      const name = functionName(expr);
      const args: PgExpr[] = expr.args?.value ?? [];
      switch (name) {
        case "CURRENT_DATE":
          return "date";
        case "CURRENT_TIMESTAMP":
        case "NOW":
          return "timestamp";
        case "LOWER":
        case "UPPER":
          return "text";
        case "ABS":
        case "NULLIF":
          return inferType(args[0], scope);
        case "COALESCE": {
          for (const a of args) {
            const t = inferType(a, scope);
            if (t !== "unknown") return t;
          }
          return "unknown";
        }
        default:
          return "unknown";
      }
    }
    case "aggr_func": {
      const name = String(expr.name).toUpperCase();
      if (name === "COUNT") return "int";
      const t = expr.args?.expr?.type === "star" ? "unknown" : inferType(expr.args?.expr, scope);
      if (name === "SUM") return t === "int" || t === "numeric" || t === "float" ? t : "unknown";
      return t; // MIN, MAX
    }
    case "window_func": {
      const name = String(expr.name).toUpperCase();
      if (name === "LAG" || name === "LEAD") return inferType(expr.args?.value?.[0], scope);
      return "int";
    }
    case "binary_expr": {
      const op = String(expr.operator);
      if (!["+", "-", "*", "/", "%"].includes(op)) return "unknown"; // comparisons and logic
      const l = inferType(expr.left, scope);
      const r = inferType(expr.right, scope);
      const dated = (t: SqlType) => t === "date" || t === "timestamp";
      if (op === "+" || op === "-") {
        if (dated(l) && r === "interval") return "timestamp";
        if (op === "+" && l === "interval" && dated(r)) return "timestamp";
        if (l === "interval" && r === "interval") return "interval";
        if (l === "date" && r === "int") return "date";
        if (op === "+" && l === "int" && r === "date") return "date";
        if (op === "-" && l === "date" && r === "date") return "int";
        if (op === "-" && l === "timestamp" && r === "timestamp") return "interval";
        if (dated(l) || dated(r) || l === "interval" || r === "interval") return "unknown";
      }
      if (op === "*" && ((l === "interval" && r === "int") || (l === "int" && r === "interval"))) return "interval";
      return numericResult(l, r);
    }
    default:
      return "unknown";
  }
}

setExprTyper(inferType);
