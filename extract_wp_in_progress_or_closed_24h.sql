-- Workpacks that are In Progress now, plus Closed workpacks closed within the last 24 hours.
-- "Now" is the moment the query runs (CURRENT_TIMESTAMP, UTC). Use --at to freeze it.
-- AMOS times are local (UTC+7), so the UTC clock gets +7 hours before comparing.
-- AMOS does not fill act_end_* for closed WPs and end_date is the scheduled end, so the closing
-- time is taken from the last change of the workpack row (mutation, mutation_time in ms).
-- This also counts a closed WP that was edited in the last 24 hours. Check before relying on it.
-- Status ids (schema/workpack.yaml): In Progress = 11, 115. Closed = -2, 116.

SELECT
    wp_header.wpno_i AS z_WP_ID,
    wp_header.wpno AS z_WP_NO,
    wp_header.station AS z_WP_STATION,
    wp_header.wp_status AS z_WP_STATUS_ID,
    wp_header.mutation,
    wp_header.mutation_time
FROM wp_header
WHERE wp_header.wp_status IN (11, 115)
   OR (
          wp_header.wp_status IN (-2, 116)
      AND (DATE '1971-12-31' + wp_header.mutation)
          + ((COALESCE(wp_header.mutation_time, 0) / 1000) * INTERVAL '1' SECOND)
          >= CURRENT_TIMESTAMP + INTERVAL '7' HOUR - INTERVAL '24' HOUR
      )
ORDER BY wp_header.wpno_i DESC;
