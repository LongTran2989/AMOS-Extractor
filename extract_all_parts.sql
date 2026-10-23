-- AMOS Part Master Extraction Query
-- Purpose: Extract 1:1 raw part records from the master 'part' table.
-- Scope: All parts in the database (including standalone parts that lack CML or alternate PNs).
-- Rules enforced: Zero table aliases, exact database column names (no unapproved aliases), no column concatenation.

SELECT
    -- Primary Identification
    part.partno,
    part.partseqno_i,
    part.partmatch,
    part.description,
    part.remarks,
    part.specification,

    -- Material Classification & Technical Specs
    part.mat_class,
    part.mat_type,
    part.ata_chapter,
    part.ac_typ,
    part.measure_unit,
    part.special_measure_unit,

    -- Operational, Tooling & Repair Flags
    part.tool,
    part.repairable,
    part.fixed_asset,
    part.pma,
    part.country_origin,
    part.waste_code,

    -- Vendor, Supplier & Sourcing
    part.default_supplier,
    part.default_repair,
    part.vendor,
    part.manufacturer,
    part.special_contract,

    -- Inventory & Reorder Management Parameters
    part.reorder,
    part.reord_level,
    part.safety_stock,
    part.min_safety_stock,
    part.target_stock,
    part.manual_safety_stock,
    part.manual_target_stock,
    part.alert_qty,
    part.max_purch,
    part.storetime,
    part.weight,
    part.avg_ta_time,
    part.max_shop_visit,
    part.shop_visit_reset_condition,

    -- System, State & Audit Tracking
    part.extended_stateno_i,
    part.status,
    part.resource_type_id,
    part.counter_template_groupno_i,
    part.created_by,
    part.created_date,
    part.mutator,
    part.mutation,
    part.mutation_time
FROM part
ORDER BY part.partno;
