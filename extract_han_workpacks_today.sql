-- AMOS Workpack (WP) Extraction Query for HAN Station (Active Today)
-- Discovered Schema Tables: wp_header (Workpack Header), wp_status (Workpack Status Lookup)
-- Rules enforced: Zero aliases (full table and column names), no column concatenation.

SELECT
    -- Workpack Identification & Basic Attributes
    wp_header.wpno_i,
    wp_header.wpno,
    wp_header.description,
    wp_header.station,
    wp_header.ac_registr,
    wp_header.ac_typ,
    wp_header.ac_model,
    wp_header.wp_type,
    wp_header.hidden,
    wp_header.responsible,

    -- Workpack Status Attributes (from wp_header and wp_status lookup)
    wp_header.wp_status,
    wp_status.name,
    wp_status.closed,
    wp_status.resource_allocation_done,
    wp_header.ops_status,
    wp_header.handed_to_prod,
    wp_header.handed_to_prod_by,
    wp_header.handed_to_prod_to,
    wp_header.jobcards_collection_status,
    wp_header.events_collection_status,

    -- Scheduled Timing (AMOS Integer Dates & Time in Minutes)
    wp_header.start_date,
    wp_header.start_time,
    wp_header.end_date,
    wp_header.end_time,

    -- Actual / Real Timing
    wp_header.act_start_date,
    wp_header.act_start_time,
    wp_header.act_end_date,
    wp_header.act_end_time,

    -- Flight & Operational Inbound/Outbound Info
    wp_header.arrival_fltno,
    wp_header.departure_fltno,
    wp_header.inbound_scheduled_date,
    wp_header.inbound_scheduled_time,

    -- Operational Requirements & Work Metrics
    wp_header.delay,
    wp_header.non_routine_time,
    wp_header.test_flight,
    wp_header.engrun,
    wp_header.acweigh,
    wp_header.ndt_req,
    wp_header.def_req,
    wp_header.jack_req,

    -- Remarks
    wp_header.remarks,
    wp_header.internal_remarks

FROM wp_header
LEFT JOIN wp_status 
       ON wp_status.wp_status_id = wp_header.wp_status

WHERE wp_header.station = 'HAN'
  -- Workpacks active today (where today falls within scheduled start_date and end_date)
  AND (DATE '1971-12-31' + wp_header.start_date) <= CURRENT_DATE
  AND (DATE '1971-12-31' + wp_header.end_date)   >= CURRENT_DATE

ORDER BY wp_header.start_date, wp_header.start_time;
