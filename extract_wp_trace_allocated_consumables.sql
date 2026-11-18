-- Trace step 10: consumable stock (consumables) allocated to the part requests of one WP.
-- allocation_link.ref_type = 'ST' with ref_key = consumables.storeno_i (seen in the data).
-- Fill in the WP name in place of <WP_NAME>.

select
    consumables.storeno_i,
    consumables.partno,
    consumables.labelno,
    consumables.batchno,
    consumables.expire_date,
    consumables.qty,
    consumables.condition,
    consumables.locationno_i,
    consumables.recdetailno_i,
    consumables.purch_recdetailno_i,
    consumables.owner,
    consumables.projectno_i,
    consumables.entityno_i,
    consumables.shelf_inspection_date,
    consumables.status
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
);
