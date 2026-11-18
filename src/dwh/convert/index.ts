// PostgreSQL -> Oracle converter entry point (plan A.4 pipeline, steps 1-12).
import sqlParser from "node-sql-parser";
import type { Model } from "../../schema/types.ts";
import type { CsvIndex } from "../../schema/csv.ts";
import { lintSql } from "../../validate/sqlLint.ts";
import type { DwhMapping } from "../mapping.ts";
import type { Catalogue } from "../catalogue.ts";
import { lex } from "../lex.ts";
import { assertReadOnlyOracle } from "../safety.ts";
import { ConvertError, addWarning, type ConvertWarning } from "./errors.ts";
import { preprocess, restorePlaceholders } from "./preprocess.ts";
import { parsePg, assertSupported } from "./guard.ts";
import { availability, resolveScopes, type SqlType } from "./scope.ts";
import { rewriteQuery } from "./rewrite.ts";
import type { RewriteCtx } from "./dates.ts";
import type { IrQuery } from "./ir.ts";
import { printExpr, printOracle } from "./print.ts";

const { Parser } = sqlParser;

/** Bump when the generated SQL for an unchanged source can change. */
export const CONVERTER_VERSION = 2;

/** Longest placeholder value accepted at run time in openquery mode (A.5 #69). */
export const PLACEHOLDER_MAX_LENGTH = 100;

/**
 * OPENQUERY accepts at most 8000 bytes of query text (A.5 #83). The text is sent as N'…' so
 * Vietnamese survives, and an N'…' string holds 2 bytes per character: 4000 characters
 * (confirmed live: a 7,889-character N'…' text gave SQL Server error 103).
 */
export const OPENQUERY_MAX_LENGTH = 4000;

/** Room for the row cap the runner appends at run time (" FETCH FIRST 2000001 ROWS ONLY"). */
export const RUN_CAP_RESERVE = " FETCH FIRST 2000001 ROWS ONLY".length;

/**
 * Characters OPENQUERY receives: the exec text with each <NAME> replaced by its value, then
 * every quote doubled for the outer N'…' string.
 */
export function openqueryLength(exec: string, values: { name: string; value: string }[]): number {
  let text = exec;
  for (const { name, value } of values) text = text.split(`<${name}>`).join(value);
  return text.replace(/'/g, "''").length;
}

export interface ConvertOptions {
  model: Model;
  csv: CsvIndex;
  mapping: DwhMapping;
  catalogue?: Catalogue;
  pinNow?: string;
  /** Test hook: replaces the printer (used to prove the self-check catches a broken one). */
  printer?: (q: IrQuery, style: "pretty" | "exec") => string;
}

export interface ConvertResult {
  pretty: string;
  exec: string;
  warnings: ConvertWarning[];
  placeholders: { name: string; maxLength: number }[];
  /** `unnamed`: the source gave no name; `name` is then the printed formula (Oracle's own naming may differ). */
  outputs: { name: string; type: SqlType; unnamed?: boolean }[];
  orderKeys: string[];
  usedColumns: string[];
  available: boolean | "unknown";
  missing: string[];
}

/**
 * A.4 step 10: re-read the Oracle text with the PostgreSQL grammar after removing the few
 * Oracle-only forms we emit (FETCH/OFFSET … ROWS, N'…', MINUS). A failure is a converter bug.
 */
export function selfCheck(exec: string): void {
  let toks;
  try {
    toks = lex(exec, "oracle");
  } catch (e) {
    throw new ConvertError("E_SELF_CHECK", "Internal converter error: the generated DWH query could not be re-read. Please report this file.", String(e));
  }
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const w = t.kind === "word" ? t.text.toUpperCase() : "";
    const sig = (j: number) => {
      let n = 0;
      for (let k = i + 1; k < toks.length; k++) {
        if (toks[k]!.kind === "space") continue;
        if (n++ === j) return toks[k];
      }
      return undefined;
    };
    const isWord = (tok: ReturnType<typeof sig>, v: string) => tok?.kind === "word" && tok.text.toUpperCase() === v;
    if (w === "OFFSET" && sig(0)?.kind === "number" && isWord(sig(1), "ROWS")) {
      i = toks.indexOf(sig(1)!);
      continue;
    }
    if (w === "FETCH" && (isWord(sig(0), "FIRST") || isWord(sig(0), "NEXT")) && sig(1)?.kind === "number" && isWord(sig(2), "ROWS") && isWord(sig(3), "ONLY")) {
      i = toks.indexOf(sig(3)!);
      continue;
    }
    if (t.kind === "nstring") out.push(t.text.slice(1));
    else if (w === "MINUS") out.push("EXCEPT");
    else if (w === "NUMBER" && sig(0)?.kind === "symbol" && sig(0)?.text === "(") out.push("NUMERIC");
    else out.push(t.text);
  }
  const text = out.join("");
  let parsed: unknown;
  try {
    parsed = new Parser().astify(text, { database: "PostgresQL" });
  } catch (e: any) {
    throw new ConvertError(
      "E_SELF_CHECK",
      "Internal converter error: the generated DWH query could not be re-read. Please report this file.",
      String(e?.message ?? e).split("\n")[0]!.slice(0, 300),
    );
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length !== 1 || (list[0] as { type?: string })?.type !== "select") {
    throw new ConvertError("E_SELF_CHECK", "Internal converter error: the generated DWH query is not a single SELECT. Please report this file.");
  }
}

