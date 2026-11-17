// A.4 date and time algebra: PostgreSQL date/time expressions -> Oracle, keeping PostgreSQL's
// meaning exactly (UTC "now", day arithmetic, PostgreSQL's month clamp rule). No constant folding.
import type { DwhMapping } from "../mapping.ts";
import type { Catalogue } from "../catalogue.ts";
import { ConvertError, addWarning, type ConvertWarning, type ErrorCode, type SourceLoc } from "./errors.ts";
import { functionName, type PgExpr } from "./guard.ts";
import type { ScopeInfo, SqlType } from "./scope.ts";
import { inferType } from "./types.ts";
import { bin, cast, dateLit, extract, fn, kw, num, str, tsLit, type IrExpr } from "./ir.ts";
import { rewriteExpr } from "./rewrite.ts";

export interface RewriteCtx {
  mapping: DwhMapping;
  catalogue?: Catalogue;
  /** Frozen "now" as a UTC instant, e.g. 2026-11-10T00:00:00Z (verification packs, A.7). */
  pinNow?: string;
  warnings: ConvertWarning[];
  /** Nearest known source location while rewriting (for error messages). */
  lastLoc?: SourceLoc;
}

const DS_UNITS = new Set(["DAY", "HOUR", "MINUTE", "SECOND", "WEEK"]);
const YM_UNITS = new Set(["MONTH", "YEAR"]);
const UTC_HINT = "Use CURRENT_TIMESTAMP (UTC) plus the repo idiom + INTERVAL '7' HOUR.";

export function failAt(ctx: RewriteCtx, node: PgExpr, code: ErrorCode, plain: string, detail = ""): never {
  const start = node?.loc?.start;
  const loc = start ? { line: start.line, column: start.column } : ctx.lastLoc;
  throw new ConvertError(code, plain, detail, loc);
}

function pinParts(ctx: RewriteCtx): { date: string; time: string } | undefined {
  if (!ctx.pinNow) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/.exec(ctx.pinNow);
  if (!m) throw new Error(`pinNow must be a UTC instant like 2026-11-10T00:00:00Z (got ${ctx.pinNow})`);
  return { date: m[1]!, time: m[2]! };
}

function utcNote(ctx: RewriteCtx) {
  if (!ctx.pinNow) addWarning(ctx.warnings, { code: "W_UTC_TODAY", plain: '"today" and "now" mean UTC, the same as in AMOS.' });
}

function nowIr(ctx: RewriteCtx): IrExpr {
  const pin = pinParts(ctx);
  utcNote(ctx);
  return pin ? tsLit(`${pin.date} ${pin.time}`) : fn("SYS_EXTRACT_UTC", kw("SYSTIMESTAMP"));
}

