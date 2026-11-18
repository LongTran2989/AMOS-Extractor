# WP fields: AMOS names, descriptions and DWH availability

Generated from Database-Description-AMOS-csv.csv and dwh/catalogue.json (2026-11-18). Keys: P primary, I index, U unique.

## Tables

| Table | In DWH | Description |
|---|---|---|
| wp_assignment | yes | This table holds the workorders that are assigned to a workpackage |
| wp_authority | **no** | This table links a Work Package (WP) to the aviation authorities that approve it. |
| wp_content | **no** | Complements wp_assignment to describe the content of the workpackage  when it was released to production. Events that were deferred or "not performed" are added to this table and stay here even after deassigning them from the W/P. |
| wp_department_link | **no** | Departments responsible for workpackage |
| wp_ground_time_extension | **no** | Workpackage ground time extensions |
| wp_group | **no** | This table connects the groups of a workpackage with the correct workpackage |
| wp_group_remarks | **no** | remarks for each WP group |
| wp_handover_link | **no** | This table stores the link between WO and handover reports (W/P or Shift Handover Reports) |
| wp_header | yes | This tables stores all workpackages |
| wp_history | **no** | This table stores when and by whom an event was assigned/de-assigned to a workpackage, when and by whom a workpackage was printed or handed over to production . On this table only inserts should be performed (no deletes / updates) |
| wp_ho_config | **no** | this is the main table for custom wp hand over reports |
| wp_ho_config_custom_field | **no** | wp handover reports custom fields definitions |
| wp_ho_config_custom_type | **no** | wp handover reports custom types definitions to use for custom fields |
| wp_ho_config_gather | **no** |  |
| wp_ho_report | **no** | wp handover report header |
| wp_ho_report_custom_field | **no** |  |
| wp_ho_report_event_data | **no** |  |
| wp_ho_report_event_reply | **no** |  |
| wp_ho_report_gather | **no** |  |
| wp_ho_report_link | **no** |  |
| wp_ho_report_properties | **no** |  |
| wp_name | **no** | This table holds the last name of the WP per wpno_i. This is required if a WP is deleted to fetch its history. |
| wp_oemdoc_mapping | **no** | default table description |
| wp_panel | **no** | Links the Panels to a Workpackage |
| wp_panel_workorder | **no** |  |
| wp_priority_codes | **no** | This table holds the priority codes as they can be specified in Basic Data Administration -> Workpackage Priority Codes. This table is only used for GOL |
| wp_req_link_overrule | **no** |  |
| wp_sequence | yes | This table stores sequence numbers for WOs and TCs, ensuring uniqueness after assignment. |
| wp_sequence_config | **no** | Workpackage sequences configuration Defines the sort orders available for WP sequencing. |
| wp_status | **no** | Workpackage statuses |
| wp_status_action | **no** | Links between WP Statuses and their enabled actions. |
| wp_wl_dist | **no** | Workpackage workload distribution |
| wp_wl_dist_entry | **no** | Single entry in an interval of a workpackage workload distribution |
| wp_wl_dist_interval | **no** | Interval defined for a workpackage workload distribution |
| wp_work_scope | **no** | Work scope of a workpackage (assigned work templates) |

## wp_assignment

This table holds the workorders that are assigned to a workpackage

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| source | int4 |  | **no** | Indicates the origin of the assignment. See {@link amos.share.bo.planning.WpAssignmentSource} for possible values. It specifies whether the assignment was created via an import or directly within AMOS. |
| uuid | varchar(36) | [I] | yes | Globally unique identifier for the workpackage assignment. |
| automatic | varchar(1) |  | yes | Indicates if the assignment was performed automatically by the system ('Y') or manually by a user ('N'). |
| planned_offset | int4 |  | yes | Offset in minutes from the Workpackage start date for planning the corresponding event. This column can be manually populated or automatically filled from the Ground Time entry position. |
| critical_event | varchar(1) |  | yes | Indicates whether a planner has marked this event as critical ('Y') or not ('N'). |
| wp_assignmentno_i | int4 | [P] | yes | Primary key of the workpackage assignment. |
| wpno_i | int4 | [I,I] | yes | Foreign key referencing the workpackage (wp) table. |
| event_perfno_i | int4 | [U,I] | yes | Foreign key referencing the event performance (event_perf) table, which represents a WO. |
| wp_groupno_i | int4 | [I] | yes | Optional: Foreign key referencing the workpackage group (wp_group) table, indicating the group to which the WO belongs. |
| milestone_date | int4 |  | yes | Optional: Milestone date, representing the offset in days from the workpackage start date. |
| milestone_time | int4 |  | yes | Optional: Time of the milestone, stored in minutes since midnight. |
| assign_date | int4 | [I] | yes | Date when the WO was assigned to the workpackage, stored as the number of days since 1971-12-31. |
| assign_time | int4 |  | yes | Time when the WO was assigned, stored in minutes since midnight. |
| user_sign | varchar(8) |  | yes | User signature of the AMOS user who assigned the WO to the workpackage. |
| seqno | int4 | [I] | yes | Deprecated: Sequence number, formerly used for check-package sequence. Superseded by the wp_sequence table. |
| assignment_reason | varchar(8) |  | yes | Reason for the assignment of the WO to the workpackage. |
| mutation | int4 |  | yes | Date when this record was last modified, stored as AMOS date (days since 1971-12-31). |
| mutator | varchar(8) |  | yes | User signature of the AMOS user who last modified this record. |
| status | int4 |  | yes | Status of the record. The meaning of this column varies depending on the table. |
| mutation_time | int4 |  | yes | Time when this record was added or last modified, stored in milliseconds since the beginning of the day. |
| created_by | varchar(8) |  | yes | User signature of the AMOS user who created this record. |
| created_time | int4 |  | yes | Time when this record was created, stored in milliseconds since the beginning of the day. |
| created_date | int4 |  | yes | Date when this record was created, stored as AMOS date (days since 1971-12-31). |

## wp_authority

