// Frozen-clock verification packs (plan A.7 #1). For one repo query and one UTC instant it writes
//   verify/<name>/amos.sql  the PostgreSQL source with CURRENT_DATE / CURRENT_TIMESTAMP / NOW() /
//                           LOCALTIMESTAMP replaced by literals of that instant (spliced at the lexer's
//                           offsets, so everything else stays byte-for-byte) and placeholders filled in;
//   verify/<name>/dwh.sql   the converter's Oracle SQL with the same instant (pinNow);
//   verify/<name>/pack.json what dwh:compare needs (source, instant, parameters, order keys, warnings).
// You paste amos.sql into AMOS and export the result; the DWH side runs the source with
// `npm run dwh:run -- <source> --at <instant> --csv verify/<name>/dwh.csv`, which sends the same text
// as dwh.sql and keeps the output types for formatting.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { ConvertError } from "./convert/errors.ts";
import { lex } from "./lex.ts";
import { convertSource, listSources } from "./sources.ts";

const AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const PLACEHOLDER = /<([A-Z0-9_]+)>/g;

/** Checks a whole-second UTC instant like 2026-11-10T06:00:00Z and returns it unchanged. */
export function parseAt(at: string): string {
  const m = AT_RE.exec(at);
  const d = new Date(at);
  const ok = m !== null && !Number.isNaN(d.getTime()) && d.toISOString() === `${at.slice(0, -1)}.000Z`;
  if (!ok) throw new Error(`--at must be a whole-second UTC instant like 2026-11-10T06:00:00Z (got "${at}").`);
  return at;
}

/** The most recent whole hour in UTC (the DWH is near real time, so a past instant is stable). */
export function defaultAt(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(/\.000Z$/, "Z");
}

/** verify/ folder name for a source: path without .sql, "/" -> "__". */
export function packName(source: string): string {
  return source.replace(/\\/g, "/").replace(/\.sql$/i, "").replace(/\//g, "__");
}

function trimmedParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v.trim()]));
}

/** Fills <NAME> placeholders inside string literals (quotes doubled); refuses missing or unknown values. */
function fillPlaceholders(text: string, dialect: "pg" | "oracle", params: Record<string, string>): string {
  const values = trimmedParams(params);
  const used = new Set<string>();
  let out = "";
  for (const t of lex(text, dialect)) {
    if (t.kind !== "string" && t.kind !== "nstring") {
      out += t.text;
      continue;
    }
    out += t.text.replace(PLACEHOLDER, (_m, name: string) => {
      used.add(name);
      const v = values[name];
      if (v === undefined || v === "") throw new ConvertError("E_PARAM_MISSING", `Fill in a value for <${name}> (--param ${name}=...).`);
      return v.replace(/'/g, "''");
    });
  }
  for (const name of Object.keys(values))
    if (!used.has(name)) throw new ConvertError("E_UNKNOWN_PARAM", `The query has no placeholder <${name}>.`);
  return out;
}

/** The PostgreSQL source with "now" frozen at `at` (UTC) and placeholders filled in. */
export function pinPg(source: string, at: string, params: Record<string, string>): string {
  parseAt(at);
  const date = at.slice(0, 10);
  const time = at.slice(11, 19);
  const tokens = lex(source, "pg");
  let out = "";
  let prevSig: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const sig = t.kind !== "space" && t.kind !== "comment";
    const word = t.kind === "word" && prevSig !== "." ? t.text.toUpperCase() : "";
    let replaced: string | undefined;
    if (word === "CURRENT_DATE") replaced = `DATE '${date}'`;
    else if (word === "CURRENT_TIMESTAMP") replaced = `TIMESTAMPTZ '${date} ${time}+00'`;
    else if (word === "LOCALTIMESTAMP") replaced = `TIMESTAMP '${date} ${time}'`;
    else if (word === "NOW") {
      // NOW ( ) with optional spaces: swallow the brackets too.
      let j = i + 1;
      const next = () => {
        while (tokens[j] && (tokens[j]!.kind === "space" || tokens[j]!.kind === "comment")) j++;
        return tokens[j];
      };
      if (next()?.text === "(") {
        j++;
        if (next()?.text === ")") {
          replaced = `TIMESTAMPTZ '${date} ${time}+00'`;
          i = j;
        }
      }
    } else if (word === "CURRENT_TIME" || word === "LOCALTIME")
      throw new ConvertError("E_UNSUPPORTED", `${word} (a time of day without a date) cannot be frozen for verification.`);
    out += replaced ?? t.text;
    if (sig) prevSig = replaced ? "" : t.text;
  }
  return fillPlaceholders(out, "pg", params);
}

export interface VerifyPackOptions {
  /** Defaults to dwh/catalogue.json (tests pass a missing path for "no snapshot"). */
  cataloguePath?: string;
  /** Defaults to <root>/verify. */
  outDir?: string;
}

