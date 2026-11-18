-- Trace step 8: allocation links (allocation_link) from the part requests of one WP to the material
-- allocated to them: rotable (REF_KEY = PSN), consumable (REF_KEY = storeno_i) or order detail (REF_KEY = detailno_i).
-- SOURCE_TYPE is returned unfiltered, so the value used for part requests shows in the result.
-- Fill in the WP name in place of <WP_NAME>.

select
    allocation_link.allocation_linkno_i,
    allocation_link.source_type,
    allocation_link.source_key,
    allocation_link.link_type,
    allocation_link.ref_type,
    allocation_link.ref_key,
    allocation_link.qty,
    allocation_link.is_consumption_event,
    allocation_link.approval_documentno_i,
    allocation_link.status,
    allocation_link.mutation
from allocation_link
where allocation_link.source_key in (
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