This table links a Work Package (WP) to the aviation authorities that approve it.

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| authority_code | varchar(12) | [I] | table missing | Code of the aviation authority. |
| wpno_i | int4 | [I] | table missing | Work Package number. Foreign key to the Work Package table. |
| wp_authorityno_i | int4 | [P] | table missing | Unique identifier for the WP Authority assignment. Primary key of the table. |
| mutation | int4 |  | table missing | Date of the last change to this record, stored as the number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | User ID of the AMOS user who last changed this record. |
| status | int4 |  | table missing | Status of this record. |
| mutation_time | int4 |  | table missing | Time of the last change to this record, stored as milliseconds since the beginning of the day. |
| created_by | varchar(8) |  | table missing | User ID of the AMOS user who created this record. |
| created_time | int4 |  | table missing | Time when this record was created, stored as milliseconds since the beginning of the day. |
| created_date | int4 |  | table missing | Date when this record was created, stored as the number of days since 31.Dec.1971. |

## wp_content

Complements wp_assignment to describe the content of the workpackage  when it was released to production. Events that were deferred or "not performed" are added to this table and stay here even after deassigning them from the W/P.

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| is_finding | varchar(1) |  | table missing | Indicates if this event is related to a finding W/O. 'Y' if true, 'N' if false. |
| remarks | varchar(500) |  | table missing | Optional user remarks related to the W/P content. |
| reason | varchar(8) | [I] | table missing | An optional reason code, as specified in Basic Data Administration, to provide context for the W/P content. |
| event_transferno_i | int4 | [I] | table missing | Foreign key referencing the event transfer number. |
| event_status | varchar(1) |  | table missing | Indicates the status of the event: 'N' if Not performed, 'D' if Deferred, or empty for other statuses like findings. |
| event_perfno_i | int4 | [U,I] | table missing | Foreign key referencing the event performance. |
| wpno_i | int4 | [U,I] | table missing | Foreign key referencing the workpackage number. |
| wp_contentno_i | int4 | [P] | table missing | Primary key for the wp_content table. |
| mutation | int4 |  | table missing | The date when this record was last modified, stored as the number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | The AMOS user ID of the user who last modified this record. |
| status | int4 |  | table missing | The status of the record. The meaning of this column varies depending on the table. |
| mutation_time | int4 |  | table missing | The time when this record was last modified, stored as milliseconds since the beginning of the day. |
| created_by | varchar(8) |  | table missing | The AMOS user ID of the user who created this record. |
| created_date | int4 |  | table missing | The date when this record was created, stored as the number of days since 31.Dec.1971. |
| created_time | int4 |  | table missing | The time when this record was created, stored as milliseconds since the beginning of the day. |

## wp_department_link

Departments responsible for workpackage

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| department | varchar(8) | [U,I] | table missing | Department code responsible for the WP. Foreign key to the department table. |
| wpno_i | int4 | [U,I] | table missing | Workpackage number. Foreign key to the workpackage table. |
| wp_department_linkno_i | int4 | [P] | table missing | Primary key of this table. |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date (number of days since 31.Dec.1971). |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date (number of days since 31.Dec.1971). |
| mutator | varchar(8) |  | table missing | The AMOS user who last changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing | The status of the record. |

## wp_ground_time_extension

Workpackage ground time extensions

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| remarks | text(2147483647) |  | table missing | Remarks regarding the Workpackage ground time extension. |
| extension_reasonno_i | int4 | [I] | table missing | Foreign key referencing the extension reason defined in application parameter APN 18. |
| wpno_i | int4 | [I] | table missing | Foreign key referencing the Workpackage to which this ground time extension applies. |
| extension_duration | int4 |  | table missing | Duration of the ground time extension in minutes. |
| wp_ground_time_extensionno_i | int4 | [P] | table missing | Primary key for the Workpackage ground time extension record. |
| mutation | int4 |  | table missing | Date of the last mutation of this record, stored as an AMOS date (number of days since 31.Dec.1971). |
| created_time | int4 |  | table missing | Time of creation of this record, stored in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | Time of last mutation of this record, stored in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | Date of creation of this record, stored as an AMOS date (number of days since 31.Dec.1971). |
| mutator | varchar(8) |  | table missing | User ID of the AMOS user who last changed this record. |
| created_by | varchar(8) |  | table missing | User ID of the AMOS user who created this record. |
| status | int4 |  | table missing | Status of the Workpackage ground time extension record. |

## wp_group

This table connects the groups of a workpackage with the correct workpackage

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| is_finding_group | varchar(1) |  | table missing | Flag indicating if this group is the designated finding group. New findings will be assigned to this group by default if set to 'Y'. |
| wpno_i | int4 | [I] | table missing | Foreign key referencing the work package to which this group belongs. |
| wp_groupno_i | int4 | [P] | table missing | Unique identifier for the work package group. This is a primary key. |
| wp_grp_projectno_i | int4 | [I] | table missing | Foreign key referencing the project to which this work package group is associated. |
| name | varchar(20) |  | table missing | Name or title of the work package group. |
| sortorder | int4 |  | table missing | Defines the sort order of the work package groups. |
| mutation | int4 |  | table missing | Date of the last modification of this record, stored as the number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | User ID of the AMOS user who last modified this record. |
| status | int4 |  | table missing | Status of the record. The meaning of this column varies depending on the table. |
| mutation_time | int4 |  | table missing | Time of the last modification of this record, stored as milliseconds since the beginning of the day. |
| created_by | varchar(8) |  | table missing | User ID of the AMOS user who created this record. |
| created_date | int4 |  | table missing | Date of creation of this record, stored as the number of days since 31.Dec.1971. |
| created_time | int4 |  | table missing | Time of creation of this record, stored as milliseconds since the beginning of the day. |

## wp_group_remarks

remarks for each WP group

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| wp_groupno_i | int4 | [P,I] | table missing | Foreign key to the wp_group table. It is the primary key of the wp_group table. |
| recno | int4 | [P,I] | table missing | Record number to ensure the order of the text lines. |
| text | varchar(70) |  | table missing | Text of the remark. |
| mutation | int4 |  | table missing | Date of the last change of this record. Stored as days since 31.Dec.1971. |
| created_time | int4 |  | table missing | Time of record creation in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | Time when this record was last changed, stored as milliseconds since the start of the day. |
| created_date | int4 |  | table missing | Date of record creation. Stored as days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | User ID of the AMOS user who last changed this record. |
| created_by | varchar(8) |  | table missing | User ID of the AMOS user who created this record. |
| status | int4 |  | table missing | Status of the record. |

## wp_handover_link

