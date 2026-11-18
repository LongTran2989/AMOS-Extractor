// Task 4.1: the QueryEngine the page's server talks to (plan A.9 "AMOS in the same screen": the
// interface keeps another engine possible later). Two engines:
// - dwhEngine: the real DWH through the relay (settings from .env, read-only, pool opened lazily);
// - fakeEngine (DWH_FAKE=1): no network, generated rows. Both run through runConverted, so the
//   same read-only checks, placeholder rules, row caps and Stop apply.
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { ConvertResult } from "./convert/index.ts";
import type { SqlType } from "./convert/scope.ts";
import { loadMapping, type DwhMapping } from "./mapping.ts";
import { fetchCatalogue, loadCatalogue, type Catalogue } from "./catalogue.ts";
import { runConverted, type RelayPool, type RelayRequest, type RunHandle, type RunOptions } from "./run.ts";
import { dwhConfigFromEnv, openPool, runRelay } from "./db.ts";
import { buildRelayStatement } from "./relay.ts";
import { assertReadOnlyOracle } from "./safety.ts";

export interface QueryEngine {
  readonly kind: "dwh" | "fake";
  run(conv: ConvertResult, opts: RunOptions): Promise<RunHandle>;
  /** When the DWH data was last changed (UTC, ISO), or undefined if it cannot be told. */
  freshness(): Promise<string | undefined>;
  /** A new catalogue snapshot (ALL_TAB_COLUMNS); the caller writes it. */
  refreshCatalogue(): Promise<Catalogue>;
  close(): Promise<void>;
}

/**
 * The one fixed freshness statement (plan A.7 #5): the latest WP_HEADER change, day and time.
 * MUTATION is days since 1971-12-31, MUTATION_TIME ms since midnight (UTC, dwh/mapping.yaml).
 */
export function freshnessOracle(mapping: DwhMapping): string {
  if (!/^[A-Z0-9_]+$/.test(mapping.oracleSchema)) throw new Error("The Oracle schema name in dwh/mapping.yaml may only contain A-Z, digits and _.");
  const t = `${mapping.oracleSchema}.WP_HEADER`;
  return (
    `SELECT WP_HEADER.MUTATION AS MUTATION_DAY, MAX(WP_HEADER.MUTATION_TIME) AS MUTATION_MS FROM ${t} ` +
    `WHERE WP_HEADER.MUTATION = (SELECT MAX(WP_HEADER.MUTATION) FROM ${t}) GROUP BY WP_HEADER.MUTATION`
  );
}

