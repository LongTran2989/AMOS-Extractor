// A.4 step 7: rewrite the PostgreSQL tree into the Oracle IR (plan A.5).
import { isDeepStrictEqual } from "node:util";
import { addWarning } from "./errors.ts";
import { functionName, isSubquery, type PgExpr, type PgNode, type SelectAst } from "./guard.ts";
import { catalogueDataType, oracleBareTableName, oracleColumnName, oracleTableName, type CteOutput, type ScopeInfo, type SqlType } from "./scope.ts";
import { oracleIdent } from "./oracleWords.ts";
import { inferType } from "./types.ts";
import { rewriteDateExpr, failAt, type RewriteCtx } from "./dates.ts";
import { NULL, bin, cast, col, fn, nstr, num, str, type IrColumn, type IrExpr, type IrFrom, type IrOrder, type IrQuery, type IrSelect, type IrWindow } from "./ir.ts";

const COMPARISONS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);
const PREDICATE_OPS = new Set([...COMPARISONS, "AND", "OR", "IN", "NOT IN", "LIKE", "NOT LIKE", "ILIKE", "NOT ILIKE", "BETWEEN", "NOT BETWEEN", "IS", "IS NOT"]);
const MAX_ALIAS = 30;

/** Quoted Oracle alias that keeps the source spelling, e.g. "z_WP_ID". */
export function quoteAlias(alias: string): string {
  return `"${alias.replace(/"/g, '""')}"`;
}

const unquote = (name: string) => (name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name);

function sortNote(t: SqlType, ctx: RewriteCtx) {
  const sameOrder = ctx.mapping.amosCollation === "C" && ctx.mapping.nlsSort.toUpperCase() === "BINARY";
  if (t === "text" && !sameOrder) {
    addWarning(ctx.warnings, {
      code: "W_STRING_ORDER",
      plain: "Text sorts, and text comparisons with <, >, BETWEEN, may differ slightly from AMOS (the DWH orders text by character code).",
    });
  }
}

/** '' in AMOS is NULL in Oracle: these text operations can then match different rows (#42). */
function emptyNote(sides: PgExpr[], scope: ScopeInfo, ctx: RewriteCtx) {
  if (sides.some((s) => s && inferType(s, scope) === "text")) {
    addWarning(ctx.warnings, {
      code: "W_EMPTY_IS_NULL",
      plain: "Text that is empty ('') in AMOS is NULL in the DWH, so IS NULL, <>, NOT IN, NOT LIKE, text ranges and COALESCE/NULLIF on text can match different rows.",
    });
  }
}

/** Warnings for comparing text: linguistic comparison or blank-padded CHAR columns (#40). */
function compareNote(sides: PgExpr[], scope: ScopeInfo, ctx: RewriteCtx) {
  for (const s of sides) {
    if (!s || inferType(s, scope) !== "text") continue;
    if (ctx.mapping.nlsComp.toUpperCase() !== "BINARY") {
      addWarning(ctx.warnings, { code: "W_STRING_COMPARE", plain: `The DWH compares text with NLS_COMP = ${ctx.mapping.nlsComp}, which can differ from AMOS (case, accents).` });
    }
    if (s.type === "column_ref" && s.table) {
      const r = scope.resolve(s);
      if (r.kind === "table" && /^N?CHAR$/i.test(catalogueDataType(r.table, r.column, ctx) ?? "")) {
        addWarning(ctx.warnings, { code: "W_CHAR_PADDED", plain: `${r.table}.${r.column} is a fixed-length CHAR column in the DWH; values are padded with spaces.` });
      }
    }
  }
}

