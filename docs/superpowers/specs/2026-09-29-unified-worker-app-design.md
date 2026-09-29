# Unified DACS worker app

Date: 29 September 2026

Status: Design for user review; application implementation has not started.

Scope: Dacs Attendance Android app, Dacs Web administration and shared backend. The dormant Flutter construction app supplies workflow references.

## 1. Intended outcome

Workers use one installed app and one existing worker account for attendance, material requests and reusable tools. Team leaders use the same app and project selection, with additional capabilities for their members. Admin/staff processes procurement and inventory in Dacs Web. The owner retains financial authority.

Expand the supported Kotlin/Compose Attendance app. Preserve its attendance workflow, evidence requirements, worker identities, offline records and history. Implement procurement against the current shared Supabase backend; do not reconnect the old Flutter Firebase backend or embed the old application inside Attendance.

Success means a worker can request items for a selected project, follow fulfillment, change needed quantities, and see tool responsibility without a second account or app. Admin/staff can reconcile physical quantities across sites and the warehouse. Purchases and project cost assignments remain traceable without counting the same purchase twice.

This is a program-level design, divided into four bounded delivery stages. Each stage needs its own implementation details, migration mapping and acceptance checks before execution. Approval of this document permits implementation planning, not an immediate production rollout.

## 2. Confirmed business decisions

| Topic | Agreed behavior |
|---|---|
| Requesters | Every worker and team leader can request materials and tools. |
| Team requests | A leader may collect members' needs and submit one combined request per project. |
| Line details | Each item identifies its trade/work category and team; named members are optional for material requests. Tool issuance requires a named responsible person. |
| Approval | No team-leader or separate admin approval gate before requests enter the admin/staff purchasing queue. Operational checks still apply. |
| Project choice | Workers and leaders select projects exactly as available in Attendance; no new permanent project-assignment restriction. |
| Advance requests | A request does not require a Time In at that project. |
| Team membership | Admin/staff maintains leaders and members. Membership does not restrict Attendance project selection. |
| Editing | Requesters and admin/staff may increase or decrease needed quantities, including after purchasing starts. Leaders edit requests they submitted for members. |
| Purchased excess | Preserve the actual purchase quantity; excess becomes inventory only after physical receipt is confirmed. |
| Delivered excess | Mark awaiting return; count as available inventory only after admin/staff confirms the return and location. |
| Locations | Track both project sites and the central warehouse, including transfers. |
| Material receipts | Only admin/staff confirms receipts and surplus returns. |
| Stock fulfillment | Use available stock first where appropriate, then purchase the shortage. |
| Tools | Support reusable tools alongside materials, with individual asset numbers and named responsibility. |
| Tool handovers | Admin/staff and team leaders may confirm tool issue/return; leaders act for their own team. |
| Offline | Prepare requests and quantity edits offline; clearly distinguish pending sync from server acceptance. |
| Conflicts | Admin/staff resolves conflicting offline edits with both versions preserved. |
| Project cost transfer | Owner may move the original cost of reused materials from Project A to Project B; no second purchase/payment. |
| Warehouse purchases | Hold as company stock until issued to a project; owner assigns the corresponding cost at issuance. |
| Money visibility | Staff must not retrieve peso amounts through UI or backend. Procurement quantity/status work must remain possible. |

## 3. Existing behavior and constraints

The Attendance project picker uses `attendance_projects_for_worker()`. The latest inspected definition is in migration 0072. It combines eligible Project Control folders and Project Management construction projects, applying existing owner, visibility, status and geofence-configuration rules. Reuse this project-selection contract; do not infer team membership from Time In or introduce a one-project-per-worker assignment.

A project reference must retain both system and ID. `folders.id` and `construction_projects.id` are different spaces. `projects` in the Web database means billing periods, not construction jobs.

