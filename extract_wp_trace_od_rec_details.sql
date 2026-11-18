-- Trace step 6: receiving lines (od_rec_detail) behind the pickslip bookings of one WP:
-- label, batch, expiry, certificate date and company.
-- Joins to extract_wp_trace_pickslip_booked.sql on RECDETAILNO_I; to the order detail file on DETAILNO_I.
-- Fill in the WP name in place of <WP_NAME>.

select
    od_rec_detail.recdetailno_i,
    od_rec_detail.detailno_i,
    od_rec_detail.receivingno,
    od_rec_detail.recno,
    od_rec_detail.orderno,
    od_rec_detail.del_date,
    od_rec_detail.partno,
    od_rec_detail.serialno,
    od_rec_detail.partnoold,
    od_rec_detail.serialnoold,
    od_rec_detail.qty,
    od_rec_detail.labelno,
    od_rec_detail.batchno,
    od_rec_detail.expire_date,
    od_rec_detail.mfg_date,
    od_rec_detail.certificate_date,
    od_rec_detail.certificate_company,
    od_rec_detail.cert_type,
    od_rec_detail.releaseno,
    od_rec_detail.vendor,
    od_rec_detail.condition,
    od_rec_detail.status
from od_rec_detail
where od_rec_detail.recdetailno_i in (
    select pickslip_booked.recdetailno_i
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
