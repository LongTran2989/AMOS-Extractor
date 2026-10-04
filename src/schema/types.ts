// Shapes of the files in schema/. Mirrors schema/entity.schema.json (which is what actually enforces them).

export type Trust = "documented" | "probed" | "unusable";
export type NameStatus = "approved" | "proposed" | "unnamed";
export type Encoding = "date_int" | "time_minutes" | "time_millis" | "bool_yn";
export type Cardinality = "1:1" | "1:N" | "N:1";

export interface Join {
  from: string; // table.column
  to: string; // table.column
  type: "inner" | "left";
  cardinality: Cardinality; // seen from `from` to `to`
  trust?: Trust;
  note?: string;
}

export interface TableSpec {
  role?: "root" | "lookup" | "link" | "child";
  meaning?: string;
  primary_key?: string[];
  joins?: Join[];
}

export interface EnumSpec {
  source: "csv" | "user" | "lookup";
  lookup?: string;
  values?: Record<string, string>;
  other?: string;
}

export interface Naming {
  name_status: NameStatus;
  name?: string;
  proposed_name?: string;
}

export interface FieldSpec extends Naming {
  column: string;
  trust: Trust;
  meaning?: string;
  multi_valued?: boolean;
  encoding?: Encoding;
  enum?: EnumSpec;
  note?: string;
  use_instead?: string;
}

export interface DerivedSpec extends Naming {
  from: string[];
  transform: {
    kind: "datetime" | "date" | "time" | "sequence_label";
    date?: "date_int";
    time?: "time_minutes" | "time_millis";
    separator?: string;
  };
  meaning?: string;
}

export interface EntityFile {
  entity: string;
  description: string;
  root: string;
  tables: Record<string, TableSpec>;
  fields: FieldSpec[];
  derived?: DerivedSpec[];
  notes?: string[];
}

export interface Conventions {
  naming: {
    pattern: string;
    prefixes: Record<string, string>;
    grandfathered: string[];
  };
  alias: { rule: string };
  encodings: Record<string, { amos_types?: string[] }>;
}

export interface Relationship extends Join {
  entity: string; // entity file that declares it
  table: string; // table under which it is declared
}

export interface RegisteredField {
  entity: string;
  field: FieldSpec;
}

export interface Model {
  conventions: Conventions;
  entities: { file: string; spec: EntityFile }[];
  fieldByColumn: Map<string, RegisteredField>;
  tableOwner: Map<string, string>; // table -> entity
  relationships: Relationship[];
}
