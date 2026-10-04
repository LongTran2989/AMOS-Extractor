import { loadCsvIndex } from "./src/schema/csv.ts";
import * as path from "node:path";

const csvPath = path.join(process.cwd(), "Database-Description-AMOS-csv.csv");
const csv = loadCsvIndex(csvPath);

['event_finding', 'od_repair_compwo'].forEach(t => {
  const table = csv.get(t);
  if (table) {
    console.log(`\n--- ${t} ---`);
    for (const [colName, col] of table.columns.entries()) {
      console.log(`${colName}`);
    }
  }
});
