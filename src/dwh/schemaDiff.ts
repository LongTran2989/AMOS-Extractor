// Task 2.2: compare the AMOS tables and columns the repo uses with the DWH catalogue snapshot
// (plan A.6 "Diff" and its Oracle compatibility table). Offline: no database access.
import type { CsvIndex } from "../schema/csv.ts";
import type { Model } from "../schema/types.ts";
import { catalogueIndex, type Catalogue } from "./catalogue.ts";
import type { DwhMapping } from "./mapping.ts";
import { sqlTypeOfPg } from "./convert/scope.ts";

export interface SchemaIssue {
  kind: "missing_table" | "missing_column" | "case_only" | "retyped" | "truncation_risk" | "maybe_lost_unicode" | "extra_column";
  severity: "error" | "warning" | "info";
  table: string;
  column?: string;
  amos?: string;
  dwh?: string;
  plain: string;
}

const NUMBER_TYPES = new Set(["NUMBER", "FLOAT", "BINARY_DOUBLE", "BINARY_FLOAT", "INTEGER"]);
const CHAR_TYPES = new Set(["VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR"]);
const LOB_TYPES = new Set(["CLOB", "NCLOB"]);
const NATIONAL = new Set(["NVARCHAR2", "NCHAR", "NCLOB"]);
const UNICODE_CHARSETS = new Set(["AL32UTF8", "UTF8", "AL16UTF16", "UTFE"]);
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

const baseType = (t: string) => t.toUpperCase().replace(/\(.*$/, "").trim();

/** Lower-case table -> lower-case columns, from "table.column" and bare "table" references. */
function wanted(used: string[], model: Model, csv: CsvIndex): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const ref of [...used, ...model.fieldByColumn.keys()]) {
    const [t, c] = ref.toLowerCase().split(".") as [string, string | undefined];
    if (!csv.has(t)) continue;
    let set = out.get(t);
    if (!set) out.set(t, (set = new Set()));
    if (c && csv.get(t)!.columns.has(c)) set.add(c);
  }
  return out;
}

function typeIssues(table: string, column: string, pgType: string, dataType: string, len: number | null, mapping: DwhMapping): SchemaIssue[] {
  const amos = sqlTypeOfPg(pgType);
  const ora = baseType(dataType);
  const at = { table: table.toUpperCase(), column: column.toUpperCase(), amos: pgType, dwh: len !== null && CHAR_TYPES.has(ora) ? `${ora}(${len})` : dataType };
  const issues: SchemaIssue[] = [];
  if (amos === "int" || amos === "numeric" || amos === "float") {
    if (!NUMBER_TYPES.has(ora)) issues.push({ kind: "retyped", severity: "error", ...at, plain: `AMOS stores a number (${pgType}); the DWH stores ${dataType}. Queries that compute with it are refused.` });
    return issues;
  }
  if (amos !== "text") return issues;
  const isText = /^text/i.test(pgType);
  if (CHAR_TYPES.has(ora)) {
    const n = /\((\d+)\)/.exec(pgType)?.[1];
    if (isText) {
      issues.push({ kind: "truncation_risk", severity: "warning", ...at, plain: `AMOS text has no length limit; the DWH keeps at most ${len ?? "?"} characters, so long values may be cut off.` });
    } else if (n !== undefined && len !== null && len < Number(n)) {
      issues.push({ kind: "truncation_risk", severity: "warning", ...at, plain: `AMOS allows ${n} characters; the DWH keeps at most ${len}, so long values may be cut off.` });
    }
  } else if (LOB_TYPES.has(ora)) {
    // #65: no CLOB rule is built, so the converter refuses queries that use such a column.
    issues.push({ kind: "retyped", severity: "error", ...at, plain: `AMOS stores text (${pgType}); the DWH stores it as ${dataType}, which the converter does not handle yet. Queries that use it are refused.` });
    return issues;
  } else {
    issues.push({ kind: "retyped", severity: "error", ...at, plain: `AMOS stores text (${pgType}); the DWH stores ${dataType}.` });
    return issues;
  }
  if (!NATIONAL.has(ora) && !UNICODE_CHARSETS.has(mapping.dbCharset.toUpperCase())) {
    issues.push({ kind: "maybe_lost_unicode", severity: "warning", ...at, plain: `The DWH database character set is ${mapping.dbCharset}, so Vietnamese letters in this column may be lost.` });
  }
  return issues;
}