This table stores the link between WO and handover reports (W/P or Shift Handover Reports)

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| from_shift_calendarno_i | int4 | [I] | table missing | Foreign key to the shift calendar number for the shift that is handing over. Points to table shift_calendar. |
| to_shift_calendarno_i | int4 | [I] | table missing | Foreign key to the shift calendar number for the shift that is taking over. Points to table shift_calendar. |
| report_type | int4 |  | table missing | Type of handover report: 0 - W/P Handover Report 1 - Shift Handover Report |
| configuration | text(2147483647) |  | table missing | Stores configuration settings as JSON string. |
| wpno_i | int4 | [I] | table missing | Foreign key to the W/O number. This W/O is linked to the handover report. Points to table workpackage. |
| report_storage_engine_id | int4 |  | table missing | ID of the storage engine where the report is stored. |
| to_shift_code | varchar(1) | [I] | table missing | DEPRECATED: Migrated to to_shift_calendarno_i |
| from_shift_code | varchar(1) | [I] | table missing | DEPRECATED: Migrated to from_shift_calendarno_i |
| wp_handover_linkno_i | int4 | [P] | table missing | Primary key for the wp_handover_link table. |
| mutation | int4 |  | table missing | The date of the last change of this record, stored as AMOS date (number of days since 31.Dec.1971). |
| created_time | int4 |  | table missing | The time when this record was created, stored in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record was last changed, stored in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The date when this record was created, stored as AMOS date (number of days since 31.Dec.1971). |
| mutator | varchar(8) |  | table missing | The AMOS user ID of the user who last changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user ID of the user who created this record. |
| status | int4 |  | table missing | The status of the record. This column has a different meaning for every table. |

## wp_header

