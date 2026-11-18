// A.4 steps 3-4: parse the PostgreSQL source and check every node against the allow-list
// (plan A.5). Anything not listed is refused by name; the node walk's `default` throws, so a
// node type the converter has never seen (e.g. after a parser change) can never pass silently.
import sqlParser from "node-sql-parser";
import { lex, significant, type Token } from "../lex.ts";
import { ConvertError, addWarning, locAt, type ConvertWarning, type ErrorCode, type SourceLoc } from "./errors.ts";

const { Parser } = sqlParser;

// node-sql-parser's AST is untyped JSON; the guard is what makes its shape safe to use.
export type PgNode = any;
export type PgExpr = any;

export interface SelectAst {
  /** Root `select` node (set operations chain through `_next`). */
  root: PgNode;
  /** The pre-processed source the tree was parsed from (for error locations). */
  sql: string;
  tokens: Token[];
}

export const SOURCE_FUNCTIONS = new Set(["COALESCE", "NULLIF", "LOWER", "UPPER", "ABS", "NOW", "CURRENT_DATE", "CURRENT_TIMESTAMP"]);
export const AGGREGATES = new Set(["COUNT", "SUM", "MIN", "MAX"]);
export const WINDOW_FUNCTIONS = new Set(["ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD"]);
export const CAST_TARGETS = new Set(["INTEGER", "INT", "INT4", "BIGINT", "INT8", "SMALLINT", "INT2", "NUMERIC", "DECIMAL", "TEXT", "VARCHAR", "TIMESTAMP", "DATE"]);
const EXTRACT_FIELDS = new Set(["YEAR", "MONTH", "DAY", "HOUR", "MINUTE"]);
const BINARY_OPS = new Set([
  "AND", "OR", "=", "<>", "!=", "<", ">", "<=", ">=", "+", "-", "*", "/", "%",
  "IN", "NOT IN", "LIKE", "NOT LIKE", "ILIKE", "NOT ILIKE", "BETWEEN", "NOT BETWEEN", "IS", "IS NOT",
]);
const JOINS = new Set(["JOIN", "INNER JOIN", "LEFT JOIN", "LEFT OUTER JOIN", "RIGHT JOIN", "RIGHT OUTER JOIN", "FULL JOIN", "FULL OUTER JOIN", "CROSS JOIN"]);
const SET_OPS = new Set(["union", "union all", "intersect", "except"]);
const SELECT_KEYS = new Set([
  "with", "type", "options", "distinct", "columns", "into", "from", "where", "groupby", "having", "orderby", "limit",
  "window", "_next", "set_op", "loc", "parentheses_symbol", "collate",
]);

