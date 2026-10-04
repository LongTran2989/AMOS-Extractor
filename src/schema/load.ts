import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import yaml from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Model, EntityFile, Conventions, RegisteredField, Relationship, FieldSpec } from "./types.ts";
import { aliasOf, nameOf } from "./alias.ts";

export function loadModel(schemaDir: string): Model {
  const conventionsPath = path.join(schemaDir, "_conventions.yaml");
  const conventions = yaml.parse(readFileSync(conventionsPath, "utf8")) as Conventions;

  const schemaPath = path.join(schemaDir, "entity.schema.json");
  const entitySchema = JSON.parse(readFileSync(schemaPath, "utf8"));

  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(entitySchema);

  const model: Model = {
    conventions,
    entities: [],
    fieldByColumn: new Map(),
    tableOwner: new Map(),
    relationships: [],
  };

  const files = readdirSync(schemaDir).filter(f => f.endsWith(".yaml") && f !== "_conventions.yaml");

  const usedNames = new Map<string, string>(); // name -> file.column
  const usedAliases = new Map<string, string>(); // alias -> file.column

  for (const file of files) {
    const fullPath = path.join(schemaDir, file);
    const text = readFileSync(fullPath, "utf8");
    const spec = yaml.parse(text) as EntityFile;

    if (!validate(spec)) {
      const errors = ajv.errorsText(validate.errors);
      throw new Error(`Validation failed for ${file}:\n${errors}`);
    }

    model.entities.push({ file, spec });

    for (const [tableName, tableDef] of Object.entries(spec.tables)) {
      if (model.tableOwner.has(tableName)) {
        throw new Error(`Table ${tableName} is declared in both ${model.tableOwner.get(tableName)} and ${file}`);
      }
      model.tableOwner.set(tableName, spec.entity);

      if (tableDef.joins) {
        for (const join of tableDef.joins) {
          model.relationships.push({ ...join, entity: spec.entity, table: tableName });
        }
      }
    }

    for (const field of spec.fields || []) {
      if (model.fieldByColumn.has(field.column)) {
        throw new Error(`Duplicate column mapping for ${field.column} in ${file}`);
      }
      model.fieldByColumn.set(field.column, { entity: spec.entity, field });

      const name = nameOf(field);
      if (name) {
        if (usedNames.has(name)) {
          throw new Error(`Duplicate name '${name}' in ${file}.${field.column} (already used in ${usedNames.get(name)})`);
        }
        usedNames.set(name, `${file}.${field.column}`);

        // Only enforce aliases for approved names
        if (field.name_status === "approved") {
          const alias = aliasOf(name);
          if (usedAliases.has(alias)) {
            throw new Error(`Duplicate alias '${alias}' for ${field.column} (already used in ${usedAliases.get(alias)})`);
          }
          usedAliases.set(alias, `${file}.${field.column}`);
        }
      }
    }

    for (const derived of spec.derived || []) {
      const name = nameOf(derived);
      if (name) {
        if (usedNames.has(name)) {
          throw new Error(`Duplicate name '${name}' in ${file}.derived (already used in ${usedNames.get(name)})`);
        }
        usedNames.set(name, `${file}.derived`);

        if (derived.name_status === "approved") {
          const alias = aliasOf(name);
          if (usedAliases.has(alias)) {
             throw new Error(`Duplicate alias '${alias}' for derived field in ${file} (already used in ${usedAliases.get(alias)})`);
          }
          usedAliases.set(alias, `${file}.derived`);
        }
      }
    }
  }

  return model;
}
