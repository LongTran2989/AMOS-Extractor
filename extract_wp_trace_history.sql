-- Trace step 5: stock history rows (history) written by the pickslip bookings of one WP.
-- Joins to extract_wp_trace_pickslip_booked.sql on PICKSLIPSEQNO_I. History is an append-only log:
-- one booking can have several rows.
-- Fill in the WP name in place of <WP_NAME>.

select
    history.historyno_i,
    history.pickslipseqno_i,
    history.transaction_id,
    history.partno,
    history.serialno,
    history.labelno,
    history.batchno,
    history.expire_date,
    history.qty,
    history.certificate_date,
    history.certificate_company,
    history.recdetailno_i,
    history.store,
    history.storeno_i,
    history.store_loc,
    history.del_date,
    history.orderno,
    history.event_perfno_i,
    history.wpno_i,
    history.status,
    history.mutation
from history
where history.pickslipseqno_i in (
    select pickslip_booked.pickslipseqno_i
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
    )
);
