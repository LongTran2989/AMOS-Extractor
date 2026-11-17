-- Probe: row count per WP of extract_wp_seqs_parameterized.sql (same FROM/WHERE, no wide columns).
-- Used to find which WPs differ when the stitched steps+parts output has a different row count
-- than the legacy query. Compare with the per-WP counts of the stitched file.

SELECT
    wp_header.wpno AS z_WP_NO,
    COUNT(*)
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
GROUP BY wp_header.wpno
ORDER BY wp_header.wpno;