function todayIr(ctx: RewriteCtx): IrExpr {
  const pin = pinParts(ctx);
  utcNote(ctx);
  return pin ? dateLit(pin.date) : fn("TRUNC", fn("SYS_EXTRACT_UTC", kw("SYSTIMESTAMP")));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** PostgreSQL month arithmetic: keep the day of month, clamp to the target month's last day. */
function addMonths(d: IrExpr, k: number): IrExpr {
  const am = fn("ADD_MONTHS", fn("TRUNC", d, str("MM")), num(k));
  return bin("+", am, bin("-", fn("LEAST", extract("DAY", d), extract("DAY", fn("LAST_DAY", am))), num(1)));
}

function parseIntervalLiteral(node: PgExpr, ctx: RewriteCtx): { n: number; unit: string } {
  const raw = node.expr?.type === "single_quote_string" ? String(node.expr.value) : undefined;
  if (raw === undefined) failAt(ctx, node, "E_UNSUPPORTED", "Only INTERVAL '…' literals are supported.");
  const unit = String(node.unit ?? "").toUpperCase();
  const reject = () =>
    failAt(ctx, node, "E_UNSUPPORTED", `INTERVAL '${raw}'${unit ? ` ${unit}` : ""} is not supported: use a whole number with one unit, e.g. INTERVAL '7' HOUR or INTERVAL '1 minute'.`);
  if (unit) {
    if (!/^[+-]?\d+$/.test(raw.trim()) || !(DS_UNITS.has(unit) || YM_UNITS.has(unit))) reject();
    return { n: Number(raw.trim()), unit };
  }
  const m = /^\s*([+-]?\d+)\s+(year|month|week|day|hour|minute|second)s?\s*$/i.exec(raw);
  if (!m) reject();
  return { n: Number(m![1]), unit: m![2]!.toUpperCase() };
}

/** x ± (INTERVAL literal | e * INTERVAL literal), x a date or timestamp. */
function addInterval(x: PgExpr, xt: SqlType, op: string, iv: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr {
  let lit: PgExpr;
  let mult: PgExpr | undefined;
  if (iv.type === "interval") lit = iv;
  else if (iv.type === "binary_expr" && iv.operator === "*" && (iv.left?.type === "interval" || iv.right?.type === "interval")) {
    lit = iv.left?.type === "interval" ? iv.left : iv.right;
    mult = iv.left?.type === "interval" ? iv.right : iv.left;
    const mt = inferType(mult, scope);
    if (mt === "unknown") failAt(ctx, iv, "E_TYPE_UNKNOWN", "The number multiplying the INTERVAL has a type the converter cannot tell.");
    if (mt !== "int") failAt(ctx, iv, "E_UNSUPPORTED", "Only whole numbers can multiply an INTERVAL.");
  } else {
    failAt(ctx, iv, "E_UNSUPPORTED", "Only INTERVAL literals (optionally times a whole number) can be added to or subtracted from a date.");
  }
  const { n, unit } = parseIntervalLiteral(lit, ctx);
  if (YM_UNITS.has(unit)) {
    if (mult) failAt(ctx, iv, "E_UNSUPPORTED", "Month and year arithmetic needs a fixed number (INTERVAL '6' MONTH), not a number times an INTERVAL.");
    if (xt !== "date") {
      failAt(ctx, iv, "E_UNSUPPORTED", "Adding months or years to a timestamp is not supported (only to a date, e.g. CURRENT_DATE - INTERVAL '6' MONTH).");
    }
    const k = n * (unit === "YEAR" ? 12 : 1) * (op === "-" ? -1 : 1);
    return addMonths(rewriteExpr(x, scope, ctx), k);
  }
  let amount: IrExpr = mult ? (n === 1 ? rewriteExpr(mult, scope, ctx) : bin("*", num(n), rewriteExpr(mult, scope, ctx))) : num(n);
  let oraUnit = unit;
  if (unit === "WEEK") {
    amount = bin("*", num(7), amount);
    oraUnit = "DAY";
  }
  return bin(op, rewriteExpr(x, scope, ctx), fn("NUMTODSINTERVAL", amount, str(oraUnit)));
}

function dateArith(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr | undefined {
  const op = String(expr.operator);
  const dated = (t: SqlType) => t === "date" || t === "timestamp";
  if (op === "*") {
    if (expr.left?.type === "interval" || expr.right?.type === "interval") {
      failAt(ctx, expr, "E_UNSUPPORTED", "A number times an INTERVAL can only be added to or subtracted from a date or timestamp.");
    }
    return undefined;
  }
  if (op !== "+" && op !== "-") {
    if (expr.left?.type === "interval" || expr.right?.type === "interval") failAt(ctx, expr, "E_UNSUPPORTED", "Intervals can only be added to or subtracted from a date or timestamp.");
    return undefined;
  }
  const lt = inferType(expr.left, scope);
  const rt = inferType(expr.right, scope);
  if (lt === "interval" || rt === "interval") {
    if (dated(lt) && rt === "interval") return addInterval(expr.left, lt, op, expr.right, scope, ctx);
    if (op === "+" && lt === "interval" && dated(rt)) return addInterval(expr.right, rt, "+", expr.left, scope, ctx);
    failAt(ctx, expr, "E_UNSUPPORTED", "Interval arithmetic is only supported as date/timestamp ± INTERVAL (interval + interval and bare intervals are not).");
  }
  const R = (e: PgExpr) => rewriteExpr(e, scope, ctx);
  if (lt === "date" && rt === "int") return bin(op, R(expr.left), R(expr.right));
  if (op === "+" && lt === "int" && rt === "date") return bin(op, R(expr.left), R(expr.right));
  if (op === "-" && lt === "date" && rt === "date") return bin(op, R(expr.left), R(expr.right));
  if (dated(lt) || dated(rt)) {
    if (lt === "unknown" || rt === "unknown") failAt(ctx, expr, "E_TYPE_UNKNOWN", "Date arithmetic with a value whose type the converter cannot tell.");
    if (op === "-" && dated(lt) && dated(rt)) {
      failAt(ctx, expr, "E_UNSUPPORTED", "Subtracting timestamps gives an interval, which is not supported. Compare the values or subtract whole dates instead.");
    }
    failAt(ctx, expr, "E_UNSUPPORTED", `${lt} ${op} ${rt} is not supported in date arithmetic (only date ± whole number, date - date, and date/timestamp ± INTERVAL).`);
  }
  return undefined;
}

/** Rewrites a date/time expression; undefined when the expression is not date-related. */
export function rewriteDateExpr(expr: PgExpr, scope: ScopeInfo, ctx: RewriteCtx): IrExpr | undefined {
  if (!expr || typeof expr !== "object") return undefined;
  const start = expr.loc?.start;
  if (start) ctx.lastLoc = { line: start.line, column: start.column };
  switch (expr.type) {
    case "date": {
      const v = String(expr.value);
      if (!DATE_RE.test(v)) failAt(ctx, expr, "E_UNSUPPORTED", `Write the date as DATE 'YYYY-MM-DD' (got DATE '${v}').`);
      return dateLit(v);
    }
    case "timestamp": {
      const v = String(expr.value);
      if (!TS_RE.test(v)) failAt(ctx, expr, "E_UNSUPPORTED", `Write the timestamp as TIMESTAMP 'YYYY-MM-DD HH:MM:SS' (got '${v}').`);
      return tsLit(v);
    }
    case "interval":
      failAt(ctx, expr, "E_UNSUPPORTED", "A bare INTERVAL value is not supported; intervals can only be added to or subtracted from a date or timestamp.");
    case "function": {
      const name = functionName(expr);
      if (name === "CURRENT_DATE") return todayIr(ctx);
      if (name === "CURRENT_TIMESTAMP" || name === "NOW") return nowIr(ctx);
      if (name === "CURRENT_TIME" || name === "TIMEZONE") failAt(ctx, expr, "E_UNSUPPORTED", `${name} is not supported. ${UTC_HINT}`);
      return undefined;
    }
    case "column_ref": {
      const v = String(expr.column?.expr?.value ?? "").toUpperCase();
      if (!expr.table && v === "LOCALTIMESTAMP") return nowIr(ctx);
      if (!expr.table && v === "LOCALTIME") failAt(ctx, expr, "E_UNSUPPORTED", `LOCALTIME is not supported. ${UTC_HINT}`);
      return undefined;
    }
    case "cast": {
      const dt = String(expr.target?.[0]?.dataType ?? "").toUpperCase();
      if (dt !== "DATE" && dt !== "TIMESTAMP") return undefined;
      const src = expr.expr;
      if (src?.type === "single_quote_string") {
        const v = String(src.value);
        if (dt === "DATE" && DATE_RE.test(v)) return dateLit(v);
        if (dt === "TIMESTAMP" && TS_RE.test(v)) return tsLit(v);
        failAt(ctx, expr, "E_UNSUPPORTED", `Text cast to ${dt.toLowerCase()} must look like ${dt === "DATE" ? "'YYYY-MM-DD'" : "'YYYY-MM-DD HH:MM:SS'"}.`);
      }
      const st = inferType(src, scope);
      if (st === "unknown") failAt(ctx, expr, "E_TYPE_UNKNOWN", `Cannot tell the type of the value cast to ${dt.toLowerCase()}.`);
      if (st !== "date" && st !== "timestamp") failAt(ctx, expr, "E_UNSUPPORTED", `Casting ${st} to ${dt.toLowerCase()} is not supported (AMOS dates are numbers: use DATE '1971-12-31' + column).`);
      // Oracle CAST(... AS DATE) keeps the time of day; TRUNC drops it like PostgreSQL ::date.
      return dt === "DATE" ? fn("TRUNC", rewriteExpr(src, scope, ctx)) : cast(rewriteExpr(src, scope, ctx), "TIMESTAMP");
    }
    case "extract": {
      const field = String(expr.args?.field ?? "").toUpperCase();
      const src = expr.args?.source;
      const st = inferType(src, scope);
      if (st === "unknown") failAt(ctx, expr, "E_TYPE_UNKNOWN", `Cannot tell the type of the value in EXTRACT(${field} FROM …).`);
      if (st !== "date" && st !== "timestamp") failAt(ctx, expr, "E_UNSUPPORTED", `EXTRACT needs a date or timestamp (got ${st}).`);
      const inner = rewriteExpr(src, scope, ctx);
      // Oracle refuses HOUR/MINUTE on a DATE value (and date arithmetic yields DATE values).
      return field === "HOUR" || field === "MINUTE" ? extract(field, cast(inner, "TIMESTAMP")) : extract(field, inner);
    }
    case "binary_expr":
      return dateArith(expr, scope, ctx);
    default:
      return undefined;
  }
}