/** Constructs the parser would mis-read or reject with an unhelpful message: refused by name first. */
function prescan(sql: string, tokens: Token[]): void {
  const sig = significant(tokens);
  const fail = (code: ErrorCode, plain: string, t: Token): never => {
    throw new ConvertError(code, plain, "", locAt(sql, t.offset));
  };
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]!;
    const prev = sig[i - 1];
    const next = sig[i + 1];
    if (t.kind === "quoted_ident") fail("E_UNSUPPORTED", `Quoted names (${t.text}) are not supported: AMOS names are lower case, so write them without double quotes.`, t);
    if (t.kind === "symbol") {
      if (t.text === "||") fail("E_CONCAT", "Joining text with || is not allowed (house rule: no column combining). Select the columns separately.", t);
      if (["^", "~", "!~", "~*", "&", "|", "#", "<<", ">>", "->", "->>", "@>", "<@", "#>", "&&", "?", "@", "[", "]"].includes(t.text)) {
        fail("E_UNSUPPORTED", `The operator ${t.text} is not supported by the DWH converter.`, t);
      }
      continue;
    }
    if (t.kind !== "word") continue;
    const qualified = (prev?.kind === "symbol" && prev.text === ".") || (next?.kind === "symbol" && next.text === ".");
    if (qualified) continue;
    const w = t.text.toUpperCase();
    const nw = next?.kind === "word" ? next.text.toUpperCase() : "";
    switch (w) {
      case "ISNULL":
      case "NOTNULL":
        fail("E_UNSUPPORTED", `The ${w} shorthand is not supported. Write IS NULL or IS NOT NULL.`, t);
      case "SYMMETRIC":
        fail("E_UNSUPPORTED", "BETWEEN SYMMETRIC is not supported. Write a plain BETWEEN with the smaller value first.", t);
      case "IS":
        if (nw === "DISTINCT" || (nw === "NOT" && sig[i + 2]?.text.toUpperCase() === "DISTINCT")) {
          fail("E_UNSUPPORTED", "IS [NOT] DISTINCT FROM is not supported. Write the comparison and the NULL checks explicitly.", t);
        }
        break;
      case "MATERIALIZED":
        fail("E_UNSUPPORTED", "WITH … AS MATERIALIZED is not supported. Remove MATERIALIZED.", t);
      case "NATURAL":
        fail("E_UNSUPPORTED", "NATURAL JOIN is not supported. Write the join condition with ON.", t);
      case "LATERAL":
        fail("E_UNSUPPORTED", "LATERAL subqueries are not supported.", t);
      case "AT":
        if (nw === "TIME") fail("E_UNSUPPORTED", "AT TIME ZONE is not supported. Use the repo idiom CURRENT_TIMESTAMP + INTERVAL '7' HOUR instead.", t);
        break;
      case "FOR":
        fail("E_UNSUPPORTED", "FOR UPDATE / FOR SHARE locks rows and is never allowed.", t);
      case "INTO":
        fail("E_UNSUPPORTED", "SELECT … INTO creates a table and is never allowed.", t);
      case "SIMILAR":
        fail("E_UNSUPPORTED", "SIMILAR TO (regular expressions) is not supported.", t);
      case "ESCAPE":
        fail("E_UNSUPPORTED", "LIKE … ESCAPE is not supported.", t);
      case "ARRAY":
        fail("E_UNSUPPORTED", "Arrays are not supported.", t);
      default:
        break;
    }
  }
}

export function parsePg(sql: string): SelectAst {
  const tokens = lex(sql, "pg");
  prescan(sql, tokens);
  let parsed: PgNode;
  try {
    parsed = new Parser().astify(sql, { database: "PostgresQL", parseOptions: { includeLocations: true } } as any);
  } catch (e: any) {
    const start = e?.location?.start;
    const loc: SourceLoc | undefined = start ? { line: start.line, column: start.column } : undefined;
    const msg = String(e?.message ?? e).split("\n")[0]!.slice(0, 300);
    throw new ConvertError("E_PARSE", "The query could not be read as PostgreSQL. Check it runs in AMOS first.", msg, loc);
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length > 1) throw new ConvertError("E_MULTI_STATEMENT", "The file holds more than one statement. Keep one query per file.");
  const root = list[0];
  if (!root || root.type !== "select") {
    throw new ConvertError("E_NOT_SELECT", "Only SELECT queries can be converted. Anything that changes data is never allowed.", String(root?.type ?? ""));
  }
  return { root, sql, tokens };
}

/** Name of a `function` node, upper case; throws for schema-qualified names. */
export function functionName(node: PgNode): string {
  const parts = node?.name?.name;
  if (Array.isArray(parts) && parts.length === 1 && !node.name.schema) return String(parts[0].value).toUpperCase();
  throw new ConvertError("E_UNSUPPORTED_FUNCTION", "Schema-qualified function calls are not supported.", JSON.stringify(node?.name ?? null));
}

export function isSubquery(node: PgNode): boolean {
  return !!node && typeof node === "object" && !node.type && !!node.ast;
}

/**
 * Finds source locations for errors. node-sql-parser only records locations on some nodes,
 * so walkers `track` the nearest located node and search the tokens for a word from there.
 */
export class Locator {
  private lastOffset = 0;
  private sa: SelectAst;
  constructor(sa: SelectAst) {
    this.sa = sa;
  }

  track(node: PgNode): void {
    const off = node?.loc?.start?.offset;
    if (typeof off === "number") this.lastOffset = off;
  }

