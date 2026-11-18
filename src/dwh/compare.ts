// AMOS vs DWH result comparison (plan A.7 #4-#6). Reads the AMOS export (CSV or xlsx, with its
// quirks: lower-case headers, NULL as a single space, apostrophe thousands separators, varying
// decimals) and the DWH CSV written by `dwh:run --csv`, pairs rows by key columns and reports, in
// plain words: row counts first (with a clear warning when the AMOS export looks cut short), the
// header check, rows found on one side only (grouped as possible drift), classified cell
// differences, per-column checksums and the row order on sort-key values.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import yaml from "yaml";
import { normalizeCell, parseCsv, type Table } from "../stitch/stitch.ts";
import { readXlsx } from "./xlsx.ts";

export type DiffKind = "whitespace" | "case" | "null_vs_empty" | "number_format" | "truncated" | "tz_shift_7h" | "changed";

export interface CellDiff {
  key: string;
  column: string;
  amos: string;
  dwh: string;
  kind: DiffKind;
}

export interface CompareOptions {
  /** The query carries W_STRING_ORDER: an order difference is explained, not a failure. */
  stringOrderExpected?: boolean;
  /** Row count AMOS showed on screen (--amos-rows), to catch a cut-short export. */
  amosRowsShown?: number;
  /** Fixed verification keys that should be present in both files (dwh/verify-keys.yaml). */
  expected?: { column: string; values: string[] };
  /** The DWH CSV ended with an INCOMPLETE line (download stopped or row limit reached). */
  dwhIncomplete?: string;
  /** Section title in the report. */
  title?: string;
  /** The rows compared should be in both files (--within), so one-side rows are not drift. */
  notDrift?: boolean;
}

export interface CompareReport {
  headerMatch: boolean;
  counts: { amos: number; dwh: number };
  onlyAmos: number;
  onlyDwh: number;
  differingColumns: string[];
  cellDiffs: CellDiff[];
  orderSame: boolean;
  driftKeys: string[];
  pass: boolean;
  // Additions to the plan's interface (ledgered):
  title: string;
  keys: string[];
  orderKeys: string[];
  columns: { missingInAmos: string[]; missingInDwh: string[] };
  /** Plain reasons why the AMOS export looks incomplete; empty when it looks whole. */
  amosIncomplete: string[];
  dwhIncomplete?: string;
  orderExplained: boolean;
  firstOrderDiff?: { position: number; amos: string; dwh: string };
  notes: string[];
  notDrift?: boolean;
}

/** Differences that are export formatting only and never fail the pass criterion (A.7 #6). */
const NOISE = new Set<DiffKind>(["whitespace", "number_format", "null_vs_empty"]);

const KIND_PLAIN: Record<DiffKind, string> = {
  whitespace: "spaces or line breaks only",
  case: "upper/lower case only",
  null_vs_empty: "empty vs blank",
  number_format: "same number, written differently",
  truncated: "text cut short on one side",
  tz_shift_7h: "same time shifted by exactly 7 hours (local time vs UTC)",
  changed: "different value",
};

/** AMOS writes NULL as a single space. */
const clean = (v: string | undefined) => (v === undefined || v === " " ? "" : v);
const norm = (v: string | undefined) => normalizeCell(clean(v));
const collapse = (v: string) => v.split(/\s+/).join(" ").trim();