This tables stores all workpackages

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| eligibilityno_i | int4 | [I] | **no** | Workpackage engine eligibility primary key |
| position_on_ac | varchar(20) |  | **no** | Position of the part on the A/C (Aircraft). |
| maintenance_calendar_group | int4 | [I] | **no** | Foreign key to the maintenance calendar group to be used in the workpackage. |
| maintenance_activity_typeno_i | int4 | [I] | **no** | Foreign key to the maintenance activity type linked to the workpackage |
| req_links_status | int4 |  | **no** | Status of the Workpackage events requirement links: 0: status is unknown / being calculated 1: W/P has no requirement link conflict 2: W/P has requirement link conflict |
| amm_oem_noi | int4 | [I] | yes | Foreign key to the oem_doc_revision table (only AMM should be linked) |
| handed_to_prod_group | varchar(12) |  | yes | Role of the group to hand over the workpackage to production |
| mp_order_detailno_i | int4 | [I] | yes | Foreign key to the maintenance planning order detail |
| target_end_time | int4 |  | yes | Target end time of the workpackage in minutes since day begin |
| target_start_time | int4 |  | yes | Target start time of the workpackage in minutes since day begin |
| return_type | int4 |  | yes | Component workpackage return type as defined in the compwpreturntypeenum |
| target_start_date | int4 |  | yes | Target start date of the workpackage as number of days since 31.Dec.1971 |
| est_end_time | int4 |  | yes | Estimated end time of the workpackage in minutes since day begin |
| est_end_date | int4 |  | yes | Estimated end date of the workpackage as number of days since 31.Dec.1971 |
| est_start_time | int4 |  | yes | Estimated start time of the workpackage in minutes since day begin |
| est_start_date | int4 |  | yes | Estimated start date of the workpackage as number of days since 31.Dec.1971 |
| comp_owner | varchar(12) | [I] | yes | Owner of the main component of this component workpackage - this field is the last resort if the component is unknown and no orders have been set |
| rc_order_detailno_i | int4 | [I] | yes | Foreign key to the customer repair order detail |
| r_order_detailno_i | int4 | [I] | yes | Foreign key to the repair order detail |
| use_new_certificates | varchar(1) |  | yes | Indicates if newly defined certificates are used for releasing the part ("Y") or if current (already existing) certificates are used ("N") |
| shop_arrival_time | int4 |  | yes | Earliest shop arrival time of all root components - will not be changed after initially set |
| shop_arrival_date | int4 |  | yes | Earliest shop arrival date of all root components - will not be changed after initially set |
| partially_imported | varchar(1) |  | yes | Indicates if the workpackage was only partially imported during a MROWorkpackageImport (for now it is only set if the customer requirements were not all matched to templates) |
| esign_manually_set | varchar(1) |  | yes | Indicates if the esign_policy has been defined by a user |
| esign_policy | int4 |  | yes | Indicates which esign_policy should be applied for this workpackage |
| req_condition | varchar(6) |  | yes | Requirement condition |
| part_description | varchar(36) |  | yes | Part Description of part for component workpackages |
| lm_groundtimeno_i | int4 | [I] | yes | Foreign key to the Ground Time eventually linked to this Work Package. |
| inbound_scheduled_time | int4 |  | yes | Scheduled time of the inbound flight in minutes since day begin. Used as part of the Maintenance Planning automation framework. |
| inbound_scheduled_date | int4 |  | yes | Scheduled date of the inbound flight as number of days since 31.Dec.1971. Used as part of the Maintenance Planning automation framework. |
| departure_fltno | varchar(10) | [I] | yes | Flight Number corresponding to the departure flight. This field is required for A/Ps without known A/C registry in order to identify to which Ground Time the W/P belongs to. |
| is_imported | varchar(1) |  | yes | Indicates if the WP was imported from an interface ("Y"), typically for an MRO, a WP coming from a customer. |
| ac_operator | varchar(12) | [I] | yes | A/C operator |
| ac_model | varchar(6) | [I] | yes | A/C model |
| ac_subtype | varchar(6) | [I] | yes | A/C subtype |
| contact_person | text(2147483647) |  | yes | Contact Person of the 3rd party. For an airline, it is the contact person on the MRO side. For an MRO, it is the contact person on the MRO side. It can contain first and last name, phone, and email. |
| shop | varchar(12) | [I] | yes | For component workpackages, shop vendor |
| target_end_date | int4 |  | yes | For component workpackages, date when the rotable is needed on A/C as number of days since 31.Dec.1971. |
| partno | varchar(32) | [I] | yes | Part number of the highest assembly, mandatory for component workpackage |
| next_flight_legno_i | int4 | [I] | yes | Foreign key to the FlightLeg of the departing flight |
| mpno | varchar(25) | [I] | yes | Name of the Maintenance Program set for the A/C. For managed A/C, it corresponds to msc_maintenance_program.mpno field. For non-managed A/C, it is a free text. |
| engines_apu_serial | varchar(400) |  | yes | The Engines and APU serial number information |
| test_flight | varchar(1) |  | yes | Indicates if a test flight has been performed as part of this Workpackage ("Y"). Any other value means that no test flight has been performed |
| cust_address | varchar(12) |  | yes | If the AMOS workpackage has been imported with 3rd party AIM import, this field contains the address code of the customer who exported this workpackage. Logical link to address.vendor |
| auto_generated | varchar(1) |  | yes | Indicates if the workpackage is auto-generated: `N`: not auto-generated (standard) `Y`: auto-generated `R`: auto-generated and needs to be reviewed `K`: auto-generated and has been reviewed |
| jobcards_collection_status | int4 |  | yes | Status of the Workpackage collection for jobcards: null: collection not needed 0: collection needed 2: collection completed |
| internal_remarks | text(2147483647) |  | yes | The internal remarks of a workpackage |
| quotationno_i | int4 | [I] | yes | Foreign key to the quotation reference key in the qm_header table |
| wp_type | int4 | [I,I,I] | yes | Type of the Work Package: 0 = PLANNING Work Package 1 = CRM Work Package |
| drop_locationno_i | int4 | [I] | yes | Foreign key to the drop-off location of the workpackage |
| wpno_i | int4 | [P] | yes | Internal unique-key of the Workpackage (counted with parameter 25) |
| wpno | varchar(70) | [U] | yes | Name of the Workpackage |
| ac_registr | varchar(6) | [I,I,I,I] | yes | Aircraft-Registry of the affected A/C |
| ac_typ | varchar(6) | [I] | yes | Type of the affected A/C |
| projectno | varchar(14) | [I] | yes | Foreign key to the Project-Number |
| station | varchar(4) |  | yes | Station for that the work is planned |
| start_date | int4 | [I,I] | yes | Scheduled start date as number of days since 31.Dec.1971 |
| start_time | int4 |  | yes | Scheduled Start-Time in minutes since day begin |
| arrival_fltno | varchar(10) | [I] | yes | Last scheduled flight number before the Workpackage can be performed. Relevant only when flight_leg is null. |
| end_date | int4 | [I,I,I] | yes | Scheduled end-date as number of days since 31.Dec.1971 |
| end_time | int4 |  | yes | Scheduled end-time in minutes since day begin |
| description | varchar(100) |  | yes | Description of the Workpackage |
| owner | varchar(12) |  | yes | If the access is restricted for a certain user-group, the corresponding role is stored here. |
| event_id | int4 | [I] | yes | If an event for this workpackage was created, the foreign key to the event (moc_daily_records table) is stored in this field |
| astra_id | int4 | [I] | yes | The unique-key used in ASTRA (a shiftplanning-software) if imported from there |
| paperwork_expected | varchar(2) | [I] | yes | Indicates if the delivery of paperwork should be tracked |
| paperwork_del_date | int4 |  | yes | Delivery-date of the paperwork after the expected paperwork was delivered as number of days since 31.Dec.1971. |
| hidden | varchar(1) |  | yes | Defines the visibility of the Workpackage. Possible values are: H: Heavy-Maintenance L: Line-Maintenance I: Hidden Empty or any other value: Unclassified |
| mutation | int4 |  | yes | The mutation date of this record as number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | yes | The AMOS user who changed this record. |
| status | int4 |  | yes | This status field is used for the workpackage manager as an indicator for a required recollection: 0: no recollection required 1: job card data changed -> recollection required |
| mutation_time | int4 |  | yes | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_by | varchar(8) |  | yes | The AMOS user who created this record. |
| created_date | int4 |  | yes | The creation date of this record as AMOS date. |
| act_start_date | int4 | [I] | yes | Real start date |
| act_start_time | int4 |  | yes | Real Start-Time |
| act_end_date | int4 | [I] | yes | Real end-date |
| act_end_time | int4 |  | yes | Real end-time |
| responsible | varchar(8) |  | yes | this field contains the sign of the responsible person |
| delay | int4 |  | yes | Delay-time in minutes |
| non_routine_time | int4 |  | yes | additional non routine time |
| engrun | varchar(1) |  | yes | Engine run |
| ratfunc | varchar(1) |  | yes | Rat function |
| acweigh | varchar(1) |  | yes | A/C Weigh |
| ndt_req | varchar(1) |  | yes | ndt Req |
| def_req | varchar(1) |  | yes | defuel req |
| jack_req | varchar(1) |  | yes | jacking req |
| change_eng1 | varchar(1) |  | yes | Change Eng 1 |
| change_eng2 | varchar(1) |  | yes | Change Eng 2 |
| change_apu | varchar(1) |  | yes | Change Apu |
| borr_eng1 | varchar(1) |  | yes | boroscope Eng1 |
| borr_eng2 | varchar(1) |  | yes | boroscope Eng2 |
| borr_apu | varchar(1) |  | yes | boroscope apu |
| dirty_sequence | varchar(1) |  | yes | contains `Y` if the sequence might not be correct anymore |
| handed_to_prod | varchar(1) |  | yes | `Y` or `N` depending on the handed to production of the workpackage |
| handed_to_prod_by | varchar(8) |  | yes | Sign of the user who handed over the workpackage to production. Null when handed_to_prod <> Y. |
| handed_to_prod_to | varchar(8) |  | yes | Sign of the user to whom the WP is handed over. Null when handed_to_prod <> Y. |
| maintprov_address | varchar(12) | [I] | yes | Foreign key to address.vendor |
| cust_wpno | text(2147483647) |  | yes | If the AMOS workpackage has been imported with 3rd party AIM import this field contains the original workpackage number that the customer gave to the package. |
| ops_status | varchar(1) |  | yes | After a workpackage has been planned or moved by the planners, the people from OPS need to confirm this movement to avoid an intersection with actual flights. The values for this column can be: ``: the default value Q: the movement is queried to the OPS R: the movement was rejected by OPS A: the movement was approved by OPS  |
| priority_code | varchar(10) |  | yes | Used only for component workpackages to hold the order priority from od_priority.priority GOL only: holds the code for the aircraft workpackage priority |
| remarks | text(2147483647) |  | yes | The remarks of a workpackage |
| amm_reference | varchar(80) |  | yes | A reference to the actual AMM of the A/C Type There is no link between this Document and the PublicationNo. This is a free text field. If the link is required use amm_publication_noi column |
| amm_publication_noi | int4 | [I] | yes | Publication No of table pm_publication |
| mpno_i | int4 | [I] | yes | Maintenance Program that is used for the Workpackage |
| mp_revision | int4 |  | yes | Revision of the Used Maintenance Program |
| wp_sequence_config_id | int4 | [I] | yes | WP sequence configuration to use when sequencing this WP. |
| sequence_on_assignment | varchar(1) |  | yes | Whether a sequence number should be automatically created each time a WO is assigned to this WP. |
| wp_status | int4 | [I,I] | yes | Used to indicate the State of a Workpackage in APN 58 |
| events_collection_status | int4 |  | yes | Status of the Workpackage collection for events (taskcards): null: collection not needed 0: collection needed 2: collection completed |
| uuid | varchar(36) | [I] | yes | Globally unique identifier |
| flight_legno_i | int4 | [I] | yes | FlightLeg of the arriving flight |
| approvalno_i | int4 | [I] | yes | Approval Number reference key foreign key on table org_approval.approvalno_i |
| created_time | int4 |  | yes | The creation time of this record in milliseconds since the start of the day. |