function isPredicate(e: PgExpr): boolean {
  if (!e || typeof e !== "object") return false;
  if (e.type === "binary_expr") return PREDICATE_OPS.has(String(e.operator).toUpperCase());
  if (e.type === "unary_expr") return ["NOT", "NOT EXISTS"].includes(String(e.operator).toUpperCase());
  if (e.type === "function") return ["EXISTS"].includes(functionName(e));
  return e.type === "bool";
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

function windowIr(over: PgNode, scope: ScopeInfo, ctx: RewriteCtx): IrWindow {
  const ws = over?.as_window_specification?.window_specification ?? {};
  return {
    partitionBy: (ws.partitionby ?? []).map((p: PgNode) => rewriteExpr(p.expr ?? p, scope, ctx)),
    orderBy: (ws.orderby ?? []).map((o: PgNode) => orderItem(o, o.expr, scope, ctx)),
  };
}

function orderItem(o: PgNode, expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrOrder {
  sortNote(inferType(expr, scope), ctx);
  return orderShape(o, rewriteExpr(expr, scope, ctx));
}

function orderShape(o: PgNode, e: IrExpr): IrOrder {
  const desc = String(o.type ?? "").toUpperCase() === "DESC";
  const nulls = o.nulls ? (/FIRST/i.test(String(o.nulls)) ? "FIRST" : "LAST") : desc ? "FIRST" : "LAST";
  return { e, desc, nulls };
}

function castIr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr {
  const t = expr.target[0];
  const dt = String(t.dataType).toUpperCase();
  const st = inferType(expr.expr, scope);
  const unknown = () => failAt(ctx, expr, "E_TYPE_UNKNOWN", `Cannot tell the type of the value cast to ${dt.toLowerCase()}.`);
  const R = () => rewriteExpr(expr.expr, scope, ctx);
  const intTarget: Record<string, string> = { INTEGER: "NUMBER(10)", INT: "NUMBER(10)", INT4: "NUMBER(10)", BIGINT: "NUMBER(19)", INT8: "NUMBER(19)", SMALLINT: "NUMBER(5)", INT2: "NUMBER(5)" };
  if (intTarget[dt]) {
    if (st === "int") return cast(R(), intTarget[dt]!);
    if (st === "numeric" || st === "float") {
      failAt(ctx, expr, "E_INT_CAST_FROM_NON_INT", `Casting a decimal value to ${dt.toLowerCase()} rounds differently in AMOS and the DWH. Keep the decimal value.`);
    }
    if (st === "unknown") unknown();
    failAt(ctx, expr, "E_UNSUPPORTED", `Casting ${st} to ${dt.toLowerCase()} is not supported.`);
  }
  if (dt === "NUMERIC" || dt === "DECIMAL") {
    if (t.length === undefined || t.length === null) failAt(ctx, expr, "E_UNSUPPORTED", "A bare ::numeric cast is not supported; give the precision, e.g. ::numeric(10,2).");
    if (st === "unknown") unknown();
    if (st !== "int" && st !== "numeric") failAt(ctx, expr, "E_UNSUPPORTED", `Casting ${st} to numeric is not supported.`);
    return cast(R(), `NUMBER(${t.length}${t.scale !== undefined && t.scale !== null ? `,${t.scale}` : ""})`);
  }
  if (dt === "TEXT" || dt === "VARCHAR") {
    if (st === "unknown") unknown();
    if (st !== "int") failAt(ctx, expr, "E_UNSUPPORTED", `Casting ${st} to text is not supported (formatting belongs in the code that reads the data).`);
    if (dt === "VARCHAR" && t.length !== undefined && t.length !== null && Number(t.length) < 20) {
      failAt(ctx, expr, "E_UNSUPPORTED", `::varchar(${t.length}) could cut numbers short; use ::text or ::varchar(20).`);
    }
    return fn("TO_CHAR", R());
  }
  return failAt(ctx, expr, "E_UNSUPPORTED", `Casting to ${dt.toLowerCase()} is not supported.`);
}

function aggregateIr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr {
  const name = String(expr.name).toUpperCase();
  const a = expr.args?.expr;
  const star = a?.type === "star";
  if ((name === "MIN" || name === "MAX") && !star) sortNote(inferType(a, scope), ctx);
  let args: IrExpr[] = [star ? { k: "star" } : rewriteExpr(a, scope, ctx)];
  if (expr.filter) {
    const cond = rewriteExpr(expr.filter.where, scope, ctx);
    args = [{ k: "case", whens: [{ cond, then: star ? num(1) : args[0]! }] }];
  }
  const out: IrExpr = { k: "fn", name, args };
  if (expr.args?.distinct) out.distinct = true;
  if (expr.over) out.over = windowIr(expr.over, scope, ctx);
  return out;
}

function binaryIr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr {
  const op = String(expr.operator).toUpperCase();
  const R = (e: PgExpr) => rewriteExpr(e, scope, ctx);
  const l = expr.left;
  const r = expr.right;
  switch (op) {
    case "AND":
    case "OR":
      return bin(op, R(l), R(r));
    case "IS":
    case "IS NOT":
      if (r?.type !== "null") failAt(ctx, expr, "E_UNSUPPORTED", `${op} is only supported with NULL.`);
      emptyNote([l], scope, ctx);
      return { k: "isnull", not: op === "IS NOT", e: R(l) };
    case "IN":
    case "NOT IN": {
      const vals: PgExpr[] = r?.value ?? [];
      if (vals.length === 1 && isSubquery(vals[0])) return { k: "in_sub", not: op === "NOT IN", e: R(l), q: queryIr(vals[0].ast, scope, ctx, false) };
      compareNote([l, ...vals], scope, ctx);
      if (op === "NOT IN") emptyNote([l], scope, ctx);
      return { k: "in", not: op === "NOT IN", e: R(l), list: vals.map(R) };
    }
    case "BETWEEN":
    case "NOT BETWEEN": {
      const [lo, hi] = r?.value ?? [];
      compareNote([l, lo, hi], scope, ctx);
      sortNote(inferType(l, scope), ctx);
      if (op === "NOT BETWEEN") emptyNote([l], scope, ctx);
      return { k: "between", not: op === "NOT BETWEEN", e: R(l), lo: R(lo), hi: R(hi) };
    }
    case "LIKE":
    case "NOT LIKE":
    case "ILIKE":
    case "NOT ILIKE": {
      if (r?.type !== "single_quote_string") failAt(ctx, expr, "E_UNSUPPORTED", "LIKE patterns must be a '…' text literal.");
      if (String(r.value).includes("\\")) failAt(ctx, expr, "E_UNSUPPORTED", "A LIKE pattern with a backslash (\\) is not supported: AMOS treats it as an escape, the DWH does not.");
      compareNote([l], scope, ctx);
      const not = op.startsWith("NOT");
      if (not) emptyNote([l], scope, ctx);
      if (op.endsWith("ILIKE")) return { k: "like", not, e: fn("LOWER", R(l)), pat: fn("LOWER", R(r)) };
      return { k: "like", not, e: R(l), pat: R(r) };
    }
    case "/": {
      const lt = inferType(l, scope);
      const rt = inferType(r, scope);
      if (lt === "unknown" || rt === "unknown") failAt(ctx, expr, "E_TYPE_UNKNOWN", "Cannot tell whether this division is between whole numbers.");
      if (lt === "int" && rt === "int") return fn("TRUNC", bin("/", R(l), R(r)));
      addWarning(ctx.warnings, { code: "W_DECIMAL_SCALE", plain: "Decimal division may show a different number of decimal places than AMOS." });
      return bin("/", R(l), R(r));
    }
    case "%": {
      const lt = inferType(l, scope);
      const rt = inferType(r, scope);
      if (lt === "unknown" || rt === "unknown") failAt(ctx, expr, "E_TYPE_UNKNOWN", "Cannot tell the types in this % (remainder).");
      if (![lt, rt].every((t) => t === "int" || t === "numeric")) failAt(ctx, expr, "E_UNSUPPORTED", "% is only supported on whole or decimal numbers.");
      return fn("MOD", R(l), R(r));
    }
    case "+":
    case "-":
    case "*":
      return bin(op, R(l), R(r));
    default:
      if (COMPARISONS.has(op)) {
        if (r?.type === "function" && functionName(r) === "ANY") {
          const sub = r.args?.value?.[0];
          return { k: "any", op: op === "!=" ? "<>" : op, e: R(l), q: queryIr(sub.ast, scope, ctx, false) };
        }
        compareNote([l, r], scope, ctx);
        if (op !== "=") emptyNote([l, r], scope, ctx);
        if (op !== "=" && op !== "<>" && op !== "!=") sortNote([l, r].some((s) => inferType(s, scope) === "text") ? "text" : "int", ctx);
        return bin(op === "!=" ? "<>" : op, R(l), R(r));
      }
      return failAt(ctx, expr, "E_UNSUPPORTED", `The operator ${expr.operator} is not supported by the DWH converter.`);
  }
}

export function rewriteExpr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr {
  const dated = rewriteDateExpr(expr, scope, ctx);
  if (dated) return dated;
  const R = (e: PgExpr) => rewriteExpr(e, scope, ctx);
  if (isSubquery(expr)) return { k: "sub", q: queryIr(expr.ast, scope, ctx, false) };
  switch (expr?.type) {
    case "column_ref":
      return columnIr(expr, scope, ctx);
    case "number":
    case "bigint":
      return num(String(expr.value));
    case "single_quote_string": {
      // node-sql-parser keeps the source escaping ('' for '); the IR holds the plain text.
      const v = String(expr.value).replace(/''/g, "'");
      if (v === "") failAt(ctx, expr, "E_EMPTY_STRING", "Empty text ('') is not supported: the DWH (Oracle) treats '' as NULL, so the query would return different rows.");
      return /[^\x00-\x7F]/.test(v) ? nstr(v) : str(v);
    }
    case "null":
      return NULL;
    case "binary_expr":
      return binaryIr(expr, scope, ctx);
    case "unary_expr": {
      const op = String(expr.operator).toUpperCase();
      if (op === "NOT EXISTS") return { k: "exists", not: true, q: queryIr(expr.expr.ast, scope, ctx, false) };
      if (op === "NOT" || op === "-" || op === "+") return { k: "un", op, e: R(expr.expr) };
      return failAt(ctx, expr, "E_UNSUPPORTED", `The operator ${expr.operator} is not supported.`);
    }
    case "function": {
      const name = functionName(expr);
      const args: PgExpr[] = expr.args?.value ?? [];
      if (name === "EXISTS") return { k: "exists", not: false, q: queryIr(args[0].ast, scope, ctx, false) };
      if (name === "COALESCE" || name === "NULLIF") emptyNote(args, scope, ctx);
      if (["COALESCE", "NULLIF", "LOWER", "UPPER", "ABS"].includes(name)) return fn(name, ...args.map(R));
      return failAt(ctx, expr, "E_UNSUPPORTED_FUNCTION", `The function ${name} is not supported by the DWH converter.`);
    }
    case "aggr_func":
      return aggregateIr(expr, scope, ctx);
    case "window_func": {
      const out: IrExpr = { k: "fn", name: String(expr.name).toUpperCase(), args: (expr.args?.value ?? []).map(R) };
      out.over = windowIr(expr.over, scope, ctx);
      return out;
    }
    case "cast":
      return castIr(expr, scope, ctx);
    default:
      return failAt(ctx, expr, "E_UNSUPPORTED", `The query uses something the DWH converter does not translate (${String(expr?.type)}).`);
  }
}

// ---------- queries ----------

const JOIN_NAMES: Record<string, string> = {
  JOIN: "JOIN", "INNER JOIN": "JOIN", "LEFT JOIN": "LEFT JOIN", "LEFT OUTER JOIN": "LEFT JOIN", "RIGHT JOIN": "RIGHT JOIN",
  "RIGHT OUTER JOIN": "RIGHT JOIN", "FULL JOIN": "FULL JOIN", "FULL OUTER JOIN": "FULL JOIN", "CROSS JOIN": "CROSS JOIN",
};
const SET_OP_NAMES: Record<string, string> = { union: "UNION", "union all": "UNION ALL", intersect: "INTERSECT", except: "MINUS" };

interface BranchOut {
  sel: IrSelect;
  outputs: { name: string; type: SqlType }[];
}

function selectIr(b: PgNode, scope: ScopeInfo, ctx: RewriteCtx, top: boolean): BranchOut {
  const outputs: { name: string; type: SqlType }[] = [];
  const columns: IrColumn[] = (b.columns ?? []).map((c: PgNode): IrColumn => {
    const e = c.expr;
    if (e?.type === "column_ref" && e.column === "*") {
      outputs.push({ name: "*", type: "unknown" });
      if (!e.table) return { e: { k: "star" } };
      const t = String(e.table?.value ?? e.table).toLowerCase();
      return { e: { k: "star", table: scope.isCte(t) ? oracleIdent(t.toUpperCase()) : oracleBareTableName(t, ctx) } };
    }
    if (isPredicate(e)) failAt(ctx, e, "E_BOOLEAN", "A true/false value cannot be a result column (Oracle 12 has no boolean values in SQL).");
    let ir: IrExpr;
    let as: string | undefined = typeof c.as === "string" && c.as ? c.as : undefined;
    if (as && as.length > MAX_ALIAS) failAt(ctx, e, "E_ALIAS_TOO_LONG", `The column name ${as} is longer than Oracle's ${MAX_ALIAS}-character limit.`);
    const r = e?.type === "column_ref" && e.table ? scope.resolve(e) : undefined;
    let name = as ?? "";
    if (r?.kind === "table") {
      const nm = oracleColumnName(`${r.table}.${r.column}`, { ...ctx, csv: scope.csv, usage: "output" });
      ir = col(oracleBareTableName(r.table, ctx), nm.name);
      if (!as && nm.aliasAs) as = nm.aliasAs;
      name ||= nm.aliasAs ?? unquote(nm.name);
    } else {
      ir = rewriteExpr(e, scope, ctx);
      if (!name && ir.k === "col") name = unquote(ir.name);
    }
    if (!name && top) addWarning(ctx.warnings, { code: "W_UNNAMED_COLUMN", plain: "A result column has no name; the DWH names it after its formula." });
    outputs.push({ name, type: inferType(e, scope) });
    return as ? { e: ir, as: quoteAlias(as) } : { e: ir };
  });
  const from: IrFrom[] = (b.from ?? []).map((f: PgNode, i: number): IrFrom => {
    const name = String(f.table).toLowerCase();
    const table = scope.fromKind(f) === "cte" ? oracleIdent(name.toUpperCase()) : oracleTableName(name, ctx);
    if (i === 0) return { table };
    const join = f.join ? JOIN_NAMES[String(f.join).toUpperCase()] ?? failAt(ctx, f.on, "E_UNSUPPORTED", `${f.join} is not supported.`) : ",";
    return f.on ? { join, table, on: rewriteExpr(f.on, scope, ctx) } : { join, table };
  });
  const sel: IrSelect = { distinct: b.distinct?.type === "DISTINCT", columns, from, groupBy: [] };
  if (b.where) sel.where = rewriteExpr(b.where, scope, ctx);
  sel.groupBy = (b.groupby?.columns ?? []).map((g: PgExpr) => {
    if (g?.type === "number") {
      const target = b.columns?.[Number(g.value) - 1];
      if (!target) failAt(ctx, g, "E_UNSUPPORTED", `GROUP BY ${g.value} does not match a result column.`);
      return rewriteExpr(target.expr, scope, ctx);
    }
    return rewriteExpr(g, scope, ctx);
  });
  if (b.having) sel.having = rewriteExpr(b.having, scope, ctx);
  return { sel, outputs };
}

function queryIr(node: PgNode, scope: ScopeInfo, ctx: RewriteCtx, top: boolean): IrQuery {
  const withs = (node.with ?? []).map((cte: PgNode) => ({
    name: oracleIdent(String(cte.name?.value ?? cte.name).toUpperCase()),
    q: queryIr(cte.stmt?.ast ?? cte.stmt, scope, ctx, false),
  }));
  const chain: PgNode[] = [];
  for (let b: PgNode = node; b; b = b._next) chain.push(b);
  const ops = chain.slice(0, -1).map((b) => SET_OP_NAMES[String(b.set_op).toLowerCase()]!);
  if (ops.includes("INTERSECT") && ops.some((o) => o !== "INTERSECT")) {
    // PostgreSQL binds INTERSECT tighter than UNION/EXCEPT; Oracle reads all set operators left to right.
    failAt(ctx, node, "E_UNSUPPORTED", "INTERSECT mixed with UNION or EXCEPT is not supported (AMOS and the DWH would group them differently). Split the query or use WITH.");
  }
  const hasStar = (node.columns ?? []).some((c: PgNode) => c.expr?.type === "column_ref" && c.expr.column === "*");
  const noPositionsWithStar = (e: PgExpr) => {
    if (hasStar && e?.type === "number") failAt(ctx, e, "E_UNSUPPORTED", "ORDER BY / GROUP BY by position is not supported when the select list has *; name the column instead.");
  };
  for (const o of chain[chain.length - 1]!.orderby ?? []) noPositionsWithStar(o.expr);
  for (const g of node.groupby?.columns ?? []) noPositionsWithStar(g);
  const outs = chain.map((b, i) => selectIr(b, scope, ctx, top && i === 0));
  const first = outs[0]!;
  const last = chain[chain.length - 1]!;
  const compound = chain.length > 1;
  const firstCols: PgNode[] = node.columns ?? [];

  const orderBy: IrOrder[] = [];
  const orderKeys: string[] = [];
  const warningsBeforeOrder = ctx.warnings.length;
  for (const o of last.orderby ?? []) {
    const e = o.expr;
    if (compound) {
      let n: number;
      if (e?.type === "number") n = Number(e.value);
      else {
        const res = scope.resolve(e);
        const want = res.kind === "ordinal_name" ? res.name : "";
        n = first.outputs.findIndex((x) => x.name.toLowerCase() === want) + 1;
      }
      if (n < 1 || n > first.outputs.length) failAt(ctx, e, "E_UNSUPPORTED", "ORDER BY does not match a result column.");
      sortNote(inferType(firstCols[n - 1]?.expr, scope), ctx);
      orderBy.push(orderShape(o, { k: "ordinal", n }));
      orderKeys.push(first.outputs[n - 1]!.name);
      continue;
    }
    let target: PgExpr = e;
    let idx = -1;
    if (e?.type === "number") {
      idx = Number(e.value) - 1;
      target = firstCols[idx]?.expr;
      if (!target) failAt(ctx, e, "E_UNSUPPORTED", `ORDER BY ${e.value} does not match a result column.`);
    }
    const item = orderItem(o, target, scope, ctx);
    orderBy.push(item);
    if (idx < 0) idx = first.sel.columns.findIndex((c) => isDeepStrictEqual(c.e, item.e));
    const key = idx >= 0 ? first.outputs[idx]?.name : undefined;
    if (key) orderKeys.push(key);
  }

  let fetch: string | undefined;
  let offset: string | undefined;
  const lim = last.limit;
  const vals: PgNode[] = lim?.value ?? [];
  if (vals.length) {
    if (lim.seperator === "offset") {
      if (vals.length === 2) [fetch, offset] = [String(vals[0].value), String(vals[1].value)];
      else offset = String(vals[0].value);
    } else if (vals[0].type === "number") fetch = String(vals[0].value);
  }
  if ((fetch || offset) && ctx.mapping.oracleVersion < 12) {
    failAt(ctx, last, "E_UNSUPPORTED", `LIMIT/OFFSET needs Oracle 12c or later (the DWH is set to Oracle ${ctx.mapping.oracleVersion}).`);
  }
  if (fetch && orderBy.length === 0) {
    addWarning(ctx.warnings, { code: "W_LIMIT_NO_ORDER", plain: "LIMIT without ORDER BY returns an arbitrary set of rows; AMOS and the DWH may return different ones." });
  }
  if (!top && orderBy.length && !fetch && !offset) {
    orderBy.length = 0;
    orderKeys.length = 0;
    ctx.warnings.length = warningsBeforeOrder; // notes about a removed ORDER BY no longer apply
    addWarning(ctx.warnings, { code: "W_SUBQUERY_ORDER_DROPPED", plain: "ORDER BY inside a subquery or WITH query was removed (it has no effect without LIMIT)." });
  }

  if (top && ctx.mapping.execMode === "openquery") {
    const seen = new Set<string>();
    for (const o of first.outputs) {
      const k = o.name.toLowerCase();
      if (!k || k === "*") continue;
      if (seen.has(k)) {
        failAt(ctx, node, "E_DUPLICATE_OUTPUT", `Two result columns are both called ${o.name}. The DWH link (OPENQUERY) refuses that; add approved z_ aliases, or ask for RPC Out to be enabled.`);
      }
      seen.add(k);
    }
  }

  const q: IrQuery = { with: withs, branches: outs.map((o) => o.sel), ops, orderBy, outputs: first.outputs, orderKeys };
  if (offset) q.offset = offset;
  if (fetch) q.fetch = fetch;
  return q;
}

export function rewriteQuery(ast: SelectAst, scope: ScopeInfo, ctx: RewriteCtx): IrQuery {
  return queryIr(ast.root, scope, ctx, true);
}
