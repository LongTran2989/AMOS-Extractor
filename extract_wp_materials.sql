-- Query: List of material part requests for sequences in a specific WP
-- Parameterized by WP name: A617-250826-CHK-C04

SELECT 
    -- Sequence Properties
    wp_sequence.seqno_prefix_i AS z_WP_SEQ_1ST,
    wp_sequence.seqno AS z_WP_SEQ_2ND,
    workstep_link.sequenceno AS z_WORKSTEP_NO,
    
    -- Material (Part Requests) Properties
    part_request_2.partno AS z_PART_NO,
    part_request_2.qty AS z_PART_QTY,
    part_request_2.no_pcf AS z_PART_NO_PCF
FROM wp_header
LEFT JOIN wp_status 
       ON wp_status.wp_status_id = wp_header.wp_status
LEFT JOIN wp_department_link
       ON wp_department_link.wpno_i = wp_header.wpno_i
LEFT JOIN wp_sequence 
       ON wp_sequence.wpno_i = wp_header.wpno_i
LEFT JOIN wo_header 
       ON wo_header.event_perfno_i = wp_sequence.event_perfno_i
LEFT JOIN workstep_link
       ON workstep_link.event_perfno_i = wo_header.event_perfno_i
LEFT JOIN part_request_2
       ON part_request_2.event_key = wo_header.event_perfno_i 
       OR part_request_2.event_key = workstep_link.workstep_linkno_i
WHERE wp_header.wpno = 'A617-250826-CHK-C04'
ORDER BY 
    wp_header.wpno, 
    wp_sequence.seqno_prefix_i,
    wp_sequence.seqno,
    workstep_link.sequenceno,
    part_request_2.part_requestno_i;
