-- Trace step 11: order details (od_detail) allocated to the part requests of one WP.
-- allocation_link.ref_type = 'ORDER_DE' with ref_key = od_detail.detailno_i (seen in the data).
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
where od_detail.detailno_i in (
    select allocation_link.ref_key
    from allocation_link
    where (allocation_link.ref_type = 'ORDER_DE')
      and (allocation_link.source_type = 'PARTRQST')
      and allocation_link.source_key in (
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