function asNumber(v: string): number | undefined {
  let x = v.trim();
  if (/^-?\d{1,3}(?:'\d{3})+(?:\.\d+)?$/.test(x)) x = x.replace(/'/g, "");
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(x)) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function asInstant(v: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (!m) return undefined;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
}

const TRUNCATION_MIN = 50;

/** Kind of difference between two cells that differ as written (after the NULL-as-space quirk). */
export function classify(amos: string, dwh: string): DiffKind {
  const a = clean(amos);
  const b = clean(dwh);
  const blankA = a.trim() === "";
  const blankB = b.trim() === "";
  if (blankA && blankB) return "null_vs_empty";
  if (blankA || blankB) return "changed";
  const ca = collapse(a);
  const cb = collapse(b);
  if (ca === cb) return "whitespace";
  const na = asNumber(ca);
  const nb = asNumber(cb);
  if ((na !== undefined && nb !== undefined && na === nb) || normalizeCell(a) === normalizeCell(b)) return "number_format";
  if (ca.toLowerCase() === cb.toLowerCase()) return "case";
  const ta = asInstant(ca);
  const tb = asInstant(cb);
  if (ta !== undefined && tb !== undefined && Math.abs(ta - tb) === 7 * 3600 * 1000) return "tz_shift_7h";
  const [short, long] = ca.length < cb.length ? [ca, cb] : [cb, ca];
  if (short.length >= TRUNCATION_MIN && long.length > short.length && long.startsWith(short)) return "truncated";
  return "changed";
}

function columnIndex(t: Table, name: string): number {
  return t.header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
}

/** Keeps the rows whose `column` value (trimmed) is one of `values`. */
export function restrictTo(t: Table, column: string, values: string[]): Table {
  const i = columnIndex(t, column);
  if (i < 0) throw new Error(`Column ${column} (from dwh/verify-keys.yaml) is not in the file.`);
  const keep = new Set(values.map((v) => v.trim()));
  return { header: t.header, rows: t.rows.filter((r) => keep.has(clean(r[i]).trim())) };
}

/**
 * Keeps the rows whose `column` value is listed in the same column of `list` (for example the
 * DWH workpacks unchanged since a test copy was taken). Values are compared after normalising,
 * so `1'596'611` matches `1596611`.
 */
export function restrictToListed(t: Table, column: string, list: Table, listName = "The list file"): Table {
  const i = columnIndex(t, column);
  if (i < 0) throw new Error(`Column ${column} is not in the file.`);
  const j = columnIndex(list, column);
  if (j < 0) throw new Error(`${listName} has no column ${column} (it needs the match column to say which rows to keep).`);
  const keep = new Set(list.rows.map((r) => norm(r[j])));
  return { header: t.header, rows: t.rows.filter((r) => keep.has(norm(r[i]))) };
}

/** Splits off the "INCOMPLETE: …" line that dwh:run writes at the end of a cut-off CSV. */
export function splitIncomplete(t: Table): { table: Table; incomplete?: string } {
  const last = t.rows[t.rows.length - 1];
  if (last && last.length === 1 && /^INCOMPLETE:/.test(last[0] ?? "")) return { table: { header: t.header, rows: t.rows.slice(0, -1) }, incomplete: last[0]! };
  return { table: t };
}

const checksum = (values: string[]) => createHash("sha256").update(JSON.stringify([...values].sort())).digest("hex");
const byNatural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const TYPICAL_CAPS = new Set([1000, 5000, 10000, 50000, 65535, 65536, 100000, 1048575, 1048576]);

export function compareResults(amos: Table, dwh: Table, keys: string[], orderKeys: string[], opts: CompareOptions = {}): CompareReport {
  const notes: string[] = [];
  const headerMatch = amos.header.length === dwh.header.length && amos.header.every((h, i) => h.trim().toLowerCase() === (dwh.header[i] ?? "").trim().toLowerCase());
  const common = dwh.header.map((name, di) => ({ name, di, ai: columnIndex(amos, name) })).filter((c) => c.ai >= 0);
  const missingInAmos = dwh.header.filter((h) => columnIndex(amos, h) < 0);
  const missingInDwh = amos.header.filter((h) => columnIndex(dwh, h) < 0);

  const keyCols = keys.length ? keys : common.map((c) => c.name);
  const keyIdx = keyCols.map((k) => {
    const c = common.find((x) => x.name.toLowerCase() === k.toLowerCase());
    if (!c) throw new Error(`The key column ${k} is not in both files.`);
    return c;
  });
  const keyOfAmos = (r: string[]) => keyIdx.map((c) => norm(r[c.ai])).join("\u0001");
  const keyOfDwh = (r: string[]) => keyIdx.map((c) => norm(r[c.di])).join("\u0001");

  // Pair rows by key; rows sharing a key pair in file order.
  const queue = new Map<string, number[]>();
  dwh.rows.forEach((r, i) => {
    const k = keyOfDwh(r);
    (queue.get(k) ?? queue.set(k, []).get(k)!).push(i);
  });
  const pairs: [number, number][] = [];
  const amosOnly: number[] = [];
  amos.rows.forEach((r, ai) => {
    const di = queue.get(keyOfAmos(r))?.shift();
    if (di === undefined) amosOnly.push(ai);
    else pairs.push([ai, di]);
  });
  const pairedDwh = new Set(pairs.map((p) => p[1]));
  const dwhOnly = dwh.rows.map((_, i) => i).filter((i) => !pairedDwh.has(i));

  // Cell differences on paired rows (key columns matched already).
  const keySet = new Set(keyIdx.map((c) => c.name));
  const cellDiffs: CellDiff[] = [];
  for (const [ai, di] of [...pairs].sort((x, y) => x[1] - y[1])) {
    const ar = amos.rows[ai]!;
    const dr = dwh.rows[di]!;
    for (const c of common) {
      if (keySet.has(c.name)) continue;
      const a = clean(ar[c.ai]);
      const d = clean(dr[c.di]);
      if (a === d) continue;
      cellDiffs.push({ key: keyIdx.map((k) => dr[k.di] ?? "").join(" / "), column: c.name, amos: ar[c.ai] ?? "", dwh: dr[c.di] ?? "", kind: classify(a, d) });
    }
  }

  const differingColumns = common.filter((c) => checksum(amos.rows.map((r) => norm(r[c.ai]))) !== checksum(dwh.rows.map((r) => norm(r[c.di])))).map((c) => c.name);

  // Row order on sort-key values only (ties are interchangeable, #39).
  let orderSame = true;
  let firstOrderDiff: CompareReport["firstOrderDiff"];
  const ord = orderKeys.map((k) => common.find((c) => c.name.toLowerCase() === k.toLowerCase())).filter((c) => c !== undefined);
  if (ord.length) {
    const pairedAmos = new Set(pairs.map((p) => p[0]));
    const seqA = amos.rows.flatMap((r, i) => (pairedAmos.has(i) ? [ord.map((c) => norm(r[c.ai])).join(" / ")] : []));
    const seqD = dwh.rows.flatMap((r, i) => (pairedDwh.has(i) ? [ord.map((c) => norm(r[c.di])).join(" / ")] : []));
    const at = seqA.findIndex((v, i) => v !== seqD[i]);
    if (at >= 0) {
      orderSame = false;
      firstOrderDiff = { position: at + 1, amos: seqA[at]!, dwh: seqD[at]! };
    }
  }
  const orderExplained = !orderSame && opts.stringOrderExpected === true;

  const firstKey = keyIdx[0];
  const driftKeys = firstKey
    ? [...new Set([...amosOnly.map((i) => norm(amos.rows[i]![firstKey.ai])), ...dwhOnly.map((i) => norm(dwh.rows[i]![firstKey.di]))])].sort(byNatural)
    : [];

  // Is the AMOS export complete? Checked first and reported first.
  const amosIncomplete: string[] = [];
  const nA = amos.rows.length;
  const nD = dwh.rows.length;
  if (opts.amosRowsShown !== undefined && opts.amosRowsShown !== nA)
    amosIncomplete.push(`AMOS showed ${opts.amosRowsShown} rows on screen, but the export file has ${nA}: the export was cut short. Export again (in smaller pieces if needed).`);
  else if (nA < nD && amosOnly.length === 0)
    amosIncomplete.push(`The AMOS file has fewer rows (${nA}) than the DWH (${nD}), and every AMOS row is also in the DWH. The AMOS export looks cut short, or AMOS shows you only some rows. Check the row count AMOS shows on screen (--amos-rows).`);
  if (TYPICAL_CAPS.has(nA) && nA < nD) amosIncomplete.push(`The AMOS file has exactly ${nA} rows, a typical export limit.`);
  if (amos.rows.some((r) => r.length < amos.header.length)) amosIncomplete.push("Some AMOS rows have fewer cells than the header: the file may be cut off in the middle of a row.");
  if (opts.expected) {
    const ia = columnIndex(amos, opts.expected.column);
    const id = columnIndex(dwh, opts.expected.column);
    const has = (t: Table, i: number, v: string) => i >= 0 && t.rows.some((r) => clean(r[i]).trim() === v.trim());
    let seen = 0;
    for (const v of opts.expected.values) {
      const inA = has(amos, ia, v);
      const inD = has(dwh, id, v);
      if (inA || inD) seen++;
      if (inD && !inA) amosIncomplete.push(`Fixed key ${opts.expected.column} = ${v} is in the DWH but not in the AMOS file: the AMOS export is incomplete, or AMOS does not show you this row.`);
      if (!inD && !inA) notes.push(`Fixed key ${opts.expected.column} = ${v} is in neither file: it may no longer match the query (for example its status changed). Pick another key.`);
    }
    if (seen === 0) notes.push("None of the fixed keys is in either file, so nothing could be checked.");
  }

  const realDiffs = cellDiffs.filter((d) => !NOISE.has(d.kind));
  const fixedNothing = opts.expected !== undefined && nA === 0 && nD === 0;
  const pass =
    headerMatch &&
    amosOnly.length === 0 &&
    dwhOnly.length === 0 &&
    realDiffs.length === 0 &&
    (orderSame || orderExplained) &&
    amosIncomplete.length === 0 &&
    opts.dwhIncomplete === undefined &&
    !fixedNothing;

  return {
    headerMatch,
    counts: { amos: nA, dwh: nD },
    onlyAmos: amosOnly.length,
    onlyDwh: dwhOnly.length,
    differingColumns,
    cellDiffs,
    orderSame,
    driftKeys,
    pass,
    title: opts.title ?? "Comparison",
    keys: keyIdx.map((c) => c.name),
    orderKeys: ord.map((c) => c.name),
    columns: { missingInAmos, missingInDwh },
    amosIncomplete,
    ...(opts.dwhIncomplete !== undefined ? { dwhIncomplete: opts.dwhIncomplete } : {}),
    orderExplained,
    ...(firstOrderDiff ? { firstOrderDiff } : {}),
    notes,
    ...(opts.notDrift ? { notDrift: true } : {}),
  };
}

const clip = (v: string, n = 60) => {
  const one = v.replace(/\r?\n/g, "⏎");
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};
const cellMd = (v: string) => clip(v).replace(/\|/g, "\\|") || "(empty)";
const MAX_ROWS_SHOWN = 25;
const MAX_KEYS_SHOWN = 20;

/** Plain-language Markdown for one comparison section. */
export function renderReport(r: CompareReport): string {
  const out: string[] = [];
  const realDiffs = r.cellDiffs.filter((d) => !NOISE.has(d.kind));
  out.push(`## ${r.title}`, "");
  out.push(`**Result: ${r.pass ? "PASS" : "FAIL"}**`, "");
  out.push(`Rows: AMOS ${r.counts.amos}, DWH ${r.counts.dwh}.`, "");
  if (r.amosIncomplete.length) {
    out.push("**The AMOS export looks incomplete:**");
    for (const m of r.amosIncomplete) out.push(`- ${m}`);
    out.push("");
  }
  if (r.dwhIncomplete !== undefined) out.push(`**The DWH file is incomplete:** ${r.dwhIncomplete}`, "");

  if (r.headerMatch) out.push("Columns: the same names in the same order (upper/lower case ignored).", "");
  else {
    out.push("**Columns differ.**");
    if (r.columns.missingInAmos.length) out.push(`- Missing in the AMOS file: ${r.columns.missingInAmos.join(", ")}`);
    if (r.columns.missingInDwh.length) out.push(`- Missing in the DWH file: ${r.columns.missingInDwh.join(", ")}`);
    if (!r.columns.missingInAmos.length && !r.columns.missingInDwh.length) out.push("- Same names, different order.");
    out.push("");
  }

  out.push(`Rows are matched on: ${r.keys.join(", ")}.`, "");
  out.push(`Rows only in AMOS: ${r.onlyAmos}. Rows only in the DWH: ${r.onlyDwh}.`);
  if (r.driftKeys.length) {
    const shown = r.driftKeys.slice(0, MAX_KEYS_SHOWN).join(", ") + (r.driftKeys.length > MAX_KEYS_SHOWN ? ", …" : "");
    out.push(
      r.notDrift
        ? `These are ${r.driftKeys.length} values of ${r.keys[0]}: ${shown}. These rows should be in both files, so this is not drift: AMOS does not have them or does not show them to you, or they are real differences.`
        : `These are ${r.driftKeys.length} values of ${r.keys[0]}: ${shown}. If AMOS and the DWH were not read at the same moment, this is likely drift: those rows changed between the two runs (a present-day status, for example). Otherwise they are real differences.`,
    );
  }
  out.push("");

  if (!r.cellDiffs.length) out.push("Cell differences: none.", "");
  else {
    const counts = new Map<DiffKind, number>();
    for (const d of r.cellDiffs) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
    out.push(`Cell differences: ${r.cellDiffs.length} (${realDiffs.length} count against the result; export formatting does not).`);
    for (const [k, n] of counts) out.push(`- ${n} × ${k}: ${KIND_PLAIN[k]}${NOISE.has(k) ? " (export formatting, allowed)" : ""}`);
    out.push("", `| ${r.keys.join(" / ")} | column | AMOS | DWH | kind |`, "|---|---|---|---|---|");
    const listed = [...realDiffs, ...r.cellDiffs.filter((d) => NOISE.has(d.kind))].slice(0, MAX_ROWS_SHOWN);
    for (const d of listed) out.push(`| ${cellMd(d.key)} | ${d.column} | ${cellMd(d.amos)} | ${cellMd(d.dwh)} | ${d.kind} |`);
    if (r.cellDiffs.length > listed.length) out.push(`| … | | | | ${r.cellDiffs.length - listed.length} more |`);
    out.push("");
  }

  out.push(`Columns whose values differ (checksums over all rows): ${r.differingColumns.length ? r.differingColumns.join(", ") : "none"}.`, "");

  if (!r.orderKeys.length) out.push("Row order: not checked (the query has no ORDER BY on its result columns).");
  else if (r.orderSame) out.push(`Row order: the same on ${r.orderKeys.join(", ")} (ties ignored).`);
  else {
    const f = r.firstOrderDiff!;
    out.push(`Row order on ${r.orderKeys.join(", ")} differs first at matched row ${f.position}: AMOS has ${clip(f.amos)}, the DWH has ${clip(f.dwh)}.`);
    if (r.orderExplained) out.push("Explained: AMOS and the DWH sort text differently (W_STRING_ORDER: the DWH orders text by character code), so this does not fail the check.");
  }
  if (r.notes.length) {
    out.push("", "Notes:");
    for (const n of r.notes) out.push(`- ${n}`);
  }
  return `${out.join("\n")}\n`;
}

/** Reads an AMOS export: xlsx (by extension or ZIP signature) or CSV (UTF-8, or UTF-16 with a BOM). */
export function readTableFile(file: string): Table {
  const buf = readFileSync(file);
  if (/\.xlsx$/i.test(file) || buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return readXlsx(buf);
  if (buf[0] === 0xff && buf[1] === 0xfe) return parseCsv(buf.subarray(2).toString("utf16le"));
  if (buf[0] === 0xfe && buf[1] === 0xff) return parseCsv(Buffer.from(buf.subarray(2)).swap16().toString("utf16le"));
  return parseCsv(buf.toString("utf8"));
}

export const COMPARE_USAGE =
  "Usage: npm run dwh:compare -- <amos.csv|amos.xlsx> <dwh.csv> [--key=COL1,COL2] [--amos-rows N] [--within rows.csv]";

interface VerifyKeyEntry {
  match_on?: string[];
  fixed_column?: string;
  fixed_values?: (string | number)[];
}

/** `npm run dwh:compare`; prints the report, writes report.md next to dwh.csv, returns the exit code. */
export function compareCli(root: string, args: string[], log: (s: string) => void): number {
  try {
    const files: string[] = [];
    let keys: string[] | undefined;
    let amosRowsShown: number | undefined;
    let withinFile: string | undefined;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const [flag, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
      const value = () => {
        const v = inline ?? args[++i];
        if (v === undefined) throw new Error(`${flag} needs a value. ${COMPARE_USAGE}`);
        return v;
      };
      if (flag === "--key") keys = value().split(",").map((k) => k.trim()).filter(Boolean);
      else if (flag === "--amos-rows") {
        const v = value().replace(/['’,\s]/g, "");
        if (!/^\d+$/.test(v)) throw new Error(`--amos-rows needs a whole number (got "${v}").`);
        amosRowsShown = Number(v);
      } else if (flag === "--within") withinFile = value();
      else if (flag.startsWith("--")) throw new Error(`Unknown option ${flag}. ${COMPARE_USAGE}`);
      else files.push(a);
    }
    if (files.length !== 2) throw new Error(COMPARE_USAGE);
    const [amosFile, dwhFile] = files as [string, string];
    const amos = readTableFile(amosFile);
    const { table: dwh, incomplete } = splitIncomplete(parseCsv(readFileSync(dwhFile, "utf8")));

    const packFile = path.join(path.dirname(dwhFile), "pack.json");
    const pack = existsSync(packFile)
      ? (JSON.parse(readFileSync(packFile, "utf8")) as { source?: string; at?: string; orderKeys?: string[]; warnings?: { code: string }[] })
      : undefined;
    const keysFile = path.join(root, "dwh", "verify-keys.yaml");
    const allKeys = existsSync(keysFile) ? ((yaml.parse(readFileSync(keysFile, "utf8")) ?? {}) as Record<string, VerifyKeyEntry>) : {};
    const entry = pack?.source ? allKeys[pack.source] : undefined;

    const matchOn = keys ?? entry?.match_on ?? (dwh.header[0] ? [dwh.header[0]] : []);
    const orderKeys = pack?.orderKeys ?? [];
    const base: CompareOptions = {
      stringOrderExpected: pack?.warnings?.some((w) => w.code === "W_STRING_ORDER") ?? false,
      ...(incomplete !== undefined ? { dwhIncomplete: incomplete } : {}),
    };
    const full = compareResults(amos, dwh, matchOn, orderKeys, { ...base, ...(amosRowsShown !== undefined ? { amosRowsShown } : {}), title: "All rows" });
    let fixed: CompareReport | undefined;
    if (entry?.fixed_column && entry.fixed_values?.length) {
      const values = entry.fixed_values.map(String);
      const col = entry.fixed_column;
      fixed = compareResults(restrictTo(amos, col, values), restrictTo(dwh, col, values), matchOn, orderKeys, {
        ...base,
        expected: { column: col, values },
        title: `Fixed keys (${values.length} values of ${col}, from dwh/verify-keys.yaml)`,
      });
    }
    let within: CompareReport | undefined;
    if (withinFile) {
      const list = splitIncomplete(readTableFile(withinFile)).table;
      const col = matchOn[0]!;
      within = compareResults(restrictToListed(amos, col, list, withinFile), restrictToListed(dwh, col, list, withinFile), matchOn, orderKeys, {
        ...base,
        title: `Rows listed in ${withinFile} (${list.rows.length})`,
        notDrift: true,
      });
      within.notes.unshift(
        `Only the ${list.rows.length} values of ${col} listed in ${withinFile} are compared here. They are rows that should be the same in both systems (for example unchanged since the AMOS copy was taken), so a difference or a one-side row here is not drift.`,
      );
    }
    const judged = [fixed, within].filter((r): r is CompareReport => r !== undefined);
    const verdict = judged.length ? judged.every((r) => r.pass) : full.pass;
    const head = [
      `# AMOS vs DWH${pack?.source ? `: ${pack.source}` : ""}`,
      "",
      ...(pack?.at ? [`"Now" frozen at ${pack.at} (UTC).`] : []),
      `AMOS file: ${amosFile}  `,
      `DWH file: ${dwhFile}`,
      "",
      `**Overall: ${verdict ? "PASS" : "FAIL"}**${judged.length ? ` (judged on ${[fixed ? "the fixed keys" : "", within ? "the listed rows" : ""].filter(Boolean).join(" and ")}; the all-rows section shows drift and export problems)` : ""}`,
      "",
    ];
    const text = [head.join("\n"), ...judged.map(renderReport), renderReport(full)].join("\n");
    const reportFile = path.join(path.dirname(dwhFile), "report.md");
    writeFileSync(reportFile, text);
    log(text);
    log(`Report written to ${reportFile}`);
    return verdict ? 0 : 1;
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
