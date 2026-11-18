-- Trace step 1: workstep part requests of one WP, with the requested serial (part_request_info).
-- Start of the pickslip chain. The key z_PART_REQUESTNO_I joins to the other extract_wp_trace_*.sql files.
-- Fill in the WP name in place of <WP_NAME>.

select
    part_request_2.part_requestno_i as z_PART_REQUESTNO_I,
    part_request_2.event_key,
    part_request_2.partno as z_PART_NO,
    part_request_2.qty as z_PART_QTY,
    part_request_2.confirmed_qty,
    part_request_2.parent_part_requestno_i,
    part_request_info.serialno,
    part_request_info.external_referenceno
from part_request_2
left join part_request_info
    on (part_request_info.part_requestno_i = part_request_2.part_requestno_i)
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
  );