The current Materials form saves an expense and, if selected, separately increases inventory by the entered quantity. Procurement delivery also independently increases inventory. The current stock table is a quantity counter matched by item name, without the required per-location movement ledger. Editing/deleting an expense does not reconcile its earlier stock addition. These are source observations, not verified production losses.

Relevant source:

- `js/expenses-module.js`: `handleAddExpense`, `_addExpenseToInventory`, `handleEditExpense`, `deleteExpense`.
- `js/construction-module.js`: request status updates, `updateInventoryAfterDelivery`, stock rendering and adjustment.
- `js/supabase-config.js`: request/item and inventory registry and parent/child persistence.
- `supabase/migrations/0001_init.sql`: existing request, inventory and expense schema.
- `supabase/migrations/0072_attendance_project_hide.sql`: current inspected worker project selector.
- `docs/ARCHITECTURE.md`: separate project ledgers, money model and deployment constraints.

No automatic posting may be built on the current shim's sequential batch semantics where an all-or-nothing operation is required.

## 4. Proposed app and admin surfaces

The following organization is proposed for review; labels can change without changing the business rules.

Worker app: Home, Attendance, Requests, My Tools and Profile. Home highlights today's attendance, request changes, pending sync and outstanding tools. Requests combines materials and tools in one project-specific document. My Tools shows the individual's current custody and return history. Leaders additionally see team requests and team tool handovers.

Dacs Web: a procurement work queue, team management, item catalogue, stock by location, receipts/issues/transfers/returns, tool register and an owner-only cost-assignment queue. Reuse existing navigation patterns and preserve allowed-module access checks. Staff works with quantities, units, specifications and status; financial fields and sensitive purchase documents are restricted to the owner.

Attendance screens and server rules continue to determine attendance. Request activity, material delivery and tool custody do not create attendance, payroll or accomplishment records.

## 5. Roles and access boundaries

| Operation | Worker | Team leader | Admin/staff | Owner financial authority |
|---|---|---|---|---|
| Select available Attendance projects | Yes | Yes | Existing admin access | Existing access |
| Submit own request | Yes | Yes | Operational assistance | Yes |
| Submit combined team request | No | Own team | Yes | Yes |
| Edit needed quantity | Own submitted request | Own submitted request | Authorized requests | Yes |
| Manage membership | No | No | Yes | Yes |
| Confirm material receipt/return | No | No | Yes | Yes |
| Confirm tool issue/return | No | Own team | Yes | Yes |
| Resolve offline edit conflicts | No | No | Yes | Yes |
| Enter/retrieve costs; confirm cost assignment | No | No | Staff: no | Yes |

Owner/admin account naming in the interface must not broaden the underlying role rules. Staff financial restrictions also apply to exports, notifications, request history, APIs, cached data and attachments containing amounts. A worker's membership does not grant permission to view another worker's attendance.

Proposed membership default: allow multiple explicit team memberships, managed by admin/staff, with one team selected on each request. Preserve historical membership and custody records when someone changes teams. A person lacking an active team remains able to submit their own request using an explicit individual-request designation; requests must not be blocked merely because roster setup is incomplete. These defaults are proposed, not prior user decisions.

## 6. Requests, edits and fulfillment

A request has one project reference, submitting user, team context and multiple lines. Each line has a stable identity, material/tool type, description/specification, unit, needed quantity, trade, optional intended member, notes and optional photos. Record who submitted a team request separately from who needs or receives an item.

Use a catalogue ID for approved stock items. Allow a descriptive request for an item absent from the catalogue; admin/staff maps it before stock receipt or issue. Names alone cannot identify stock. Unit changes require an explicit conversion; never add boxes to pieces or different cable specifications together.

Track needed, reserved, purchased, received, issued, returned and cancelled quantities separately. Changing needed quantity never rewrites completed purchases or handovers. Item status is derived from these facts; different lines can progress independently. Substitutions retain the requested item, replacement, actor and reason.

