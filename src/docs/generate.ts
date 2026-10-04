import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { loadModel } from "../schema/load.ts";
import { loadCsvIndex, getColumn } from "../schema/csv.ts";
import { aliasOf, nameOf } from "../schema/alias.ts";

export function generateDocs(schemaDir: string, csvPath: string, outPath: string, checkOnly = false): void {
  const model = loadModel(schemaDir);
  const csv = loadCsvIndex(csvPath);

  let md = `# AMOS Logical Schema\n\n`;
  md += `> **Generated file.** Do not edit manually. Update the YAML files in \`schema/\` instead.\n\n`;

  // ERD
  md += `## Entity Relationship Diagram\n\n`;
  md += `\`\`\`mermaid\n`;
  md += `erDiagram\n`;
  
  for (const rel of model.relationships) {
    const [fromTable] = rel.from.split(".");
    const [toTable] = rel.to.split(".");
    
    let left = "}o";
    let right = "o{";
    let line = "--";
    
    if (rel.cardinality === "1:1") {
      left = "||"; right = "||";
    } else if (rel.cardinality === "1:N") {
      left = "||"; right = "o{";
    } else if (rel.cardinality === "N:1") {
      left = "}o"; right = "||";
    }
    
    md += `  ${fromTable} ${left}${line}${right} ${toTable} : "${rel.from} -> ${rel.to}"\n`;
  }
  md += `\`\`\`\n\n`;

  // Entities
  for (const { file, spec } of model.entities) {
    md += `## ${spec.entity}\n\n`;
    md += `${spec.description}\n\n`;
    
    md += `| Column | Name | Alias | Type | Trust | Notes/Meaning |\n`;
    md += `|---|---|---|---|---|---|\n`;

    for (const field of spec.fields || []) {
      const colInfo = getColumn(csv, field.column);
      const typeStr = colInfo ? `${colInfo.amosType} (${colInfo.pgType})` : "UNKNOWN";
      
      const name = nameOf(field) || "";
      const alias = field.name_status === "approved" && name ? aliasOf(name) : (name ? "(proposed)" : "");
      
      let meaning = field.meaning || (colInfo ? colInfo.description : "");
      if (field.enum && field.enum.values) {
        meaning += ` Enum: ` + Object.entries(field.enum.values).map(([k,v]) => `${k}=${v}`).join(", ");
      }
      if (field.use_instead) meaning += ` Use instead: ${field.use_instead}`;

      md += `| \`${field.column}\` | ${name} | ${alias} | ${typeStr} | ${field.trust} | ${meaning.replace(/\n/g, " ")} |\n`;
    }
    
    if (spec.derived && spec.derived.length > 0) {
      for (const der of spec.derived) {
        const name = nameOf(der) || "";
        const alias = der.name_status === "approved" && name ? aliasOf(name) : (name ? "(proposed)" : "");
        md += `| *(derived)* | ${name} | ${alias} | computed | - | From: ${der.from.join(", ")} |\n`;
      }
    }
    
    md += `\n`;
  }

  if (checkOnly) {
    let existing = "";
    try { existing = readFileSync(outPath, "utf8"); } catch(e) {}
    if (existing !== md) {
      throw new Error(`Docs are stale. Run 'npm run docs' to update.`);
    }
    console.log("Docs are up to date.");
  } else {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, md, "utf8");
    console.log(`Wrote docs to ${outPath}`);
  }
}
