// Task 4.1 / 4.2: the runner's web server (random port, fake engine, throwaway repo copy).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as https from "node:https";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { startServer, bindAddressFor } from "../../src/dwh/server.ts";
import { hashCode, loadShareConfig, ShareNotReady, type ShareConfig } from "../../src/dwh/share.ts";
import { dwhEngine, fakeEngine, type FakeOptions, type QueryEngine } from "../../src/dwh/engine.ts";
import { ROOT } from "./helpers.ts";

const PFX = path.join(ROOT, "test", "dwh", "fixtures", "server-test.pfx");
const FAKE_ENV = { DWH_SERVER: "fake-relay-host", DWH_USER: "fake_reader", DWH_PASSWORD: "Fake-Pa55word-9x7" };
const CODE = "right-code-123";

let root: string;
let logDir: string;

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "dwh-srv-"));
  logDir = mkdtempSync(path.join(tmpdir(), "dwh-srv-log-"));
  cpSync(path.join(ROOT, "schema"), path.join(root, "schema"), { recursive: true });
  copyFileSync(path.join(ROOT, "Database-Description-AMOS-csv.csv"), path.join(root, "Database-Description-AMOS-csv.csv"));
  mkdirSync(path.join(root, "dwh"));
  for (const f of ["mapping.yaml", "catalogue.json"]) copyFileSync(path.join(ROOT, "dwh", f), path.join(root, "dwh", f));
  for (const f of ["extract_wp_item_counts.sql", "extract_all_parts.sql", "extract_work_order.sql", "probe_closed_dates.sql"]) copyFileSync(path.join(ROOT, f), path.join(root, f));
  writeFileSync(path.join(root, "q_param.sql"), "SELECT wp_header.wpno_i AS z_WP_ID, wp_header.wpno AS z_WP_NO FROM wp_header WHERE wp_header.wpno = '<WPNO>'\n");
  writeFileSync(path.join(root, "q_edit.sql"), "SELECT wp_header.wpno AS z_WP_NO FROM wp_header\n");
  writeFileSync(path.join(root, "q_cmp.sql"), "SELECT wp_header.wpno_i AS z_WP_ID, wp_header.wpno AS z_WP_NO FROM wp_header ORDER BY wp_header.wpno\n");
  writeFileSync(path.join(root, "dwh", "verify-keys.yaml"), "q_cmp.sql:\n  match_on: [z_WP_ID]\n  fixed_column: z_WP_ID\n  fixed_values: [1000000, 1000002]\n");
});
after(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  complete: boolean;
}
interface CallOpts {
  method?: string;
  json?: unknown;
  body?: Buffer;
  headers?: Record<string, string>;
  host?: string;
  from?: string;
  token?: string;
  cookie?: string;
}

/** One request to the test server; resolves even when the server cuts the response off. */
function call(base: string, p: string, o: CallOpts = {}): Promise<Reply> {
  const u = new URL(p, base);
  const lib = u.protocol === "https:" ? https : http;
  const body = o.json !== undefined ? Buffer.from(JSON.stringify(o.json)) : o.body;
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.json !== undefined) headers["content-type"] = "application/json";
  if (o.token) headers["x-runner-token"] = o.token;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.host) headers.host = o.host;
  if (body && headers["content-length"] === undefined) headers["content-length"] = String(body.length);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: o.method ?? (body ? "POST" : "GET"), headers, rejectUnauthorized: false, ...(o.from ? { localAddress: o.from } : {}) },
      (res) => {
        const chunks: Buffer[] = [];
        let done = false;
        const finish = (complete: boolean) => {
          if (done) return;
          done = true;
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), complete });
        };
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => finish(res.complete));
        res.on("aborted", () => finish(false));
        res.on("error", () => finish(false));
        res.on("close", () => finish(res.complete));
      },
    );
    req.on("error", reject);
    if (body && !o.headers?.["x-no-body"]) req.end(body);
    else req.end();
  });
}