When demand increases, reserve additional stock or place the additional quantity in the purchase queue. When demand falls, release unissued reservations first. Unreceived purchases are flagged for cancellation/supplier coordination; physically received extras may be available stock; already-issued extras require confirmed return. Do not create inventory from an arithmetic excess without a physical event.

Cancelling a request stops remaining demand but retains fulfilled lines, purchase links, custody and unresolved returns. Completed history is corrected through recorded reversal/correction actions rather than deletion.

## 7. Inventory and movement controls

Use an item catalogue, locations, purchase/receipt provenance, reservations and a permanent movement history. Maintain balances from confirmed movements, with any cached totals reconciled against that history.

Distinguish on-hand, reserved, available, in-transit, awaiting-return and damaged/unavailable quantities. Available stock is usable on-hand stock less active reservations. Issued material is no longer available warehouse/site-store stock even if it remains physically at the construction site.

| Event | Required result |
|---|---|
| Receipt | Admin/staff confirms actual quantity and destination; link to purchase/delivery, once. |
| Reservation | Server verifies availability and protects stock from competing requests. |
| Issue | Record recipient, project, request and source stock; reduce stock/reservation consistently. |
| Transfer dispatch | Remove from source availability and record in transit. |
| Transfer receipt | Confirm actual quantity at destination; leave shortages/discrepancies visible. |
| Material return | Admin/staff confirms quantity, condition and destination before availability increases. |
| Count correction | Require actor and reason; keep before/after and adjustment history. |

Retain the Materials form's inventory option as “Track this purchase in inventory”, with separate receipt state. A purchase may be paid before receipt or received before payment; physical availability depends on confirmed receipt, not payment status. The same physical receipt cannot be counted again through a request, expense form, retry or delivery-status change.

Preserve source ownership and cost provenance when stock changes location. Location does not by itself establish permission to use materials purchased for a different client/project. Cross-project reuse enters the owner review flow, with any required client-billing adjustment explicit.

## 8. Reusable tools

Generate a unique stable asset number for each reusable tool; proposed presentation is `TOOL-0001`, with optional printable QR labels. Store description, photo, condition, location and custody history. Bits, discs and other consumables remain quantity-tracked materials.

Each issue identifies the tool, responsible worker/leader, project, issuing actor and condition. Only one active custody record is permitted per tool. Team leaders can issue/receive for their own members or themselves, using the same available-project selection as ordinary workers. Admin/staff manages all authorized teams.

Returns record condition. A damaged return can be accepted into custody without making the tool available for reissue. Lost/damaged reports remain visible for admin/owner resolution and never create automatic salary deductions or project charges. Changing teams or deactivating a user must not erase outstanding responsibility.

Registering a newly purchased tool into company inventory remains an admin/staff receipt operation. The team-leader permission concerns tool handovers and returns, not general warehouse procurement or material receipt authority.

## 9. Offline operation and conflicts

Reuse the Attendance application's durable-storage approach, with separately scoped procurement records and sync work. Every local operation has a stable event ID and authenticated user identity. Keep pending requests and photos until acknowledgement; never upload one worker's queued changes as a different signed-in worker.

Queued edits retain the version they were based on. Server operations validate current permissions, project eligibility, membership and fulfillment state. If an edit conflicts with a newer change, preserve both versions and route it to admin/staff. Disjoint edits may merge only when their validation rules remain satisfied; concurrent edits to the same quantity are not silently added together or overwritten.

Show Draft, Pending sync, Synced, Needs resolution and Failed states distinctly. Cached stock is informational: it cannot guarantee an offline reservation. New or increased demand does not reserve stock until the server confirms it.

Proposed first-release boundary: requests and quantity edits work offline; stock confirmation, reservations, tool handovers and cost assignments require connectivity. This prevents competing offline devices from issuing the same tool or stock. Extending offline physical handovers requires a separate design.

Attendance sync must continue independently when a procurement operation fails. Preserve queued changes across process death and restart. Revalidate membership/role after reconnect; do not discard rejected requests without a visible explanation.

