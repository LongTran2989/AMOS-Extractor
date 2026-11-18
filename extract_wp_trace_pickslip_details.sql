-- Trace step 2: pickslip lines (pickslip_detail) raised for the part requests of one WP.
-- Joins to extract_wp_trace_part_requests.sql on PART_REQUESTNO_I; to the header and booking files on PICKSLIPNO (and RECNO).
-- Fill in the WP name in place of <WP_NAME>.

select
    pickslip_detail.part_requestno_i,
    pickslip_detail.pickslipno,
    pickslip_detail.recno,
    pickslip_detail.partno,
    pickslip_detail.serialno,
    pickslip_detail.qty_req,
    pickslip_detail.qty_sys,
    pickslip_detail.qty_booked,
    pickslip_detail.date_booked,
    pickslip_detail.repair_order,
    pickslip_detail.event_perfno_i,
    pickslip_detail.status
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
);
