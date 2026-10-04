// Index of Database-Description-AMOS-csv.csv: the PHYSICAL truth (which tables/columns exist, types, keys).
import { readFileSync } from "node:fs";

export interface CsvColumn {
  table: string;
  name: string;
  keys: string[]; // e.g. ["P"], ["U", "I"]
  amosType: string; // e.g. DATE, TIME, TIMI, BOOL, ALPHANUM
  pgType: string; // e.g. int4, varchar(8)
  description: string;
}

export interface CsvTable {
  name: string;
  description: string;
  columns: Map<string, CsvColumn>;
}

export type CsvIndex = Map<string, CsvTable>;

/** RFC 4180-style parser: quoted fields may contain commas, "" escapes and newlines. */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

const IDENT = /^[a-z][a-z0-9_]*$/i;

export function buildCsvIndex(text: string): CsvIndex {
  const index: CsvIndex = new Map();
  let current: CsvTable | undefined;
  let expectDescription = false;
  for (const rec of parseCsvRecords(text.replace(/^\uFEFF/, ""))) {
    const first = rec[0] ?? "";
    if (!expectDescription && first.startsWith("Table ") && rec.slice(1).every((v) => v === "")) {
      const name = first.slice(6).trim().toLowerCase();
      current = index.get(name) ?? { name, description: "", columns: new Map() };
      index.set(name, current);
      expectDescription = true;
      continue;
    }
    if (!current) continue;
    if (first === "Keys" && rec[1] === "Name") {
      expectDescription = false;
      continue;
    }
    if (expectDescription) {
      current.description = first;
      expectDescription = false;
      continue;
    }
    const name = rec[1] ?? "";
    if (rec.length >= 4 && IDENT.test(name)) {
      const col: CsvColumn = {
        table: current.name,
        name: name.toLowerCase(),
        keys: first.replace(/[[\]\s]/g, "").split(",").filter(Boolean),
        amosType: rec[2] ?? "",
        pgType: rec[3] ?? "",
        description: rec[4] ?? "",
      };
      current.columns.set(col.name, col);
    }
  }
  return index;
}

export function loadCsvIndex(path: string): CsvIndex {
  return buildCsvIndex(readFileSync(path, "utf8"));
}

export function splitRef(ref: string): [string, string] {
  const dot = ref.indexOf(".");
  return [ref.slice(0, dot).toLowerCase(), ref.slice(dot + 1).toLowerCase()];
}

export function getColumn(csv: CsvIndex, ref: string): CsvColumn | undefined {
  const [table, column] = splitRef(ref);
  return csv.get(table)?.columns.get(column);
}

/** Which conventions encoding an AMOS type implies (undefined = none implied). */
export function encodingForAmosType(amosType: string): string | undefined {
  switch (amosType) {
    case "DATE":
    case "DATE_INT":
      return "date_int";
    case "TIME":
      return "time_minutes";
    case "TIMI":
      return "time_millis";
    case "BOOL":
      return "bool_yn";
    default:
      return undefined;
  }
}
