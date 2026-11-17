// A.4 step 7: rewrite the PostgreSQL tree into the Oracle IR (plan A.5).
import { functionName, type PgExpr } from "./guard.ts";
import { oracleBareTableName, oracleColumnName, type CteOutput, type ScopeInfo } from "./scope.ts";
import { oracleIdent } from "./oracleWords.ts";
import { rewriteDateExpr, failAt, type RewriteCtx } from "./dates.ts";
import { NULL, bin, col, fn, num, str, type IrExpr } from "./ir.ts";

const COMPARISONS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);

/** Quoted Oracle alias that keeps the source spelling, e.g. "z_WP_ID". */
export function quoteAlias(alias: string): string {
  return `"${alias.replace(/"/g, '""')}"`;
}

/** Printed name of a CTE output column as its defining query prints it. */
function ctePrintedName(out: CteOutput, scope: ScopeInfo, ctx: RewriteCtx): string {
  if (out.aliased) return quoteAlias(out.name);
  const ir = rewriteExpr(out.expr, scope, ctx);
  if (ir.k !== "col") failAt(ctx, out.expr, "E_UNSUPPORTED", `The WITH query column ${out.name} needs a name.`);
  return ir.name;
}

export function columnIr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx, usage: "output" | "expr" = "expr"): IrExpr {
  const r = scope.resolve(expr);
  switch (r.kind) {
    case "table": {
      const name = oracleColumnName(`${r.table}.${r.column}`, { ...ctx, csv: scope.csv, usage }).name;
      return col(oracleBareTableName(r.table, ctx), name);
    }
    case "cte":
      return col(oracleIdent(r.cte.toUpperCase()), ctePrintedName(r.out, scope, ctx));
    case "alias":
      return rewriteExpr(r.target, scope, ctx);
    default:
      return failAt(ctx, expr, "E_UNSUPPORTED", "Unexpected column reference.");
  }
}

export function rewriteExpr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr {
  const dated = rewriteDateExpr(expr, scope, ctx);
  if (dated) return dated;
  const R = (e: PgExpr) => rewriteExpr(e, scope, ctx);
  switch (expr?.type) {
    case "column_ref":
      return columnIr(expr, scope, ctx);
    case "number":
    case "bigint":
      return num(String(expr.value));
    case "single_quote_string":
      return str(String(expr.value));
    case "null":
      return NULL;
    case "binary_expr": {
      const op = String(expr.operator).toUpperCase();
      if (op === "AND" || op === "OR" || COMPARISONS.has(op)) return bin(op === "!=" ? "<>" : op, R(expr.left), R(expr.right));
      if (op === "+" || op === "-" || op === "*") return bin(op, R(expr.left), R(expr.right));
      return failAt(ctx, expr, "E_UNSUPPORTED", `The operator ${expr.operator} is not translated yet.`);
    }
    case "function": {
      const name = functionName(expr);
      if (["COALESCE", "NULLIF", "LOWER", "UPPER", "ABS"].includes(name)) return fn(name, ...(expr.args?.value ?? []).map(R));
      return failAt(ctx, expr, "E_UNSUPPORTED_FUNCTION", `The function ${name} is not translated yet.`);
    }
    default:
      return failAt(ctx, expr, "E_UNSUPPORTED", `The query uses something the DWH converter does not translate (${String(expr?.type)}).`);
  }
}
