// A.4 steps 5 and 8: scope resolution (CTE vs AMOS table, every column qualified and known),
// Oracle names, and DWH availability (plan A.5 #1-#8, #78, #79; A.6).
import type { CsvColumn, CsvIndex } from "../../schema/csv.ts";
import type { DwhMapping } from "../mapping.ts";
import { catalogueIndex, type Catalogue } from "../catalogue.ts";
import { ConvertError, addWarning, type ConvertWarning } from "./errors.ts";
import { Locator, functionName, isSubquery, type PgExpr, type PgNode, type SelectAst } from "./guard.ts";
import { oracleIdent } from "./oracleWords.ts";

export type SqlType = "int" | "numeric" | "float" | "text" | "date" | "timestamp" | "interval" | "unknown";

export interface CteOutput {
  /** Output name as written (alias or column name). */
  name: string;
  expr: PgExpr;
  /** True when the name comes from an AS alias (printed quoted). */
  aliased: boolean;
}

export interface CteInfo {
  name: string;
  /** Keyed by lower-case output name. */
  outputs: Map<string, CteOutput>;
}

export type Resolved =
  | { kind: "table"; table: string; column: string; csv: CsvColumn }
  | { kind: "cte"; cte: string; column: string; out: CteOutput }
  | { kind: "alias"; name: string; target: PgExpr }
  | { kind: "ordinal_name"; name: string } // ORDER BY <output name> after UNION/INTERSECT/EXCEPT
  | { kind: "localtimestamp" };

export interface ScopeInfo {
  root: PgNode;
  csv: CsvIndex;
  tableOf(columnRef: PgExpr): string;
  isCte(name: string): boolean;
  pgTypeOf(columnRef: PgExpr): SqlType;
  resolve(columnRef: PgExpr): Resolved;
  /** "cte" or "table" for a FROM item. */
  fromKind(fromItem: PgNode): "cte" | "table";
  cte(name: string): CteInfo | undefined;
  usedTables(): string[];
  usedColumns(): string[];
}

