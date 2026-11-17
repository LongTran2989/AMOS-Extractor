// Task 2.4: `npm run dwh:run -- <source.sql> [--param K=V] [--csv out.csv]` and
// `--raw <oracle.sql>` (maintainers only). Runs converter output (or hand-written Oracle after
// the same read-only check) through the relay; read-only.
import { closeSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import * as path from "node:path";
import { listSources, convertSource } from "./sources.ts";
import { loadMapping, type DwhMapping } from "./mapping.ts";
import type { ConvertResult } from "./convert/index.ts";
import { PLACEHOLDER_MAX_LENGTH } from "./convert/index.ts";
import { assertReadOnlyOracle } from "./safety.ts";
import { placeholdersIn } from "./relay.ts";
import { runConverted, type RelayPool } from "./run.ts";
import { csvHeaderBytes, csvLine, formatCell } from "./format.ts";
import { toPlain } from "./errorsPlain.ts";

export const RUN_USAGE = "Usage: npm run dwh:run -- <source.sql> [--param NAME=value] [--csv out.csv]   or   npm run dwh:run -- --raw <oracle.sql> [--csv out.csv]";

export interface RunArgs {
  source?: string;
  raw?: string;
  params: Record<string, string>;
  csv?: string;
}

export function parseRunArgs(args: string[]): RunArgs {
  const out: RunArgs = { params: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${a} needs a value. ${RUN_USAGE}`);
      return v;
    };
    if (a === "--param") {
      const kv = value();
      const eq = kv.indexOf("=");
      if (eq <= 0) throw new Error(`--param must look like K=V (got "${kv}"). ${RUN_USAGE}`);
      out.params[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === "--csv") out.csv = value();
    else if (a === "--raw") out.raw = value();
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}. ${RUN_USAGE}`);
    else if (out.source === undefined) out.source = a;
    else throw new Error(`Only one query at a time. ${RUN_USAGE}`);
  }
  if (!out.source === !out.raw) throw new Error(RUN_USAGE);
  return out;
}

/** Hand-written Oracle for --raw: same shape as converter output, names unknown until it runs. */
function rawConversion(file: string): ConvertResult {
  const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trim().replace(/;$/, "").trim();
  assertReadOnlyOracle(text);
  return {
    pretty: text,
    exec: text,
    warnings: [],
    placeholders: placeholdersIn(text).map((name) => ({ name, maxLength: PLACEHOLDER_MAX_LENGTH })),
    outputs: [],
    orderKeys: [],
    usedColumns: [],
    available: true,
    missing: [],
  };
}

const PREVIEW_PRINT_ROWS = 20;

/**
 * Runs one query and prints or saves the result. Returns the process exit code.
 * A CSV is written as <name>.part and renamed only when the download has ended, so a killed or
 * crashed run never leaves a file that looks complete; a run that fails or reaches the row
 * limit ends with an "INCOMPLETE: …" line.
 */
export async function dwhRun(
  pool: RelayPool,
  root: string,
  args: string[],
  log: (s: string) => void,
  opts: { signal?: AbortSignal; mapping?: DwhMapping } = {},
): Promise<number> {
  let parsed: RunArgs;
  try {
    parsed = parseRunArgs(args);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const part = parsed.csv ? `${parsed.csv}.part` : undefined;
  let fd: number | undefined;
  let written = 0;
  const finishCsv = (lastLine?: string) => {
    if (fd === undefined) return;
    try {
      if (lastLine) writeSync(fd, csvLine([lastLine]));
    } finally {
      closeSync(fd);
      fd = undefined;
      renameSync(part!, parsed.csv!);
    }
  };
  try {
    let conv: ConvertResult;
    if (parsed.raw) conv = rawConversion(parsed.raw);
    else {
      const source = parsed.source!.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!listSources(root).includes(source)) {
        log(`${parsed.source} is not one of the repo queries (root *.sql or queries/wp_seqs/*.sql).`);
        return 1;
      }
      conv = convertSource(root, source);
      for (const w of conv.warnings) log(`Note ${w.code}: ${w.plain}`);
    }
    const mapping = opts.mapping ?? loadMapping(path.join(root, "dwh", "mapping.yaml"));
    const handle = await runConverted(pool, conv, mapping, { mode: parsed.csv ? "export" : "preview", params: parsed.params, ...(opts.signal ? { signal: opts.signal } : {}) });
    const names = handle.columns.map((c) => c.name);
    const cells = (r: unknown[]) => r.map((v, i) => formatCell(v, handle.columns[i]?.type ?? "unknown"));
    if (part) {
      fd = openSync(part, "w");
      writeSync(fd, csvHeaderBytes());
      writeSync(fd, csvLine(names));
      for await (const r of handle.rows) {
        writeSync(fd, csvLine(cells(r)));
        written++;
      }
    } else {
      log(names.join("\t"));
      for await (const r of handle.rows) {
        if (written < PREVIEW_PRINT_ROWS) log(cells(r).join("\t"));
        written++;
      }
    }
    const { ms } = await handle.done;
    if (part) finishCsv(handle.truncated() ? `INCOMPLETE: the row limit (${mapping.exportRowLimit}) was reached; the DWH has more rows.` : undefined);
    const more = handle.truncated() ? " (more available; the limit was reached)" : "";
    log(`${written} rows${more} in ${(ms / 1000).toFixed(1)} s${parsed.csv ? ` -> ${parsed.csv}` : written > PREVIEW_PRINT_ROWS ? ` (first ${PREVIEW_PRINT_ROWS} shown)` : ""}`);
    return 0;
  } catch (e) {
    const p = toPlain(e);
    try {
      finishCsv(`INCOMPLETE: the download stopped after ${written} rows. ${p.message}`);
    } catch {
      log(`The partial file ${part} could not be completed.`);
    }
    log(p.message);
    if (p.detail) log(`Details: ${p.detail}`);
    return 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