## wp_history

This table stores when and by whom an event was assigned/de-assigned to a workpackage, when and by whom a workpackage was printed or handed over to production . On this table only inserts should be performed (no deletes / updates)

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| action_source | int4 |  | table missing | Source of the action performed on the W/P. |
| req_link_info | text(2147483647) |  | table missing | Stores information about the link to a requirement. |
| wt_revision_date | int4 |  | table missing | Work template revision date, stored as days since 31.Dec.1971. |
| wt_revision_number | varchar(8) |  | table missing | Work template revision number. |
| taskcard_type | varchar(1) |  | table missing | Only for taskcards: BTC, On Demand, SRT etc.. see ETaskcardType |
| action_type | varchar(1) | [I] | table missing | The action type: - A: assign - D: deassign - P: print - H: hand over to production - U: undo hand over to production - R: update work template revision - E: export - X: export results |
| storage_id | int4 | [I] | table missing | If the WP summary was saved in the database after printing/ handing over to production, here the link to the attachment is saved |
| wp_groupno_i | int4 | [I] | table missing | Optional: The number of the group to which the event belongs to. |
| action_reason | varchar(8) |  | table missing | Optional: The action reason as specified in basic data administration. |
| action_date | int4 | [I] | table missing | The date the action was performed, stored as days since 31.Dec.1971. |
| action_time | int4 |  | table missing | The time in minutes since midnight when the action was performed. |
| event_name | varchar(100) |  | table missing | Name of the event. |
| event_perfno_i | int4 | [I] | table missing | The event perf NoI. |
| event_type | varchar(2) |  | table missing | The type of the event: D = Document R = Rotable Requirement C = Check T = Block Taskcard Q = Single Running / On Demand Taskcard V = Replacement Event E = Change Order O = Event Tracking WO SV = Shop Visit WO SC = Sim. Complaint WO W = Finding WO I = Import WO P = Panel Workorder J = JIC Workorder JC = Jobcard CD = Customer Requirement - Document CC = Customer Requirement - Check CT = Customer Requirement - Task CP = Customer Requirement - Part |
| remarks | varchar(1000) |  | table missing | Some remarks manually entered by the user. |
| user_sign | varchar(8) |  | table missing | The user who assigned / deassigned, printed or handed over to production. |
| wp_seqno | varchar(20) | [I] | table missing | The wp sequence number. |
| wpno_i | int4 | [I] | table missing | The workpackage NoI. |
| wp_historyno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| status | int4 |  | table missing | The status of the record. This column has a different meaning for every table. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |

## wp_ho_config

this is the main table for custom wp hand over reports

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| report_design_id | varchar(20) |  | table missing | Unique identifier for the report. |
| edit_role | varchar(12) |  | table missing |  |
| view_role | varchar(12) |  | table missing |  |
| group_by | int4 |  | table missing |  |
| is_multi_aircraft | varchar(1) |  | table missing |  |
| name | varchar(60) |  | table missing | Report default title |
| position_no | int4 | [I] | table missing | The position of the report in the list |
| classification | varchar(1) |  | table missing | Possible values are: H: Heavy-Maintenance L: Line-Maintenance I: Hidden T:Light-Maintenance Empty or any other value: Unclassified |
| wp_ho_report_typeno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing |  |

## wp_ho_config_custom_field

wp handover reports custom fields definitions

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| description | text(2147483647) |  | table missing | Custom field description |
| type | int4 |  | table missing |  |
| name | varchar(50) |  | table missing | Custom field name |
| position_no | int4 | [I] | table missing | The position of the report in the list |
| wp_ho_report_typeno_i | int4 | [I] | table missing |  |
| wp_ho_config_custom_typeno_i | int4 | [I] | table missing | The ID of the custom type associated with the custom field |
| data_source_key | varchar(60) |  | table missing | The value to be used in the report designerâ€™s data source. It must not contain space |
| wp_ho_config_custom_fieldno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing | The status of the record. This column has a different meaning for every table. |

## wp_ho_config_custom_type

wp handover reports custom types definitions to use for custom fields

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| field_values | text(2147483647) |  | table missing | If the custom type is an enum, this column lists all possible values. |
| description | text(2147483647) |  | table missing | Custom type description |
| name | text(2147483647) |  | table missing | Custom type name |
| wp_ho_config_custom_typeno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing |  |

## wp_ho_config_gather



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| child_report_typeno_i | int4 | [I] | table missing |  |
| parent_report_typeno_i | int4 | [I] | table missing |  |
| wp_ho_config_gatherno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing | The status of the record. This column has a different meaning for every table. |

## wp_ho_report

wp handover report header

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| configuration | text(2147483647) |  | table missing | Stores configuration settings as JSON string. |
| report_time | int4 |  | table missing | Issue time of the report, stored as minutes since the beginning of the day. |
| report_date | int4 |  | table missing | The issue date of the report, stored as days since 31.Dec.1971. |
| storage_engine_id | int4 |  | table missing | ID of the storage engine where the report is stored. |
| from_user_sign | varchar(8) |  | table missing | The user sign of the person preparing the report |
| to_user_sign | varchar(8) |  | table missing | The user sign of the person receiving the report |
| to_shift_calendarno_i | int4 | [I] | table missing | Foreign key to the shift calendar number for the shift that is taking over. Points to table shift_calendar. |
| from_shift_calendarno_i | int4 | [I] | table missing | Foreign key to the shift calendar number for the shift that is handing over. Points to table shift_calendar. |
| title | varchar(100) |  | table missing | Title of the report |
| wp_ho_report_typeno_i | int4 | [I] | table missing | Id of the report config |
| wp_ho_reportno_i | int4 | [P] | table missing | Id of the report |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing | 1 = Draft 2 = Submitted 3 = Reviewed |

