# Querying Rules

- **Zero Aliases (No Table or Column Aliases)**: DO NOT use column aliases (e.g., `AS work_order_id`) or table aliases (e.g., `wo_header wh`). Always write out full table and column names exactly as they appear in the database schema (e.g., `wo_header.event_perfno_i`, `wp_header.wpno`) so every table and column can be precisely pinpointed.
- **`wo_text_description` Text Fields**: `wo_text_description.text` is ONLY populated if saved as plain text (otherwise `NULL`). Formatted step descriptions are stored in `wo_text_description.text_html`, and step titles in `wo_text_description.header`. Always SELECT `wo_text_description.header`, `wo_text_description.text`, and `wo_text_description.text_html` together to ensure full step text extraction.
- **No Column Combining**: Any SQL query must select and return exactly the column names as they appear in the database. Do not combine or concatenate columns (e.g., no `CONCAT()`, no `||`) within SQL queries.
- **Ask Before Combining**: If a user request implicitly requires combining columns, explicitly ask the user for permission or clarification before doing so.
- **1:1 Raw Extraction**: Keep raw data extraction as 1:1 with the database schema as possible.
