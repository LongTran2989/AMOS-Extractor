-- Query: how many items each workpack has, for workpacks that are In Progress or Issued.
-- One row per workpack. An item is every work order assigned to the workpack (wp_assignment),
-- numbered or not; a workpack with no items shows 0.
-- Filters by the status number in wp_header.wp_status, because the DWH has no wp_status table.
-- Status numbers (from AMOS, 2026-11-18; see schema/workpack.yaml notes):
--   In Progress = 11, 115   Issued = 112, 114
-- wp_header.wp_status is the present-day status, so this answers "now", not a past date.

SELECT
    wp_header.wpno_i AS z_WP_ID,
    wp_header.wpno AS z_WP_NO,
    wp_header.station AS z_WP_STATION,
    wp_header.wp_status AS z_WP_STATUS_ID,
    COUNT(wp_assignment.wp_assignmentno_i) AS z_WP_ITEM_COUNT
FROM wp_header
LEFT JOIN wp_assignment
       ON wp_assignment.wpno_i = wp_header.wpno_i
WHERE wp_header.wp_status IN (11, 115, 112, 114)
GROUP BY
    wp_header.wpno_i,
    wp_header.wpno,
    wp_header.station,
    wp_header.wp_status
ORDER BY wp_header.wpno;
