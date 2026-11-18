// Task 4.1: the DWH Runner's web server (plan A.8 #8, A.9). Plain node:http / node:https, no
// framework. The page sends a query path and placeholder values, never SQL: every request
// re-reads and re-converts the source, then runs it through the QueryEngine (read-only).
//
// Unshared (default): 127.0.0.1 only, per-launch token. Shared: HTTPS on every address, access
// code -> session cookie, lockout after five wrong codes, optional allowCidrs, Host check.
// Run directly (`node --env-file-if-exists=.env src/dwh/server.ts`) it starts the page and opens
// the browser; see main() at the end.
import * as http from "node:http";
import * as https from "node:https";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { ConvertError } from "./convert/errors.ts";
import type { ConvertResult } from "./convert/index.ts";
import { convertContext, convertSourceWith, dwhConvert, listSources } from "./sources.ts";
import { checkOutputNames, type RunHandle } from "./run.ts";
import { SAFE_VALUE } from "./relay.ts";
import { csvHeaderBytes, csvLine, formatCell } from "./format.ts";
import { toPlain } from "./errorsPlain.ts";
import { diffSchema } from "./schemaDiff.ts";
import { catalogueJson } from "./catalogue.ts";
import { judgeComparison, readTableBuffer, sha256Text } from "./compare.ts";
import { defaultAt, parseAt, pinPg } from "./verifyPack.ts";
import type { Table } from "../stitch/stitch.ts";
import { addressAllowed, isHostAddress, loadShareConfig, plainIp, shareProblems, ShareNotReady, verifyCode, type ShareConfig } from "./share.ts";
import { dwhEngine, fakeEngine, fakeOptionsFromEnv, type QueryEngine } from "./engine.ts";

export const APP = "amos-dwh-runner";
export const FIRST_PORT = 4870;
export const LAST_PORT = 4880;
/** Queries running at once, for everyone together (plan A.8 #8 "Fair use"). */
export const MAX_RUNNING = 4;
export const MAX_UPLOAD = 200 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;
const SESSION_MS = 12 * 3600_000;
const LOCK_MS = 15 * 60_000;
const MAX_WRONG = 5;
const COOKIE = "dwh_runner_session";
const CSP = "default-src 'self'";
export const BUSY = "The DWH runner is busy, try again in a minute.";

const UI_DIR = path.join(import.meta.dirname, "ui");
const STATIC: Record<string, { file: string; type: string }> = {
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/login.js": { file: "login.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};

export interface ServerOptions {
  root: string;
  share: ShareConfig;
  engine: QueryEngine;
  /** 0 = any free port (tests); default: the first free one of 4870-4880. */
  port?: number;
  // Additions to the plan's interface (ledgered):
  /** Overrides the bind address (tests use 127.0.0.1 in shared mode: no firewall prompt). */
  bindAddress?: string;
  /** Default <root>/logs/runner.log. */
  logFile?: string;
  /** The .env values to keep out of every response and log line (default process.env). */
  env?: NodeJS.ProcessEnv;
  /** Clock for the lockout (tests). */
  now?: () => number;
  onQuit?: () => void;
}

export interface RunningServer {
  /** Address for the host PC itself (127.0.0.1). */
  url: string;
  /** Address colleagues use (shared mode), else the same as url. */
  shareUrl: string;
  address: string;
  port: number;
  close(): Promise<void>;
}

export function bindAddressFor(share: ShareConfig): string {
  return share.share ? "0.0.0.0" : "127.0.0.1";
}

class HttpError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    if (detail) this.detail = detail;
  }
}

const version = (): string => {
  try {
    return String(JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "package.json"), "utf8")).version);
  } catch {
    return "unknown";
  }
};

function securityHeaders(res: http.ServerResponse) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) return reject(new HttpError(413, `The upload is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `The upload is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw new HttpError(415, "The page must send JSON.");
  const buf = await readBody(req, MAX_JSON);
  try {
    const v = buf.length ? JSON.parse(buf.toString("utf8")) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "The request could not be read.");
  }
}

