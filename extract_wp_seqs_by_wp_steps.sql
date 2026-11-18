-- Query: Result A (steps) of the WP-sequences extraction, looked up by WP name (DWH version).
-- Same columns as queries/wp_seqs/BDNTH_steps.sql, but the WP is picked by its name (wp_header.wpno)
-- instead of department and status: WP_DEPARTMENT_LINK and WP_STATUS are missing in the DWH.
-- So the z_WP_DEPT, z_WP_STATUS_NAME and closed columns are left out.
-- Fill in the WP name in place of <WP_NAME> (the page's Values box, or --param WP_NAME=...).
-- One row per WP x item x workstep, WITHOUT the part columns (see extract_wp_seqs_by_wp_parts.sql).
-- z_WORKSTEP_LINK_ID is the last column; the stitcher uses it to join the parts query.
-- Items come from wp_assignment; wp_sequence is a LEFT JOIN because unsequenced items have no row there.

SELECT
    -- WP Properties
    wp_header.wpno_i AS z_WP_ID,
    wp_header.wpno AS z_WP_NO,
    wp_header.description AS z_WP_DESC,
    wp_header.station AS z_WP_STATION,
    wp_header.ac_registr AS z_AC_REG,
    wp_header.start_date AS z_WP_START_DATE,
    wp_header.start_time AS z_WP_START_TIME,
    wp_header.act_end_date AS z_WP_ACT_END_DATE,
    wp_header.act_end_time AS z_WP_ACT_END_TIME,

    -- Sequence Properties
    wp_sequence.seqno_prefix_i AS z_WP_SEQ_1ST,
    wp_sequence.seqno AS z_WP_SEQ_2ND,
    workstep_link.sequenceno AS z_WORKSTEP_NO,
    wo_header.state AS z_WP_IT_STS,

    -- Title
    wo_event_link.event_name AS z_WP_IT_NAME,
    wo_event_link.event_display AS z_WP_IT_NAME_1,

    -- Validated Step Text
    wo_text_description.header AS z_WP_IT_HEADER,
    wo_text_description.text AS z_WP_IT_TEXT,
    wo_text_description.text_html AS z_WP_IT_TEXT_HTML,

    -- Stitch key (dropped by the stitcher)
    workstep_link.workstep_linkno_i AS z_WORKSTEP_LINK_ID
FROM wp_header
LEFT JOIN wp_assignment
       ON wp_assignment.wpno_i = wp_header.wpno_i
LEFT JOIN wp_sequence
       ON wp_sequence.wpno_i = wp_assignment.wpno_i
      AND wp_sequence.event_perfno_i = wp_assignment.event_perfno_i
LEFT JOIN wo_header
       ON wo_header.event_perfno_i = wp_assignment.event_perfno_i
LEFT JOIN wo_event_link
       ON wo_event_link.event_perfno_i = wo_header.event_perfno_i
LEFT JOIN workstep_link
       ON workstep_link.event_perfno_i = wo_header.event_perfno_i
LEFT JOIN wo_text_description
       ON wo_text_description.descno_i = workstep_link.descno_i
WHERE wp_header.wpno = '<WP_NAME>'
ORDER BY
    wp_header.wpno,
    wp_sequence.seqno_prefix_i,
    wp_sequence.seqno,
    workstep_link.sequenceno;
