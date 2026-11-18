// Task 2.1: the read-only runner. It runs converter output only: checks availability, result
// names and the read-only scan, caps the rows, wraps the Oracle text in one of the two fixed
// relay statements and streams the rows back (plan A.8).
import sql from "mssql";
import { ConvertError } from "./convert/errors.ts";
import type { ConvertResult } from "./convert/index.ts";
import type { SqlType } from "./convert/scope.ts";
import type { DwhMapping } from "./mapping.ts";
import { assertReadOnlyOracle } from "./safety.ts";
import { applyPreviewCap, buildRelayStatement } from "./relay.ts";
import { attachServerMessages, EXPORT_TIMEOUT_MS, PREVIEW_TIMEOUT_MS } from "./db.ts";

export const PREVIEW_ROWS = 500;

/** The part of an mssql request the runner uses (sql.Request satisfies it). */
export interface RelayRequest {
  stream: boolean;
  arrayRowMode: boolean;
  input(name: string, type: any, value: unknown): unknown;
  query(tsql: string, callback: (...args: any[]) => void): unknown;
  cancel(): unknown;
  pause(): unknown;
  resume(): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** The part of an mssql connection pool the runner uses (sql.ConnectionPool satisfies it). */
export interface RelayPool {
  request(conf?: { requestTimeout?: number }): RelayRequest;
}

export interface RunOptions {
  mode: "preview" | "export";
  params: Record<string, string>;
  signal?: AbortSignal;
}

export interface RunHandle {
  columns: { name: string; type: SqlType }[];
  rows: AsyncIterable<unknown[]>;
  truncated: () => boolean;
  done: Promise<{ rowCount: number; ms: number }>;
}

/** OPENQUERY refuses two result columns with the same name (Phase 0b, b7); it cannot be checked for * or unnamed formulas. */
export function checkOutputNames(conv: ConvertResult): void {
  const seen = new Set<string>();
  for (const o of conv.outputs) {
    if (o.name === "*") {
      throw new ConvertError("E_DUPLICATE_OUTPUT", "The query uses SELECT *, so its column names cannot be checked for duplicates, which the DWH link (OPENQUERY) refuses. List the columns instead.");
    }
    if (o.unnamed || !o.name) {
      throw new ConvertError("E_DUPLICATE_OUTPUT", `The result column ${o.name || "(formula)"} has no name, so it cannot be checked for duplicates, which the DWH link (OPENQUERY) refuses. Give it an approved z_ alias.`);
    }
    const k = o.name.toLowerCase();
    if (seen.has(k)) {
      throw new ConvertError("E_DUPLICATE_OUTPUT", `Two result columns are both called ${o.name}. The DWH link (OPENQUERY) refuses that; add approved z_ aliases, or ask for RPC Out to be enabled.`);
    }
    seen.add(k);
  }
}

function hasDuplicateNames(conv: ConvertResult): boolean {
  const names = conv.outputs.map((o) => o.name.toLowerCase());
  return names.includes("*") || new Set(names).size !== names.length;
}

const isCancel = (e: unknown) => (e as { code?: string })?.code === "ECANCEL";

export async function runConverted(pool: RelayPool, conv: ConvertResult, mapping: DwhMapping, opts: RunOptions): Promise<RunHandle> {
  if (conv.available === false) {
    throw new ConvertError("E_MISSING_IN_DWH", `This query is not available in the DWH: it needs ${conv.missing.join(", ")}, which the DWH does not have.`);
  }
  if (mapping.execMode === "openquery") checkOutputNames(conv);
  const known = new Set(conv.placeholders.map((p) => p.name));
  for (const name of Object.keys(opts.params)) {
    if (!known.has(name)) throw new ConvertError("E_UNKNOWN_PARAM", `The query has no placeholder <${name}>.`);
  }
  assertReadOnlyOracle(conv.exec);

  const limit = opts.mode === "preview" ? PREVIEW_ROWS : mapping.exportRowLimit;
  const capped = applyPreviewCap(conv.exec, mapping.oracleVersion, limit + 1, hasDuplicateNames(conv));
  assertReadOnlyOracle(capped);
  const params = conv.placeholders.map((p) => ({ name: p.name, value: opts.params[p.name] ?? "", maxLength: p.maxLength }));
  const { tsql, inputs } = buildRelayStatement(capped, mapping.execMode, params, mapping.linkedServer);
  if (opts.signal?.aborted) throw new ConvertError("E_STOPPED", "The query was stopped before it started.");

  const started = Date.now();
  const req = pool.request({ requestTimeout: opts.mode === "export" ? EXPORT_TIMEOUT_MS : PREVIEW_TIMEOUT_MS });
  req.stream = true;
  req.arrayRowMode = true;
  for (const i of inputs) req.input(i.name, sql.NVarChar(i.maxLength), i.value);

  const queue: unknown[][] = [];
  let emitted = 0;
  let truncated = false;
  let ended = false;
  let cancelledByUs = false;
  let paused = false;
  let failure: unknown;
  let waiter: (() => void) | undefined;
  const wake = () => {
    const w = waiter;
    waiter = undefined;
    w?.();
  };
  const stop = () => {
    if (ended || cancelledByUs) return;
    cancelledByUs = true;
    req.cancel();
  };

  let settle!: { resolve: (v: { rowCount: number; ms: number }) => void; reject: (e: unknown) => void };
  const done = new Promise<{ rowCount: number; ms: number }>((resolve, reject) => (settle = { resolve, reject }));
  done.catch(() => {}); // a caller that never awaits `done` must not crash the process

  let columnsReady!: (cols: { name: string; type: SqlType }[] | Error) => void;
  const columnsPromise = new Promise<{ name: string; type: SqlType }[] | Error>((res) => (columnsReady = res));
  const fromConverter = () => conv.outputs.map((o) => ({ name: o.name, type: o.type }));

  const onAbort = () => {
    if (ended) return;
    failure ??= new ConvertError("E_STOPPED", "The query was stopped.");
    queue.length = 0;
    stop();
    wake();
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  req.on("recordset", (cols: { name: string }[]) => {
    const list: { name: string }[] = Array.isArray(cols) ? cols : (Object.values(cols ?? {}) as { name: string }[]);
    columnsReady(list.map((c, i) => ({ name: c.name, type: conv.outputs.length === list.length ? conv.outputs[i]!.type : "unknown" })));
  });
  req.on("row", (r: unknown[]) => {
    if (cancelledByUs || failure) return;
    if (emitted >= limit) {
      truncated = true;
      stop();
      return;
    }
    emitted++;
    queue.push(r);
    if (queue.length >= 1000 && !paused) {
      paused = true;
      req.pause();
    }
    wake();
  });
  // The relay sends the Oracle text (ORA-…) as informational messages next to its own error.
  const serverMessages: unknown[] = [];
  req.on("info", (m: unknown) => {
    if (serverMessages.length < 50) serverMessages.push(m);
  });
  req.on("error", (e: unknown) => {
    // Once we stopped reading (row cap, reader stopped early, or Stop), later errors do not matter.
    if (cancelledByUs || isCancel(e)) return;
    if (failure !== undefined) {
      serverMessages.push(e);
      return;
    }
    failure = attachServerMessages(e, serverMessages);
    columnsReady(failure instanceof Error ? failure : new Error(String(failure)));
    wake();
  });
  req.on("done", () => {
    ended = true;
    opts.signal?.removeEventListener("abort", onAbort);
    columnsReady(fromConverter());
    if (failure) settle.reject(failure);
    else settle.resolve({ rowCount: emitted, ms: Date.now() - started });
    wake();
  });
  req.query(tsql, () => {});

  const cols = await columnsPromise;
  if (cols instanceof Error) {
    stop();
    throw cols;
  }

  async function* rows(): AsyncGenerator<unknown[]> {
    try {
      for (;;) {
        if (failure) throw failure;
        if (queue.length) {
          const r = queue.shift()!;
          if (paused && queue.length < 100) {
            paused = false;
            req.resume();
          }
          yield r;
          continue;
        }
        if (ended) return;
        await new Promise<void>((res) => (waiter = res));
      }
    } finally {
      if (!ended) stop(); // the reader stopped early
    }
  }

  return { columns: cols, rows: rows(), truncated: () => truncated, done };
}