## 10. Expenses and project cost assignment

Keep three distinct facts: actual purchase/payment history, physical material movement, and which project bears the cost. A request or stock movement does not itself record a second payment. Owner-confirmed cost assignments are explicit financial actions.

### Project purchase reused elsewhere

Example: A buys ten outlets for PHP 1,000. Two are later issued to B. Owner confirms a PHP 200 transfer: A retains PHP 800 and B carries PHP 200. Preserve the original purchase and receipt; total allocated purchase cost remains PHP 1,000. Moving A's leftovers into warehouse storage alone leaves their cost with A.

### Direct warehouse purchase

Record the actual company purchase and its unassigned stock cost without charging an arbitrary project or treating it as company overhead. When stock is issued, owner assigns the corresponding original cost to the receiving project. Show an explicit pending cost-assignment state until confirmation. Remaining stock retains the unassigned cost. A payment against an already-recorded purchase does not create another material-cost entry.

### Financial controls

- Retain original purchase lots/source lines and unit-cost provenance; identify which source quantity each issue uses. Proposed default is oldest usable received stock first, with explicit source selection when needed.
- Owner-confirmed transfers post balanced source/destination adjustments atomically and once. A failed operation posts neither side. Reversals remain linked to the original event.
- Never transfer more quantity/cost than remains attributable to the source. Returns reverse or reassign cost only through an explicit owner-reviewed action.
- Billed or closed projects require exception review. Do not silently rewrite issued invoices, cost-plus fees or frozen warranty contributions.
- Cost transfers are not client allocations, revenue, accomplishment, cover funding, reimbursements or warranty draws.
- Preserve Labor/Overhead classification, Cover as a subset of Spent, Forecast labels, and all isolated modules.
- Project Control and Project Management require separate cost-posting adapters. Do not put a construction-project ID into a billing-period field. A cross-system transfer is disabled until both adapters and their reporting effects are verified.
- Company stock is not a new job-level Spent bucket. Existing project formulas stay intact; stage 4 must explicitly map approved material-cost adjustments into every affected total and presentation.

This stage changes cost attribution beyond today's quantity-only inventory. It requires a dedicated financial integration spec and regression evidence before activation. No new general ledger, tax treatment, depreciation, tool rental charge or automatic client billing is included.

## 11. Technical ownership and consistency

The Android app owns worker interaction and durable pending operations. Web owns admin work queues, confirmations and owner financial review. Supabase owns authoritative identity, permissions, version checks, state transitions and transactional movement/posting operations. The old Flutter app is a workflow reference only.

Conceptual records: teams/memberships, item catalogue, requests/lines/revisions, purchase-source links, locations, stock receipts/movements/reservations, tool assets/custody, conflict resolutions and restricted cost assignments. These are design concepts, not approval to create particular table names or columns without inspecting the live schema.

Use real migrated columns and owner-scoped access. Enforce permissions on the server, not just screen visibility. Restrict worker reads to safe request/tool data and prevent financial values from being returned then hidden. Database operations must prevent overselling stock, duplicate receipts and duplicate custody under concurrent use.

Keep financial documents out of worker/staff attachments and offline caches. Notifications identify status, quantities or actions without peso amounts for restricted roles. Existing attendance reward behavior is not expanded by this design.

## 12. Delivery stages and release boundaries

1. **Requests and teams:** existing-account integration, team administration, current project selector, combined requests, line revisions and offline/conflict handling. Show accurate manual progress; do not promise live stock availability before stage 2. Requests for tools are accepted, but tracked tool issuance launches with stage 3.
2. **Inventory and purchasing:** catalogue, locations, reservations, physical movement history, partial fulfillment, receipts/returns and purchasing links. Replace both legacy automatic stock increments for migrated records. Existing financial entries retain their current treatment. Show cross-project cost review needs; do not activate unimplemented cost-posting features.
3. **Tool tracking:** asset registration/labels, named custody, leader permissions and condition-aware returns. Existing tools enter through a confirmed opening register, not invented historical purchases.
4. **Expense integration:** company-stock purchase recording, owner cost assignments, project-to-project reallocation, both ledger adapters and complete reports/exports. Activate only after financial reconciliation tests pass.

