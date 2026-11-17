// dwh/catalogue.json: snapshot of ALL_TAB_COLUMNS for STG_AMOS (plan A.6).
// Fetching it is Task 2.2; this file only defines the model and loads a committed snapshot.
import { existsSync, readFileSync } from "node:fs";

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
