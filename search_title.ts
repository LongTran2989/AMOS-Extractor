import { loadCsvIndex } from "./src/schema/csv.ts";
import * as path from "node:path";

const csvPath = path.join(process.cwd(), "Database-Description-AMOS-csv.csv");
const csv = loadCsvIndex(csvPath);

for (const [tableName, table] of csv.entries()) {
  if (tableName.includes("event") || tableName.includes("finding") || tableName.includes("work") || tableName.includes("job")) {
    for (const [colName, col] of table.columns.entries()) {
      const desc = col.description.toLowerCase();
      if (colName.includes("title") || colName.includes("desc") || colName.includes("name") || desc.includes("title") || desc.includes("jobcard") || desc.includes("finding")) {
        console.log(`${tableName}.${colName}: ${col.description}`);
      }
    }
  }
}
