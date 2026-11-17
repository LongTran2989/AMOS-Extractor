import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { loadModel } from "./schema/load.ts";
import { loadCsvIndex } from "./schema/csv.ts";
import { lintSql } from "./validate/sqlLint.ts";

const command = process.argv[2];

if (command === "validate") {
  const schemaDir = path.join(process.cwd(), "schema");
  const model = loadModel(schemaDir);
  const csvPath = path.join(process.cwd(), "Database-Description-AMOS-csv.csv");
  const csv = loadCsvIndex(csvPath);

  // Root queries plus the generated per-pair queries (queries/wp_seqs/).
  const sqlIn = (dir: string) => readdirSync(path.join(process.cwd(), dir)).filter(f => f.endsWith(".sql") && f !== "AMOS-WO.sql").map(f => path.join(dir, f));
  const files = [...sqlIn("."), ...sqlIn(path.join("queries", "wp_seqs"))];
  let hasErrors = false;

  for (const file of files) {
    let sql = readFileSync(path.join(process.cwd(), file), "utf8");
    // Pre-replace the placeholder inside single quotes so node-sql-parser can parse it
    sql = sql.replace(/<INSERT_WPNO_HERE>/g, "placeholder");
    
    const result = lintSql(sql, file, model, csv);
    
    if (result.errors.length > 0 || result.warnings.length > 0) {
      console.log(`\n=== ${file} ===`);
      for (const e of result.errors) console.log(`ERROR: ${e}`);
      for (const w of result.warnings) console.log(`WARN:  ${w}`);
      if (result.errors.length > 0) hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  } else {
    console.log("Validation passed.");
  }
} else if (command === "docs" || command === "docs:check") {
  const { generateDocs } = await import("./docs/generate.ts");
  const schemaDir = path.join(process.cwd(), "schema");
  const csvPath = path.join(process.cwd(), "Database-Description-AMOS-csv.csv");
  const outPath = path.join(process.cwd(), "docs", "generated", "schema.md");
  generateDocs(schemaDir, csvPath, outPath, command === "docs:check");
} else if (command === "stitch" || command === "stitch:compare") {
  const { parseCsv, toCsv, stitch, compareTables } = await import("./stitch/stitch.ts");
  const read = (f: string) => parseCsv(readFileSync(f, "utf8"));
  const [a, b, c] = process.argv.slice(3).filter(x => !x.startsWith("--"));
  const keyArg = process.argv.find(x => x.startsWith("--key="));
  const keys = keyArg ? keyArg.slice(6).split(",") : undefined;
  if (command === "stitch") {
    if (!a || !b || !c) { console.log("Usage: stitch <steps.csv> <parts.csv> <out.csv> [--key=COL1,COL2]"); process.exit(1); }
    const { table, orphanParts } = stitch(read(a), read(b), keys);
    writeFileSync(c, toCsv(table), "utf8");
    console.log(`Wrote ${table.rows.length} rows to ${c}`);
    if (orphanParts) console.warn(`WARN: dropped ${orphanParts} part rows with no matching step (WPs changed between the two runs?)`);
  } else {
    // Last file is the stitched output; every file before it is a legacy export (or a piece of one).
    const files = process.argv.slice(3).filter(x => !x.startsWith("--"));
    if (files.length < 2) { console.log("Usage: stitch:compare <legacy.csv> [<legacy2.csv> ...] <stitched.csv>"); process.exit(1); }
    const legacy = files.slice(0, -1).map(read);
    const stitched = read(files[files.length - 1]!);
    const problems = compareTables({ header: legacy[0]!.header, rows: legacy.flatMap(t => t.rows) }, stitched);
    if (problems.length) { for (const p of problems) console.log(p); process.exit(1); }
    console.log("Identical (ignoring row order).");
  }
} else if (command === "scaffold") {
  const { scaffoldWpSeqs } = await import("./scaffold/wpSeqs.ts");
  const written = scaffoldWpSeqs(process.cwd());
  console.log(`Wrote ${written.length} files to queries/wp_seqs/`);
} else {
  console.log(`Unknown command: ${command}`);
}