function cookies(req: http.IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
}

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Trims every value (pasted from Excel) and refuses anything that is not text. */
function trimParams(v: unknown): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "The placeholder values could not be read.");
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string") throw new HttpError(400, `The value for <${k}> must be text.`);
    out[k] = val.trim();
  }
  return out;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { root, share, engine } = opts;
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const logFile = opts.logFile ?? path.join(root, "logs", "runner.log");
  if (share.share) {
    const missing = shareProblems(share);
    if (missing.length) throw new ShareNotReady(missing);
  }
  const token = randomBytes(32).toString("hex");
  const sessions = new Map<string, { expires: number }>();
  const wrongCodes = new Map<string, { count: number; lockedUntil: number }>();
  const running = new Map<string, AbortController>();
  let port = 0;

  const plain = (e: unknown) => toPlain(e, env);
  const log = (entry: Record<string, unknown>) => {
    try {
      mkdirSync(path.dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
    } catch {
      // the audit log must never stop a query
    }
  };

  const hostAllowed = (hostHeader: string | undefined) => {
    const h = String(hostHeader ?? "").toLowerCase();
    const names = ["127.0.0.1", "localhost", "[::1]", ...(share.share ? share.hostNames : [])].map((n) => `${n.toLowerCase()}:${port}`);
    return names.includes(h);
  };

  /** Who is asking: "host" or a session; throws 403 when the request is not from the page. */
  const visitorOf = (req: http.IncomingMessage, ip: string): string => {
    const t = String(req.headers["x-runner-token"] ?? "");
    if (!t || !sameSecret(t, token)) throw new HttpError(403, "This request did not come from the DWH Runner page. Reload the page.");
    if (!share.share || isHostAddress(ip)) return "host";
    const sid = cookies(req).get(COOKIE);
    const s = sid ? sessions.get(sid) : undefined;
    if (!sid || !s || s.expires < now()) throw new HttpError(403, "Your session has ended. Reload the page and enter the access code.");
    return `session:${sid}`;
  };

  const hasSession = (req: http.IncomingMessage, ip: string) => {
    if (!share.share || isHostAddress(ip)) return true;
    const sid = cookies(req).get(COOKIE);
    const s = sid ? sessions.get(sid) : undefined;
    return !!s && s.expires >= now();
  };

  const checkPath = (p: unknown): string => {
    const src = typeof p === "string" ? p.replace(/\\/g, "/") : "";
    if (!src || !listSources(root).includes(src)) throw new HttpError(400, `${typeof p === "string" && p.length < 200 ? p : "That"} is not one of the queries.`);
    return src;
  };

  const convertNow = (src: string, pinNow?: string) => convertSourceWith(convertContext(root), root, src, pinNow);

  /** The runner's checks before anything is sent (availability, OPENQUERY names). */
  const gate = (conv: ConvertResult) => {
    if (conv.available === false)
      throw new ConvertError("E_MISSING_IN_DWH", `This query is not available in the DWH: it needs ${conv.missing.join(", ")}, which the DWH does not have.`);
    if (convertContext(root).mapping.execMode === "openquery") checkOutputNames(conv);
  };

  const acquire = (visitor: string): AbortController => {
    if (running.has(visitor)) throw new HttpError(429, `${BUSY} (You already have a query running: wait for it, or press Stop.)`);
    if (running.size >= MAX_RUNNING) throw new HttpError(429, BUSY);
    const ac = new AbortController();
    running.set(visitor, ac);
    return ac;
  };
  const release = (visitor: string, ac: AbortController) => {
    if (running.get(visitor) === ac) running.delete(visitor);
  };

  const statusOf = (e: unknown): number => {
    if (e instanceof HttpError) return e.status;
    if (e instanceof ConvertError) {
      if (e.code === "E_MISSING_IN_DWH" || e.code === "E_STOPPED") return 409;
      if (e.code === "E_UNSAFE_PARAM_VALUE" || e.code === "E_PARAM_MISSING" || e.code === "E_UNKNOWN_PARAM") return 400;
      return 422;
    }
    return 502;
  };
  const errorBody = (e: unknown) => {
    if (e instanceof HttpError) return { error: scrubText(e.message) };
    const p = plain(e);
    return { error: p.message, ...(p.detail ? { detail: p.detail } : {}), ...(e instanceof ConvertError ? { code: e.code } : {}) };
  };
  const scrubText = (s: string) => {
    let out = s;
    for (const name of ["DWH_PASSWORD", "DWH_USER", "DWH_SERVER"]) {
      const v = env[name];
      if (v && v.length >= 2) out = out.split(v).join(`<${name}>`);
    }
    return out;
  };

  const describe = (src: string) => {
    try {
      const { conv } = convertNow(src);
      if (conv.available === false) return { path: src, state: "unavailable", missing: conv.missing, reason: `Needs what the DWH doesn't have: ${conv.missing.join(", ")}` };
      try {
        gate(conv);
      } catch (e) {
        return { path: src, state: "refused", reason: plain(e).message };
      }
      return { path: src, state: conv.warnings.length ? "notes" : "ready", ...(conv.warnings.length ? { reason: conv.warnings.map((w) => w.plain).join(" ") } : {}) };
    } catch (e) {
      return { path: src, state: "refused", reason: plain(e).message };
    }
  };

  const freshness = async () => {
    try {
      return { freshness: (await engine.freshness()) ?? null };
    } catch (e) {
      return { freshness: null, freshnessError: plain(e).message };
    }
  };

  const collect = async (handle: RunHandle) => {
    const rows: string[][] = [];
    for await (const r of handle.rows) rows.push(r.map((v, i) => formatCell(v, handle.columns[i]?.type ?? "unknown")));
    const { ms } = await handle.done;
    return { rows, ms };
  };

  // ---- routes ----------------------------------------------------------------------------

  const api: Record<string, (req: http.IncomingMessage, res: http.ServerResponse, ip: string, visitor: string) => Promise<void>> = {
    "GET /api/sources": async (_req, res, ip) => {
      sendJson(res, 200, { sources: listSources(root).map(describe), host: isHostAddress(ip), engine: engine.kind, share: share.share });
    },

    "GET /api/status": async (_req, res, ip) => {
      const cat = convertContext(root).catalogue;
      sendJson(res, 200, { engine: engine.kind, host: isHostAddress(ip), share: share.share, catalogueTakenAt: cat?.takenAt ?? null, ...(await freshness()) });
    },

    "POST /api/convert": async (req, res) => {
      const body = await readJson(req);
      const src = checkPath(body.path);
      const ctx = convertContext(root);
      let text: string;
      let conv: ConvertResult;
      try {
        ({ text, conv } = convertNow(src));
      } catch (e) {
        if (!(e instanceof ConvertError)) throw e;
        const pg = readFileSync(path.join(root, src), "utf8").replace(/\r\n?/g, "\n");
        sendJson(res, 200, { path: src, state: "refused", pg, refused: { code: e.code, message: e.plain, ...(e.loc ? { line: e.loc.line } : {}) } });
        return;
      }
      const d = describe(src);
      // diffSchema also covers every table in schema/*.yaml; keep only this query's tables and columns.
      const usedCols = new Set(conv.usedColumns.map((u) => u.toUpperCase()));
      const usedTables = new Set([...usedCols].map((u) => u.split(".")[0]));
      const issues = (ctx.catalogue ? diffSchema(ctx.catalogue, ctx.csv, ctx.model, conv.usedColumns, ctx.mapping) : [])
        .filter((i) => usedTables.has(i.table) && (i.column === undefined ? i.kind === "missing_table" : usedCols.has(`${i.table}.${i.column}`)))
        .map((i) => (i.column ? { ...i, plain: `${i.table}.${i.column}: ${i.plain}` } : i));
      sendJson(res, 200, {
        path: src,
        state: d.state,
        ...(d.state === "refused" ? { refused: { message: d.reason } } : {}),
        pg: text,
        oracle: conv.pretty,
        warnings: conv.warnings,
        placeholders: conv.placeholders,
        available: conv.available,
        missing: conv.missing,
        schemaIssues: issues,
        columnsChecked: new Set(conv.usedColumns).size,
        catalogueTakenAt: ctx.catalogue?.takenAt ?? null,
        outputs: conv.outputs,
      });
    },

    "POST /api/run": async (req, res, ip, visitor) => {
      const body = await readJson(req);
      const src = checkPath(body.path);
      const params = trimParams(body.params);
      const started = Date.now();
      const { conv } = convertNow(src);
      gate(conv);
      const ac = acquire(visitor);
      try {
        const handle = await engine.run(conv, { mode: "preview", params, signal: ac.signal });
        const { rows, ms } = await collect(handle);
        log({ ip, action: "run", path: src, params, rows: rows.length, ms, result: "ok" });
        sendJson(res, 200, { columns: handle.columns, rows, truncated: handle.truncated(), rowCount: rows.length, ms, params, warnings: conv.warnings });
      } catch (e) {
        log({ ip, action: "run", path: src, params, rows: 0, ms: Date.now() - started, result: "error", message: plain(e).message });
        throw e;
      } finally {
        release(visitor, ac);
      }
    },

    "POST /api/export": async (req, res, ip, visitor) => {
      const body = await readJson(req);
      const src = checkPath(body.path);
      const params = trimParams(body.params);
      const started = Date.now();
      const { conv } = convertNow(src);
      gate(conv);
      const ac = acquire(visitor);
      let written = 0;
      res.on("close", () => {
        if (!res.writableFinished) ac.abort(); // the browser went away: stop the query
      });
      try {
        const handle = await engine.run(conv, { mode: "export", params, signal: ac.signal });
        const name = `${path.basename(src, ".sql")}_DWH_${stamp(new Date())}.csv`;
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` });
        const gone = () => new ConvertError("E_STOPPED", "The download was cancelled, or the connection to the browser was lost.");
        /** Writes one piece; waits for the browser to keep up, but gives up when it goes away or Stop is pressed. */
        const write = (s: string | Buffer) =>
          new Promise<void>((resolve, reject) => {
            if (res.destroyed || ac.signal.aborted) return reject(gone());
            if (res.write(s)) return resolve();
            const cleanup = () => {
              res.off("drain", onDrain);
              res.off("close", onGone);
              ac.signal.removeEventListener("abort", onGone);
            };
            const onDrain = () => (cleanup(), resolve());
            const onGone = () => (cleanup(), reject(gone()));
            res.once("drain", onDrain);
            res.once("close", onGone);
            ac.signal.addEventListener("abort", onGone, { once: true });
          });
        try {
          await write(csvHeaderBytes());
          await write(csvLine(handle.columns.map((c) => c.name)));
          for await (const r of handle.rows) {
            await write(csvLine(r.map((v, i) => formatCell(v, handle.columns[i]?.type ?? "unknown"))));
            written++;
          }
          const { ms } = await handle.done;
          if (handle.truncated()) {
            const limit = convertContext(root).mapping.exportRowLimit;
            res.write(csvLine([`INCOMPLETE: the row limit (${limit}) was reached; the DWH has more rows.`]));
          }
          res.end();
          log({ ip, action: "export", path: src, params, rows: written, ms, result: handle.truncated() ? "row limit" : "ok" });
        } catch (e) {
          // Headers are sent: the file must not look complete. Last line says so, then the
          // connection is cut so the browser reports a failed download.
          const p = plain(e);
          log({ ip, action: "export", path: src, params, rows: written, ms: Date.now() - started, result: "incomplete", message: p.message });
          if (!res.destroyed) res.write(csvLine([`INCOMPLETE: the download stopped after ${written} rows. ${p.message}`]), () => res.destroy());
        }
      } catch (e) {
        if (!res.headersSent) log({ ip, action: "export", path: src, params, rows: 0, ms: Date.now() - started, result: "error", message: plain(e).message });
        throw e;
      } finally {
        release(visitor, ac);
      }
    },

    "POST /api/stop": async (req, res, _ip, visitor) => {
      await readJson(req);
      const ac = running.get(visitor);
      ac?.abort();
      sendJson(res, 200, { stopped: ac !== undefined });
    },

    "POST /api/verify-pack": async (req, res) => {
      const body = await readJson(req);
      const src = checkPath(body.path);
      const params = trimParams(body.params);
      let at: string;
      try {
        at = typeof body.at === "string" && body.at.trim() ? parseAt(body.at.trim()) : defaultAt();
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
      const { text, conv } = convertNow(src, at);
      gate(conv);
      if (convertContext(root).mapping.execMode === "openquery") {
        for (const [k, v] of Object.entries(params))
          if (v && !SAFE_VALUE.test(v)) throw new ConvertError("E_UNSAFE_PARAM_VALUE", `The value for <${k}> may only contain letters A-Z, digits, spaces and . _ / - (it was "${v}").`);
      }
      const amosSql = pinPg(text, at, params);
      sendJson(res, 200, { at, amosSql, pack: { source: src, sourceSha256: sha256Text(text), at, params }, warnings: conv.warnings });
    },

    "POST /api/compare": async (req, res, ip, visitor) => {
      if (!/^application\/octet-stream\b/i.test(String(req.headers["content-type"] ?? ""))) throw new HttpError(415, "The file must be sent as it is.");
      if (Number(req.headers["content-length"] ?? 0) > MAX_UPLOAD) {
        res.setHeader("Connection", "close");
        throw new HttpError(413, "The files are larger than 200 MB together. Export fewer rows from AMOS.");
      }
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(decodeURIComponent(String(req.headers["x-compare"] ?? ""))) as Record<string, unknown>;
      } catch {
        throw new HttpError(400, "The compare request could not be read.");
      }
      const src = checkPath(meta.path);
      const pack = meta.pack as { source?: string; sourceSha256?: string; at?: string; params?: Record<string, string> } | undefined;
      if (!pack || typeof pack.at !== "string" || typeof pack.sourceSha256 !== "string" || pack.source !== src)
        throw new HttpError(400, "Make the AMOS version first (step 1 of Compare): it freezes \"now\" so both sides answer the same question.");
      const buf = await readBody(req, MAX_UPLOAD);
      const amosBytes = Number(meta.amosBytes);
      const withinBytes = meta.withinBytes === undefined ? 0 : Number(meta.withinBytes);
      if (!Number.isInteger(amosBytes) || !Number.isInteger(withinBytes) || amosBytes + withinBytes !== buf.length) throw new HttpError(400, "The uploaded file did not arrive complete. Try again.");
      const amosName = typeof meta.amosName === "string" ? path.basename(meta.amosName) : "AMOS export";
      const withinName = typeof meta.withinName === "string" ? path.basename(meta.withinName) : "the list";
      const amosRows = meta.amosRows === undefined || meta.amosRows === null || meta.amosRows === "" ? undefined : Number(meta.amosRows);
      if (amosRows !== undefined && !(Number.isInteger(amosRows) && amosRows >= 0)) throw new HttpError(400, "The number of rows AMOS showed must be a whole number.");
      const keys = Array.isArray(meta.keys) ? meta.keys.map(String).filter(Boolean) : undefined;

      const now0 = readFileSync(path.join(root, src), "utf8");
      if (sha256Text(now0) !== pack.sourceSha256)
        throw new HttpError(409, `${src} changed after you made the AMOS version. Make the AMOS version again (step 1), run it in AMOS and export again.`);
      const params = trimParams(pack.params);
      const at = parseAt(pack.at);
      const { conv } = convertNow(src, at);
      gate(conv);
      let amos: Table;
      let within: Table | undefined;
      try {
        amos = readTableBuffer(buf.subarray(0, amosBytes), amosName);
        if (withinBytes) within = readTableBuffer(buf.subarray(amosBytes), withinName);
      } catch (e) {
        throw new HttpError(400, `The file could not be read as CSV or Excel: ${e instanceof Error ? e.message : String(e)}`);
      }
      const ac = acquire(visitor);
      const started = Date.now();
      try {
        const handle = await engine.run(conv, { mode: "export", params, signal: ac.signal });
        const { rows, ms } = await collect(handle);
        const limit = convertContext(root).mapping.exportRowLimit;
        const dwh: Table = { header: handle.columns.map((c) => c.name), rows: handle.truncated() ? [...rows, [`INCOMPLETE: the row limit (${limit}) was reached.`]] : rows };
        const result = judgeComparison({
          root,
          amos,
          amosLabel: amosName,
          dwh,
          dwhLabel: `DWH, read by the page at ${new Date().toISOString().slice(0, 19)}Z`,
          pack: { source: src, sourceSha256: pack.sourceSha256, at, params, orderKeys: conv.orderKeys, outputs: conv.outputs, warnings: conv.warnings },
          remakeHint: "Make the AMOS version again (step 1), run it in AMOS and export again.",
          ...(keys?.length ? { keys } : {}),
          ...(amosRows !== undefined ? { amosRowsShown: amosRows } : {}),
          ...(within ? { within: { table: within, label: withinName } } : {}),
        });
        log({ ip, action: "compare", path: src, params, at, rows: rows.length, amosRows: amos.rows.length, ms, result: result.pass ? "PASS" : "FAIL" });
        sendJson(res, 200, { pass: result.pass, report: result.text, dwhRows: rows.length, amosFileRows: amos.rows.length });
      } catch (e) {
        log({ ip, action: "compare", path: src, params, at, rows: 0, ms: Date.now() - started, result: "error", message: plain(e).message });
        throw e;
      } finally {
        release(visitor, ac);
      }
    },

    "POST /api/catalogue/refresh": async (req, res, ip, visitor) => {
      if (!isHostAddress(ip)) throw new HttpError(403, "Only the host PC can refresh the DWH catalogue.");
      await readJson(req);
      const ac = acquire(visitor);
      try {
        const cat = await engine.refreshCatalogue();
        writeFileSync(path.join(root, "dwh", "catalogue.json"), catalogueJson(cat), "utf8");
        const r = dwhConvert(root);
        const tables = new Set(cat.columns.map((c) => c.table)).size;
        log({ ip, action: "catalogue", rows: cat.columns.length, result: "ok" });
        sendJson(res, 200, { message: `Catalogue refreshed: ${cat.columns.length} columns in ${tables} tables (taken ${cat.takenAt}). ${r.written.length + r.removed.length} generated files updated.` });
      } catch (e) {
        log({ ip, action: "catalogue", result: "error", message: plain(e).message });
        throw e;
      } finally {
        release(visitor, ac);
      }
    },

    "POST /api/quit": async (req, res, ip) => {
      if (!isHostAddress(ip)) throw new HttpError(403, "Only the host PC can stop the DWH Runner.");
      await readJson(req);
      sendJson(res, 200, { message: "The DWH Runner has stopped. You can close this tab." });
      setImmediate(() => void close().then(() => opts.onQuit?.()));
    },
  };

  const pageHtml = () => readFileSync(path.join(UI_DIR, "index.html"), "utf8").replace(/__RUNNER_TOKEN__/g, token);

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    securityHeaders(res);
    const ip = plainIp(req.socket.remoteAddress);
    try {
      if (!addressAllowed(ip, share.allowCidrs)) throw new HttpError(403, "This PC is not allowed to use the DWH Runner.");
      if (!hostAllowed(req.headers.host)) throw new HttpError(403, "Open the DWH Runner with the address the host gave you.");
      const url = new URL(req.url ?? "/", "http://runner");
      const route = `${req.method} ${url.pathname}`;

      if (route === "GET /health") return sendJson(res, 200, { app: APP, version: version() });
      if (route === "GET /") {
        const html = hasSession(req, ip) ? pageHtml() : readFileSync(path.join(UI_DIR, "login.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return void res.end(html);
      }
      if (req.method === "GET" && STATIC[url.pathname]) {
        const s = STATIC[url.pathname]!;
        res.writeHead(200, { "Content-Type": s.type });
        return void res.end(readFileSync(path.join(UI_DIR, s.file)));
      }
      if (route === "POST /login") {
        if (!share.share) throw new HttpError(404, "Not found.");
        const w = wrongCodes.get(ip);
        if (w && w.lockedUntil > now()) throw new HttpError(429, "Too many wrong codes from this PC. Try again in 15 minutes.");
        const body = await readJson(req);
        if (!verifyCode(String(body.code ?? ""), share)) {
          const count = (w && w.lockedUntil <= now() && w.count >= MAX_WRONG ? 0 : (w?.count ?? 0)) + 1;
          wrongCodes.set(ip, { count, lockedUntil: count >= MAX_WRONG ? now() + LOCK_MS : 0 });
          log({ ip, action: "login", result: "wrong code" });
          throw new HttpError(401, count >= MAX_WRONG ? "Wrong access code. This PC is now locked out for 15 minutes." : "Wrong access code.");
        }
        wrongCodes.delete(ip);
        const sid = randomBytes(32).toString("hex");
        sessions.set(sid, { expires: now() + SESSION_MS });
        log({ ip, action: "login", result: "ok" });
        res.setHeader("Set-Cookie", `${COOKIE}=${sid}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
        return sendJson(res, 200, { ok: true });
      }
      const fn = api[route];
      if (!fn) throw new HttpError(404, "Not found.");
      const visitor = visitorOf(req, ip);
      await fn(req, res, ip, visitor);
    } catch (e) {
      if (res.headersSent) {
        if (!res.writableEnded) res.destroy();
        return;
      }
      sendJson(res, statusOf(e), errorBody(e));
      if (e instanceof HttpError && e.status === 413) req.destroy();
    }
  };

  let server: http.Server;
  if (share.share) {
    let pfx: Buffer;
    try {
      pfx = readFileSync(share.pfxPath!);
    } catch {
      throw new ShareNotReady(["a certificate (the PFX file in pfxPath)"]);
    }
    try {
      server = https.createServer({ pfx, ...(share.pfxPassphrase ? { passphrase: share.pfxPassphrase } : {}) }, (q, r) => void handle(q, r));
    } catch {
      throw new ShareNotReady(["a certificate that opens with its password (pfxPassphrase)"]);
    }
  } else {
    server = http.createServer((q, r) => void handle(q, r));
  }
  server.requestTimeout = 15 * 60_000;

  const bind = opts.bindAddress ?? bindAddressFor(share);
  const listen = (p: number) =>
    new Promise<void>((resolve, reject) => {
      const onError = (e: Error) => {
        server.off("listening", onListening);
        reject(e);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, bind);
    });
  if (opts.port !== undefined) await listen(opts.port);
  else {
    for (let p = FIRST_PORT; ; p++) {
      try {
        await listen(p);
        break;
      } catch (e) {
        if ((e as { code?: string }).code !== "EADDRINUSE" || p >= LAST_PORT) {
          if ((e as { code?: string }).code === "EADDRINUSE") throw new Error(`Ports ${FIRST_PORT}-${LAST_PORT} are all in use on this PC.`);
          throw e;
        }
      }
    }
  }
  const addr = server.address() as AddressInfo;
  port = addr.port;
  const proto = share.share ? "https" : "http";

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= new Promise<void>((resolve) => {
      for (const ac of running.values()) ac.abort();
      server.close(() => resolve());
      server.closeAllConnections();
    }).then(() => engine.close()));

  return {
    url: `${proto}://127.0.0.1:${port}/`,
    shareUrl: share.share ? `${proto}://${share.hostNames[0]}:${port}/` : `${proto}://127.0.0.1:${port}/`,
    address: addr.address,
    port,
    close,
  };
}