## wp_ho_report_custom_field



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| field_value | text(2147483647) |  | table missing | The value obtained from the user, which can be a date, time, boolean, text, or other data type. |
| wp_ho_config_custom_fieldno_i | int4 | [I] | table missing | The custom configuration field ID to which the field is linked. |
| wp_ho_reportno_i | int4 | [I] | table missing | The report ID to which the custom field is linked. |
| wp_ho_report_custom_fieldno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing |  |

## wp_ho_report_event_data



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| remarks | text(2147483647) |  | table missing |  |
| event_perfno_i | int4 | [I] | table missing | The event_perfno_i the current record refers to. |
| wp_ho_reportno_i | int4 | [I] | table missing | The report ID to which this event is linked. |
| wp_ho_report_event_datano_i | int4 | [P] | table missing |  |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing |  |

## wp_ho_report_event_reply



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| response | text(2147483647) |  | table missing | User feedback on the previous report related to this event |
| previous_wp_ho_reportno_i | int4 | [I] | table missing | The report ID to which this report is responding |
| wp_ho_reportno_i | int4 | [I] | table missing | The report ID to which this event is linked. |
| event_perfno_i | int4 | [I] | table missing | The event_perfno_i the record refers to. |
| wp_ho_report_event_replyno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing |  |

## wp_ho_report_gather



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| remarks | text(2147483647) |  | table missing |  |
| event_perfno_i | int4 | [I] | table missing | The event_perfno_i the record refers to. |
| gather_wp_ho_reportno_i | int4 | [I] | table missing | The report ID from which this report is gathering information |
| wp_ho_reportno_i | int4 | [I] | table missing | The report ID to which this entry is linked. |
| wp_ho_report_gatherno_i | int4 | [P] | table missing |  |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing | The status of the record. This column has a different meaning for every table. |

## wp_ho_report_link



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| wp_ho_reportno_i | int4 | [I] | table missing |  |
| wpno_i | int4 | [I] | table missing |  |
| wp_ho_report_linkno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing |  |

## wp_ho_report_properties



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| ref_value | text(2147483647) |  | table missing | The value of the property, stored as a string. The interpretation of this value depends on the ref_type |
| ref_type | int4 |  | table missing | Reference type indicating whether the ref_key refers to workpackage, zone, qualification and so on |
| wp_ho_reportno_i | int4 | [I] | table missing |  |
| wp_ho_report_propertiesno_i | int4 | [P] | table missing | First column of the primary key |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date. |
| mutator | varchar(8) |  | table missing | The AMOS user who changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing | The status of the record. This column has a different meaning for every table. |

## wp_name

This table holds the last name of the WP per wpno_i. This is required if a WP is deleted to fetch its history.

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| wp_type | int4 |  | table missing | Workpackage type. Refers to code table wp_type. |
| uuid | varchar(36) | [I] | table missing | Globally unique identifier of workpackage |
| wpno_i | int4 | [P] | table missing | The unique internal number of the workpackage. This is the primary key of the table. |
| wpno | varchar(70) | [U] | table missing | The actually used name of the workpackage |
| start_date | int4 | [I] | table missing | The start date of the WP as number of days since 31.Dec.1971. This is redundant with wp_header.start_date, but to search for deleted workpackages this is required. |
| mutation | int4 |  | table missing | The mutation date of this record as number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | The AMOS user id who last changed this record. |
| status | int4 |  | table missing | The status of the record. This column has a different meaning for every table. |
| mutation_time | int4 |  | table missing | The time when this record has been added or changed in milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | The AMOS user id who created this record. |
| created_date | int4 |  | table missing | The creation date of this record as number of days since 31.Dec.1971. |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |

## wp_oemdoc_mapping

default table description

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| oem_doc_noi | int4 | [I] | table missing | Foreign key to the OEM Document revision table. |
| wp_uuid | varchar(36) |  | table missing | The workpackage UUID to be mapped. |
| wp_oemdoc_mappingno_i | int4 | [P] | table missing | The unique identifier (primary key) of this mapping table. |
| mutation | int4 |  | table missing | The mutation date of this record, stored as number of days since 31.Dec.1971. |
| created_time | int4 |  | table missing | The creation time of this record, stored in milliseconds since the start of the day. |
| mutation_time | int4 |  | table missing | The time when this record was last added or changed, stored in milliseconds since the start of the day. |
| created_date | int4 |  | table missing | The creation date of this record, stored as number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | The AMOS user who last changed this record. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| status | int4 |  | table missing | The status of the record. The meaning of this column is specific to each table. |

## wp_panel

Links the Panels to a Workpackage

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| closed_date | int4 |  | table missing | The date the panel was closed, stored as days since 31.Dec.1971, if no WO panel was created. |
| opened_date | int4 |  | table missing | The date the panel was opened, stored as days since 31.Dec.1971, if no WO panel was created. |
| opened_by | varchar(10) |  | table missing | The user sign of the person who opened the panel if no Workorder panel was created. |
| closed_by | varchar(10) |  | table missing | The user sign of the person who closed the panel if no Workorder panel was created. |
| wp_panelno_i | int4 | [P] | table missing | Primary Key for the Panels of a Workpackage. |
| wpno_i | int4 | [I] | table missing | Foreign key referencing the Workpackage (wp.wpno_i). |
| panelno_i | int4 | [I] | table missing | Foreign key referencing the msc_panel_type table (msc_panel_type.panelno_i). |
| mutation | int4 |  | table missing | Date of the last change of this record, stored as days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | The user sign of the AMOS user who last changed this record. |
| status | int4 |  | table missing | The status of the record. |
| mutation_time | int4 |  | table missing | Time of the last change of this record in milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | The user sign of the AMOS user who created this record. |
| created_date | int4 |  | table missing | The date this record was created, stored as days since 31.Dec.1971. |
| created_time | int4 |  | table missing | The time when this record was created in milliseconds since the start of the day. |

## wp_panel_workorder



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|

## wp_priority_codes

