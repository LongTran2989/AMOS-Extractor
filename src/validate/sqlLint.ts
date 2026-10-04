import sqlParser from "node-sql-parser";
const { Parser } = sqlParser;
import type { Model } from "../schema/types.ts";
import type { CsvIndex } from "../schema/csv.ts";
import { getColumn } from "../schema/csv.ts";
import { aliasOf } from "../schema/alias.ts";

export interface LintResult {
  file: string;
  errors: string[];
  warnings: string[];
}

export function lintSql(sql: string, filename: string, model: Model, csv: CsvIndex): LintResult {
  const result: LintResult = { file: filename, errors: [], warnings: [] };
  const p = new Parser();
  let ast: any;
  
  try {
    const parsed = p.astify(sql, { database: "PostgresQL" });
    ast = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (e: any) {
    result.errors.push(`Parse error: ${e.message}`);
    return result;
  }

  // R6: Table aliases
  if (ast.from) {
    for (const table of ast.from) {
      if (table.as && typeof table.as === "string") {
        result.errors.push(`[R6] Table alias used: '${table.table} AS ${table.as}'. Table aliases are forbidden.`);
      }
    }
  }

  // R8: Each JOIN matches a declared relationship
  if (ast.from) {
    for (const table of ast.from) {
      if (table.join && table.join.includes("JOIN") && table.on) {
        // Simplified check: we extract left/right tables and columns.
        if (table.on.type === "binary_expr" && table.on.operator === "=") {
          const left = table.on.left;
          const right = table.on.right;
          if (left.type === "column_ref" && right.type === "column_ref") {
            const lRef = `${left.table}.${left.column.expr.value}`;
            const rRef = `${right.table}.${right.column.expr.value}`;
            
            // Check if model.relationships has this join
            const relMatch = model.relationships.some(r => 
              (r.from === lRef && r.to === rRef) || (r.from === rRef && r.to === lRef)
            );
            if (!relMatch) {
              result.errors.push(`[R8] Undeclared JOIN: ${lRef} = ${rRef}`);
            }
          }
        }
      }
    }
  }

  if (!ast.columns || ast.columns === "*") return result;

  const outCols = new Set<string>();
  let hasText = false, hasTextHtml = false, hasHeader = false;

  for (const col of ast.columns) {
    // R7: no concat in SELECT
    const expr = col.expr;
    if (!expr) continue;
    
    if (expr.type === "binary_expr" && expr.operator === "||") {
      result.errors.push(`[R7] Concatenation (||) found in SELECT.`);
      continue;
    }
    if (expr.type === "function") {
      const funcName = Array.isArray(expr.name.name) ? expr.name.name[0]?.value : expr.name.name?.value;
      if (funcName && ["CONCAT", "CONCAT_WS"].includes(funcName.toUpperCase())) {
        result.errors.push(`[R7] CONCAT function found in SELECT.`);
      }
      continue;
    }

    if (expr.type === "column_ref") {
      const table = expr.table;
      const column = expr.column.expr.value;
      const alias = col.as;
      
      const outName = alias || column;
      if (outCols.has(outName)) {
        result.warnings.push(`[R10] Duplicate output column name: ${outName}`);
      }
      outCols.add(outName);

      if (table === "wo_text_description") {
        if (column === "text") hasText = true;
        if (column === "text_html") hasTextHtml = true;
        if (column === "header") hasHeader = true;
      }

      if (table) {
        const ref = `${table}.${column}`.toLowerCase();
        
        // R1: Exists in CSV
        const csvCol = getColumn(csv, ref);
        if (!csvCol) {
          result.errors.push(`[R1] Column ${ref} does not exist in the database (not in CSV).`);
          continue; // skip other checks if it doesn't exist
        }

        // R2: Registered in schema
        const regField = model.fieldByColumn.get(ref);
        if (!regField) {
          result.warnings.push(`[R2] Column ${ref} is not registered in the schema (schema/...).`);
          // Note: we continue checks that don't depend on regField
        }

        if (regField) {
          const field = regField.field;
          const status = field.name_status;
          
          // R9: Trust unusable
          if (field.trust === "unusable") {
            const useInstead = field.use_instead ? ` (use ${field.use_instead} instead)` : "";
            result.warnings.push(`[R9] Selected column ${ref} has trust: unusable.${useInstead}`);
          }

          if (status === "approved" && field.name) {
            const expectedAlias = aliasOf(field.name);
            if (!alias) {
              result.errors.push(`[R4] Column ${ref} has an approved name ('${field.name}') but no alias is used. Expecting 'AS ${expectedAlias}'.`);
            } else if (alias !== expectedAlias) {
              result.errors.push(`[R3] Column ${ref} alias mismatch. Expected 'AS ${expectedAlias}', got 'AS ${alias}'.`);
            }
          } else {
            // Unnamed or proposed
            if (alias) {
              result.errors.push(`[R5] Column ${ref} has no approved name, but an alias ('${alias}') was used.`);
            }
          }
        }
      }
    }
  }

  // R11: wo_text_description check
  if (hasText || hasTextHtml || hasHeader) {
    if (!(hasText && hasTextHtml && hasHeader)) {
      result.warnings.push(`[R11] wo_text_description.text, .text_html and .header must be selected together.`);
    }
  }

  return result;
}
