// A.4 step 9: print the Oracle IR. "pretty" is the committed rendering (one select item per
// line, fixed 4-space indentation, LF); "exec" is the same text on one line (whitespace
// collapsed by the shared lexer, so both renderings always come from the same tree).
// Every binary and unary expression is parenthesised; no trailing ";"; no comments.
import { lex } from "../lex.ts";
import type { IrExpr, IrOrder, IrQuery, IrSelect, IrWindow } from "./ir.ts";

const IND = "    ";
const WRAP_AT = 100;

function strLit(v: string, national?: boolean): string {
  return `${national ? "N" : ""}'${v.replace(/'/g, "''")}'`;
}

function orderText(o: IrOrder): string {
  return `${printExpr(o.e)}${o.desc ? " DESC" : ""} NULLS ${o.nulls}`;
}

function overText(w: IrWindow): string {
  const parts: string[] = [];
  if (w.partitionBy.length) parts.push(`PARTITION BY ${w.partitionBy.map(printExpr).join(", ")}`);
  if (w.orderBy.length) parts.push(`ORDER BY ${w.orderBy.map(orderText).join(", ")}`);
  return ` OVER (${parts.join(" ")})`;
}

const sub = (q: IrQuery) => collapse(printQuery(q, 0));

/** One expression on one line. */
export function printExpr(e: IrExpr): string {
  switch (e.k) {
    case "col":
      return `${e.table}.${e.name}`;
    case "num":
      return e.v;
    case "str":
      return strLit(e.v, e.national);
    case "null":
      return "NULL";
    case "date":
      return `DATE '${e.v}'`;
    case "ts":
      return `TIMESTAMP '${e.v}'`;
    case "kw":
      return e.v;
    case "star":
      return e.table ? `${e.table}.*` : "*";
    case "bin":
      return `(${printExpr(e.l)} ${e.op} ${printExpr(e.r)})`;
    case "un": {
      const inner = printExpr(e.e);
      if (e.op === "NOT") return `(NOT ${inner})`;
      return `(${e.op}${inner.startsWith("-") || inner.startsWith("+") ? " " : ""}${inner})`;
    }
    case "fn":
      return `${e.name}(${e.distinct ? "DISTINCT " : ""}${e.args.map(printExpr).join(", ")})${e.over ? overText(e.over) : ""}`;
    case "cast":
      return `CAST(${printExpr(e.e)} AS ${e.to})`;
    case "extract":
      return `EXTRACT(${e.field} FROM ${printExpr(e.e)})`;
    case "isnull":
      return `(${printExpr(e.e)} IS ${e.not ? "NOT " : ""}NULL)`;
    case "in":
      return `(${printExpr(e.e)} ${e.not ? "NOT " : ""}IN (${e.list.map(printExpr).join(", ")}))`;
    case "in_sub":
      return `(${printExpr(e.e)} ${e.not ? "NOT " : ""}IN (${sub(e.q)}))`;
    case "between":
      return `(${printExpr(e.e)} ${e.not ? "NOT " : ""}BETWEEN ${printExpr(e.lo)} AND ${printExpr(e.hi)})`;
    case "like":
      return `(${printExpr(e.e)} ${e.not ? "NOT " : ""}LIKE ${printExpr(e.pat)})`;
    case "exists":
      return e.not ? `(NOT EXISTS (${sub(e.q)}))` : `EXISTS (${sub(e.q)})`;
    case "any":
      return `(${printExpr(e.e)} ${e.op} ANY (${sub(e.q)}))`;
    case "sub":
      return `(${sub(e.q)})`;
    case "case":
      return `CASE ${e.whens.map((w) => `WHEN ${printExpr(w.cond)} THEN ${printExpr(w.then)}`).join(" ")} END`;
    case "ordinal":
      return String(e.n);
  }
}

/** A condition, wrapped at AND/OR when long (pretty rendering only adds line breaks). */
function condText(e: IrExpr, depth: number): string {
  const flat = printExpr(e);
  if (flat.length <= WRAP_AT || e.k !== "bin" || (e.op !== "AND" && e.op !== "OR")) return flat;
  return `(${condText(e.l, depth + 1)}\n${IND.repeat(depth + 1)}${e.op} ${condText(e.r, depth + 1)})`;
}

function selectLines(s: IrSelect, P: string, depth: number): string[] {
  const lines = [`${P}SELECT${s.distinct ? " DISTINCT" : ""}`];
  s.columns.forEach((c, i) => {
    lines.push(`${P}${IND}${printExpr(c.e)}${c.as ? ` AS ${c.as}` : ""}${i < s.columns.length - 1 ? "," : ""}`);
  });
  if (s.from.length === 0) lines.push(`${P}FROM DUAL`);
  s.from.forEach((f, i) => {
    if (i === 0) lines.push(`${P}FROM ${f.table}`);
    else if (f.join === ",") lines[lines.length - 1] += `, ${f.table}`;
    else {
      lines.push(`${P}${f.join} ${f.table}`);
      if (f.on) lines.push(`${P}${IND}ON ${condText(f.on, depth + 1)}`);
    }
  });
  if (s.where) lines.push(`${P}WHERE ${condText(s.where, depth)}`);
  if (s.groupBy.length) {
    lines.push(`${P}GROUP BY`);
    s.groupBy.forEach((g, i) => lines.push(`${P}${IND}${printExpr(g)}${i < s.groupBy.length - 1 ? "," : ""}`));
  }
  if (s.having) lines.push(`${P}HAVING ${condText(s.having, depth)}`);
  return lines;
}

function printQuery(q: IrQuery, depth: number): string {
  const P = IND.repeat(depth);
  const lines: string[] = [];
  q.with.forEach((w, i) => {
    if (i === 0) lines.push(`${P}WITH ${w.name} AS (`);
    else lines[lines.length - 1] += `, ${w.name} AS (`;
    lines.push(printQuery(w.q, depth + 1));
    lines.push(`${P})`);
  });
  q.branches.forEach((b, i) => {
    if (i > 0) lines.push(`${P}${q.ops[i - 1]}`);
    lines.push(...selectLines(b, P, depth));
  });
  if (q.orderBy.length) {
    lines.push(`${P}ORDER BY`);
    q.orderBy.forEach((o, i) => lines.push(`${P}${IND}${orderText(o)}${i < q.orderBy.length - 1 ? "," : ""}`));
  }
  if (q.offset) lines.push(`${P}OFFSET ${q.offset} ROWS`);
  if (q.fetch) lines.push(`${P}FETCH ${q.offset ? "NEXT" : "FIRST"} ${q.fetch} ROWS ONLY`);
  return lines.join("\n");
}

/** Whitespace outside strings and quoted names becomes one space (none after "(" or before ")"). */
export function collapse(text: string): string {
  const toks = lex(text, "oracle");
  let out = "";
  toks.forEach((t, i) => {
    if (t.kind !== "space") {
      out += t.text;
      return;
    }
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (!prev || !next) return;
    if (prev.kind === "symbol" && prev.text === "(") return;
    if (next.kind === "symbol" && next.text === ")") return;
    out += " ";
  });
  return out;
}

export function printOracle(q: IrQuery, style: "pretty" | "exec"): string {
  const pretty = printQuery(q, 0);
  return style === "pretty" ? pretty : collapse(pretty);
}
