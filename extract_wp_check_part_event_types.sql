-- Check: part requests of one WP that are not workstep requests (event_type <> 'WSL') but sit on one of its work orders.
-- Fill in the WP name in place of <WP_NAME>.

select
    part_request_2.part_requestno_i as z_PART_REQUESTNO_I,
    part_request_2.event_type,
    part_request_2.event_key,
    part_request_2.partno as z_PART_NO,
    part_request_2.qty as z_PART_QTY,
    part_request_2.status
from part_request_2
where part_request_2.event_type <> 'WSL'
  and part_request_2.event_key in (
      select wo_header.event_perfno_i
      from wp_header
      join wp_assignment
             on (wp_assignment.wpno_i = wp_header.wpno_i)
      join wo_header
             on (wo_header.event_perfno_i = wp_assignment.event_perfno_i)
      where wp_header.wpno = '<WP_NAME>'
  );
