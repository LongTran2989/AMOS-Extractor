-- Probe: which station / status / type / maintenance-class combinations exist in WP_HEADER (DWH).
-- One row per distinct combination, all workpacks, no date filter. Capped to 50 rows.
-- Use the values you see to pick the filters for a real query.
-- wp_status is the raw id: map it with the id list in schema/workpack.yaml notes
-- (the DWH has no wp_status table).

SELECT DISTINCT
    wp_header.station AS z_WP_STATION,
    wp_header.wp_status AS z_WP_STATUS_ID,
    wp_header.wp_type,
    wp_header.hidden
FROM wp_header
ORDER BY
    wp_header.station,
    wp_header.wp_status,
    wp_header.wp_type,
    wp_header.hidden
LIMIT 50;
