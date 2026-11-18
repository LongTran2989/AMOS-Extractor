-- Trace step 3: pickslip headers (pickslip_header) of the pickslips that issue the parts of one WP.
-- Joins to extract_wp_trace_pickslip_details.sql on PICKSLIPNO.
-- Fill in the WP name in place of <WP_NAME>.

select
    pickslip_header.pickslipno,
    pickslip_header.pickslip_date,
    pickslip_header.issue_date,
    pickslip_header.issue_time,
    pickslip_header.planned_date,
    pickslip_header.state,
    pickslip_header.station_from,
    pickslip_header.store_from,
    pickslip_header.station_to,
    pickslip_header.store_to,
    pickslip_header.receiver,
    pickslip_header.is_transfer,
    pickslip_header.is_reservation,
    pickslip_header.status
from pickslip_header
where pickslip_header.pickslipno in (
    select pickslip_detail.pickslipno
    from pickslip_detail
    where pickslip_detail.part_requestno_i in (
        select part_request_2.part_requestno_i
        from part_request_2
        where (part_request_2.event_type = 'WSL')
          and exists (
              select 1
              from wp_header
              join wp_assignment
                     on (wp_assignment.wpno_i = wp_header.wpno_i)
              join wo_header
                     on (wo_header.event_perfno_i = wp_assignment.event_perfno_i)
              join workstep_link
                     on (workstep_link.event_perfno_i = wo_header.event_perfno_i)
              where (workstep_link.workstep_linkno_i = part_request_2.event_key)
                and (wp_header.wpno = '<WP_NAME>')
          )
    )
);