This table holds the priority codes as they can be specified in Basic Data Administration -> Workpackage Priority Codes. This table is only used for GOL

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| type | varchar(6) | [P] | table missing | Priority type code. This is the primary key for the table. |
| description | varchar(30) |  | table missing | Description of the priority type code. |
| priority | int4 |  | table missing | Numerical priority of this type. Lower values indicate higher priority. |
| mimetype | varchar(10) |  | table missing | AMOS mimetype for which this priority is the default. Can be 'workpackage' or 'event tracking'. |
| mutation | int4 |  | table missing | Date of the last change to this record, stored as the number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | User ID of the AMOS user who last changed this record. |
| status | int4 |  | table missing | Status of this record. |
| mutation_time | int4 |  | table missing | Time of the last change to this record, stored as milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | User ID of the AMOS user who created this record. |
| created_date | int4 |  | table missing | Date of creation of this record, stored as the number of days since 31.Dec.1971. |
| uuid | varchar(36) |  | table missing | Globally Unique Identifier for this record. |
| created_time | int4 |  | table missing | Time of creation of this record, stored as milliseconds since the start of the day. |

## wp_req_link_overrule



| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|

## wp_sequence

This table stores sequence numbers for WOs and TCs, ensuring uniqueness after assignment.

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| seqno_prefix_i2 | int4 | [U] | yes | Second prefix for the sequence number, used in conjunction with seqno_prefix_i. This column should only be populated if seqno_prefix_i is not empty. |
| seqno | int4 | [U,I] | yes | The sequence number, starting at 1 for each WP. A negative value indicates a duplicate sequence; the original value is stored in the deprecated old_seqno_i column. |
| seqno2 | int4 |  | yes | Secondary sequence number, used by EGME to sequence events grouped by area. |
| seqno_prefix_i | int4 | [U,I] | yes | Prefix for the sequence number, corresponding to the event type or check. For example, if the sequence number is "3.342", this column contains "3". |
| seqno_prefix | varchar(3) |  | yes | Deprecated: Prefix for the sequence number, corresponding to the event type or check. For example, if the sequence number is "3.342", this column contains "3". |
| wp_sequence_id | int4 | [P] | yes | Primary key for the wp_sequence table. |
| wpno_i | int4 | [U,I] | yes | Foreign key referencing the work package number from the wp_header table. |
| event_perfno_i | int4 | [I] | yes | Foreign key referencing the event_perfno_i of the WO within the workpackage. Links to either the wo_header or task_header table. |
| old_seqno_i | int4 | [I] | yes | Deprecated: Original sequence number, starting at 1 for each workpackage. Used to store the original sequence number in case of duplicates. |
| wo_type | varchar(2) |  | yes | Deprecated: Type of the WO, represented by a code (W, R, D, C, T). |
| mutation | int4 |  | yes | Date of the last change to this record, stored as the number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | yes | The AMOS user ID of the user who last modified this record. |
| status | int4 | [U] | yes | Status code for the sequence entry: 0: Normal entry 5: Dummy entry (WP sequenced without real content) 9: WO deassigned from this WP |
| mutation_time | int4 |  | yes | Time of the last change to this record, stored as milliseconds since the beginning of the day. |
| created_by | varchar(8) |  | yes | The AMOS user ID of the user who created this record. |
| created_date | int4 |  | yes | Date of creation of this record, stored as the number of days since 31.Dec.1971. |
| created_time | int4 |  | yes | Time of creation of this record, stored as milliseconds since the beginning of the day. |

## wp_sequence_config

Workpackage sequences configuration Defines the sort orders available for WP sequencing.

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| wp_type | int4 |  | table missing | Type of the Workpackage. 0 = Aircraft Workpackage 1 = Component Workpackage |
| sort_order_4 | varchar(20) |  | table missing | Fourth sort order to use for sorting maintenance events or WO's in the WP. References a column in the respective table. |
| wp_sequence_config_id | int4 | [P] | table missing | PK of the table |
| name | varchar(50) |  | table missing | Name of the sequence configuration |
| use_prefix | varchar(1) |  | table missing | Indicates whether WP events are grouped by the first sort order. Currently, only Event Type is supported. The sequence numbers then consist of two parts: - a prefix indicating the Event Type - the main part starts at 1 for each group. |
| sort_no | int4 | [I] | table missing | Index used for sorting the configurations |
| sort_order_1 | varchar(20) |  | table missing | First sort order to use for sorting maintenance events or WO's in the WP. References a column in the respective table. |
| sort_order_2 | varchar(20) |  | table missing | Second sort order to use for sorting maintenance events or WO's in the WP. References a column in the respective table. |
| sort_order_3 | varchar(20) |  | table missing | Third sort order to use for sorting maintenance events or WO's in the WP. References a column in the respective table. |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date (days since 31.Dec.1971). |
| mutator | varchar(8) |  | table missing | The AMOS user who last changed this record. |
| status | int4 |  | table missing | The status of the record. The meaning of this column is table-specific. |
| mutation_time | int4 |  | table missing | The time when this record was last changed, in milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date (days since 31.Dec.1971). |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |

## wp_status

Workpackage statuses

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| crm | varchar(1) |  | table missing | Indicates whether the status is a CRM status ("Y" for yes, "N" for no) |
| wp_type | int4 | [U] | table missing | Workpackage type (enum) that a workpackage status belongs to |
| closed | varchar(1) |  | table missing | Indicates whether the status is considered closed ("Y" for yes, "N" for no) |
| resource_allocation_done | varchar(1) |  | table missing | Indicates whether resource allocation is done for this status ("Y" for yes, "N" for no) |
| wp_status_id | int4 | [P] | table missing | Primary key, unique Workpackage status ID. |
| name | varchar(50) | [U] | table missing | Name of the Workpackage status |
| icon | varchar(100) |  | table missing | File path of the icon to display for this status |
| sort_no | int4 | [I] | table missing | Index used to sort the statuses in a list |
| mutation | int4 |  | table missing | Date of last change of this record, stored as days since 31.Dec.1971 |
| mutator | varchar(8) |  | table missing | User ID of the AMOS user who last changed this record |
| status | int4 |  | table missing | Generic status of this record |
| mutation_time | int4 |  | table missing | Time of last change of this record, stored as milliseconds since day begin |
| created_by | varchar(8) |  | table missing | User ID of the AMOS user who created this record |
| created_date | int4 |  | table missing | Date of creation of this record, stored as days since 31.Dec.1971 |
| created_time | int4 |  | table missing | Time of creation of this record, stored as milliseconds since day begin |