  fail(code: ErrorCode, plain: string, word?: string | string[], detail = ""): never {
    throw new ConvertError(code, plain, detail, this.locOf(word));
  }

  /** Location of `word` (first token at or after the nearest known position), else that position. */
  locOf(word?: string | string[]): SourceLoc | undefined {
    if (Array.isArray(word)) {
      // A run of consecutive words, e.g. ["wp_header", "h"] for a table alias.
      const sig = significant(this.sa.tokens);
      const up = word.map((w) => w.toUpperCase());
      for (let i = 0; i + up.length <= sig.length; i++) {
        if (up.every((w, j) => sig[i + j]!.kind === "word" && sig[i + j]!.text.toUpperCase() === w)) return locAt(this.sa.sql, sig[i]!.offset);
      }
      return this.locOf(word[0]);
    }
    if (word) {
      const w = word.toUpperCase();
      const t = this.sa.tokens.find((x) => x.offset >= this.lastOffset && x.kind === "word" && x.text.toUpperCase() === w);
      if (t) return locAt(this.sa.sql, t.offset);
      const any = this.sa.tokens.find((x) => x.kind === "word" && x.text.toUpperCase() === w);
      if (any) return locAt(this.sa.sql, any.offset);
    }
    return this.lastOffset > 0 ? locAt(this.sa.sql, this.lastOffset) : undefined;
  }
}

class Walker {
  warnings: ConvertWarning[] = [];
  private loc: Locator;
  constructor(sa: SelectAst) {
    this.loc = new Locator(sa);
  }

  fail(code: ErrorCode, plain: string, word?: string | string[], detail = ""): never {
    this.loc.fail(code, plain, word, detail);
  }

  private track(node: PgNode) {
    this.loc.track(node);
  }

  select(node: PgNode): void {
    this.track(node);
    if (node.type !== "select") this.fail("E_NOT_SELECT", "Only SELECT queries can be converted.", undefined, String(node.type));
    for (const [k, v] of Object.entries(node)) {
      if (!SELECT_KEYS.has(k) && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
        this.fail("E_UNSUPPORTED", `The query uses a clause the converter does not know (${k}).`);
      }
    }
    if (node.options) this.fail("E_UNSUPPORTED", "SELECT options are not supported.", "SELECT");
    if (node.into?.position) this.fail("E_UNSUPPORTED", "SELECT … INTO creates a table and is never allowed.", "INTO");
    if (node.window) this.fail("E_UNSUPPORTED", "Named WINDOW clauses are not supported. Write the window inside OVER (…).", "WINDOW");
    const distinct = node.distinct?.type;
    if (distinct && distinct !== "DISTINCT") {
      this.fail("E_UNSUPPORTED", `${distinct} is not supported (it would need a derived table alias, which the house rules forbid).`, "DISTINCT");
    }
    for (const cte of node.with ?? []) {
      if (cte.recursive) this.fail("E_UNSUPPORTED", "WITH RECURSIVE is not supported.", "RECURSIVE");
      if (cte.columns && cte.columns.length) this.fail("E_UNSUPPORTED", "Column lists on WITH queries are not supported. Name the columns inside the query.", "WITH");
      const stmt = cte.stmt?.ast ?? cte.stmt;
      if (!stmt || stmt.type !== "select") this.fail("E_UNSUPPORTED", "Only SELECT is allowed inside WITH (data-modifying WITH is never allowed).", "WITH");
      this.select(stmt);
    }
    if (node.columns === "*" || !Array.isArray(node.columns)) this.fail("E_UNSUPPORTED", "Unexpected select list shape.", "SELECT");
    for (const col of node.columns) {
      const e = col.expr;
      if (e?.type === "column_ref" && e.column === "*") {
        addWarning(this.warnings, { code: "W_SELECT_STAR", plain: "SELECT * returns whatever columns the DWH copy has, which may differ from AMOS." });
        if (e.schema) this.fail("E_UNSUPPORTED", "Schema-qualified names (like public.x) are not supported. Use the plain table name.");
        continue;
      }
      this.expr(e);
    }
    this.from(node.from ?? []);
    if (node.where) this.expr(node.where);
    for (const g of node.groupby?.columns ?? []) this.expr(g);
    if (node.groupby && Object.keys(node.groupby).some((k) => k !== "columns" && node.groupby[k])) {
      this.fail("E_UNSUPPORTED", "GROUP BY modifiers (ROLLUP, CUBE, …) are not supported.", "GROUP");
    }
    if (node.having) this.expr(node.having);
    for (const o of node.orderby ?? []) this.orderItem(o);
    this.limit(node.limit);
    if (node._next) {
      const op = String(node.set_op ?? "").toLowerCase();
      if (!SET_OPS.has(op)) this.fail("E_UNSUPPORTED", `${op.toUpperCase() || "This set operation"} is not supported.`, op.split(" ")[0]);
      this.select(node._next);
    }
  }