/** Writes verify/<name>/{amos.sql,dwh.sql,pack.json}; refuses refused or unavailable queries. */
export function writeVerifyPack(
  root: string,
  source: string,
  at: string,
  params: Record<string, string>,
  opts: VerifyPackOptions = {},
): { amosSql: string; dwhSql: string } {
  const src = source.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!listSources(root).includes(src)) throw new Error(`${source} is not one of the repo queries (root *.sql or queries/wp_seqs/*.sql).`);
  parseAt(at);
  const conv = convertSource(root, src, { ...(opts.cataloguePath ? { cataloguePath: opts.cataloguePath } : {}), pinNow: at });
  if (conv.available === false)
    throw new ConvertError("E_MISSING_IN_DWH", `This query is not available in the DWH: it needs ${conv.missing.join(", ")}, which the DWH does not have.`);

  const text = readFileSync(path.join(root, src), "utf8").replace(/\r\n?/g, "\n");
  const amosSql = pinPg(text, at, params);
  const filled = trimmedParams(params);
  const header = [
    `-- Verification pack for ${src}, "now" frozen at ${at} (UTC). Oracle SQL as the DWH runner sends it.`,
    `-- Run it with: npm run dwh:run -- ${src} --at ${at}${Object.entries(filled).map(([k, v]) => ` --param "${k}=${v}"`).join("")} --csv verify/${packName(src)}/dwh.csv`,
    ...conv.warnings.map((w) => `-- Warning ${w.code}: ${w.plain}`),
  ];
  const dwhSql = `${header.join("\n")}\n\n${fillPlaceholders(conv.pretty, "oracle", params)}\n`;

  const dir = path.join(opts.outDir ?? path.join(root, "verify"), packName(src));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "amos.sql"), amosSql);
  writeFileSync(path.join(dir, "dwh.sql"), dwhSql);
  const pack = {
    source: src,
    sourceSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    at,
    params: filled,
    outputs: conv.outputs,
    orderKeys: conv.orderKeys,
    warnings: conv.warnings,
  };
  writeFileSync(path.join(dir, "pack.json"), `${JSON.stringify(pack, null, 2)}\n`);
  return { amosSql, dwhSql };
}

export const VERIFY_PACK_USAGE = "Usage: npm run dwh:verify-pack -- <source.sql> [--at 2026-11-10T06:00:00Z] [--param NAME=value]";

/** `npm run dwh:verify-pack -- <source.sql> [--at <UTC instant>] [--param K=V]`; returns the exit code. */
export function verifyPackCli(root: string, args: string[], log: (s: string) => void, opts: VerifyPackOptions = {}): number {
  let source: string | undefined;
  let at = defaultAt();
  const params: Record<string, string> = {};
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const value = () => {
        const v = args[++i];
        if (v === undefined) throw new Error(`${a} needs a value. ${VERIFY_PACK_USAGE}`);
        return v;
      };
      if (a === "--at") at = parseAt(value());
      else if (a === "--param") {
        const kv = value();
        const eq = kv.indexOf("=");
        if (eq <= 0) throw new Error(`--param must look like K=V (got "${kv}"). ${VERIFY_PACK_USAGE}`);
        params[kv.slice(0, eq)] = kv.slice(eq + 1);
      } else if (a.startsWith("--")) throw new Error(`Unknown option ${a}. ${VERIFY_PACK_USAGE}`);
      else if (source === undefined) source = a;
      else throw new Error(`Only one query at a time. ${VERIFY_PACK_USAGE}`);
    }
    if (!source) throw new Error(VERIFY_PACK_USAGE);
    const src = source.replace(/\\/g, "/").replace(/^\.\//, "");
    writeVerifyPack(root, src, at, params, opts);
    const dir = `verify/${packName(src)}`;
    const p = Object.entries(trimmedParams(params)).map(([k, v]) => ` --param "${k}=${v}"`).join("");
    log(`Wrote ${dir}/amos.sql, ${dir}/dwh.sql and ${dir}/pack.json ("now" frozen at ${at} UTC).`);
    log("Next:");
    log(`  1. Paste ${dir}/amos.sql into AMOS, run it, and export the result into ${dir}/ (amos.xlsx or amos.csv).`);
    log("     Note the number of rows AMOS shows on screen.");
    log(`  2. Soon after, run the DWH side: npm run dwh:run -- ${src} --at ${at}${p} --csv ${dir}/dwh.csv`);
    log(`  3. Compare: npm run dwh:compare -- ${dir}/amos.xlsx ${dir}/dwh.csv --amos-rows <rows AMOS showed>`);
    return 0;
  } catch (e) {
    log(e instanceof ConvertError ? e.plain : e instanceof Error ? e.message : String(e));
    return 1;
  }
}
