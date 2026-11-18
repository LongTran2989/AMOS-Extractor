-- Query: Result B (parts) of the WP-sequences extraction, looked up by WP name (DWH version).
-- Same columns as queries/wp_seqs/BDNTH_parts.sql, filtered by WP name (wp_header.wpno) instead of
-- department and status, because WP_DEPARTMENT_LINK and WP_STATUS are missing in the DWH.
-- Fill in the WP name in place of <WP_NAME> (the page's Values box, or --param WP_NAME=...).
-- One row per part request, only for worksteps that have parts. Keyed by z_WORKSTEP_LINK_ID,
-- which matches the last column of extract_wp_seqs_by_wp_steps.sql.
-- The WP filter sits in an EXISTS so each part request appears exactly once, even when the same
-- work order is listed more than once for the WP.

SELECT
    workstep_link.workstep_linkno_i AS z_WORKSTEP_LINK_ID,
    part_request_2.partno AS z_PART_NO,
    part_request_2.qty AS z_PART_QTY,
    part_request_2.no_pcf AS z_PART_NO_PCF
FROM part_request_2
JOIN workstep_link
       ON workstep_link.workstep_linkno_i = part_request_2.event_key
WHERE part_request_2.event_type = 'WSL'
  AND EXISTS (
      SELECT 1
      FROM wp_header
      JOIN wp_assignment
             ON wp_assignment.wpno_i = wp_header.wpno_i
      JOIN wo_header
             ON wo_header.event_perfno_i = wp_assignment.event_perfno_i
      WHERE wo_header.event_perfno_i = workstep_link.event_perfno_i
        AND wp_header.wpno = '<WP_NAME>'
  );