## wp_status_action

Links between WP Statuses and their enabled actions.

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| action_id | int4 |  | table missing | Id of WpStatusAction enum. Refers to a specific action that can be performed on a WP status. |
| wp_status_id | int4 | [I] | table missing | ID of the WP status, FK to the wp_status table. Links this action to a specific WP status. |
| wp_status_action_id | int4 | [P] | table missing | Primary key of the wp_status_action table. |
| mutation | int4 |  | table missing | The mutation date of this record, stored as the number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | The AMOS user who last updated this record. |
| status | int4 |  | table missing | The status of the record. This column indicates whether the link between the WP status and action is active or inactive. |
| mutation_time | int4 |  | table missing | The time when this record was last updated, stored in milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| created_date | int4 |  | table missing | The creation date of this record, stored as the number of days since 31.Dec.1971. |
| created_time | int4 |  | table missing | The creation time of this record, stored in milliseconds since the start of the day. |

## wp_wl_dist

Workpackage workload distribution

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| distrib_unit | int4 |  | table missing | Distribution unit. |
| distrib_type | int4 |  | table missing | Distribution type: flat (1), based on ground time plan (2) or based on profile (3) |
| wpno_i | int4 | [I] | table missing | Workpackage number (WPNO_I), foreign key to WP table. |
| wp_wl_distno_i | int4 | [P] | table missing | Primary key for the wp_wl_dist table. |
| mutation | int4 |  | table missing | The mutation date of this record as AMOS date (number of days since 31.Dec.1971). |
| mutator | varchar(8) |  | table missing | The AMOS user who last changed this record. |
| status | int4 |  | table missing | The status of the record. |
| mutation_time | int4 |  | table missing | The time when this record was last changed, in milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | The AMOS user who created this record. |
| created_date | int4 |  | table missing | The creation date of this record as AMOS date (number of days since 31.Dec.1971). |
| created_time | int4 |  | table missing | The creation time of this record in milliseconds since the start of the day. |

## wp_wl_dist_entry

Single entry in an interval of a workpackage workload distribution

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| wp_department_linkno_i | int4 | [U,I] | table missing | Foreign key to the department table for this entry |
| val_min | int4 |  | table missing | Value in minutes or percentage, depending on the resource type. |
| planning_qualification | varchar(12) | [U,I] | table missing | Qualification required for planning, foreign key to the qualification table. |
| resource_type_no_i | int4 | [U,I] | table missing | Foreign key to the resource type table, defining the type of resource (e.g., man-hours, material). |
| val | int4 |  | table missing | Deprecated: Value, replaced by val_min. |
| wp_wl_dist_intervalno_i | int4 | [U,I] | table missing | Foreign key to the workpackage workload distribution interval table. |
| wp_wl_dist_entryno_i | int4 | [P] | table missing | Primary key for the workpackage workload distribution entry. |
| mutation | int4 |  | table missing | The date of the last change to this record, stored as days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | The user ID of the AMOS user who last changed this record. |
| status | int4 |  | table missing | The status of the record. Its meaning varies depending on the table. |
| mutation_time | int4 |  | table missing | The time when this record was last changed, in milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | The user ID of the AMOS user who created this record. |
| created_date | int4 |  | table missing | The date when this record was created, stored as days since 31.Dec.1971. |
| created_time | int4 |  | table missing | The time when this record was created, in milliseconds since the start of the day. |

## wp_wl_dist_interval

Interval defined for a workpackage workload distribution

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| maintenance_calendarno_i | int4 | [I] | table missing | Foreign key to DDMaintenanceCalendar table. It references the maintenance calendar used to generate the trade profile for this interval. |
| maintenance_calendar_code | varchar(1) | [I] | table missing | Link to DDMaintenanceCalendar for this interval in case that maintenance calendar has been usedd to generate the trade profile DEPRECATED: Migrated to maintenance_calendarno_i |
| duration | int4 |  | table missing | Duration of this interval in minutes. |
| start_offset | int4 |  | table missing | Offset from the start of the workpackage in minutes. |
| wp_wl_distno_i | int4 | [I] | table missing | Foreign key to the wp_wl_dist table. This indicates the workload distribution to which this interval belongs. |
| wp_wl_dist_intervalno_i | int4 | [P] | table missing | Primary key for the wp_wl_dist_interval table. |
| mutation | int4 |  | table missing | Date of the last modification of this record, stored as the number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | User who last modified this record. |
| status | int4 |  | table missing | Status of this record. |
| mutation_time | int4 |  | table missing | Time of the last modification of this record, stored as milliseconds since the start of the day. |
| created_by | varchar(8) |  | table missing | User who created this record. |
| created_date | int4 |  | table missing | Date of creation of this record, stored as the number of days since 31.Dec.1971. |
| created_time | int4 |  | table missing | Time of creation of this record, stored as milliseconds since the start of the day. |

## wp_work_scope

Work scope of a workpackage (assigned work templates)

| Column | Type | Keys | In DWH | Description |
|---|---|---|---|---|
| automatic | varchar(1) |  | table missing | Indicates whether the work template has been assigned automatically ("Y") or manually ("N") to the Workpackage. |
| uuid | varchar(36) |  | table missing | Globally unique identifier |
| wpno_i | int4 | [U,I] | table missing | Foreign key to the WORKPACKAGE table (WPNO_I) |
| wtno_i | int4 | [U,I] | table missing | Foreign key to the WORKTEMPLATE table (WTNO_I) |
| wp_work_scopeno_i | int4 | [P] | table missing | Primary key for the WP_WORK_SCOPE table. |
| mutation | int4 |  | table missing | Date of the last change to this record, stored as the number of days since 31.Dec.1971. |
| mutator | varchar(8) |  | table missing | User ID of the AMOS user who last changed this record. |
| status | int4 |  | table missing | Status of the record. |
| mutation_time | int4 |  | table missing | Time of the last change to this record, stored as milliseconds since the beginning of the day. |
| created_by | varchar(8) |  | table missing | User ID of the AMOS user who created this record. |
| created_date | int4 |  | table missing | Date when this record was created, stored as the number of days since 31.Dec.1971. |
| created_time | int4 |  | table missing | Time when this record was created, stored as milliseconds since the beginning of the day. |
