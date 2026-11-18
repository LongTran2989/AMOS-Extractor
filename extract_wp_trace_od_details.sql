-- Trace step 7: order details (od_detail) raised from the pickslips of one WP.
-- Joins to extract_wp_trace_pickslip_details.sql on PICKSLIPNO; to the receiving file on DETAILNO_I.
-- Fill in the WP name in place of <WP_NAME>.

select
    od_detail.detailno_i,
    od_detail.orderno_i,
    od_detail.posno,
    od_detail.pickslipno,
    od_detail.pickslipseqno_i,
    od_detail.partno,
    od_detail.serialno,
    od_detail.requested_partno,
    od_detail.requested_serialno,
    od_detail.qty,
    od_detail.req_qty,
    od_detail.ext_qty,
    od_detail.labelno,
    od_detail.recdetailno_i,
    od_detail.condition,
    od_detail.state,
    od_detail.target_date,
    od_detail.del_date,
    od_detail.status
from od_detail
where od_detail.pickslipno in (
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
