-- Workpacks at station HAN that are In Progress or Issued now (present-day status, no date filter).
-- Status ids (schema/workpack.yaml notes): In Progress = 11. Issued = 112, 114.
-- Status 115 (In Progress) is left out on purpose.
-- wp_status is the present-day status, so this answers "now", not a past date.
-- Only aircraft of operator HVN (wp_header.ac_operator).

SELECT
    wp_header.wpno_i AS z_WP_ID,
    wp_header.wpno AS z_WP_NO,
    wp_header.description AS z_WP_DESC,
    wp_header.station AS z_WP_STATION,
    wp_header.wp_status AS z_WP_STATUS_ID,
    wp_header.hidden,
    wp_header.start_date AS z_WP_START_DATE,
    wp_header.end_date,
    wp_header.ac_registr AS z_AC_REG,
    wp_header.ac_typ,
    wp_header.mpno,
    wp_header.mp_revision
FROM wp_header
WHERE wp_header.station = 'HAN'
  AND wp_header.wp_status IN (11, 112, 114)
  AND wp_header.ac_operator = 'HVN'
ORDER BY wp_header.wpno;
