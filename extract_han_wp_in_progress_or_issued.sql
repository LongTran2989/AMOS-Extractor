-- Workpacks that are In Progress or Issued now (present-day status, no date filter).
-- Status ids (schema/workpack.yaml notes): In Progress = 11, 115. Issued = 112, 114.
-- wp_status is the present-day status, so this answers "now", not a past date.
-- Filters are placeholders, filled in by the app (or --param NAME=value):
--   STATION, AC_OPERATOR, AC_REGISTR, DESCRIPTION: one value each.
--   WP_STATUS_1 .. WP_STATUS_4: one status id each; repeat a value to use fewer than four.
-- Each value must sit in quotes and use only A-Z a-z 0-9, space, . _ / - (max 100 characters)
-- in openquery mode, so a comma or apostrophe in a description is refused.

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
    wp_header.mp_revision,
    wp_header.mutation,
    wp_header.mutation_time
FROM wp_header
WHERE wp_header.station = '<STATION>'
  AND wp_header.wp_status IN ('<WP_STATUS_1>', '<WP_STATUS_2>', '<WP_STATUS_3>', '<WP_STATUS_4>')
  AND wp_header.ac_operator = '<AC_OPERATOR>'
  AND wp_header.ac_registr = '<AC_REGISTR>'
  AND wp_header.description = '<DESCRIPTION>'
ORDER BY wp_header.wpno;
