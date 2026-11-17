# AMOS Extractor

Welcome to the **AMOS Extractor** project! If you're new here, this guide will help you understand what this codebase is, why it exists, and how to use it.

## 🌟 What is this project?

AMOS is a massive aircraft maintenance management software with a highly complex and largely undocumented database (over 45,000 columns). Extracting raw data from AMOS can be tricky because:
1. Column names can be cryptic (e.g., `wpno_i`, `event_perfno_i`).
2. Table relationships (JOINs) aren't always obvious.

This project solves those problems by creating a **Logical Schema layer** over the raw AMOS database. It does this by:
1. **Defining the Truth**: We map out exactly how tables connect (like Workpacks → Work Orders → Work Steps) using clean YAML files.
2. **Standardizing Names**: We define strict, approved aliases (e.g., `z_WP_NO`) so everyone queries the data consistently.
3. **Automated Validation**: We built a custom TypeScript tool that reads any SQL query you write and strictly validates it against our rules.

## 📂 Codebase Structure

Here is a quick tour of the important files and folders:

- **`schema/`**: The heart of the project. Contains YAML files (e.g., `workpack.yaml`, `workorder.yaml`) that define the logical entities, their columns, aliases, and how tables JOIN together.
- **`src/`**: The TypeScript source code for the custom CLI tools (Schema Loader, SQL Validator, and Docs Generator).
- **`docs/`**: Documentation folder. 
  - `docs/generated/schema.md` is automatically generated and contains the full schema documentation and Entity Relationship Diagram (ERD).
- **`queries/wp_seqs/`**: generated steps/parts queries per station-department pair (`npm run scaffold`); see `docs/wp-seqs-split-extraction.md`.
- **`*.sql`**: SQL query files (like `extract_work_order.sql`) living in the root directory. These are the actual queries used to pull data out of AMOS.
- **`Database-Description-AMOS-csv.csv`**: A massive raw export of the physical AMOS database schema. Our CLI uses this to verify that columns actually exist in the physical database.

## 🚀 How to Use It

### 1. Writing SQL Queries
When you write an SQL query to extract data from AMOS, you must follow strict rules:
- Look at `docs/generated/schema.md` or the YAML files in `schema/` to see what tables and columns are available.
- **DO NOT** invent column aliases. If a column has an approved alias in the schema (e.g., `wp_id`), you *must* use it exactly like this: `wp_header.wpno_i AS z_WP_ID`.
- Save your query as a `.sql` file in the root directory.

### 2. Validating Your Queries
To ensure your SQL queries are correct and follow our conventions, run the validator:

```bash
npm run validate
```
This tool will scan all `.sql` files in the root folder and tell you if:
- You are using columns that don't exist.
- You forgot to declare a table JOIN in the schema.
- You forgot to use an approved alias (or used it incorrectly).

### 3. Generating Documentation
Whenever you update the YAML files in `schema/` to add new tables, columns, or relationships, you should regenerate the markdown documentation:

```bash
npm run docs
```
This updates `docs/generated/schema.md` with the latest tables and a beautiful Mermaid ERD (Entity Relationship Diagram).

## 🛠️ Adding New Data

If you discover new tables in AMOS that need to be extracted:
1. Create or update a YAML file in the `schema/` directory.
2. Define the `tables`, their `primary_key`s, and the `joins` that connect them to existing tables.
3. Add the `fields` (columns) you care about. If you want to propose a cleaner name, add `name: my_clean_name` and `name_status: proposed`.
4. Run `npm run docs` to update the documentation.
5. Write your `.sql` query.
6. Run `npm run validate` to ensure everything links up perfectly.
