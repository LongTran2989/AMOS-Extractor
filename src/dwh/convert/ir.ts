// Oracle tree (IR) produced by the rewrites and printed by print.ts. Plain JSON objects, so
// tests can compare trees with assert.deepEqual. Identifiers are stored already printed
// (catalogue case, quoted when needed).
import type { SqlType } from "./scope.ts";

export type IrExpr =
  | { k: "col"; table: string; name: string }
  | { k: "num"; v: string }
  | { k: "str"; v: string; national?: true }
  | { k: "null" }
  | { k: "date"; v: string }
  | { k: "ts"; v: string }
  | { k: "kw"; v: string } // bare keyword-like value, e.g. SYSTIMESTAMP
  | { k: "star"; table?: string }
  | { k: "bin"; op: string; l: IrExpr; r: IrExpr }
  | { k: "un"; op: "NOT" | "-" | "+"; e: IrExpr }
  | { k: "fn"; name: string; args: IrExpr[]; distinct?: true; over?: IrWindow }
  | { k: "cast"; e: IrExpr; to: string }
  | { k: "extract"; field: string; e: IrExpr }
  | { k: "isnull"; not: boolean; e: IrExpr }
  | { k: "in"; not: boolean; e: IrExpr; list: IrExpr[] }
  | { k: "in_sub"; not: boolean; e: IrExpr; q: IrQuery }
  | { k: "between"; not: boolean; e: IrExpr; lo: IrExpr; hi: IrExpr }
  | { k: "like"; not: boolean; e: IrExpr; pat: IrExpr }
  | { k: "exists"; not: boolean; q: IrQuery }
  | { k: "any"; op: string; e: IrExpr; q: IrQuery }
  | { k: "sub"; q: IrQuery }
  | { k: "case"; whens: { cond: IrExpr; then: IrExpr }[] }
  | { k: "ordinal"; n: number };

export interface IrOrder {
  e: IrExpr;
  desc: boolean;
  nulls: "FIRST" | "LAST";
}

export interface IrWindow {
  partitionBy: IrExpr[];
  orderBy: IrOrder[];
}

export interface IrColumn {
  e: IrExpr;
  /** Printed alias (already quoted), if any. */
  as?: string;
}

export interface IrFrom {
  /** JOIN keyword(s), absent for the first item; "," for a comma join. */
  join?: string;
  table: string;
  on?: IrExpr;
}

export interface IrSelect {
  distinct: boolean;
  columns: IrColumn[];
  /** Empty means FROM DUAL. */
  from: IrFrom[];
  where?: IrExpr;
  groupBy: IrExpr[];
  having?: IrExpr;
}

export interface IrQuery {
  with: { name: string; q: IrQuery }[];
  branches: IrSelect[];
  /** Set operations between branches: UNION, UNION ALL, INTERSECT, MINUS. */
  ops: string[];
  orderBy: IrOrder[];
  offset?: string;
  fetch?: string;
  outputs: { name: string; type: SqlType }[];
  orderKeys: string[];
}

// ---- builders (used by the rewrites and by tests, so both build identical shapes) ----
export const col = (table: string, name: string): IrExpr => ({ k: "col", table, name });
export const num = (v: string | number): IrExpr => ({ k: "num", v: String(v) });
export const str = (v: string): IrExpr => ({ k: "str", v });
export const nstr = (v: string): IrExpr => ({ k: "str", v, national: true });
export const kw = (v: string): IrExpr => ({ k: "kw", v });
export const dateLit = (v: string): IrExpr => ({ k: "date", v });
export const tsLit = (v: string): IrExpr => ({ k: "ts", v });
export const fn = (name: string, ...args: IrExpr[]): IrExpr => ({ k: "fn", name, args });
export const bin = (op: string, l: IrExpr, r: IrExpr): IrExpr => ({ k: "bin", op, l, r });
export const cast = (e: IrExpr, to: string): IrExpr => ({ k: "cast", e, to });
export const extract = (field: string, e: IrExpr): IrExpr => ({ k: "extract", field, e });
export const NULL: IrExpr = { k: "null" };