export function convertQuery(source: string, filename: string, opts: ConvertOptions): ConvertResult {
  const { sql, placeholders, marker } = preprocess(source);

  const lint = lintSql(sql, filename, opts.model, opts.csv);
  if (lint.errors.length) {
    throw new ConvertError(
      "E_LINT",
      `The query fails \`npm run validate\` (${lint.errors.length} error${lint.errors.length > 1 ? "s" : ""}). Fix it in PostgreSQL first.`,
      lint.errors.join("\n"),
    );
  }

  const ast = parsePg(sql);
  const warnings: ConvertWarning[] = [...assertSupported(ast)];
  const scope = resolveScopes(ast, opts.csv);
  const ctx: RewriteCtx = { mapping: opts.mapping, warnings, ...(opts.catalogue ? { catalogue: opts.catalogue } : {}), ...(opts.pinNow ? { pinNow: opts.pinNow } : {}) };
  const q = rewriteQuery(ast, scope, ctx);
  if (!opts.catalogue) {
    addWarning(warnings, {
      code: "W_NO_CATALOGUE",
      plain: "No DWH catalogue snapshot yet: names are upper case, and availability uses only the missing tables listed in dwh/mapping.yaml (columns are not checked).",
    });
  }

  const print = opts.printer ?? printOracle;
  const prettySentinel = print(q, "pretty");
  const execSentinel = print(q, "exec");
  selfCheck(execSentinel);
  assertReadOnlyOracle(execSentinel);

  const pretty = restorePlaceholders(prettySentinel, placeholders, marker);
  const exec = restorePlaceholders(execSentinel, placeholders, marker);
  if (opts.mapping.execMode === "openquery") {
    // Each placeholder counts as its longest allowed value and the runner's row cap is included,
    // so any query converted here also fits when it runs.
    const len = openqueryLength(exec, placeholders.map((name) => ({ name, value: "x".repeat(PLACEHOLDER_MAX_LENGTH) }))) + RUN_CAP_RESERVE;
    if (len > OPENQUERY_MAX_LENGTH) {
      throw new ConvertError(
        "E_TOO_LONG",
        `The DWH query is ${len} characters long (with the longest allowed values and the row limit filled in); the DWH link (OPENQUERY) accepts at most ${OPENQUERY_MAX_LENGTH}. Split the query or ask for RPC Out to be enabled.`,
      );
    }
  }

  const firstCols = q.branches[0]!.columns;
  const outputs = q.outputs.map((o, i) => (o.name ? o : { name: printExpr(firstCols[i]!.e), type: o.type, unnamed: true }));
  const avail = availability(scope, opts.catalogue, opts.mapping);
  return {
    pretty,
    exec,
    warnings,
    placeholders: placeholders.map((name) => ({ name, maxLength: PLACEHOLDER_MAX_LENGTH })),
    outputs,
    orderKeys: q.orderKeys,
    usedColumns: scope.usedColumns(),
    available: avail.available,
    missing: avail.missing,
  };
}
