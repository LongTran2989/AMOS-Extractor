-- Probe: operator and owner of the HAN workpacks that are In Progress or Issued (same rows as
-- extract_han_wp_in_progress_or_issued.sql). Used to see which aircraft operators the DWH returns.

SELECT
    wp_header.wpno_i AS z_WP_ID,
    wp_header.station AS z_WP_STATION,
    wp_header.wp_status AS z_WP_STATUS_ID,
    wp_header.ac_operator,
    wp_header.owner
FROM wp_header
WHERE wp_header.station = 'HAN'
  AND wp_header.wp_status IN (11, 112, 114)
ORDER BY wp_header.wpno_i;