/** Day number + ms since midnight -> ISO UTC instant. */
export function freshnessInstant(day: unknown, ms: unknown): string | undefined {
  const d = Number(day);
  const m = Number(ms ?? 0);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return undefined;
  const t = Date.UTC(1971, 11, 31) + d * 86_400_000 + m;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const FRESHNESS_CACHE_MS = 5 * 60_000;

/** The real DWH. The pool is opened on first use, so a missing .env shows up as a plain message on Run. */
export function dwhEngine(root: string, env: NodeJS.ProcessEnv = process.env): QueryEngine {
  let pool: Promise<RelayPool & { close(): Promise<void> }> | undefined;
  const getPool = () => {
    pool ??= (async () => {
      const p = await openPool(dwhConfigFromEnv(env));
      // A broken idle connection must not crash the server (Phase 2 deferred minor).
      (p as unknown as EventEmitter).on?.("error", () => {});
      return p;
    })();
    pool.catch(() => (pool = undefined)); // try again next time (e.g. VPN back on)
    return pool;
  };
  const mapping = () => loadMapping(path.join(root, "dwh", "mapping.yaml"));
  let fresh: { at: number; value: string | undefined } | undefined;
  return {
    kind: "dwh",
    async run(conv, opts) {
      return runConverted(await getPool(), conv, mapping(), opts);
    },
    async freshness() {
      if (fresh && Date.now() - fresh.at < FRESHNESS_CACHE_MS) return fresh.value;
      const m = mapping();
      const oracle = freshnessOracle(m);
      assertReadOnlyOracle(oracle);
      const { tsql } = buildRelayStatement(oracle, "openquery", [], m.linkedServer);
      const { rows } = await runRelay(await getPool(), tsql);
      const value = rows[0] ? freshnessInstant(rows[0][0], rows[0][1]) : undefined;
      fresh = { at: Date.now(), value };
      return value;
    },
    async refreshCatalogue() {
      return fetchCatalogue(await getPool(), mapping());
    },
    async close() {
      const p = pool;
      pool = undefined;
      if (p) await (await p.catch(() => undefined))?.close();
    },
  };
}

const VIETNAMESE = ["BÌNH XỊT ĐI CAN VN512", "Kiểm tra hệ thống thủy lực", "Thay thế bánh xe", "A-check", "Lubricate main gear"];

/** A generated cell for the fake engine, as the relay would deliver it (numbers as float, dates as Date). */
function fakeValue(type: SqlType, row: number, col: number): unknown {
  if (row % 17 === 3 && col > 0) return null;
  switch (type) {
    case "int":
      return col === 0 ? 1_000_000 + row : (row * 7 + col) % 50;
    case "numeric":
    case "float":
      return Math.round(((row * 13 + col) % 1000) * 25) / 100;
    case "date":
      return new Date(Date.UTC(2026, 0, 1) + (row % 300) * 86_400_000);
    case "timestamp":
      return new Date(Date.UTC(2026, 0, 1, 6, 30) + row * 3_600_000);
    default:
      return `${VIETNAMESE[(row + col) % VIETNAMESE.length]} ${row}`;
  }
}

export interface FakeOptions {
  /** Rows in every result (default 1234: the preview shows "more available"). */
  rows?: number;
  /** Pause this long after every 500 rows (default 0), to try Stop. */
  delayMs?: number;
  /** Fail after this many rows (the network dropping mid-download). */
  failAfter?: number;
}

/** Reads the fake engine's settings from DWH_FAKE_ROWS / DWH_FAKE_DELAY_MS / DWH_FAKE_FAIL_AFTER. */
export function fakeOptionsFromEnv(env: NodeJS.ProcessEnv): FakeOptions {
  const n = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);
  const rows = n(env.DWH_FAKE_ROWS);
  const delayMs = n(env.DWH_FAKE_DELAY_MS);
  const failAfter = n(env.DWH_FAKE_FAIL_AFTER);
  return { ...(rows !== undefined ? { rows } : {}), ...(delayMs !== undefined ? { delayMs } : {}), ...(failAfter !== undefined ? { failAfter } : {}) };
}

class FakeRequest extends EventEmitter implements RelayRequest {
  stream = false;
  arrayRowMode = false;
  private cancelled = false;
  private conv: ConvertResult;
  private opts: FakeOptions;
  constructor(conv: ConvertResult, opts: FakeOptions) {
    super();
    this.conv = conv;
    this.opts = opts;
  }
  input() {
    return this;
  }
  cancel() {
    this.cancelled = true;
    return true;
  }
  pause() {
    return true;
  }
  resume() {
    return true;
  }
  query(_tsql: string) {
    setImmediate(() => void this.play());
    return this;
  }
  private async play() {
    const outs = this.conv.outputs;
    this.emit("recordset", outs.map((o, index) => ({ index, name: o.name })));
    const total = this.opts.rows ?? 1234;
    for (let r = 0; r < total && !this.cancelled; r++) {
      if (this.opts.failAfter !== undefined && r === this.opts.failAfter) {
        this.emit("error", Object.assign(new Error("Connection lost - read ECONNRESET"), { name: "RequestError", code: "ESOCKET" }));
        this.emit("done", {});
        return;
      }
      this.emit("row", outs.map((o, c) => fakeValue(o.type, r, c)));
      if (r % 500 === 499) await new Promise((res) => setTimeout(res, this.opts.delayMs ?? 0));
    }
    if (this.cancelled) this.emit("error", Object.assign(new Error("Canceled."), { code: "ECANCEL" }));
    this.emit("done", {});
  }
}

/** No network: generated rows typed like the query's result columns (Vietnamese text included). */
export function fakeEngine(root: string, opts: FakeOptions = {}): QueryEngine {
  const mapping = () => loadMapping(path.join(root, "dwh", "mapping.yaml"));
  return {
    kind: "fake",
    run(conv, runOpts) {
      const pool: RelayPool = { request: () => new FakeRequest(conv, opts) };
      return runConverted(pool, conv, mapping(), runOpts);
    },
    async freshness() {
      return new Date(Date.now() - 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    },
    async refreshCatalogue() {
      const cat = loadCatalogue(path.join(root, "dwh", "catalogue.json"));
      if (!cat) throw new Error("The fake engine has no catalogue to return (dwh/catalogue.json is missing).");
      return cat;
    },
    async close() {},
  };
}