  orderItem(o: PgNode): void {
    if (o.type && !["ASC", "DESC"].includes(String(o.type).toUpperCase())) this.fail("E_UNSUPPORTED", `ORDER BY … ${o.type} is not supported.`, "ORDER");
    if (o.nulls && !["NULLS FIRST", "NULLS LAST"].includes(String(o.nulls).toUpperCase())) this.fail("E_UNSUPPORTED", "Unexpected NULLS option.", "NULLS");
    this.expr(o.expr);
  }

  limit(l: PgNode): void {
    if (!l) return;
    const sep = l.seperator ?? "";
    if (sep !== "" && sep !== "offset") this.fail("E_UNSUPPORTED", "Only LIMIT n [OFFSET m] is supported.", "LIMIT");
    for (const v of l.value ?? []) {
      const ok = v.type === "number" || (v.type === "origin" && String(v.value).toLowerCase() === "all");
      if (!ok) this.fail("E_UNSUPPORTED", "LIMIT and OFFSET must be plain numbers.", "LIMIT");
    }
  }

  from(items: PgNode[]): void {
    items.forEach((f, i) => {
      if (f.on) this.track(f.on);
      if (f.expr || f.prefix) {
        this.fail("E_UNSUPPORTED", "Subqueries in FROM (derived tables) and LATERAL are not supported: they need a table alias, which the house rules forbid. Use WITH or EXISTS.", f.prefix ?? "FROM");
      }
      if (f.db) this.fail("E_UNSUPPORTED", `Schema-qualified table names (${f.db}.${f.table}) are not supported. Use the plain table name.`, f.db);
      if (typeof f.table !== "string") this.fail("E_UNSUPPORTED", "Unexpected FROM item.", "FROM");
      if (f.as) this.fail("E_UNSUPPORTED", `Table aliases (${f.table} ${f.as}) are not allowed by the house rules. Use the full table name.`, [f.table, f.as]);
      if (f.using) this.fail("E_UNSUPPORTED", "JOIN … USING is not supported. Write the join condition with ON.", "USING");
      if (f.join) {
        if (!JOINS.has(String(f.join).toUpperCase())) this.fail("E_UNSUPPORTED", `${f.join} is not supported.`, "JOIN");
        if (String(f.join).toUpperCase() !== "CROSS JOIN" && !f.on) this.fail("E_UNSUPPORTED", "A JOIN without ON is not supported.", "JOIN");
      } else if (i > 0 && f.on) this.fail("E_UNSUPPORTED", "Unexpected FROM item.", "FROM");
      for (const k of Object.keys(f)) {
        if (!["db", "table", "as", "join", "on", "using", "expr", "prefix", "loc", "schema", "operator", "addition"].includes(k) && f[k]) {
          this.fail("E_UNSUPPORTED", `The FROM item uses something the converter does not know (${k}).`, f.table);
        }
      }
      if (f.on) this.expr(f.on);
    });
  }

  over(over: PgNode, name: string): void {
    const spec = over?.as_window_specification;
    if (!spec || typeof spec !== "object" || !spec.window_specification) {
      this.fail("E_UNSUPPORTED", "Named windows (OVER w) are not supported. Write the window inside OVER (…).", name);
    }
    const ws = spec.window_specification;
    if (ws.window_frame_clause) this.fail("E_UNSUPPORTED", "Window frames (ROWS/RANGE …) are not supported.", name);
    if (ws.name) this.fail("E_UNSUPPORTED", "Named windows are not supported.", name);
    for (const p of ws.partitionby ?? []) this.expr(p.expr ?? p);
    for (const o of ws.orderby ?? []) this.orderItem(o);
  }