/** Starts reading a long response; resolves once the first bytes arrived. */
function openStream(base: string, p: string, o: CallOpts): Promise<{ first: string; rest: Promise<Reply> }> {
  const u = new URL(p, base);
  const lib = u.protocol === "https:" ? https : http;
  const body = Buffer.from(JSON.stringify(o.json));
  const headers: Record<string, string> = { "content-type": "application/json", "content-length": String(body.length), "x-runner-token": o.token! };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.host) headers.host = o.host;
  return new Promise((resolveFirst, reject) => {
    const req = lib.request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers, rejectUnauthorized: false, ...(o.from ? { localAddress: o.from } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      let first = true;
      let finish!: (r: Reply) => void;
      const rest = new Promise<Reply>((r) => (finish = r));
      let done = false;
      const end = (complete: boolean) => {
        if (done) return;
        done = true;
        finish({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), complete });
      };
      res.on("data", (c: Buffer) => {
        chunks.push(c);
        if (first) {
          first = false;
          resolveFirst({ first: c.toString("utf8"), rest });
        }
      });
      res.on("end", () => end(res.complete));
      res.on("aborted", () => end(false));
      res.on("error", () => end(false));
      res.on("close", () => end(res.complete));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const tokenOf = (html: string) => /<meta name="runner-token" content="([0-9a-f]{64})">/.exec(html)?.[1];
const lastLine = (csv: string) => csv.trimEnd().split("\r\n").pop() ?? "";

async function unshared(engine?: QueryEngine, extra: { logFile?: string } = {}) {
  const s = await startServer({
    root,
    share: { share: false, hostNames: [], allowCidrs: [] },
    engine: engine ?? fakeEngine(root, { rows: 1234 }),
    port: 0,
    env: FAKE_ENV,
    logFile: extra.logFile ?? path.join(logDir, "runner.log"),
  });
  const page = await call(s.url, "/");
  const token = tokenOf(page.body)!;
  return { s, token, page };
}

function shareConfig(extra: Partial<ShareConfig> = {}): ShareConfig {
  const { hash, salt } = hashCode(CODE);
  return { share: true, hostNames: ["dwh-host.example"], allowCidrs: [], pfxPath: PFX, pfxPassphrase: "test-only", codeHash: hash, codeSalt: salt, ...extra };
}

async function shared(engine?: QueryEngine, extra: Partial<ShareConfig> = {}, now?: () => number) {
  const s = await startServer({
    root,
    share: shareConfig(extra),
    engine: engine ?? fakeEngine(root, { rows: 1234 }),
    port: 0,
    env: FAKE_ENV,
    logFile: path.join(logDir, "runner.log"),
    bindAddress: "127.0.0.1",
    ...(now ? { now } : {}),
  });
  const port = new URL(s.url).port;
  const host = `dwh-host.example:${port}`;
  /** Logs in as a colleague from `from`; returns the cookie and the page token. */
  const login = async (from = "127.0.0.2") => {
    const r = await call(s.url, "/login", { json: { code: CODE }, host, from });
    assert.equal(r.status, 200, r.body);
    const cookie = String(r.headers["set-cookie"]?.[0] ?? "").split(";")[0]!;
    const page = await call(s.url, "/", { host, from, cookie });
    return { cookie, token: tokenOf(page.body)!, from, host };
  };
  return { s, host, login };
}

test("unshared binds to 127.0.0.1 only", async () => {
  const { s } = await unshared();
  try {
    assert.equal(s.address, "127.0.0.1");
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(bindAddressFor({ share: false, hostNames: [], allowCidrs: [] }), "127.0.0.1");
    assert.equal(bindAddressFor(shareConfig()), "0.0.0.0");
  } finally {
    await s.close();
  }
});

test("shared without certificate or code refuses to start", async () => {
  for (const [extra, named] of [
    [{ pfxPath: undefined }, /certificate/],
    [{ pfxPath: path.join(root, "no-such.pfx") }, /certificate/],
    [{ codeHash: undefined }, /access code/],
    [{ hostNames: [] }, /host name/],
  ] as const) {
    await assert.rejects(
      startServer({ root, share: shareConfig(extra as Partial<ShareConfig>), engine: fakeEngine(root), port: 0, bindAddress: "127.0.0.1", logFile: path.join(logDir, "x.log") }),
      (e: unknown) => e instanceof ShareNotReady && named.test((e as Error).message),
    );
  }
});

test("loadShareConfig: a missing file means unshared", () => {
  assert.deepEqual(loadShareConfig(path.join(root, "dwh", "local", "share.json")), { share: false, hostNames: [], allowCidrs: [] });
});

test("shared serves HTTPS only (fixture PFX)", async () => {
  const { s, host } = await shared();
  try {
    assert.match(s.url, /^https:/);
    const ok = await call(s.url, "/health", { host });
    assert.equal(ok.status, 200);
    const plain = s.url.replace("https:", "http:");
    const r = await call(plain, "/health", { host }).catch((e: Error) => e);
    assert.ok(r instanceof Error || r.status !== 200, "plain HTTP must not be served");
  } finally {
    await s.close();
  }
});

test("wrong Host -> 403 (both modes)", async () => {
  const { s, token } = await unshared();
  try {
    assert.equal((await call(s.url, "/health", { host: "evil.example:80" })).status, 403);
    assert.equal((await call(s.url, "/api/sources", { token, host: "evil.example" })).status, 403);
    assert.equal((await call(s.url, "/health", { host: `localhost:${new URL(s.url).port}` })).status, 200);
  } finally {
    await s.close();
  }
  const sh = await shared();
  try {
    assert.equal((await call(sh.s.url, "/health", { host: "evil.example" })).status, 403);
    assert.equal((await call(sh.s.url, "/health", { host: sh.host })).status, 200);
  } finally {
    await sh.s.close();
  }
});

test("missing or wrong token -> 403", async () => {
  const { s, token } = await unshared();
  try {
    assert.equal((await call(s.url, "/api/sources")).status, 403);
    assert.equal((await call(s.url, "/api/sources", { token: "0".repeat(64) })).status, 403);
    assert.equal((await call(s.url, "/api/sources", { token })).status, 200);
  } finally {
    await s.close();
  }
});

test("shared: no session -> login page; wrong code -> 401; right code -> HttpOnly, Secure, SameSite=Strict cookie", async () => {
  const { s, host, login } = await shared();
  try {
    const page = await call(s.url, "/", { host, from: "127.0.0.2" });
    assert.equal(page.status, 200);
    assert.match(page.body, /access code/i);
    assert.equal(tokenOf(page.body), undefined, "the login page carries no token");
    const wrong = await call(s.url, "/login", { json: { code: "nope" }, host, from: "127.0.0.2" });
    assert.equal(wrong.status, 401);
    const right = await call(s.url, "/login", { json: { code: CODE }, host, from: "127.0.0.2" });
    assert.equal(right.status, 200);
    const cookie = String(right.headers["set-cookie"]?.[0] ?? "");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=43200/);
    const v = await login();
    assert.equal((await call(s.url, "/api/sources", { host, from: v.from, token: v.token })).status, 403, "token without session");
    assert.equal((await call(s.url, "/api/sources", { host, from: v.from, cookie: v.cookie })).status, 403, "session without token");
    assert.equal((await call(s.url, "/api/sources", { host, from: v.from, cookie: v.cookie, token: v.token })).status, 200);
  } finally {
    await s.close();
  }
});

test("five wrong codes lock the IP for 15 minutes", async () => {
  let clock = Date.UTC(2026, 10, 18, 8, 0);
  const { s, host } = await shared(undefined, {}, () => clock);
  try {
    for (let i = 0; i < 5; i++) assert.equal((await call(s.url, "/login", { json: { code: "bad" }, host, from: "127.0.0.4" })).status, 401);
    const locked = await call(s.url, "/login", { json: { code: CODE }, host, from: "127.0.0.4" });
    assert.equal(locked.status, 429);
    assert.match(locked.body, /15 minutes/);
    assert.equal((await call(s.url, "/login", { json: { code: CODE }, host, from: "127.0.0.5" })).status, 200, "another PC is not locked");
    clock += 14 * 60_000;
    assert.equal((await call(s.url, "/login", { json: { code: CODE }, host, from: "127.0.0.4" })).status, 429);
    clock += 61_000;
    assert.equal((await call(s.url, "/login", { json: { code: CODE }, host, from: "127.0.0.4" })).status, 200);
  } finally {
    await s.close();
  }
});

test("IP outside allowCidrs -> 403", async () => {
  const { s, host } = await shared(undefined, { allowCidrs: ["10.0.0.0/8", "127.0.0.3/32"] });
  try {
    assert.equal((await call(s.url, "/health", { host, from: "127.0.0.2" })).status, 403);
    assert.equal((await call(s.url, "/health", { host, from: "127.0.0.3" })).status, 200);
    assert.equal((await call(s.url, "/health", { host })).status, 200, "the host PC itself is always allowed");
  } finally {
    await s.close();
  }
});

test("quit and catalogue refresh from a non-loopback address -> 403", async () => {
  const { s, login } = await shared();
  try {
    const v = await login("127.0.0.2");
    for (const p of ["/api/quit", "/api/catalogue/refresh"]) {
      const r = await call(s.url, p, { json: {}, host: v.host, from: v.from, cookie: v.cookie, token: v.token });
      assert.equal(r.status, 403, p);
      assert.match(r.body, /host PC/);
    }
    const sources = JSON.parse((await call(s.url, "/api/sources", { host: v.host, from: v.from, cookie: v.cookie, token: v.token })).body);
    assert.equal(sources.host, false, "the page hides Quit and Refresh for colleagues");
  } finally {
    await s.close();
  }
});

test("second run by the same visitor -> 429 with the busy message", async () => {
  const opts: FakeOptions = { rows: 1_000_000, delayMs: 20 };
  const { s, token } = await unshared(fakeEngine(root, opts));
  try {
    const long = await openStream(s.url, "/api/export", { json: { path: "q_edit.sql", params: {} }, token });
    const second = await call(s.url, "/api/run", { json: { path: "q_edit.sql", params: {} }, token });
    assert.equal(second.status, 429);
    assert.match(JSON.parse(second.body).error, /busy/);
    const stop = await call(s.url, "/api/stop", { json: {}, token });
    assert.equal(stop.status, 200);
    const rest = await long.rest;
    assert.match(lastLine(rest.body), /^"INCOMPLETE: .*stopped/);
  } finally {
    await s.close();
  }
});

test("fifth concurrent run -> 429", async () => {
  const { s, login } = await shared(fakeEngine(root, { rows: 1_000_000, delayMs: 20 }));
  try {
    const visitors = [];
    for (const ip of ["127.0.0.2", "127.0.0.3", "127.0.0.4", "127.0.0.5", "127.0.0.6"]) visitors.push(await login(ip));
    const running = [];
    for (const v of visitors.slice(0, 4)) running.push(await openStream(s.url, "/api/export", { json: { path: "q_edit.sql", params: {} }, token: v.token, cookie: v.cookie, host: v.host, from: v.from }));
    const v5 = visitors[4]!;
    const fifth = await call(s.url, "/api/run", { json: { path: "q_edit.sql", params: {} }, token: v5.token, cookie: v5.cookie, host: v5.host, from: v5.from });
    assert.equal(fifth.status, 429);
    assert.match(JSON.parse(fifth.body).error, /The DWH runner is busy, try again in a minute/);
    for (const v of visitors.slice(0, 4)) await call(s.url, "/api/stop", { json: {}, token: v.token, cookie: v.cookie, host: v.host, from: v.from });
    for (const r of running) await r.rest;
  } finally {
    await s.close();
  }
});

test("path outside the source list -> 400", async () => {
  const { s, token } = await unshared();
  try {
    for (const p of ["../.env", "C:\\x.sql", ".env", "dwh/mapping.yaml", "queries/dwh/extract_wp_item_counts.sql"]) {
      for (const route of ["/api/convert", "/api/run", "/api/export"]) {
        const r = await call(s.url, route, { json: { path: p, params: {} }, token });
        assert.equal(r.status, 400, `${route} ${p}`);
        assert.match(JSON.parse(r.body).error, /not one of the queries/);
      }
    }
  } finally {
    await s.close();
  }
});

test("unavailable query -> plain \"not available\" message", async () => {
  const { s, token } = await unshared();
  try {
    const r = await call(s.url, "/api/run", { json: { path: "extract_all_parts.sql", params: {} }, token });
    assert.equal(r.status, 409);
    assert.match(JSON.parse(r.body).error, /not available in the DWH: it needs .*PART\.MANUAL_TARGET_STOCK/);
    const c = JSON.parse((await call(s.url, "/api/convert", { json: { path: "extract_all_parts.sql" }, token })).body);
    assert.equal(c.state, "unavailable");
    assert.ok(c.missing.length > 0);
  } finally {
    await s.close();
  }
});

test("the column check names only the query's own tables and columns", async () => {
  const { s, token } = await unshared();
  try {
    const c = JSON.parse((await call(s.url, "/api/convert", { json: { path: "extract_wp_item_counts.sql" }, token })).body);
    const used = new Set(["WP_HEADER.STATION", "WP_HEADER.WP_STATUS", "WP_HEADER.WPNO", "WP_HEADER.WPNO_I", "WP_ASSIGNMENT.WP_ASSIGNMENTNO_I", "WP_ASSIGNMENT.WPNO_I"]);
    assert.ok(c.schemaIssues.length > 0, "WP_HEADER.WPNO is a truncation risk");
    for (const i of c.schemaIssues) {
      assert.ok(i.column !== undefined && used.has(`${i.table}.${i.column}`), `unrelated issue: ${JSON.stringify(i)}`);
      assert.ok(i.plain.startsWith(`${i.table}.${i.column}: `), "the note names the column");
    }
  } finally {
    await s.close();
  }
});

test("sources list every query with its state", async () => {
  const { s, token } = await unshared();
  try {
    const r = JSON.parse((await call(s.url, "/api/sources", { token })).body);
    const state = Object.fromEntries(r.sources.map((x: { path: string; state: string }) => [x.path, x.state]));
    assert.equal(state["q_param.sql"], "ready");
    assert.equal(state["extract_wp_item_counts.sql"], "notes");
    assert.equal(state["extract_all_parts.sql"], "unavailable");
    assert.equal(state["extract_work_order.sql"], "refused");
    assert.equal(state["probe_closed_dates.sql"], "refused");
    assert.equal(r.host, true);
    assert.equal(r.engine, "fake");
  } finally {
    await s.close();
  }
});

test("server re-converts after the source changes on disk", async () => {
  const { s, token } = await unshared();
  try {
    const a = JSON.parse((await call(s.url, "/api/convert", { json: { path: "q_edit.sql" }, token })).body);
    assert.doesNotMatch(a.oracle, /STATION/);
    writeFileSync(path.join(root, "q_edit.sql"), "SELECT wp_header.wpno AS z_WP_NO, wp_header.station AS z_WP_STATION FROM wp_header\n");
    const b = JSON.parse((await call(s.url, "/api/convert", { json: { path: "q_edit.sql" }, token })).body);
    assert.match(b.oracle, /WP_HEADER\.STATION/);
    const run = JSON.parse((await call(s.url, "/api/run", { json: { path: "q_edit.sql", params: {} }, token })).body);
    assert.deepEqual(run.columns.map((c: { name: string }) => c.name), ["z_WP_NO", "z_WP_STATION"]);
  } finally {
    writeFileSync(path.join(root, "q_edit.sql"), "SELECT wp_header.wpno AS z_WP_NO FROM wp_header\n");
    await s.close();
  }
});

test("preview: 500 rows, more available, placeholder value trimmed and shown back; unsafe value refused", async () => {
  const { s, token } = await unshared();
  try {
    const r = await call(s.url, "/api/run", { json: { path: "q_param.sql", params: { WPNO: "A501-091026 \t" } }, token });
    assert.equal(r.status, 200, r.body);
    const j = JSON.parse(r.body);
    assert.equal(j.rows.length, 500);
    assert.equal(j.truncated, true);
    assert.deepEqual(j.params, { WPNO: "A501-091026" });
    assert.deepEqual(j.columns.map((c: { name: string }) => c.name), ["z_WP_ID", "z_WP_NO"]);
    assert.equal(j.rows[0][0], "1000000", "whole numbers without decimals");
    const bad = await call(s.url, "/api/run", { json: { path: "q_param.sql", params: { WPNO: "A'1" } }, token });
    assert.equal(bad.status, 400);
    assert.match(JSON.parse(bad.body).error, /may only contain/);
  } finally {
    await s.close();
  }
});

test("zero rows keep the column names", async () => {
  const { s, token } = await unshared(fakeEngine(root, { rows: 0 }));
  try {
    const j = JSON.parse((await call(s.url, "/api/run", { json: { path: "q_edit.sql", params: {} }, token })).body);
    assert.deepEqual(j.columns.map((c: { name: string }) => c.name), ["z_WP_NO"]);
    assert.deepEqual(j.rows, []);
    const csv = await call(s.url, "/api/export", { json: { path: "q_edit.sql", params: {} }, token });
    assert.equal(csv.body, '\uFEFF"z_WP_NO"\r\n');
  } finally {
    await s.close();
  }
});

test("export: UTF-8 with BOM, CRLF, file name, Vietnamese intact", async () => {
  const { s, token } = await unshared(fakeEngine(root, { rows: 7 }));
  try {
    const r = await call(s.url, "/api/export", { json: { path: "q_param.sql", params: { WPNO: "X" } }, token });
    assert.equal(r.status, 200);
    assert.equal(r.complete, true);
    assert.match(String(r.headers["content-disposition"]), /attachment; filename="q_param_DWH_\d{8}-\d{4}\.csv"/);
    assert.ok(r.body.startsWith('\uFEFF"z_WP_ID","z_WP_NO"\r\n'));
    assert.match(r.body, /BÌNH XỊT ĐI CAN VN512/);
    assert.equal(r.body.trimEnd().split("\r\n").length, 8);
  } finally {
    await s.close();
  }
});

test("aborted export marks the file incomplete", async () => {
  const { s, token } = await unshared(fakeEngine(root, { rows: 100, failAfter: 30 }));
  try {
    const r = await call(s.url, "/api/export", { json: { path: "q_edit.sql", params: {} }, token });
    assert.equal(r.status, 200);
    assert.equal(r.complete, false, "the download must end with an error, not look complete");
    assert.match(lastLine(r.body), /^"INCOMPLETE: the download stopped after \d+ rows\./);
  } finally {
    await s.close();
  }
});

test("review: a download the browser drops frees the visitor's slot", async () => {
  const logFile = path.join(logDir, "drop.log");
  const { s, token } = await unshared(fakeEngine(root, { rows: 300_000 }), { logFile });
  try {
    // Ask for a big export, never read it, then drop the connection (tab closed, Save-as cancelled).
    await new Promise<void>((resolve) => {
      const body = JSON.stringify({ path: "q_edit.sql", params: {} });
      const u = new URL(s.url);
      const req = http.request({ host: u.hostname, port: u.port, path: "/api/export", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-runner-token": token } }, (res) => {
        res.pause();
        setTimeout(() => {
          req.destroy();
          resolve();
        }, 300);
      });
      req.on("error", () => {});
      req.end(body);
    });
    let status = 0;
    for (let i = 0; i < 40 && status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = (await call(s.url, "/api/run", { json: { path: "q_edit.sql", params: {} }, token })).status;
    }
    assert.equal(status, 200, "the next run must not be refused as busy");
    assert.match(readFileSync(logFile, "utf8"), /"action":"export".*"result":"incomplete"/);
  } finally {
    await s.close();
  }
});

test("review: selecting a query does not wait for the freshness read", async () => {
  const slow: QueryEngine = { ...fakeEngine(root), freshness: () => new Promise(() => {}) };
  const { s, token } = await unshared(slow);
  try {
    const t0 = Date.now();
    const r = await call(s.url, "/api/convert", { json: { path: "q_edit.sql" }, token });
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  } finally {
    await s.close();
  }
});

test("review: the real engine sends no freshness query unless DWH_FRESHNESS=1", async () => {
  // No DWH settings at all: without the switch nothing is attempted; with it, the settings are needed.
  assert.equal(await dwhEngine(root, {}).freshness(), undefined);
  await assert.rejects(dwhEngine(root, { DWH_FRESHNESS: "1" }).freshness(), /DWH_SERVER/);
});

test("no response contains the fake DWH_PASSWORD", async () => {
  const leaky: QueryEngine = {
    kind: "dwh",
    run: async () => {
      throw Object.assign(new Error(`Login failed for user '${FAKE_ENV.DWH_USER}' on ${FAKE_ENV.DWH_SERVER} with ${FAKE_ENV.DWH_PASSWORD}`), { name: "ConnectionError", code: "ELOGIN" });
    },
    freshness: async () => {
      throw new Error(`cannot reach ${FAKE_ENV.DWH_SERVER} ${FAKE_ENV.DWH_PASSWORD}`);
    },
    refreshCatalogue: async () => {
      throw new Error(FAKE_ENV.DWH_PASSWORD);
    },
    close: async () => {},
  };
  const logFile = path.join(logDir, "leak.log");
  const { s, token, page } = await unshared(leaky, { logFile });
  try {
    const bodies = [page.body];
    bodies.push((await call(s.url, "/health")).body);
    bodies.push((await call(s.url, "/api/sources", { token })).body);
    bodies.push((await call(s.url, "/api/status", { token })).body);
    bodies.push((await call(s.url, "/api/convert", { json: { path: "q_edit.sql" }, token })).body);
    const run = await call(s.url, "/api/run", { json: { path: "q_edit.sql", params: {} }, token });
    bodies.push(run.body);
    bodies.push((await call(s.url, "/api/export", { json: { path: "q_edit.sql", params: {} }, token })).body);
    bodies.push((await call(s.url, "/api/catalogue/refresh", { json: {}, token })).body);
    assert.match(JSON.parse(run.body).error, /did not accept the username or password/);
    for (const b of bodies) {
      for (const v of Object.values(FAKE_ENV)) assert.ok(!b.includes(v), `a response contains ${v}`);
    }
    const log = readFileSync(logFile, "utf8");
    for (const v of Object.values(FAKE_ENV)) assert.ok(!log.includes(v), `the log contains ${v}`);
  } finally {
    await s.close();
  }
});

test("log line has time, IP, path, params, row count", async () => {
  const logFile = path.join(logDir, "audit.log");
  const { s, token } = await unshared(undefined, { logFile });
  try {
    await call(s.url, "/api/run", { json: { path: "q_param.sql", params: { WPNO: " A-1 " } }, token });
    const line = JSON.parse(readFileSync(logFile, "utf8").trim().split("\n").pop()!);
    assert.match(line.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.equal(line.ip, "127.0.0.1");
    assert.equal(line.action, "run");
    assert.equal(line.path, "q_param.sql");
    assert.deepEqual(line.params, { WPNO: "A-1" });
    assert.equal(line.rows, 500);
    assert.equal(typeof line.ms, "number");
  } finally {
    await s.close();
  }
});

test("/health signature", async () => {
  const { s } = await unshared();
  try {
    const r = await call(s.url, "/health");
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.deepEqual(JSON.parse(r.body), { app: "amos-dwh-runner", version: pkg.version });
  } finally {
    await s.close();
  }
});

test("/ serves the page with token and CSP", async () => {
  const { s, token, page } = await unshared();
  try {
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-type"]), /text\/html/);
    assert.equal(page.headers["content-security-policy"], "default-src 'self'");
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.match(page.body, /<script src="app\.js"/);
    for (const asset of ["/app.js", "/style.css"]) {
      const r = await call(s.url, asset);
      assert.equal(r.status, 200, asset);
      assert.equal(r.headers["content-security-policy"], "default-src 'self'");
    }
    assert.equal(page.headers["access-control-allow-origin"], undefined, "no CORS headers");
  } finally {
    await s.close();
  }
});

test("POST bodies must be JSON", async () => {
  const { s, token } = await unshared();
  try {
    const r = await call(s.url, "/api/run", { body: Buffer.from("path=q_edit.sql"), headers: { "content-type": "application/x-www-form-urlencoded" }, token });
    assert.equal(r.status, 415);
  } finally {
    await s.close();
  }
});

/** Uploads an AMOS file (and optionally a --within list) to /api/compare. */
function compareCall(base: string, token: string, opts: object, amos: Buffer, within?: Buffer) {
  const meta = { ...opts, amosName: "amos.csv", amosBytes: amos.length, ...(within ? { withinName: "unchanged.csv", withinBytes: within.length } : {}) };
  return call(base, "/api/compare", {
    method: "POST",
    body: within ? Buffer.concat([amos, within]) : amos,
    headers: { "content-type": "application/octet-stream", "x-compare": encodeURIComponent(JSON.stringify(meta)) },
    token,
  });
}

test("compare works like dwh:compare: fixed keys, --amos-rows, --within, a stale pack is named", async () => {
  const { s, token } = await unshared(fakeEngine(root, { rows: 5 }));
  try {
    const vp = await call(s.url, "/api/verify-pack", { json: { path: "q_cmp.sql", at: "2026-11-18T03:00:00Z", params: {} }, token });
    assert.equal(vp.status, 200, vp.body);
    const { pack, amosSql } = JSON.parse(vp.body);
    assert.match(amosSql, /ORDER BY wp_header\.wpno/);
    assert.equal(pack.at, "2026-11-18T03:00:00Z");
    // The fake DWH result, exported, stands in for the AMOS export (same rows).
    const amos = Buffer.from((await call(s.url, "/api/export", { json: { path: "q_cmp.sql", params: {} }, token })).body, "utf8");

    const ok = JSON.parse((await compareCall(s.url, token, { path: "q_cmp.sql", pack, amosRows: 5 }, amos)).body);
    assert.equal(ok.pass, true, ok.report);
    assert.match(ok.report, /Fixed keys \(2 values of z_WP_ID/);
    assert.match(ok.report, /"Now" frozen at 2026-11-18T03:00:00Z/);

    const cut = JSON.parse((await compareCall(s.url, token, { path: "q_cmp.sql", pack, amosRows: 6 }, amos)).body);
    assert.equal(cut.pass, false);
    assert.match(cut.report.split("## ")[0], /cut short/);

    const within = Buffer.from('"z_WP_ID"\r\n"1000001"\r\n"1000003"\r\n');
    const w = JSON.parse((await compareCall(s.url, token, { path: "q_cmp.sql", pack }, amos, within)).body);
    assert.equal(w.pass, true, w.report);
    assert.match(w.report, /Rows listed in unchanged\.csv \(2\)/);

    writeFileSync(path.join(root, "q_cmp.sql"), "SELECT wp_header.wpno_i AS z_WP_ID, wp_header.wpno AS z_WP_NO FROM wp_header ORDER BY wp_header.wpno_i\n");
    const stale = await compareCall(s.url, token, { path: "q_cmp.sql", pack }, amos);
    assert.equal(stale.status, 409);
    assert.match(JSON.parse(stale.body).error, /q_cmp\.sql changed after you made the AMOS version/);
  } finally {
    writeFileSync(path.join(root, "q_cmp.sql"), "SELECT wp_header.wpno_i AS z_WP_ID, wp_header.wpno AS z_WP_NO FROM wp_header ORDER BY wp_header.wpno\n");
    await s.close();
  }
});

test("compare input mistakes (unknown key column, bad --within list, bad pack time) come back as 400 with the reason", async () => {
  const { s, token } = await unshared(fakeEngine(root, { rows: 5 }));
  try {
    const vp = await call(s.url, "/api/verify-pack", { json: { path: "q_cmp.sql", at: "2026-11-18T03:00:00Z", params: {} }, token });
    const { pack } = JSON.parse(vp.body);
    const amos = Buffer.from((await call(s.url, "/api/export", { json: { path: "q_cmp.sql", params: {} }, token })).body, "utf8");

    const key = await compareCall(s.url, token, { path: "q_cmp.sql", pack, keys: ["z_nope"] }, amos);
    assert.equal(key.status, 400, key.body);
    assert.match(JSON.parse(key.body).error, /key column z_nope is not in amos.csv/);

    const within = await compareCall(s.url, token, { path: "q_cmp.sql", pack }, amos, Buffer.from('"other"\r\n"1"\r\n'));
    assert.equal(within.status, 400, within.body);
    assert.match(JSON.parse(within.body).error, /unchanged\.csv has no column/);

    const at = await compareCall(s.url, token, { path: "q_cmp.sql", pack: { ...pack, at: "yesterday" } }, amos);
    assert.equal(at.status, 400, at.body);
    assert.match(JSON.parse(at.body).error, /Make the AMOS version again/);
  } finally {
    await s.close();
  }
});

test("compare without a pack is refused in plain words; uploads over 200 MB are refused", async () => {
  const { s, token } = await unshared(fakeEngine(root, { rows: 5 }));
  try {
    const r = await compareCall(s.url, token, { path: "q_cmp.sql" }, Buffer.from("z_wp_id\r\n1\r\n"));
    assert.equal(r.status, 400);
    assert.match(JSON.parse(r.body).error, /Make the AMOS version first/);
    const big = await call(s.url, "/api/compare", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "content-length": String(200 * 1024 * 1024 + 1), "x-compare": encodeURIComponent("{}"), "x-no-body": "1" },
      token,
    }).catch((e: Error) => e);
    assert.ok(!(big instanceof Error), String(big));
    assert.equal(big.status, 413);
  } finally {
    await s.close();
  }
});

test("catalogue refresh from the host writes the snapshot", async () => {
  const { s, token } = await unshared();
  try {
    const r = await call(s.url, "/api/catalogue/refresh", { json: {}, token });
    assert.equal(r.status, 200, r.body);
    assert.match(JSON.parse(r.body).message, /columns in \d+ tables/);
    assert.ok(existsSync(path.join(root, "dwh", "catalogue.json")));
  } finally {
    await s.close();
  }
});

test("catalogue refresh refuses an empty DWH read and keeps the current snapshot", async () => {
  const file = path.join(root, "dwh", "catalogue.json");
  const before = readFileSync(file, "utf8");
  const empty: QueryEngine = { ...fakeEngine(root), refreshCatalogue: async () => ({ takenAt: "2026-11-18T00:00:00Z", columns: [] }) };
  const { s, token } = await unshared(empty);
  try {
    const r = await call(s.url, "/api/catalogue/refresh", { json: {}, token });
    assert.equal(r.status, 502, r.body);
    assert.match(JSON.parse(r.body).error, /no columns.*current snapshot was kept/);
    assert.equal(readFileSync(file, "utf8"), before);
  } finally {
    await s.close();
  }
});

test("quit from the host closes the server", async () => {
  let quit = false;
  const s = await startServer({ root, share: { share: false, hostNames: [], allowCidrs: [] }, engine: fakeEngine(root), port: 0, env: FAKE_ENV, logFile: path.join(logDir, "q.log"), onQuit: () => (quit = true) });
  const token = tokenOf((await call(s.url, "/")).body)!;
  const r = await call(s.url, "/api/quit", { json: {}, token });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(quit, true);
  await assert.rejects(call(s.url, "/health"));
});