Roll out backend support before dependent app versions. Use a controlled pilot and per-stage enablement. Preserve existing Attendance and historical requests throughout. Retiring the Flutter prototype does not authorize deletion of its historical data.

Before switching inventory, take a reviewed opening count per item/location, distinguish outstanding issued tools and unresolved returns, and reconcile duplicates. Existing name-only inventory has no reliable location or purchase provenance: do not fabricate those facts. Quantities can be entered with documented unknown cost; owner must establish supported cost before financial allocation.

Once a location/item uses the new ledger, prohibit legacy direct stock-counter writes for it. Rollback disables new actions while preserving confirmed movements and financial history; it must not restore an old counter over newer transactions.

## 13. Acceptance examples

- A worker and leader see the same eligible project list as Attendance and may request ahead of Time In.
- A leader submits electrical and plumbing lines for different members in one project request; unrelated teams cannot access or administer them.
- Ten requested items are fulfilled with four reserved from stock and six purchased, without a second purchase expense for the four.
- Reducing demand from ten to eight preserves ten already purchased. If two remain in store they can be unreserved; if already issued they await confirmed return.
- Marking delivery twice, retrying a receipt or recording its expense cannot add stock twice.
- Two simultaneous reservations cannot consume the same last item; two handovers cannot issue the same tool.
- A transfer remains in transit until receipt; a short receipt does not silently create the missing quantity.
- Offline worker quantity eight versus newer staff quantity twelve creates a visible conflict; admin/staff resolution retains both originals.
- Switching accounts never exposes or uploads another worker's pending request or photos.
- A leader returns a damaged drill for a member; custody ends but the tool remains unavailable until cleared.
- A-to-B cost transfer reduces A and increases B by the same original cost, records no new payment and preserves the original receipt.
- Warehouse purchases reconcile to cost already assigned plus cost remaining unassigned; outstanding owner confirmations are visible.
- Staff cannot retrieve amounts through direct API calls, exports, notifications, files or cached responses.
- Existing attendance, payroll isolation, Cover, Earned/Forecast, overhead and warranty rules remain intact.

## 14. Verification and implementation mapping

Before each implementation stage, inspect current migrations and live schema, trace every save/render/print/export path, and list affected files in that stage's plan. Never reserve a migration number from this document; choose highest plus one at implementation time.

Expected Web surfaces include `js/construction-module.js`, `js/expenses-module.js`, `js/supabase-config.js`, `js/admin.js`, `admin.html` and the schema/architecture docs. Stage 4 also includes Project Control calculations, PM costs, print utilities, invoice/report/CSV surfaces and paired client portals where affected. Both portal HTML files must remain aligned.

Expected Android surfaces include navigation, repositories, authenticated local caches, Room migrations, sync scheduling and new request/tool screens. Preserve the existing Attendance RPC payload and trusted-time deployment contract.

Verification includes server permission tests across roles/owners, concurrent stock/custody operations, retry and failure-between-steps tests, offline device scenarios, migration rehearsals, opening-stock reconciliation and cross-ledger cost totals. Run Web money tests after any money-code change and JavaScript syntax checks. Never run the Web build stub. Run Android tests and handset verification for the merged flows. A previously saved test report is not a fresh pass.

## 15. Review boundary

The business rules in section 2 reflect the conversation. Screen organization, multiple-team fallback, online-only physical confirmations, QR presentation and source-lot default selection are explicit proposed defaults in this document.

The next step after written-design approval is an implementation plan for stage 1, with its exact schema and API contracts. Subsequent stages each receive their own focused specification and plan, with the financial integration treated as a distinct controlled change.