export function diffSchema(cat: Catalogue, csv: CsvIndex, model: Model, used: string[], mapping: DwhMapping): SchemaIssue[] {
  const idx = catalogueIndex(cat);
  const issues: SchemaIssue[] = [];
  for (const [table, columns] of wanted(used, model, csv)) {
    const T = table.toUpperCase();
    const catTable = idx.get(T);
    if (!catTable) {
      issues.push({ kind: "missing_table", severity: "error", table: T, plain: `The DWH has no table ${T}. Queries that use it cannot run there.` });
      continue;
    }
    const csvTable = csv.get(table)!;
    for (const column of [...columns].sort()) {
      const ref = `${table}.${column}`;
      const dwhName = (mapping.columns[ref]?.dwh ?? column).toUpperCase();
      const catCol = catTable.columns.get(dwhName);
      if (!catCol) {
        issues.push({ kind: "missing_column", severity: "error", table: T, column: column.toUpperCase(), plain: `The DWH table ${T} has no column ${dwhName}.` });
        continue;
      }
      if (catCol.name !== dwhName) {
        issues.push({ kind: "case_only", severity: "info", table: T, column: column.toUpperCase(), dwh: catCol.name, plain: `The DWH spells this column ${catCol.name}; the converter uses that spelling.` });
      }
      issues.push(...typeIssues(table, column, csvTable.columns.get(column)!.pgType, catCol.dataType, catCol.charLength ?? catCol.dataLength, mapping));
    }
    const renamedTargets = new Set(Object.entries(mapping.columns).filter(([r]) => r.startsWith(`${table}.`)).map(([, v]) => v.dwh.toUpperCase()));
    for (const [upper, col] of catTable.columns) {
      if (csvTable.columns.has(upper.toLowerCase()) || renamedTargets.has(upper)) continue;
      issues.push({ kind: "extra_column", severity: "info", table: T, column: col.name, dwh: col.dataType, plain: `The DWH has a column ${col.name} that AMOS does not describe.` });
    }
  }
  return sortIssues(issues);
}

function sortIssues(issues: SchemaIssue[]): SchemaIssue[] {
  const key = (i: SchemaIssue) => [SEVERITY_ORDER[i.severity], i.table, i.column ?? "", i.kind] as const;
  return [...issues].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
    return 0;
  });
}

const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function renderDiffMarkdown(issues: SchemaIssue[], cat: Catalogue): string {
  const sorted = sortIssues(issues);
  const count = (s: SchemaIssue["severity"]) => sorted.filter((i) => i.severity === s).length;
  const lines = [
    "<!-- GENERATED by `npm run dwh:schema-diff` (and `npm run dwh:convert`). DO NOT EDIT. -->",
    "# DWH schema differences",
    "",
    `Catalogue snapshot taken at ${cat.takenAt} (UTC). Compares the AMOS tables and columns used by the repo queries and \`schema/*.yaml\` with the DWH copy.`,
    "",
    `Errors: ${count("error")} · Warnings: ${count("warning")} · Notes: ${count("info")}`,
    "",
  ];
  if (!sorted.length) lines.push("No differences.");
  else {
    lines.push("| Severity | Kind | Table | Column | AMOS | DWH | What it means |", "|---|---|---|---|---|---|---|");
    for (const i of sorted) lines.push(`| ${i.severity} | ${i.kind} | ${cell(i.table)} | ${cell(i.column)} | ${cell(i.amos)} | ${cell(i.dwh)} | ${cell(i.plain)} |`);
  }
  return `${lines.join("\n")}\n`;
}
