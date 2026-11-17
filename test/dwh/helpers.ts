// Shared helpers for the DWH converter tests.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { ConvertError } from "../../src/dwh/convert/errors.ts";

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
