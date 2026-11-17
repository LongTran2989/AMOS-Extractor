// Task 2.4: engine-level proof of the converter's date and number rules (plan A.7 #7).
// Each probe is a table-free PostgreSQL query; its converted Oracle version runs on the DWH
// (read-only, FROM DUAL) and the PostgreSQL version is printed for AMOS (--pg).
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { loadModel } from "../schema/load.ts";
import { loadCsvIndex } from "../schema/csv.ts";
import { loadMapping, type DwhMapping } from "./mapping.ts";
import { convertQuery, type ConvertOptions } from "./convert/index.ts";
import { assertReadOnlyOracle } from "./safety.ts";
import { buildRelayStatement } from "./relay.ts";
import { runRelay } from "./db.ts";
import { formatCell } from "./format.ts";
import { toPlain } from "./errorsPlain.ts";
import type { RelayPool } from "./run.ts";
import type { SqlType } from "./convert/scope.ts";

export interface Probe {
  id: string;
  pg: string;
  ref: { fn: string; args: unknown[] };
  expected: string;
}

export function loadProbes(file: string): Probe[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { probes: Probe[] };
  if (!Array.isArray(raw?.probes)) throw new Error(`${file}: expected { probes: [...] }`);
  return raw.probes;
}

// ---- JavaScript reference (independent of both databases) ----

const DAY = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const ymd = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const ymdhms = (t: number) => {
  const d = new Date(t);
  return `${ymd(t)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const parseDate = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const parseTs = (s: string) => parseDate(s) + (Number(s.slice(11, 13)) * 3600 + Number(s.slice(14, 16)) * 60 + Number(s.slice(17, 19))) * 1000;
const AMOS_EPOCH = Date.UTC(1971, 11, 31);

/** PostgreSQL month arithmetic: keep the day, clamp to the target month's last day. */
function addMonths(date: string, k: number): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + k;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return Date.UTC(ty, tm, Math.min(Number(date.slice(8, 10)), last));
}

export function referenceValue(ref: Probe["ref"]): string {
  const a = ref.args as any[];
  switch (ref.fn) {
    case "addMonths":
      return ymdhms(addMonths(a[0], a[1]));
    case "amosDateTime":
      return ymdhms(AMOS_EPOCH + a[0] * DAY + (a[1] ?? 0) * 60_000);
    case "amosDate":
      return ymd(AMOS_EPOCH + a[0] * DAY);
    case "addHours":
      return ymdhms(parseTs(a[0]) + a.slice(1).reduce((s: number, h: number) => s + h, 0) * 3_600_000);
    case "toDate":
      return ymd(Math.floor((parseTs(a[0]) + a[1] * 3_600_000) / DAY) * DAY);
    case "dayDiff":
      return String(Math.round((parseDate(a[0]) - parseDate(a[1])) / DAY));
    case "intDiv":
      return String(Math.trunc(a[0] / a[1]));
    case "mod":
      return String(a[0] % a[1]);
    case "extract": {
      const d = new Date(parseDate(a[1]));
      return String(a[0] === "DAY" ? d.getUTCDate() : a[0] === "MONTH" ? d.getUTCMonth() + 1 : d.getUTCFullYear());
    }
    case "order": {
      const values = (a[0] as (number | null)[]).filter((v) => v !== null).sort((x, y) => x! - y!);
      const nulls = (a[0] as (number | null)[]).filter((v) => v === null).length;
      const sorted = a[1] === "desc" ? [...Array(nulls).fill(null), ...values.reverse()] : [...values, ...Array(nulls).fill(null)];
      return sorted.map((v) => (v === null ? "NULL" : String(v))).join("|");
    }
    default:
      throw new Error(`unknown reference function ${ref.fn}`);
  }
}

// ---- Oracle and PostgreSQL texts ----

const optsCache = new Map<string, Omit<ConvertOptions, "mapping"> & { mapping: DwhMapping }>();
function convertOpts(root: string, mapping?: DwhMapping) {
  let o = optsCache.get(root);
  if (!o) {
    o = { model: loadModel(path.join(root, "schema")), csv: loadCsvIndex(path.join(root, "Database-Description-AMOS-csv.csv")), mapping: loadMapping(path.join(root, "dwh", "mapping.yaml")) };
    optsCache.set(root, o);
  }
  return mapping ? { ...o, mapping } : o;
}

function converted(p: Probe, root: string, mapping?: DwhMapping): { text: string; type: SqlType } {
  const r = convertQuery(p.pg, `${p.id}.sql`, convertOpts(root, mapping));
  // Name the (first) result column V: the converter's own name would be the whole formula.
  const at = r.exec.indexOf(" FROM DUAL");
  if (!r.exec.startsWith("SELECT ") || at < 0) throw new Error(`probe ${p.id}: unexpected Oracle text ${r.exec}`);
  const text = `${r.exec.slice(0, at)} AS "V"${r.exec.slice(at)}`;
  assertReadOnlyOracle(text);
  return { text, type: r.outputs[0]!.type };
}

export function probeOracleText(p: Probe, root: string, mapping?: DwhMapping): string {
  return converted(p, root, mapping).text;
}

/** The PostgreSQL version to paste into AMOS, with the expected answer as a comment. */
export function probePgText(p: Probe): string {
  const union = p.pg.indexOf(" UNION ");
  const named = union >= 0 ? `${p.pg.slice(0, union)} AS v${p.pg.slice(union)}` : `${p.pg} AS v`;
  return `${named}; -- ${p.id}: expect ${p.expected}`;
}

export async function runProbes(
  pool: RelayPool,
  probes: Probe[],
  root: string,
  mapping: DwhMapping,
): Promise<{ id: string; pass: boolean; expected: string; got: string }[]> {
  const out: { id: string; pass: boolean; expected: string; got: string }[] = [];
  for (const p of probes) {
    let got: string;
    try {
      const { text, type } = converted(p, root, mapping);
      const { tsql, inputs } = buildRelayStatement(text, mapping.execMode, [], mapping.linkedServer);
      const { rows } = await runRelay(pool, tsql, inputs);
      got = rows.map((r) => (r[0] === null || r[0] === undefined ? "NULL" : formatCell(r[0], type))).join("|");
    } catch (e) {
      got = `error: ${toPlain(e).message}`;
    }
    out.push({ id: p.id, pass: got === p.expected, expected: p.expected, got });
  }
  return out;
}
