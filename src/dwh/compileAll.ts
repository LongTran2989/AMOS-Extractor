// Task 2.2: live compile check. Every converted query that the DWH can run is sent with zero
// rows requested, so Oracle parses and plans it without returning data (read-only).
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { loadModel } from "../schema/load.ts";
import { loadCsvIndex } from "../schema/csv.ts";
import { loadMapping, type DwhMapping } from "./mapping.ts";
import { loadCatalogue } from "./catalogue.ts";
import { ConvertError } from "./convert/errors.ts";
import { convertQuery } from "./convert/index.ts";
import { listSources } from "./sources.ts";
import { assertReadOnlyOracle } from "./safety.ts";
import { applyPreviewCap, buildRelayStatement } from "./relay.ts";
import { runRelay } from "./db.ts";
import { checkOutputNames, type RelayPool } from "./run.ts";
import { toPlain } from "./errorsPlain.ts";

/** Value used for placeholders during the compile check (passes the openquery value check). */
const DUMMY_VALUE = "X";

/** Zero-row version of an Oracle query: FETCH FIRST 0 ROWS ONLY on 12c+, else a WHERE 1 = 0 wrapper. */
export function zeroRows(exec: string, version: number): string {
  return version >= 12 ? applyPreviewCap(exec, version, 0, false) : `SELECT * FROM (${exec}) WHERE 1 = 0`;
}

export async function compileAll(
  pool: RelayPool,
  root: string,
  opts: { mapping?: DwhMapping; cataloguePath?: string } = {},
): Promise<{ source: string; ok: boolean; message?: string }[]> {
  const model = loadModel(path.join(root, "schema"));
  const csv = loadCsvIndex(path.join(root, "Database-Description-AMOS-csv.csv"));
  const mapping = opts.mapping ?? loadMapping(path.join(root, "dwh", "mapping.yaml"));
  const catalogue = loadCatalogue(opts.cataloguePath ?? path.join(root, "dwh", "catalogue.json"));
  const results: { source: string; ok: boolean; message?: string }[] = [];
  for (const source of listSources(root)) {
    const text = readFileSync(path.join(root, source), "utf8").replace(/\r\n?/g, "\n");
    let conv;
    try {
      conv = convertQuery(text, source, { model, csv, mapping, ...(catalogue ? { catalogue } : {}) });
    } catch (e) {
      if (e instanceof ConvertError) continue; // refused: listed in the manifest, nothing to compile
      throw e;
    }
    if (conv.available === false) continue;
    try {
      if (mapping.execMode === "openquery") checkOutputNames(conv);
      const zero = zeroRows(conv.exec, mapping.oracleVersion);
      assertReadOnlyOracle(zero);
      const params = conv.placeholders.map((p) => ({ name: p.name, value: DUMMY_VALUE, maxLength: p.maxLength }));
      const { tsql, inputs } = buildRelayStatement(zero, mapping.execMode, params, mapping.linkedServer);
      await runRelay(pool, tsql, inputs);
      results.push({ source, ok: true });
    } catch (e) {
      // Plain message, with the .env values (server, user, password) removed from the technical part.
      const p = toPlain(e);
      const ora = /ORA-\d{5}[^\n"]*/.exec(p.detail)?.[0];
      results.push({ source, ok: false, message: e instanceof ConvertError ? `${e.code}: ${e.plain}` : `${p.message}${ora ? ` (${ora.trim()})` : ""}` });
    }
  }
  return results;
}