/** Type of an AMOS column from the CSV's PostgreSQL type. */
export function sqlTypeOfPg(pgType: string): SqlType {
  const t = pgType.toLowerCase().replace(/\(.*$/, "");
  if (["int4", "int8", "int2", "integer", "int", "bigint", "smallint"].includes(t)) return "int";
  if (["float8", "float4", "double precision", "real"].includes(t)) return "float";
  if (t === "numeric" || t === "decimal") return "numeric";
  if (["varchar", "text", "bpchar", "char", "character varying"].includes(t)) return "text";
  return "unknown";
}

interface Scope {
  parent?: Scope;
  ctes: Map<string, CteInfo>;
  from: Map<string, "cte" | "table">;
}

/** Type hook for CTE outputs that are expressions; set by types.ts to avoid an import cycle. */
let exprTyper: (expr: PgExpr, scope: ScopeInfo) => SqlType = () => "unknown";
export function setExprTyper(fn: (expr: PgExpr, scope: ScopeInfo) => SqlType): void {
  exprTyper = fn;
}

export function outputName(col: PgNode): string | undefined {
  if (typeof col.as === "string" && col.as) return col.as;
  const e = col.expr;
  if (e?.type === "column_ref" && typeof e.column?.expr?.value === "string") return e.column.expr.value;
  return undefined;
}

class Resolver {
  resolved = new WeakMap<object, Resolved>();
  fromKinds = new WeakMap<object, "cte" | "table">();
  cteNames = new Map<string, CteInfo>();
  tables = new Set<string>();
  columns = new Set<string>();
  loc: Locator;
  csv: CsvIndex;
  constructor(sa: SelectAst, csv: CsvIndex) {
    this.loc = new Locator(sa);
    this.csv = csv;
  }

  private findCte(scope: Scope | undefined, name: string): CteInfo | undefined {
    for (let s = scope; s; s = s.parent) {
      const c = s.ctes.get(name);
      if (c) return c;
    }
    return undefined;
  }

  private findFrom(scope: Scope | undefined, name: string): "cte" | "table" | undefined {
    for (let s = scope; s; s = s.parent) {
      const k = s.from.get(name);
      if (k) return k;
    }
    return undefined;
  }

  /** A query: optional WITH, then a chain of set-operation branches. */
  query(node: PgNode, parent: Scope | undefined): void {
    this.loc.track(node);
    const withScope: Scope = { parent, ctes: new Map(), from: new Map() };
    for (const cte of node.with ?? []) {
      const name = String(cte.name?.value ?? cte.name).toLowerCase();
      const stmt = cte.stmt?.ast ?? cte.stmt;
      this.query(stmt, withScope);
      const info: CteInfo = { name, outputs: new Map() };
      for (const col of stmt.columns ?? []) {
        const n = outputName(col);
        if (n) info.outputs.set(n.toLowerCase(), { name: n, expr: col.expr, aliased: typeof col.as === "string" && col.as.length > 0 });
      }
      withScope.ctes.set(name, info);
      this.cteNames.set(name, info);
    }
    const branches: PgNode[] = [];
    for (let b: PgNode = node; b; b = b._next) branches.push(b);
    const firstOutputs = new Set<string>();
    for (const c of node.columns ?? []) {
      const n = outputName(c);
      if (n) firstOutputs.add(n.toLowerCase());
    }
    branches.forEach((b, i) => {
      const compoundOrder = branches.length > 1 && i === branches.length - 1;
      this.select(b, withScope, compoundOrder ? firstOutputs : undefined);
    });
  }

  private select(node: PgNode, parent: Scope, compoundOutputs?: Set<string>): void {
    this.loc.track(node);
    const scope: Scope = { parent, ctes: new Map(), from: new Map() };
    for (const f of node.from ?? []) {
      const name = String(f.table).toLowerCase();
      if (this.findCte(parent, name)) {
        scope.from.set(name, "cte");
        this.fromKinds.set(f, "cte");
      } else if (this.csv.has(name)) {
        scope.from.set(name, "table");
        this.fromKinds.set(f, "table");
        this.tables.add(name);
      } else {
        this.loc.fail("E_UNKNOWN_TABLE", `The table ${f.table} is not an AMOS table (not in Database-Description-AMOS-csv.csv) and not a WITH query.`, f.table);
      }
    }
    const aliases = new Map<string, PgExpr>();
    for (const col of node.columns ?? []) {
      if (typeof col.as === "string" && col.as) aliases.set(col.as.toLowerCase(), col.expr);
    }
    for (const col of node.columns ?? []) {
      const e = col.expr;
      if (e?.type === "column_ref" && e.column === "*") {
        if (e.table) {
          const t = String(e.table?.value ?? e.table).toLowerCase();
          if (!this.findFrom(scope, t)) this.loc.fail("E_UNKNOWN_TABLE", `${t}.* names a table that is not in FROM.`, t);
        }
        continue;
      }
      this.expr(e, scope);
    }
    for (const f of node.from ?? []) if (f.on) this.expr(f.on, scope);
    if (node.where) this.expr(node.where, scope);
    for (const g of node.groupby?.columns ?? []) this.expr(g, scope, aliases);
    if (node.having) this.expr(node.having, scope);
    for (const o of node.orderby ?? []) {
      if (compoundOutputs) {
        const e = o.expr;
        if (e?.type === "number") continue;
        const n = e?.type === "column_ref" && !e.table ? String(e.column?.expr?.value ?? "").toLowerCase() : "";
        if (n && compoundOutputs.has(n)) {
          this.resolved.set(e, { kind: "ordinal_name", name: n });
          continue;
        }
        this.loc.fail("E_UNSUPPORTED", "After UNION/INTERSECT/EXCEPT, ORDER BY must use output column names or positions.", "ORDER");
      }
      this.expr(o.expr, scope, aliases);
    }
  }

  private expr(node: PgExpr, scope: Scope, aliases?: Map<string, PgExpr>): void {
    if (node === null || node === undefined || typeof node !== "object") return;
    this.loc.track(node);
    if (isSubquery(node)) {
      this.query(node.ast, scope);
      return;
    }
    switch (node.type) {
      case "column_ref":
        this.columnRef(node, scope, aliases);
        return;
      case "binary_expr":
        this.expr(node.left, scope);
        this.expr(node.right, scope);
        return;
      case "unary_expr":
        this.expr(node.expr, scope);
        return;
      case "expr_list":
        for (const v of node.value ?? []) this.expr(v, scope);
        return;
      case "function": {
        functionName(node);
        for (const a of node.args?.value ?? []) this.expr(a, scope);
        return;
      }
      case "aggr_func":
      case "window_func": {
        if (node.args?.expr && node.args.expr.type !== "star") this.expr(node.args.expr, scope);
        for (const a of node.args?.value ?? []) this.expr(a, scope);
        if (node.filter) this.expr(node.filter.where, scope);
        const ws = node.over?.as_window_specification?.window_specification;
        for (const p of ws?.partitionby ?? []) this.expr(p.expr ?? p, scope);
        for (const o of ws?.orderby ?? []) this.expr(o.expr, scope);
        return;
      }
      case "extract":
        this.expr(node.args?.source, scope);
        return;
      case "cast":
        this.expr(node.expr, scope);
        return;
      default:
        return; // literals; the guard has already refused everything else
    }
  }

  private columnRef(node: PgExpr, scope: Scope, aliases?: Map<string, PgExpr>): void {
    const col = String(node.column?.expr?.value ?? "");
    if (!node.table) {
      if (col.toUpperCase() === "LOCALTIMESTAMP") {
        this.resolved.set(node, { kind: "localtimestamp" });
        return;
      }
      const target = aliases?.get(col.toLowerCase());
      if (target) {
        this.resolved.set(node, { kind: "alias", name: col, target });
        return;
      }
      this.loc.fail("E_UNQUALIFIED_COLUMN", `The column ${col} must be written with its table name (table.${col}), as the house rules require.`, col);
    }
    const table = String(node.table).toLowerCase();
    const kind = this.findFrom(scope, table);
    if (!kind) this.loc.fail("E_UNKNOWN_TABLE", `${node.table}.${col} names a table that is not in FROM.`, node.table);
    if (kind === "cte") {
      const info = this.findCte(scope, table)!;
      const out = info.outputs.get(col.toLowerCase());
      if (!out) this.loc.fail("E_UNKNOWN_COLUMN", `The WITH query ${table} has no column ${col}.`, col);
      this.resolved.set(node, { kind: "cte", cte: table, column: col.toLowerCase(), out });
      return;
    }
    const csvCol = this.csv.get(table)?.columns.get(col.toLowerCase());
    if (!csvCol) this.loc.fail("E_UNKNOWN_COLUMN", `The column ${table}.${col} does not exist in AMOS (not in Database-Description-AMOS-csv.csv).`, col);
    this.resolved.set(node, { kind: "table", table, column: csvCol.name, csv: csvCol });
    this.columns.add(`${table}.${csvCol.name}`);
  }
}

export function resolveScopes(ast: SelectAst, csv: CsvIndex): ScopeInfo {
  const r = new Resolver(ast, csv);
  r.query(ast.root, undefined);
  const info: ScopeInfo = {
    root: ast.root,
    csv,
    resolve(ref) {
      const x = r.resolved.get(ref);
      if (!x) throw new ConvertError("E_TYPE_UNKNOWN", "Internal: a column reference was not resolved.", JSON.stringify(ref).slice(0, 200));
      return x;
    },
    tableOf(ref) {
      const x = info.resolve(ref);
      if (x.kind === "table") return x.table;
      if (x.kind === "cte") return x.cte;
      return "";
    },
    isCte: (name) => r.cteNames.has(name.toLowerCase()),
    cte: (name) => r.cteNames.get(name.toLowerCase()),
    fromKind(f) {
      const k = r.fromKinds.get(f);
      if (!k) throw new ConvertError("E_TYPE_UNKNOWN", "Internal: a FROM item was not resolved.", String(f?.table));
      return k;
    },
    pgTypeOf(ref) {
      const x = info.resolve(ref);
      switch (x.kind) {
        case "table":
          return sqlTypeOfPg(x.csv.pgType);
        case "cte":
          return exprTyper(x.out.expr, info);
        case "alias":
          return exprTyper(x.target, info);
        case "localtimestamp":
          return "timestamp";
        default:
          return "unknown";
      }
    },
    usedTables: () => [...r.tables].sort(),
    usedColumns: () => [...r.columns].sort(),
  };
  return info;
}

// Basic typing until types.ts installs full inference: plain column references only.
setExprTyper((expr, scope) => (expr?.type === "column_ref" && expr.table ? scope.pgTypeOf(expr) : "unknown"));

// ---------- Oracle names ----------

export interface NameCtx {
  mapping: DwhMapping;
  catalogue?: Catalogue;
  csv?: CsvIndex;
  /** "output": the column is selected as is; "expr": something depends on its type. */
  usage?: "output" | "expr";
  warnings?: ConvertWarning[];
}

const indexCache = new WeakMap<Catalogue, ReturnType<typeof catalogueIndex>>();
function catIndex(cat: Catalogue) {
  let idx = indexCache.get(cat);
  if (!idx) indexCache.set(cat, (idx = catalogueIndex(cat)));
  return idx;
}

/** Table name as Oracle knows it (catalogue spelling, else upper case), without schema. */
export function oracleBareTableName(amosTable: string, ctx: NameCtx): string {
  const t = ctx.catalogue ? catIndex(ctx.catalogue).get(amosTable.toUpperCase()) : undefined;
  return oracleIdent(t?.name ?? amosTable.toUpperCase());
}

export function oracleTableName(amosTable: string, ctx: NameCtx): string {
  return `${oracleIdent(ctx.mapping.oracleSchema)}.${oracleBareTableName(amosTable, ctx)}`;
}

function isRetyped(pgType: string, dataType: string): boolean {
  const amos = sqlTypeOfPg(pgType);
  const ora = dataType.toUpperCase().replace(/\(.*$/, "");
  if (amos === "int" || amos === "numeric" || amos === "float") return !["NUMBER", "FLOAT", "BINARY_DOUBLE", "BINARY_FLOAT", "INTEGER"].includes(ora);
  if (amos === "text") return !["VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR"].includes(ora);
  return false;
}

/** Column name as Oracle knows it; `aliasAs` is set for an approved rename (print NEW AS "old"). */
export function oracleColumnName(ref: string, ctx: NameCtx): { name: string; aliasAs?: string } {
  const [table, column] = ref.toLowerCase().split(".") as [string, string];
  const rename = ctx.mapping.columns[`${table}.${column}`];
  if (rename && !rename.keepOutputName) {
    throw new ConvertError(
      "E_RENAMED_NEEDS_APPROVAL",
      `The column ${table}.${column} is called ${rename.dwh} in the DWH. Approve the rename in dwh/mapping.yaml (keep_output_name: true) before converting.`,
    );
  }
  const dwhName = rename?.dwh ?? column;
  const catCol = ctx.catalogue ? catIndex(ctx.catalogue).get(table.toUpperCase())?.columns.get(dwhName.toUpperCase()) : undefined;
  const csvCol = ctx.csv?.get(table)?.columns.get(column);
  if (catCol && csvCol && isRetyped(csvCol.pgType, catCol.dataType)) {
    const plain = `The column ${table}.${column} is ${csvCol.pgType} in AMOS but ${catCol.dataType} in the DWH.`;
    if (ctx.usage !== "output") throw new ConvertError("E_RETYPED_COLUMN", `${plain} The query depends on its type, so it cannot be converted exactly.`);
    if (ctx.warnings) addWarning(ctx.warnings, { code: "W_RETYPED_COLUMN", plain: `${plain} Its values may look different.` });
  }
  const name = oracleIdent(catCol?.name ?? dwhName.toUpperCase());
  return rename ? { name, aliasAs: column } : { name };
}

/** Oracle data type of an AMOS column in the catalogue snapshot, if known. */
export function catalogueDataType(table: string, column: string, ctx: NameCtx): string | undefined {
  if (!ctx.catalogue) return undefined;
  const dwh = ctx.mapping.columns[`${table}.${column}`]?.dwh ?? column;
  return catIndex(ctx.catalogue).get(table.toUpperCase())?.columns.get(dwh.toUpperCase())?.dataType;
}

/** Which of the query's tables and columns the DWH snapshot lacks (#6). */
export function availability(
  scope: ScopeInfo,
  cat?: Catalogue,
  mapping?: DwhMapping,
): { available: boolean | "unknown"; missing: string[] } {
  if (!cat) {
    // No snapshot yet: fall back to the missing tables recorded from Phase 0 in dwh/mapping.yaml.
    const known = new Set(mapping?.knownMissingTables ?? []);
    const missing = scope.usedTables().filter((t) => known.has(t)).map((t) => t.toUpperCase()).sort();
    return missing.length ? { available: false, missing } : { available: "unknown", missing: [] };
  }
  const idx = catIndex(cat);
  const missing = new Set<string>();
  for (const t of scope.usedTables()) if (!idx.has(t.toUpperCase())) missing.add(t.toUpperCase());
  for (const ref of scope.usedColumns()) {
    const [t, c] = ref.split(".") as [string, string];
    const table = idx.get(t.toUpperCase());
    if (!table) continue;
    const dwh = mapping?.columns[ref]?.dwh ?? c;
    if (!table.columns.has(dwh.toUpperCase())) missing.add(`${t.toUpperCase()}.${dwh.toUpperCase()}`);
  }
  const list = [...missing].sort();
  return { available: list.length === 0, missing: list };
}
