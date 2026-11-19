-- Query: Result B (parts) of the WP-sequences extraction, looked up by WP name (DWH version).
-- Fill in the WP name in place of <WP_NAME> (the page's Values box, or --param WP_NAME=...).
-- Keyed by z_WORKSTEP_LINK_ID, which matches the last column of extract_wp_seqs_by_wp_steps.sql.
-- Only worksteps that have part requests. One row per pickslip booking of a part request; a part request
-- with no pickslip yet has one row with the pickslip columns empty. Requested PN, quantity and S/N or B/N
-- come from the part request; booked quantity, batch, expiry and pickslip number come from the booking.
-- Expiry is days since 1971-12-31 (as in AMOS). The WP filter sits in an EXISTS so each part request
-- appears once per booking, even when the same work order is listed more than once for the WP.
-- TOOL is the raw AMOS part.tool flag: Y = the part is a tool, N = a material/part. Not converted in SQL.

SELECT
    workstep_link.workstep_linkno_i AS z_WORKSTEP_LINK_ID,
    part_request_2.partno AS z_PART_NO,
    part_request_2.qty AS z_PART_QTY,
    part_request_2.no_pcf AS z_PART_NO_PCF,
    part.tool,
    part_request_info.serialno,
    pickslip_detail.pickslipno,
    pickslip_booked.qty_booked,
    pickslip_booked.qty_canceled,
    pickslip_booked.batchno,
    pickslip_booked.expire_date
FROM part_request_2
JOIN workstep_link
       ON workstep_link.workstep_linkno_i = part_request_2.event_key
LEFT JOIN part
       ON part.partno = part_request_2.partno
LEFT JOIN part_request_info
       ON part_request_info.part_requestno_i = part_request_2.part_requestno_i
LEFT JOIN pickslip_detail
       ON pickslip_detail.part_requestno_i = part_request_2.part_requestno_i
LEFT JOIN pickslip_booked
       ON (pickslip_booked.pickslipno = pickslip_detail.pickslipno)
      AND (pickslip_booked.recno = pickslip_detail.recno)
WHERE part_request_2.event_type = 'WSL'
  AND EXISTS (
      SELECT 1
      FROM wp_header
      JOIN wp_assignment
             ON wp_assignment.wpno_i = wp_header.wpno_i
      JOIN wo_header
             ON wo_header.event_perfno_i = wp_assignment.event_perfno_i
      WHERE wo_header.event_perfno_i = workstep_link.event_perfno_i
        AND wp_header.wpno = '<WP_NAME>'
  );
