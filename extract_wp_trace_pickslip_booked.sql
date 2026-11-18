-- Trace step 4: parts actually booked on the pickslip lines of one WP (pickslip_booked).
-- Joins to extract_wp_trace_pickslip_details.sql on PICKSLIPNO + RECNO; to the history and receiving files on
-- PICKSLIPSEQNO_I and RECDETAILNO_I.
-- Fill in the WP name in place of <WP_NAME>.

select
    pickslip_booked.pickslipseqno_i,
    pickslip_booked.pickslipno,
    pickslip_booked.recno,
    pickslip_booked.partno,
    pickslip_booked.serialno,
    pickslip_booked.batchno,
    pickslip_booked.expire_date,
    pickslip_booked.qty_booked,
    pickslip_booked.qty_sys,
    pickslip_booked.qty_canceled,
    pickslip_booked.station,
    pickslip_booked.store,
    pickslip_booked.storeno_i,
    pickslip_booked.location_from,
    pickslip_booked.location_to,
    pickslip_booked.recdetailno_i,
    pickslip_booked.purch_recdetailno_i,
    pickslip_booked.projectno_i,
    pickslip_booked.owner,
    pickslip_booked.entityno_i,
    pickslip_booked.picking_listno_i,
    pickslip_booked.is_consumption,
    pickslip_booked.is_return,
    pickslip_booked.return_part_requestno_i,
    pickslip_booked.status,
    pickslip_booked.created_date
from pickslip_booked
where exists (
    select 1
    from pickslip_detail
    where (pickslip_detail.pickslipno = pickslip_booked.pickslipno)
      and (pickslip_detail.recno = pickslip_booked.recno)
      and pickslip_detail.part_requestno_i in (
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
