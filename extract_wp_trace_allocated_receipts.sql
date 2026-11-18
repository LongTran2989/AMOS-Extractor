-- Trace step 13: receiving lines (od_rec_detail) of the consumables allocated to the part requests of one WP:
-- new label, batch, expiry, certificate date and company.
-- Path: allocation_link (ref_type 'ST') -> consumables.storeno_i -> consumables.recdetailno_i -> od_rec_detail.recdetailno_i.
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
    od_rec_detail.status
from od_rec_detail
where od_rec_detail.recdetailno_i in (
    select consumables.recdetailno_i
    from consumables
    where consumables.storeno_i in (
        select allocation_link.ref_key
        from allocation_link
        where (allocation_link.ref_type = 'ST')
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
    )
);
