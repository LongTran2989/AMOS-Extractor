// Shared helpers for the DWH converter tests.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { ConvertError } from "../../src/dwh/convert/errors.ts";
import { loadCsvIndex, type CsvIndex } from "../../src/schema/csv.ts";
import { loadMapping, type DwhMapping } from "../../src/dwh/mapping.ts";
import type { Catalogue } from "../../src/dwh/catalogue.ts";
import { preprocess } from "../../src/dwh/convert/preprocess.ts";
import { parsePg, assertSupported } from "../../src/dwh/convert/guard.ts";
import { resolveScopes } from "../../src/dwh/convert/scope.ts";
import { rewriteQuery } from "../../src/dwh/convert/rewrite.ts";
import type { RewriteCtx } from "../../src/dwh/convert/dates.ts";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Runs fn, asserts it throws a ConvertError, and returns that error. */
export function rejects(fn: () => unknown): ConvertError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConvertError) return e;
    throw e;
  }
  assert.fail("expected a ConvertError");
}

/** The 15 root queries and the 12 generated per-pair queries (paths relative to the repo root). */
export function realSources(): string[] {
  const inDir = (dir: string) =>
    readdirSync(path.join(ROOT, dir))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => (dir === "." ? f : `${dir}/${f}`));
  return [...inDir("."), ...inDir("queries/wp_seqs")];
}

export function readSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

let csvCache: CsvIndex | undefined;
export function csvIndex(): CsvIndex {
  return (csvCache ??= loadCsvIndex(path.join(ROOT, "Database-Description-AMOS-csv.csv")));
}
export const MAPPING: DwhMapping = loadMapping(path.join(ROOT, "dwh", "mapping.yaml"));

/** Source -> Oracle IR through every step before printing. */
export function irOf(sql: string, opts: { mapping?: Partial<DwhMapping>; catalogue?: Catalogue } = {}) {
  const sa = parsePg(preprocess(sql).sql);
  const warnings = assertSupported(sa);
  const scope = resolveScopes(sa, csvIndex());
  const ctx: RewriteCtx = { mapping: { ...MAPPING, ...opts.mapping }, warnings, ...(opts.catalogue ? { catalogue: opts.catalogue } : {}) };
  const q = rewriteQuery(sa, scope, ctx);
  return { q, warnings: ctx.warnings, codes: ctx.warnings.map((w) => w.code) };
}

/** IR of the first select item of `SELECT <expr> FROM <from>`. */
export function exprIr(expr: string, from = "wp_header") {
  const r = irOf(`SELECT ${expr} FROM ${from}`);
  return { e: r.q.branches[0]!.columns[0]!.e, codes: r.codes, q: r.q };
}
