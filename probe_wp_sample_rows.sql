-- Probe: 50 workpacks (newest wpno_i first) with the fields for picking filters. One row per WP.
-- Dates are AMOS ints: days since 1971-12-31 (convert with DATE '1971-12-31' + n).
-- wp_status is the raw id: map it with the id list in schema/workpack.yaml notes.
-- For a value list of one field, use probe_wp_filter_fields.sql.

SELECT
    wp_header.wpno_i AS z_WP_ID,
    wp_header.wpno AS z_WP_NO,
    wp_header.description AS z_WP_DESC,
    wp_header.station AS z_WP_STATION,
    wp_header.wp_status AS z_WP_STATUS_ID,
    wp_header.hidden,
    wp_header.start_date AS z_WP_START_DATE,
    wp_header.end_date,
    wp_header.act_start_date,
    wp_header.act_end_date AS z_WP_ACT_END_DATE,
    wp_header.est_start_date,
    wp_header.est_end_date,
    wp_header.ac_registr AS z_AC_REG,
    wp_header.ac_typ,
    wp_header.ac_model,
    wp_header.ac_subtype,
    wp_header.ac_operator,
    wp_header.projectno,
    wp_header.mpno,
    wp_header.mp_revision
FROM wp_header
ORDER BY wp_header.wpno_i DESC
LIMIT 50;
