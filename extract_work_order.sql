-- AMOS Work Order Full Extraction Query
-- Purpose: Extract 1:1 raw maintenance records for a Work Order (WO) across all 9 schema tables in AMOS-WO.sql
-- Rules enforced: Zero aliases (full table and column names), no column concatenation.

SELECT
    -- 1. wo_header (Work Order Header)
    wo_header.event_perfno_i,
    wo_header.ac_registr,
    wo_header.state,
    wo_header.mech_sign,
    wo_header.release_sign,
    wo_header.release_sign2,
    wo_header.closing_date,

    -- 2. wp_sequence (WO-in-WP Sequence Components, e.g., 4.34)
    wp_sequence.wp_sequence_id,
    wp_sequence.seqno_prefix_i,
    wp_sequence.seqno_prefix_i2,
    wp_sequence.seqno_prefix,
    wp_sequence.seqno,
    wp_sequence.seqno2,

    -- 3. wp_header (Workpack Header)
    wp_header.wpno_i,
    wp_header.wpno,
    wp_header.wp_status,
    wp_header.station,

    -- 4. workstep_link (Step Sequence inside WO)
    workstep_link.workstep_linkno_i,
    workstep_link.descno_i,
    workstep_link.sequenceno,

    -- 5. wo_text_description (Step Text Description: Plain, HTML, Header)
    wo_text_description.header,
    wo_text_description.text,
    wo_text_description.desc_comment,
    wo_text_description.text_html,

    -- 6. wo_text_action (Step Execution Actions & Sign-offs)
    wo_text_action.actionno_i,
    wo_text_action.header,
    wo_text_action.text,
    wo_text_action.action_comment,
    wo_text_action.sign_performed,
    wo_text_action.sign_inspected,
    wo_text_action.sign_double_inspected,

    -- 7. time_captured_additional (Action-to-Booking Link)
    time_captured_additional.itemno_i,

    -- 8. time_captured (Time Bookings)
    time_captured.bookingno_i,
    time_captured.user_sign,
    time_captured.created_by,
    time_captured.start_date,
    time_captured.start_time,
    time_captured.end_date,
    time_captured.end_time,
    time_captured.duration,
    time_captured.primkey,

    -- 9. wo_remarks (Work Order Remarks)
    wo_remarks.recno,
    wo_remarks.recordno,
    wo_remarks.text

FROM wo_header
LEFT JOIN wp_sequence 
       ON wp_sequence.event_perfno_i = wo_header.event_perfno_i
LEFT JOIN wp_header 
       ON wp_header.wpno_i = wp_sequence.wpno_i
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
LEFT JOIN wo_remarks 
       ON wo_remarks.event_perfno_i = wo_header.event_perfno_i

WHERE wo_header.event_perfno_i = 5585360
ORDER BY workstep_link.sequenceno;
