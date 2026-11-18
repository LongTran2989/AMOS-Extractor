-- Trace step 12: rotables (rotables) allocated to the part requests of one WP.
-- allocation_link.ref_type = 'RO' with ref_key = rotables.psn (seen in the data).
-- Fill in the WP name in place of <WP_NAME>.

select
    rotables.psn,
    rotables.partno,
    rotables.serialno,
    rotables.labelno,
    rotables.partnonew,
    rotables.serialnonew,
    rotables.condition,
    rotables.location,
    rotables.locationno_i,
    rotables.date_inst,
    rotables.expiry_date,
    rotables.rotable_status,
    rotables.status
from rotables
where rotables.psn in (
    select allocation_link.ref_key
    from allocation_link
    where (allocation_link.ref_type = 'RO')
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
