# Querying Rules

- **Schema First**: Always read the logical schema files in `schema/` first before creating queries. Never invent column names or aliases. The schema is the Single Source of Truth for how columns should be queried.
- **Strict Aliases Policy**: DO NOT use table aliases (e.g., `wo_header wh`). You may use column aliases ONLY IF explicitly approved by the user and documented in the schema. Any approved column alias MUST be CAPITALIZED and prefixed with `z_` (e.g., `wp_sequence.seqno AS z_WP_SEQ_2ND`). Otherwise, always write out full column names exactly as they appear in the database schema.
- **Name Approval Workflow**: You may propose canonical logical names for columns (e.g. `wp_id`), but you cannot use them in SQL until the user explicitly approves them.
- **Trust Levels**: Columns in the schema have trust levels. `documented` (exists in CSV), `probed` (live data verified), `unusable` (do not use, refer to `use_instead`).
- **`wo_text_description` Text Fields**: `wo_text_description.text` is ONLY populated if saved as plain text (otherwise `NULL`). Formatted step descriptions are stored in `wo_text_description.text_html`, and step titles in `wo_text_description.header`. Always SELECT `wo_text_description.header`, `wo_text_description.text`, and `wo_text_description.text_html` together to ensure full step text extraction.
- **No Column Combining**: Any SQL query must select and return exactly the column names as they appear in the database. Do not combine or concatenate columns (e.g., no `CONCAT()`, no `||`) within SQL queries.
- **Ask Before Combining**: If a user request implicitly requires combining columns, explicitly ask the user for permission or clarification before doing so.
- **1:1 Raw Extraction**: Keep raw data extraction as 1:1 with the database schema as possible.

## AI Agent Workflow

When the user asks you (the AI agent) to write a new query, you MUST follow this strict protocol:
1. **Check Existing Knowledge**: Attempt to construct the query using ONLY the verified relationships and columns documented in `schema/` and `docs/generated/schema.md`.
2. **Halt on Unknowns**: If the user asks for data that requires tables, columns, or JOINs not currently mapped in the logical schema, **DO NOT guess or invent relationships**. Explicitly tell the user: *"I do not have the knowledge in the schema to fulfill this request. I need to know how X connects to Y."*
3. **Process Discoveries**: If the user provides a new discovery (e.g., how two tables join, or the meaning of a cryptic column):
    - Validate the existence of the tables/columns against `Database-Description-AMOS-csv.csv`.
    - If valid, update the appropriate YAML file in `schema/`.
    - Run `npm run docs` to regenerate the documentation.
    - Run `npm run validate` to ensure everything is correct.
    - Finally, write the requested SQL query.