  expr(node: PgExpr): void {
    if (node === null || node === undefined) return;
    this.track(node);
    if (isSubquery(node)) {
      this.select(node.ast);
      return;
    }
    switch (node.type) {
      case "column_ref": {
        if (node.options) this.fail("E_UNSUPPORTED", "AT TIME ZONE is not supported. Use the repo idiom CURRENT_TIMESTAMP + INTERVAL '7' HOUR instead.", "AT");
        if (node.schema) this.fail("E_UNSUPPORTED", "Schema-qualified names (like public.x) are not supported. Use the plain table name.", node.schema);
        if (node.column === "*") this.fail("E_UNSUPPORTED", "* is only allowed directly in the select list or in COUNT(*).");
        const col = node.column?.expr;
        if (!col || col.type !== "default" || typeof col.value !== "string") this.fail("E_UNSUPPORTED", "Unexpected column reference.");
        if (!node.table && col.value.toUpperCase() === "LOCALTIME") {
          this.fail("E_UNSUPPORTED", "LOCALTIME is not supported. Use CURRENT_TIMESTAMP (UTC) plus the repo idiom + INTERVAL '7' HOUR.", "LOCALTIME");
        }
        if (node.collate) this.fail("E_UNSUPPORTED", "COLLATE is not supported.", "COLLATE");
        return;
      }
      case "number":
      case "bigint":
      case "single_quote_string":
      case "date":
      case "timestamp":
      case "null":
      case "interval":
        return;
      case "bool":
        this.fail("E_BOOLEAN", "TRUE/FALSE values are not supported (Oracle 12 has no boolean values in SQL). Compare a column with a value instead.", String(node.value));
      case "binary_expr": {
        const op = String(node.operator).toUpperCase();
        if (op === "||") this.fail("E_CONCAT", "Joining text with || is not allowed (house rule: no column combining).");
        if (!BINARY_OPS.has(op)) this.fail("E_UNSUPPORTED", `The operator ${node.operator} is not supported by the DWH converter.`, op.split(" ")[0]);
        this.expr(node.left);
        this.expr(node.right);
        return;
      }
      case "unary_expr": {
        const op = String(node.operator).toUpperCase();
        if (!["NOT", "-", "+", "NOT EXISTS"].includes(op)) this.fail("E_UNSUPPORTED", `The operator ${node.operator} is not supported.`);
        this.expr(node.expr);
        return;
      }
      case "expr_list":
        for (const v of node.value ?? []) this.expr(v);
        return;
      case "function": {
        const name = functionName(node);
        if (node.over && !SOURCE_FUNCTIONS.has(name)) this.fail("E_UNSUPPORTED_FUNCTION", `The window function ${name} is not supported.`, name);
        if (node.over) this.fail("E_UNSUPPORTED", `${name}(…) OVER is not supported.`, name);
        if (name === "EXISTS" || name === "ANY") {
          const args = node.args?.value ?? [];
          if (args.length !== 1 || !isSubquery(args[0])) this.fail("E_UNSUPPORTED", `${name} needs a subquery; arrays are not supported.`, name);
          this.select(args[0].ast);
          return;
        }
        if (name === "GREATEST" || name === "LEAST") {
          this.fail("E_UNSUPPORTED", `${name} is not supported: Oracle returns NULL if any value is NULL, AMOS ignores NULLs.`, name);
        }
        if (name === "CURRENT_TIME" || name === "TIMEZONE") {
          this.fail("E_UNSUPPORTED", `${name} is not supported. Use CURRENT_TIMESTAMP (UTC) plus the repo idiom + INTERVAL '7' HOUR.`, name);
        }
        if (["DATE_TRUNC", "TO_CHAR", "FORMAT", "TO_DATE", "TO_TIMESTAMP"].includes(name)) {
          this.fail("E_UNSUPPORTED", `${name} is not supported: formatting belongs in the code that reads the data.`, name);
        }
        if (["STRING_AGG", "ARRAY_AGG"].includes(name)) this.fail("E_UNSUPPORTED", `${name} is not supported (aggregated text and arrays).`, name);
        if (!SOURCE_FUNCTIONS.has(name)) this.fail("E_UNSUPPORTED_FUNCTION", `The function ${name} is not supported by the DWH converter.`, name);
        for (const a of node.args?.value ?? []) this.expr(a);
        return;
      }
      case "aggr_func": {
        const name = String(node.name).toUpperCase();
        if (name === "AVG") this.fail("E_UNSUPPORTED", "AVG is not supported (its precision differs between AMOS and the DWH). Compute averages in code.", name);
        if (!AGGREGATES.has(name)) this.fail("E_UNSUPPORTED", `The aggregate ${name} is not supported.`, name);
        const args = node.args ?? {};
        if (args.orderby) this.fail("E_UNSUPPORTED", "ORDER BY inside an aggregate is not supported.", name);
        if (args.distinct && String(args.distinct).toUpperCase() !== "DISTINCT") this.fail("E_UNSUPPORTED", "Unexpected aggregate option.", name);
        const a = args.expr;
        if (a?.type === "star") {
          if (name !== "COUNT") this.fail("E_UNSUPPORTED", `${name}(*) is not valid.`, name);
        } else this.expr(a);
        if (node.filter) this.expr(node.filter.where);
        if (node.over) this.over(node.over, name);
        return;
      }
      case "window_func": {
        const name = String(node.name).toUpperCase();
        if (!WINDOW_FUNCTIONS.has(name)) this.fail("E_UNSUPPORTED", `The window function ${name} is not supported.`, name);
        if (node.consider_nulls) this.fail("E_UNSUPPORTED", "IGNORE/RESPECT NULLS is not supported.", name);
        for (const a of node.args?.value ?? []) this.expr(a);
        if (!node.over) this.fail("E_UNSUPPORTED", `${name} needs OVER (…).`, name);
        this.over(node.over, name);
        return;
      }
      case "extract": {
        const field = String(node.args?.field ?? "").toUpperCase();
        if (!EXTRACT_FIELDS.has(field)) this.fail("E_UNSUPPORTED", `EXTRACT(${field} …) is not supported (only YEAR, MONTH, DAY, HOUR, MINUTE).`, "EXTRACT");
        // node-sql-parser reads EXTRACT(YEAR FROM DATE 'x' + n) as a cast of 'x' only; refuse unless it is a plain typed literal.
        const ct = node.args?.cast_type;
        if (ct && (!["DATE", "TIMESTAMP"].includes(String(ct).toUpperCase()) || node.args.source?.type !== "single_quote_string")) {
          this.fail("E_UNSUPPORTED", "Put parentheses around the value in EXTRACT, e.g. EXTRACT(YEAR FROM (DATE '1971-12-31' + table.column)).", "EXTRACT");
        }
        this.expr(node.args.source);
        return;
      }
      case "cast": {
        const targets = node.target ?? [];
        if (targets.length !== 1) this.fail("E_UNSUPPORTED", "Chained casts (x::a::b) are not supported.", "CAST");
        const dt = String(targets[0].dataType ?? "").toUpperCase();
        if (!CAST_TARGETS.has(dt)) this.fail("E_UNSUPPORTED", `Casting to ${dt.toLowerCase()} is not supported.`, dt);
        this.expr(node.expr);
        return;
      }
      case "case":
        this.fail("E_UNSUPPORTED", "CASE expressions are not supported by the DWH converter yet.", "CASE");
      default:
        this.fail("E_UNSUPPORTED", `The query uses something the DWH converter does not translate (${String(node.type)}).`, undefined, JSON.stringify(node).slice(0, 200));
    }
  }
}

export function assertSupported(ast: SelectAst): ConvertWarning[] {
  const w = new Walker(ast);
  w.select(ast.root);
  return w.warnings;
}
