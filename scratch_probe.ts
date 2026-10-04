import { readFileSync } from "node:fs";
import sqlParser from "node-sql-parser";
import { Ajv2020 } from "ajv/dist/2020.js";

console.log("ajv named export:", typeof Ajv2020);
const { Parser } = sqlParser;
const p = new Parser();
for (const f of ["extract_han_workpacks_date_range.sql", "list_all_seq_in_a_single_wp_3_levels_w_sts.sql", "extract_work_order.sql", "extract_han_workpacks_today.sql"]) {
  const sql = readFileSync(`g:/AMOS-Extractor/${f}`, "utf8");
  try {
    const ast: any = p.astify(sql, { database: "PostgresQL" });
    const s = Array.isArray(ast) ? ast[0] : ast;
    console.log("OK", f, "cols", s.columns.length);
    if (f.startsWith("extract_han_workpacks_date")) {
      console.log(JSON.stringify(s.columns.slice(0, 2), null, 0));
      console.log(JSON.stringify(s.from, null, 0).slice(0, 900));
    }
  } catch (e: any) {
    console.log("FAIL", f, String(e.message).slice(0, 300));
  }
}
for (const q of ["SELECT wh.a FROM wo_header wh", "SELECT a.b || a.c FROM a", "SELECT CONCAT(a.b, a.c) AS x FROM a"]) {
  const s: any = p.astify(q, { database: "PostgresQL" });
  console.log(q, "=>", JSON.stringify((Array.isArray(s) ? s[0] : s).columns[0]).slice(0, 400), JSON.stringify((Array.isArray(s) ? s[0] : s).from));
}
