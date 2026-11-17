// dwh/catalogue.json: snapshot of ALL_TAB_COLUMNS for STG_AMOS (plan A.6).
import { existsSync, readFileSync } from "node:fs";
import type { DwhMapping } from "./mapping.ts";
import type { RelayPool } from "./run.ts";
import { runRelay } from "./db.ts";

const CATALOGUE_COLUMNS = "TABLE_NAME, COLUMN_NAME, COLUMN_ID, DATA_TYPE, DATA_LENGTH, CHAR_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE";

/** The one fixed catalogue statement (A.6; the only form that works through the relay, Phase 0.3). */
export function catalogueStatement(mapping: DwhMapping): string {
  if (!/^[A-Za-z0-9_]+$/.test(mapping.linkedServer)) throw new Error("The linked server name in dwh/mapping.yaml may only contain letters, digits and _.");
  if (!/^[A-Z0-9_]+$/.test(mapping.oracleSchema)) throw new Error("The Oracle schema name in dwh/mapping.yaml may only contain A-Z, digits and _.");
  return `SELECT * FROM OPENQUERY([${mapping.linkedServer}], 'SELECT ${CATALOGUE_COLUMNS} FROM ALL_TAB_COLUMNS WHERE OWNER = ''${mapping.oracleSchema}''')`;
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function sortCatalogue(columns: CatalogueColumn[]): CatalogueColumn[] {
  return [...columns].sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : a.columnId - b.columnId || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}

/** Reads ALL_TAB_COLUMNS for the DWH schema through the relay (read-only). */
export async function fetchCatalogue(pool: RelayPool, mapping: DwhMapping): Promise<Catalogue> {
  const { rows } = await runRelay(pool, catalogueStatement(mapping));
  const columns = rows.map(
    (r): CatalogueColumn => ({
      table: String(r[0]),
      name: String(r[1]),
      columnId: Number(r[2]),
      dataType: String(r[3]),
      dataLength: numOrNull(r[4]),
      charLength: numOrNull(r[5]),
      precision: numOrNull(r[6]),
      scale: numOrNull(r[7]),
      nullable: r[8] === "Y",
    }),
  );
  return { takenAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), columns: sortCatalogue(columns) };
}

/** Stable JSON text for dwh/catalogue.json. */
export function catalogueJson(cat: Catalogue): string {
  return `${JSON.stringify({ takenAt: cat.takenAt, columns: sortCatalogue(cat.columns) }, null, 2)}\n`;
}

export interface CatalogueColumn {
  table: string;
  name: string;
  columnId: number;
  dataType: string;
  dataLength: number | null;
  charLength: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
}

export type Catalogue = { takenAt: string; columns: CatalogueColumn[] };

export function loadCatalogue(path: string): Catalogue | undefined {
  if (!existsSync(path)) return undefined;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Catalogue;
  if (typeof raw?.takenAt !== "string" || !Array.isArray(raw.columns)) throw new Error(`${path}: expected { takenAt, columns: [...] }`);
  return raw;
}

/** Catalogue lookups by upper-case name. */
export function catalogueIndex(cat: Catalogue): Map<string, { name: string; columns: Map<string, CatalogueColumn> }> {
  const tables = new Map<string, { name: string; columns: Map<string, CatalogueColumn> }>();
  for (const c of cat.columns) {
    const key = c.table.toUpperCase();
    let t = tables.get(key);
    if (!t) tables.set(key, (t = { name: c.table, columns: new Map() }));
    t.columns.set(c.name.toUpperCase(), c);
  }
  return tables;
}
