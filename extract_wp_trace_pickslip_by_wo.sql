-- Trace check: pickslip lines (pickslip_detail) raised against any work order of one WP, by
-- event_perfno_i instead of part_requestno_i. Shows whether the part-request link is what is empty,
-- or whether the WP has no pickslips at all.
-- Fill in the WP name in place of <WP_NAME>.

select
    pickslip_detail.event_perfno_i,
    pickslip_detail.part_requestno_i,
    pickslip_detail.pickslipno,
    pickslip_detail.recno,
    pickslip_detail.partno,
    pickslip_detail.serialno,
    pickslip_detail.qty_req,
    pickslip_detail.qty_booked,
    pickslip_detail.date_booked,
    pickslip_detail.status
from pickslip_detail
where pickslip_detail.event_perfno_i in (
    select wo_header.event_perfno_i
    from wp_header
    join wp_assignment
           on (wp_assignment.wpno_i = wp_header.wpno_i)
    join wo_header
           on (wo_header.event_perfno_i = wp_assignment.event_perfno_i)
    where wp_header.wpno = '<WP_NAME>'
);
