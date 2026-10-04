-- LIST ALL SEQ IN A SINGLE WP -3 LEVELS W STS
-- Extracts all items, worksteps, and coversheet metadata for a single Workpack
-- Enforces Strict Aliases Policy (approved z_ aliases only)

SELECT
    -- Workpack Info
    wp_header.wpno_i AS z_WP_ID,
    wp_header.wpno AS z_WP_NO,
    wp_header.description AS z_WP_DESC,
    wp_status.name AS z_WP_STATUS_NAME,
    wp_header.start_date AS z_WP_START_DATE,
    wp_header.end_date,
    
    -- Populated Sequence & Item Data (with approved z_ aliases)
    wp_sequence.seqno_prefix_i AS z_WP_SEQ_1ST,
    wp_sequence.seqno          AS z_WP_SEQ_2ND,
    workstep_link.sequenceno   AS z_WORKSTEP_NO,
    wo_header.state            AS z_WP_IT_STS,
    
    -- Step Text Descriptions
    wo_text_description.header AS z_WP_IT_HEADER,
    wo_text_description.text AS z_WP_IT_TEXT,
    wo_text_description.text_html AS z_WP_IT_TEXT_HTML,
    
    -- ==========================================
    -- Empty/Null Columns (Moved to the end)
    -- ==========================================
    wp_sequence.seqno_prefix_i2,
    wp_sequence.seqno_prefix,
    wp_sequence.seqno2,
    wo_header.event_perfno_i,
    wo_header.type,
    wo_header.ext_workorderno AS z_WP_IT_NAME_4,
    taskcard_coversheet_info.taskcard_number,
    taskcard_coversheet_info.field_name,
    taskcard_coversheet_info.field_value,
    taskcard_coversheet_info.sequence,
    taskcard_coversheet_info.type
FROM wp_header
LEFT JOIN wp_status 
       ON wp_status.wp_status_id = wp_header.wp_status
LEFT JOIN wp_sequence 
       ON wp_sequence.wpno_i = wp_header.wpno_i
LEFT JOIN wo_header 
       ON wo_header.event_perfno_i = wp_sequence.event_perfno_i
LEFT JOIN taskcard_coversheet_info
       ON taskcard_coversheet_info.ext_workorderno = wo_header.ext_workorderno
LEFT JOIN workstep_link 
       ON workstep_link.event_perfno_i = wo_header.event_perfno_i
LEFT JOIN wo_text_description 
       ON wo_text_description.descno_i = workstep_link.descno_i
WHERE wp_header.wpno = '<INSERT_WPNO_HERE>'
ORDER BY 
    wp_sequence.seqno_prefix_i, 
    wp_sequence.seqno, 
    workstep_link.sequenceno;
