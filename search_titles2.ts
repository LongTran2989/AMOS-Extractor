import { loadCsvIndex } from "./src/schema/csv.ts";
import * as path from "node:path";

const csvPath = path.join(process.cwd(), "Database-Description-AMOS-csv.csv");
const csv = loadCsvIndex(csvPath);

['fl2_event', 'fl2_etlb_defect'].forEach(t => {
  const table = csv.get(t);
  if (table) {
    console.log(`\n--- ${t} ---`);
    for (const [colName, col] of table.columns.entries()) {
      if (colName.includes('event_perf') || colName.includes('headline')) {
        console.log(`${colName}`);
      }
    }
  }
});
