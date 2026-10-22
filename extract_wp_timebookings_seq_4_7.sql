-- Query: Timebookings and modification history for a specific sequence in a Workpack
-- WP: A620-040326-BASE-MCC-STO
-- Sequence: 4.7 (seqno_prefix_i = 4, seqno = 7)

SELECT 
    -- Workpack Properties
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
    
    -- Sequence Item Properties (4.7)
    wp_sequence.seqno_prefix_i AS z_WP_SEQ_1ST,
    wp_sequence.seqno AS z_WP_SEQ_2ND,
    workstep_link.sequenceno AS z_WORKSTEP_NO,
    wo_header.state AS z_WP_IT_STS,

    -- Item Title
    wo_event_link.event_name AS z_WP_IT_NAME,
    wo_event_link.event_display AS z_WP_IT_NAME_1,
    
    -- Step Text Descriptions
    wo_text_description.header AS z_WP_IT_HEADER,
    wo_text_description.text AS z_WP_IT_TEXT,
    wo_text_description.text_html AS z_WP_IT_TEXT_HTML,
    
    -- Workstep Execution Actions & Sign-offs
    wo_text_action.actionno_i,
    wo_text_action.header,
    wo_text_action.text,
    wo_text_action.action_comment,
    wo_text_action.sign_performed,
    wo_text_action.sign_inspected,
    wo_text_action.sign_double_inspected,

    -- Action-to-Booking Link
    time_captured_additional.itemno_i,

    -- Time Bookings (Active Record & Modification Stamp)
    time_captured.bookingno_i,
    time_captured.user_sign,
    time_captured.created_by,
    time_captured.created_date,
    time_captured.start_date,
    time_captured.start_time,
    time_captured.end_date,
    time_captured.end_time,
    time_captured.duration,
    time_captured.mutation,
    time_captured.mutation_time,
    time_captured.mutator,
    time_captured.primkey,

    -- Time Booking Modification History (AMOS History Viewer)
    time_captured_history.historyno_i,
    time_captured_history.change_comment,
    time_captured_history.created_by_org,
    time_captured_history.created_date_org,
    time_captured_history.mutation_org,
    time_captured_history.mutator_org,
    time_captured_history.mutation_time_org
FROM wp_header
LEFT JOIN wp_status 
       ON wp_status.wp_status_id = wp_header.wp_status
LEFT JOIN wp_department_link
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
LEFT JOIN wo_text_action 
       ON wo_text_action.workstep_linkno_i = workstep_link.workstep_linkno_i
LEFT JOIN time_captured_additional 
       ON time_captured_additional.itemno_i = wo_text_action.actionno_i
LEFT JOIN time_captured 
       ON time_captured.bookingno_i = time_captured_additional.bookingno_i
LEFT JOIN time_captured_history
       ON time_captured_history.bookingno_i = time_captured.bookingno_i
WHERE wp_header.wpno = 'A620-040326-BASE-MCC-STO'
  AND wp_sequence.seqno_prefix_i = 4
  AND wp_sequence.seqno = 7
ORDER BY 
    workstep_link.sequenceno,
    wo_text_action.actionno_i,
    time_captured.bookingno_i,
    time_captured_history.historyno_i;
