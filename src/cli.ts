import { readFileSync, readdirSync } from "node:fs";
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

  const files = readdirSync(process.cwd()).filter(f => f.endsWith(".sql") && f !== "AMOS-WO.sql");
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
} else if (command === "scaffold") {
  console.log("scaffold not implemented yet");
} else {
  console.log(`Unknown command: ${command}`);
}
