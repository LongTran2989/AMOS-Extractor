SELECT 
    wp_header.wpno,
    wp_status.name AS status,
    wp_header.start_date,
    wp_header.end_date,
    wp_header.act_end_date,
    wp_header.act_end_time,
    DATE '1971-12-31' + wp_header.act_end_date AS converted_act_end_date,
    (DATE '1971-12-31' + wp_header.act_end_date) + (COALESCE(wp_header.act_end_time, 0) * INTERVAL '1 minute') AS full_act_end_timestamp,
    CURRENT_TIMESTAMP AS db_current_timestamp
FROM wp_header
JOIN wp_status ON wp_status.wp_status_id = wp_header.wp_status
WHERE wp_header.station = 'HAN' 
  AND wp_status.name IN ('In Progress', 'Issued', 'Closed')
  AND (
       ((DATE '1971-12-31' + wp_header.start_date) >= DATE '2026-09-30' AND (DATE '1971-12-31' + wp_header.start_date) <= DATE '2026-10-01')
    OR ((DATE '1971-12-31' + wp_header.end_date) >= DATE '2026-09-30' AND (DATE '1971-12-31' + wp_header.end_date) <= DATE '2026-10-01')
    OR ((DATE '1971-12-31' + wp_header.act_end_date) >= DATE '2026-09-30' AND (DATE '1971-12-31' + wp_header.act_end_date) <= DATE '2026-10-01')
  )
ORDER BY wp_header.wpno DESC
LIMIT 20;
