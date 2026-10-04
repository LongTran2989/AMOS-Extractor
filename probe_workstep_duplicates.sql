SELECT 
    wp_header.wpno,
    wp_sequence.seqno_prefix_i,
    wp_sequence.seqno,
    workstep_link.sequenceno,
    wo_event_link.event_name AS z_WP_IT_NAME,
    wo_event_link.event_display AS z_WP_IT_NAME_1,
    wo_text_description.header AS z_WP_IT_HEADER,
    wo_text_description.text AS z_WP_IT_TEXT,
    wo_text_description.text_html AS z_WP_IT_TEXT_HTML
FROM wp_header
JOIN wp_sequence 
  ON wp_sequence.wpno_i = wp_header.wpno_i
JOIN workstep_link 
  ON workstep_link.event_perfno_i = wp_sequence.event_perfno_i
LEFT JOIN wo_header
  ON wo_header.event_perfno_i = wp_sequence.event_perfno_i
LEFT JOIN wo_event_link
  ON wo_event_link.event_perfno_i = wo_header.event_perfno_i
LEFT JOIN wo_text_description
  ON wo_text_description.descno_i = workstep_link.descno_i
WHERE wp_header.wpno = '2-VNAB-090926-CHK-STO'
  AND wp_sequence.seqno_prefix_i = 4
  AND wp_sequence.seqno = 2
ORDER BY workstep_link.sequenceno;
