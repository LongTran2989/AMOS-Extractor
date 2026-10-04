-- AMOS Workpack (WP) Extraction Query for a Specific Station in a Date Range
-- Station: HAN
-- Date Range: 2026-09-22 to 2026-09-26
-- Discovered Schema Tables: wp_header (Workpack Header), wp_status (Workpack Status Lookup),
--                           wp_department_link (Departments responsible for Workpack)
-- Rules enforced: Only approved z_ aliases (see SESSION_CONTEXT.md), no table aliases, no column concatenation.

SELECT
    -- Workpack Identification & Basic Attributes
    wp_header.wpno_i AS z_WP_ID,
    wp_header.wpno AS z_WP_NO,
    wp_header.description AS z_WP_DESC,
    wp_header.station AS z_WP_STATION,
    wp_department_link.department AS z_WP_DEPT,
    wp_header.ac_registr AS z_AC_REG,
    wp_header.ac_typ,
    wp_header.ac_model,
    wp_header.wp_type,
    wp_header.hidden,
    wp_header.responsible,

    -- Workpack Status Attributes (from wp_header and wp_status lookup)
    wp_header.wp_status,
    wp_status.name AS z_WP_STATUS_NAME,
    wp_status.closed,
    wp_status.resource_allocation_done,
    wp_header.ops_status,
    wp_header.handed_to_prod,
    wp_header.handed_to_prod_by,
    wp_header.handed_to_prod_to,
    wp_header.jobcards_collection_status,
    wp_header.events_collection_status,

    -- Scheduled Timing (AMOS Integer Dates & Time in Minutes)
    wp_header.start_date AS z_WP_START_DATE,
    wp_header.start_time AS z_WP_START_TIME,
    wp_header.end_date,
    wp_header.end_time,

    -- Actual / Real Timing
    wp_header.act_start_date,
    wp_header.act_start_time,
    wp_header.act_end_date AS z_WP_ACT_END_DATE,
    wp_header.act_end_time AS z_WP_ACT_END_TIME,

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
LEFT JOIN wp_department_link
       ON wp_department_link.wpno_i = wp_header.wpno_i

WHERE wp_header.station = 'HAN'
  -- Workpacks active or overlapping within the date range 2026-09-22 to 2026-09-26
  AND (DATE '1971-12-31' + wp_header.start_date) <= '2026-09-26'
  AND (DATE '1971-12-31' + wp_header.end_date)   >= '2026-09-22'

ORDER BY wp_header.start_date, wp_header.start_time;
