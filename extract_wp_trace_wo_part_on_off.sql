-- Trace step 9: parts installed on and removed from the aircraft in the workstep actions of one WP
-- (wo_part_on_off). Only rows with an action text are reached through WO_TEXT_ACTION (ACTIONNO_I); the
-- workstep is WO_TEXT_ACTION.WORKSTEP_LINKNO_I.
-- Fill in the WP name in place of <WP_NAME>.

select
    wo_text_action.workstep_linkno_i,
    wo_part_on_off.actionno_i,
    wo_part_on_off.event_perfno_i,
    wo_part_on_off.part_exchangeno_i,
    wo_part_on_off.partno,
    wo_part_on_off.serialno,
    wo_part_on_off.labelno,
    wo_part_on_off.partno_off,
    wo_part_on_off.serialno_off,
    wo_part_on_off.batchno_off,
    wo_part_on_off.qty_off,
    wo_part_on_off.ac_position,
    wo_part_on_off.removal_type,
    wo_part_on_off.certificate_i,
    wo_part_on_off.status
from wo_part_on_off
join wo_text_action
       on (wo_text_action.actionno_i = wo_part_on_off.actionno_i)
where wo_text_action.workstep_linkno_i in (
    select workstep_link.workstep_linkno_i
    from wp_header
    join wp_assignment
           on (wp_assignment.wpno_i = wp_header.wpno_i)
    join wo_header
           on (wo_header.event_perfno_i = wp_assignment.event_perfno_i)
    join workstep_link
           on (workstep_link.event_perfno_i = wo_header.event_perfno_i)
    where wp_header.wpno = '<WP_NAME>'
);
