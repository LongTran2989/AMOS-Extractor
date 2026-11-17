// dwh/mapping.yaml: hand-edited DWH settings (plan A.6).
import { readFileSync } from "node:fs";
import yaml from "yaml";

export interface DwhMapping {
  linkedServer: string;
  oracleSchema: string;
  execMode: "exec_at" | "openquery";
  oracleVersion: number;
  nlsComp: string;
  nlsSort: string;
  dbCharset: string;
  /** Renames, keyed by lower-case AMOS "table.column". */
  columns: Record<string, { dwh: string; keepOutputName?: boolean }>;
  amosCollation: "C" | "other" | "unknown";
  exportRowLimit: number;
  /** AMOS tables known to be absent from the DWH (dwh_facts.amos_tables_missing_in_dwh, lower case). */
  knownMissingTables: string[];
}

function need<T>(raw: Record<string, unknown>, key: string, check: (v: unknown) => boolean, what: string): T {
  const v = raw[key];
  if (!check(v)) throw new Error(`dwh/mapping.yaml: '${key}' must be ${what} (got ${JSON.stringify(v)})`);
  return v as T;
}

function knownMissing(raw: Record<string, unknown>): string[] {
  const list = (raw.dwh_facts as Record<string, unknown> | undefined)?.amos_tables_missing_in_dwh ?? [];
  if (!Array.isArray(list) || !list.every((t) => typeof t === "string" && /^[a-z0-9_]+$/.test(t))) {
    throw new Error("dwh/mapping.yaml: dwh_facts.amos_tables_missing_in_dwh must be a list of lower-case AMOS table names");
  }
  return list as string[];
}

export function parseMapping(text: string): DwhMapping {
  const raw = (yaml.parse(text) ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => typeof v === "string" && v.length > 0;
  const columnsRaw = (raw.columns ?? {}) as Record<string, { dwh?: unknown; keep_output_name?: unknown }>;
  const columns: DwhMapping["columns"] = {};
  for (const [ref, v] of Object.entries(columnsRaw)) {
    if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(ref) || !v || typeof v.dwh !== "string") {
      throw new Error(`dwh/mapping.yaml: columns.${ref} must be "table.column: { dwh: NEW_NAME, keep_output_name: true }"`);
    }
    columns[ref] = v.keep_output_name === true ? { dwh: v.dwh, keepOutputName: true } : { dwh: v.dwh };
  }
  return {
    linkedServer: need(raw, "linked_server", str, "a name"),
    oracleSchema: need(raw, "oracle_schema", str, "a name"),
    execMode: need(raw, "exec_mode", (v) => v === "exec_at" || v === "openquery", "exec_at or openquery"),
    oracleVersion: need(raw, "oracle_version", (v) => Number.isInteger(v), "a whole number"),
    nlsComp: need(raw, "nls_comp", str, "a value"),
    nlsSort: need(raw, "nls_sort", str, "a value"),
    dbCharset: need(raw, "db_charset", str, "a value"),
    columns,
    amosCollation: need(raw, "amos_collation", (v) => v === "C" || v === "other" || v === "unknown", "C, other or unknown"),
    exportRowLimit: need(raw, "export_row_limit", (v) => Number.isInteger(v) && (v as number) > 0, "a positive whole number"),
    knownMissingTables: knownMissing(raw),
  };
}

export function loadMapping(path: string): DwhMapping {
  return parseMapping(readFileSync(path, "utf8"));
}