// ---- starting it on the host PC (plan A.9 "Starting it") -----------------------------------

/** Asks 127.0.0.1:<port>/health whether our server answers there. */
function probeHealth(port: number): Promise<string | undefined> {
  const one = (proto: "http" | "https") =>
    new Promise<string | undefined>((resolve) => {
      const lib = proto === "https" ? https : http;
      const req = lib.get({ host: "127.0.0.1", port, path: "/health", timeout: 700, rejectUnauthorized: false }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body).app === APP ? `${proto}://localhost:${port}/` : undefined);
          } catch {
            resolve(undefined);
          }
        });
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(undefined));
    });
  return one("http").then((u) => u ?? one("https"));
}

export async function findRunning(): Promise<string | undefined> {
  for (let p = FIRST_PORT; p <= LAST_PORT; p++) {
    const u = await probeHealth(p);
    if (u) return u;
  }
  return undefined;
}

/** Opens the default browser (Windows `start`). The URL is built here, never from input. */
export function openBrowser(url: string): void {
  if (!/^https?:\/\/[A-Za-z0-9.-]+:\d+\/$/.test(url)) return;
  spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function main(args: string[]): Promise<number> {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const share = loadShareConfig(path.join(root, "dwh", "local", "share.json"));
  if (args.includes("--launch-check")) {
    // Used by "Start DWH Runner.cmd": 0 = already running (browser opened), 3 = start it, 1 = problem.
    const running = await findRunning();
    if (running) {
      if (process.env.DWH_NO_BROWSER !== "1") openBrowser(running);
      console.log(`The DWH Runner is already running${process.env.DWH_NO_BROWSER === "1" ? ` (${running})` : "; it has been opened in your browser"}.`);
      return 0;
    }
    if (share.share) {
      const missing = shareProblems(share);
      if (missing.length) {
        console.log(new ShareNotReady(missing).message);
        return 1;
      }
    }
    return 3;
  }
  const running = await findRunning();
  if (running) {
    if (process.env.DWH_NO_BROWSER !== "1") openBrowser(running);
    console.log(`The DWH Runner is already running${process.env.DWH_NO_BROWSER === "1" ? ` (${running})` : "; it has been opened in your browser"}.`);
    return 0;
  }
  const fake = process.env.DWH_FAKE === "1";
  const engine = fake ? fakeEngine(root, fakeOptionsFromEnv(process.env)) : dwhEngine(root);
  const s = await startServer({ root, share, engine, onQuit: () => process.exit(0) });
  const local = s.url.replace("127.0.0.1", "localhost");
  console.log(`DWH Runner is running${fake ? " with FAKE data (DWH_FAKE=1, no DWH connection)" : ""}.`);
  console.log(`On this PC: ${local}`);
  if (share.share) console.log(`Colleagues open: ${s.shareUrl}  (they need the access code)`);
  console.log("Close this window to stop the DWH Runner.");
  if (process.env.DWH_NO_BROWSER !== "1") openBrowser(local);
  process.on("SIGINT", () => void s.close().then(() => process.exit(0)));
  return -1; // keep running
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code >= 0) process.exit(code);
    },
    async (e) => {
      console.log(e instanceof ShareNotReady ? e.message : toPlain(e).message);
      if (!(e instanceof ShareNotReady)) {
        const d = toPlain(e).detail;
        if (d) console.log(`Details: ${d}`);
      }
      console.log("Press Enter to close this window.");
      process.stdin.once("data", () => process.exit(1));
    },
  );
}

