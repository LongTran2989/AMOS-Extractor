-- Probe: which values the WP filter fields take in WP_HEADER (DWH). Capped to 50 rows.
-- One row per distinct combination, all workpacks, no date filter. Pick the values you need.
-- Fields: station, wp_status (raw id, map with schema/workpack.yaml notes), wp_type,
-- hidden (H/L/I), owner (role if access is restricted), handed_to_prod_group, ops_status.
-- If the result has exactly 50 rows, the list is cut off; narrow the fields to see the rest.

SELECT DISTINCT
    wp_header.station AS z_WP_STATION,
    wp_header.wp_status AS z_WP_STATUS_ID,
    wp_header.wp_type,
    wp_header.hidden,
    wp_header.owner,
    wp_header.handed_to_prod_group,
    wp_header.ops_status
FROM wp_header
ORDER BY
    wp_header.station,
    wp_header.wp_status,
    wp_header.wp_type,
    wp_header.hidden,
    wp_header.owner,
    wp_header.handed_to_prod_group,
    wp_header.ops_status
LIMIT 50;
