// `npm run dwh:*` commands (dispatched from src/cli.ts). Offline: dwh:convert, dwh:check,
// dwh:schema-diff. Read-only live commands (through the relay, settings from .env):
// dwh:catalogue, dwh:compile-all.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { dwhCheck, dwhConvert, generateAll, SCHEMA_DIFF } from "./sources.ts";
import { loadMapping } from "./mapping.ts";
import { catalogueJson, fetchCatalogue } from "./catalogue.ts";
import { compileAll } from "./compileAll.ts";
import { dwhConfigFromEnv, openPool } from "./db.ts";
import type { RelayPool } from "./run.ts";

const COMMANDS = "dwh:convert, dwh:check, dwh:catalogue, dwh:schema-diff, dwh:compile-all";

/** Opens the relay pool from .env, runs fn, always closes the pool. */
async function withPool<T>(fn: (pool: RelayPool) => Promise<T>): Promise<T> {
  const pool = await openPool(dwhConfigFromEnv(process.env));
  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

export async function runDwh(command: string, _args: string[], root: string): Promise<number> {
  switch (command) {
    case "dwh:convert": {
      const r = dwhConvert(root);
      for (const f of r.written) console.log(`wrote   ${f}`);
      for (const f of r.removed) console.log(`removed ${f}`);
      if (r.refused.length) console.log(`Not converted (see queries/dwh/_manifest.json for the reason): ${r.refused.join(", ")}`);
      console.log(r.written.length || r.removed.length ? "queries/dwh/ updated." : "queries/dwh/ was already up to date.");
      return 0;
    }
    case "dwh:check": {
      const problems = dwhCheck(root);
      for (const p of problems) console.log(`ERROR: ${p}`);
      if (problems.length) return 1;
      console.log("queries/dwh/ is up to date.");
      return 0;
    }
    case "dwh:schema-diff": {
      if (!existsSync(path.join(root, "dwh", "catalogue.json"))) {
        console.log("No DWH catalogue snapshot yet (dwh/catalogue.json). Run npm run dwh:catalogue first.");
        return 1;
      }
      const md = generateAll(root).get(SCHEMA_DIFF)!;
      mkdirSync(path.dirname(path.join(root, SCHEMA_DIFF)), { recursive: true });
      writeFileSync(path.join(root, SCHEMA_DIFF), md, "utf8");
      console.log(`wrote ${SCHEMA_DIFF}`);
      return 0;
    }
    case "dwh:catalogue": {
      const mapping = loadMapping(path.join(root, "dwh", "mapping.yaml"));
      const cat = await withPool((pool) => fetchCatalogue(pool, mapping));
      writeFileSync(path.join(root, "dwh", "catalogue.json"), catalogueJson(cat), "utf8");
      const tables = new Set(cat.columns.map((c) => c.table)).size;
      console.log(`wrote dwh/catalogue.json: ${cat.columns.length} columns in ${tables} tables (taken ${cat.takenAt}). Next: npm run dwh:schema-diff and npm run dwh:convert.`);
      return 0;
    }
    case "dwh:compile-all": {
      const results = await withPool((pool) => compileAll(pool, root));
      for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.source}${r.message ? `  ${r.message}` : ""}`);
      const failed = results.filter((r) => !r.ok).length;
      console.log(`${results.length - failed} of ${results.length} available queries compile in the DWH.`);
      return failed ? 1 : 0;
    }
    default:
      console.log(`Unknown command: ${command} (available: ${COMMANDS})`);
      return 1;
  }
}
