-- Piece 3 of 5: legacy extract_wp_seqs_parameterized.sql limited to 4 WPs (~7000 rows).
-- Only used to verify the stitched steps+parts output; see npm run stitch:compare.
-- Query: List of WPs with their properties parameterized by station, ac_registr, and department
-- And for each WP, a list of the corresponding 1st and 2nd seq no, with statuses and descriptions.

SELECT 
    -- WP Properties
    wp_header.wpno_i AS z_WP_ID,
    wp_header.wpno AS z_WP_NO,
    wp_header.description AS z_WP_DESC,
    wp_header.station AS z_WP_STATION,
    wp_header.ac_registr AS z_AC_REG,
    wp_department_link.department AS z_WP_DEPT,
    wp_status.name AS z_WP_STATUS_NAME,
    wp_status.closed,
    wp_header.start_date AS z_WP_START_DATE,
    wp_header.start_time AS z_WP_START_TIME,
    wp_header.act_end_date AS z_WP_ACT_END_DATE,
    wp_header.act_end_time AS z_WP_ACT_END_TIME,
    
    -- Sequence Properties
    wp_sequence.seqno_prefix_i AS z_WP_SEQ_1ST,
    wp_sequence.seqno AS z_WP_SEQ_2ND,
    workstep_link.sequenceno AS z_WORKSTEP_NO,
    wo_header.state AS z_WP_IT_STS,

    -- PROBE: Finding the Title
    wo_event_link.event_name AS z_WP_IT_NAME,
    wo_event_link.event_display AS z_WP_IT_NAME_1,
    
    -- Validated Step Text
    wo_text_description.header AS z_WP_IT_HEADER,
    wo_text_description.text AS z_WP_IT_TEXT,
    wo_text_description.text_html AS z_WP_IT_TEXT_HTML,
    
    -- Required Materials
    part_request_2.partno AS z_PART_NO,
    part_request_2.qty AS z_PART_QTY,
    part_request_2.no_pcf AS z_PART_NO_PCF
FROM wp_header
-- INNER (not LEFT): the WHERE clause already requires a matching row in both tables,
-- so LEFT only blocks the planner from starting at the small, filtered wp_header set.
JOIN wp_status 
       ON wp_status.wp_status_id = wp_header.wp_status
JOIN wp_department_link
       ON wp_department_link.wpno_i = wp_header.wpno_i
LEFT JOIN wp_sequence 
       ON wp_sequence.wpno_i = wp_header.wpno_i
LEFT JOIN wo_header 
       ON wo_header.event_perfno_i = wp_sequence.event_perfno_i
LEFT JOIN wo_event_link
       ON wo_event_link.event_perfno_i = wo_header.event_perfno_i
LEFT JOIN workstep_link
       ON workstep_link.event_perfno_i = wo_header.event_perfno_i
LEFT JOIN wo_text_description
       ON wo_text_description.descno_i = workstep_link.descno_i
LEFT JOIN part_request_2
       ON part_request_2.event_key = workstep_link.workstep_linkno_i
      AND part_request_2.event_type = 'WSL'
WHERE wp_header.station = 'HAN'
  AND wp_department_link.department = 'NTHN'
  AND wp_header.wpno IN (
    'A617-250826-CHK-C04',
    'A357-250826-CHK-Y01',
    'A611-240926-CHK-EQ01',
    'A513-DONGIA-CHK-Y01'
  )
  AND (
      -- Condition 1: In Progress or Issued in the last 6 months
      (
          wp_status.name IN ('In Progress', 'Issued')
          -- Sargable: compare the raw int column (index-friendly) instead of wrapping it in date math
          AND wp_header.start_date <= (CURRENT_DATE - DATE '1971-12-31')
          AND wp_header.start_date >= ((CURRENT_DATE - INTERVAL '6' MONTH)::date - DATE '1971-12-31')
      )
      OR
      -- Condition 2: Closed WPs in the last 31 hours
      (
          wp_status.name = 'Closed'
          AND wp_header.end_date IS NOT NULL
          -- Coarse sargable pre-filter on the raw int (end_time < 1 day, so this never drops a match)
          AND wp_header.end_date >= ((CURRENT_TIMESTAMP + INTERVAL '7' HOUR - INTERVAL '24' HOUR)::date - DATE '1971-12-31')
          -- Exact check
          AND ((DATE '1971-12-31' + wp_header.end_date) + (COALESCE(wp_header.end_time, 0) * INTERVAL '1 minute')) >= (CURRENT_TIMESTAMP + INTERVAL '7' HOUR - INTERVAL '24' HOUR)
      )
  )
ORDER BY 
    wp_header.wpno, 
    wp_sequence.seqno_prefix_i,
    wp_sequence.seqno,
    workstep_link.sequenceno;
