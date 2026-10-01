# DAC’S WorkMate — MVP Scope

Date: 29 September 2026

Status: Draft for review. No application changes have been made.

**Mobile Purchasing addition, 30 September 2026:** [Mobile Purchasing](2026-09-30-workmate-mobile-purchasing-design.md) records the agreed role-based buying workspace inside WorkMate, buyer assignments/claims, offline drafts, shared receipts, substitutions, unplanned purchases, Paid/Unpaid payment details and explicit direct-site receiving. Use **Still to buy** for remaining purchasing quantities. Delivery sequencing belongs in the purchasing/inventory plan.

**Feature addition, 30 September 2026:** [Meetings & Work Plan](2026-09-30-workmate-meetings-work-plan-design.md) records the agreed AI-assisted meeting drafts, staff-reviewed publication, targeted shared notes, worker tasks, blockers, acknowledgements and final staff verification, with clear Tagalog/Taglish wording. Read it alongside this scope. Its release placement remains to be planned; it does not silently add these capabilities to Stage 1a or change the existing Attendance/procurement rules.

## 1. What we are building

**DAC’S WorkMate is the confirmed name of the new worker app for Attendance, Material Requests and Tools, managed through Dacs Web.** The user selected this name on 29 September 2026.

**Confirmed project scope: Project Control only.** Project Management is excluded from this worker app's requests, project item history, project tool assignments and automatic cost integration. Existing PM operations remain separate. The shared warehouse has one limited admin/staff exception: **Release stock to other job** records materials leaving for an external job, without creating a PM request, expense or cost transfer.

MVP means the smallest useful version that supports the workflows we agreed on. Keep the screens simple and build in small stages, while preserving the rules needed for accurate stock and expenses.

**Updated product direction:** create the new worker app as **DAC’S WorkMate**, related to DAC'S / Dacs Building Design Services. Preserve the existing Attendance rules, worker accounts and historical records through the shared backend. Use the current Android Attendance implementation as the behavioral reference when recreating its features in Flutter; Kotlin/Compose screens are not directly reusable as Flutter screens. Do not create duplicate worker accounts.

**Confirmed technology: Flutter with Dart; Android only for the first release.** Preserve Supabase accounts/data and existing Attendance behavior. Follow the [Stage 0 roadmap](../plans/2026-09-29-workmate-stage0-roadmap.md).

**Packaging direction:** separate Android app `com.dacs.workmate` (debug `com.dacs.workmate.debug`), planned sibling repository Dacs WorkMate, own signing key and release stream. Keep the old Attendance app maintained; no retirement is authorized here. Preserve pending attendance/photos and never assume the new app can read the old local queue. Stage 0A support exists in migration 0082 and is reported live in the user-supplied Claude review; this update did not independently check production.

The user confirmed the old Flutter Dacs Construction app is an unused prototype; it remains a reference for procurement features. At rollout, verify there are no remaining users submitting to its old Firebase backend, and preserve historical data.

**Confirmed app name: DAC’S WorkMate.** Proposed publisher/subtitle: “By Dacs Building Design Services.” Name selection does not establish trademark or app-store availability. Follow the settled Stage 0 package and release-stream direction. Flutter with Dart is approved; this document update does not implement the new app or migrate the old Flutter prototype from Firebase.

This rewrite simplifies the design; it does not remove the agreed inventory, tools or expense features. The first stage can be piloted early, but the full MVP below includes all four delivery stages.

**Completed prerequisite: document-storage repair.** Migration 0081 shipped in commit `5a3de03`. The migration ledger records application and passing live role-access checks on 29 September 2026. Do not re-plan it as unfinished. This update did not rerun live checks. New request, gallery and shared-receipt storage still require scoped access design and tests preserving legitimate client/partner and staff access.

## 2. Who uses it

| User | What they can do |
|---|---|
| Worker | Record attendance, request materials/tools, edit their requests and see tools assigned to them. |
| Team leader | Do everything a worker does, submit combined requests for members, and confirm tool handovers for their own team. |
| Admin/staff | Manage teams, process requests, encode and review purchase amounts and receipts, arrange purchasing, confirm material receipts/returns, manage stock and resolve conflicting edits. |
| Main owner | Manage all operations and confirm how costs are assigned or transferred between projects. Other owner accounts do not automatically receive cost-transfer authority. |

All staff may enter and review purchase amounts and supporting receipt documents. Preserve their existing payroll encoding workflow and its current access during this MVP as an explicit legacy exception. This supersedes the earlier blanket staff-peso and payroll restrictions in this design. Broader changes to existing payroll/financial privacy are separate work; this MVP must not silently remove access staff needs for daily encoding. New procurement features do not grant access to unrelated profit or payroll records, and staff cannot approve cost transfers.

Workers and team leaders cannot access procurement prices, purchase totals or cost-transfer amounts. Enforce this across requests, item history, images, downloads, notifications, caches and direct data access, including procurement surfaces reachable through the existing Web admin. Product photos must not expose receipt prices. This procurement restriction does not redefine existing Attendance or reward behavior.

**Confirmed main owner: `admin@dacsbuilding.com`.** Only this intended main-owner account may approve cost transfers and external cost handling. Other owner-role accounts, including the PM sub-owner, do not automatically receive this authority. During implementation, verify and bind the existing account's stable identity in trusted server-side authorization; do not rely on a browser-supplied email or owner role alone. The user has confirmed the account; no further identity-choice approval is pending.

## 3. What stays the same in Attendance

**Confirmed business scope:** Attendance applies to **Project Control**, not **Project Management**. PM having no attendance is intentional, not evidence of an inactive project or a missing feature. Preserve the current operational workflow; do not activate PM Attendance or change PM statuses to make those projects appear in Time In.

Project Control and Project Management are separate systems with separate project records, expense workflows and billing rules. Similar names across them are not automatically duplicate sites. For example, a completed Project Control record and an ongoing PM record with a similar name may both be valid. Do not merge, link, transfer costs or apply one record's completed status to the other based on its name.

Before rollout, admin/staff verifies the intended Project Control record for each enabled request destination. This prevents wrong-project selection; it is not a requirement to merge similarly named records across systems. PM jobs are not offered as destinations in this worker app.

**PM procurement is excluded by user decision.** Do not add PM jobs to request, request-again or project tool-issue selection, and do not bring PM job history into this app's project gallery. No PM cost adapter or PC-to-PM cost transfer is part of the MVP. The existing backend's technical support for multiple project systems does not override this business scope.

- Workers and team leaders select projects exactly as they do today.
- No permanent project assignment is required.
- Admin/staff manages team membership separately from project selection.
- Admin/staff explicitly names each team's leader. Acting for a team requires both the team-leader profile role and a current leader assignment to that particular team. The role alone, or ordinary membership in another team, grants no authority over that other team. Enforce this for combined team requests, team-private photo access and tool handovers on the server. Preserve historical actions when leadership changes; recheck current authority when queued actions sync. Leaders can still submit individual requests as ordinary workers.
- Existing Time In, Time Out, photos, location checks, history and offline attendance continue working.
- Requests can be made for an upcoming job without first timing in there.
- Material requests and tool loans do not create attendance records or determine payroll.

**Procurement exception:** for Project Control, admin/staff may manually enable an upcoming project with **Allow requests**, before it has a geofence or is enabled for attendance. Both workers and team leaders may select that project for requests. Attendance visibility and request availability are separate controls: hiding a site from Attendance does not automatically turn off Allow requests. This setting applies only to Project Control in the MVP and does not enable PM requests.

Completed projects block new requests by default, while authorized history access, returns and transfers remain available. Request-again must choose a destination currently accepting requests. Any exception allowing new work on a completed project needs an explicit future policy; normal request submission cannot bypass the block.

Apply the same completion check to the selected Additional Works job, independently of its parent. A completed Additional Works job cannot receive a new request even when the parent remains open; an open child does not override a completed parent's block. Check both records and their parent-child relationship on the server when a request or request-again draft is submitted. Preserve authorized history, returns and transfers for completed work. An offline draft that no longer has an eligible destination stays visible for resolution rather than silently creating a request against completed work.

The app keeps request-only projects out of the Time In picker. Existing Attendance server behavior is preserved: for Project Control, hiding is a picker rule and does not reject delayed offline attendance merely because a site was hidden later (0072). Do not describe it as a new server-side Time In prohibition. Procurement eligibility and permissions are checked on the server; enabling requests does not change Attendance's existing checks.

## 4. MVP features

### A. Material and tool requests

A worker selects one Project Control project, then chooses **Main Contract** or a **specific Additional Works job** under that project, and creates a request with one or more items. Choose **one team once for the whole request**, consistent with the approved defaults. A leader combines that team's members' needs; requests for a different team use a separate request. A worker without a team uses the approved individual-request option. This work selection belongs to procurement and does not change Attendance's picker. Only show Additional Works that actually belong to the selected Project Control project.

Each item includes:

- Material or reusable tool.
- Item name and specification, such as size or type.
- Quantity and unit, such as pieces, bags or metres.
- Trade/work category, such as electrical or plumbing.
- Optional intended member from the request's team for materials; no separate team field per item. A tool's responsible person is mandatory at issuance, not at initial request.
- Optional notes and photos.

Stage 1a request photos require their own private storage area from the first pilot; never put new request photos in the legacy shared `uploads` bucket. Stage 1b adds a separate approved-product gallery with its own access rules.

**Official item catalogue:** admin/staff maintains the shared list of materials and tools, including their names, specifications and units. Workers and team leaders choose an existing item when available. If an item is missing, they can describe it and attach an optional photo; the request still goes through. Admin/staff matches it to an existing catalogue item or creates the official entry before it is used for stock tracking. This matching is item identification, not an extra team-leader approval step.

For example, “PVC pipe, ½-inch, 3 metres long, piece” is one defined item. Alternate wording must not create duplicate stock, and different sizes or units must not be merged automatically. A box quantity cannot be treated as pieces without a known conversion.

Example: one request for House A contains 10 electrical outlets for Juan, 6 plumbing pipes for Pedro and 1 drill for the team.

Requests go directly to admin/staff for purchasing. Workers do not need team-leader approval, and there is no separate request-approval step before entering the purchasing queue.

Admin/staff can use stock already available and purchase only the shortage. For example, 10 outlets needed can be fulfilled with 4 from stock and 6 newly purchased. Stock set aside for that request cannot also be promised to another request.

Each item shows its own progress, including quantities purchased, received, issued and still needed. Admin/staff can substitute an unavailable item, with the replacement and reason visible in the history.

**Flexible weekly schedule:** regular requests follow Saturday cutoff, Monday purchasing and Wednesday delivery by default. After-cutoff regular requests enter the next weekly batch. Admin/staff can adjust purchasing and expected delivery dates per batch, for example for holidays or supplier delays. Workers see the updated expected delivery date. Completed events retain their actual purchase/delivery dates.

**Urgency is per item**, with a reason and needed-by date. Urgent items may be submitted anytime and appear in the admin/staff urgent queue once received by the server, without making every item in a combined request urgent. Stock already available can fulfill requests without waiting for the purchasing day.

**Batch assignment uses the server's received time in Philippine time (Asia/Manila)**, not the phone's draft/capture time. A regular request drafted before cutoff but first received afterward joins the next batch. Show Pending sync before receipt and the assigned schedule afterward. Admin/staff may move a late item into an earlier batch when feasible, recording the change. Retrying an already-received operation must not reassign its batch. Exact Saturday cutoff time and notification delivery channels will be specified in the implementation plan.

Quantity edits remain allowed after cutoff. Additional units received after cutoff join the next batch by default; admin/staff can override when feasible. Preserve quantities already arranged and alert admin/staff to changes affecting purchasing. One line can have quantity portions in different batches: 10 outlets this week plus 2 added for next week. Do not move the original 10 or duplicate their purchase when scheduling the extra 2. Workers see the quantity and expected date for each portion.

### A1. Live supplier search — confirmed 1 October 2026

The user requires live Shopee and Wilcon product results directly inside WorkMate while entering a request item. Opening external supplier sites, manually pasting links, or substituting a staff-managed catalogue alone does not satisfy this feature.

Flow: enter description → show supplier product cards in the app → inspect photo, name, specification, source and available variants → tap **Use this item** → copy the chosen product reference/details into the request draft → confirm quantity/unit and submit through the normal request flow. Preserve source identity/link, selected variant and a dated reference snapshot where permitted, so later listing changes do not silently change the request. Selection creates no order, payment, purchase or inventory record. Procurement can inspect the same reference. Existing catalogue matching remains separate from supplier-listing identity.

Workers/leaders still cannot access procurement prices. Live result payloads and photos must respect this rule; hiding a price label alone is insufficient if the raw response or image exposes amounts. Show a safe placeholder if a product photo cannot be shown without exposing restricted content. Search matches are candidates, not proof of correct electrical specifications; unknown size/rating/length meanings require confirmation rather than AI guesses.

**Feasibility remains unverified:** identify and validate a permitted live product-data integration for both Philippine suppliers, including search coverage, images/variant rights, credentials, costs, limits and freshness. On 1 October an initial public-documentation check could not establish such access (Shopee developer portal returned 403; Wilcon FAQ returned 503). Those failures do not prove integration is impossible. No provider/access has been provisioned and no live results have been demonstrated. Do not promise a delivery stage until a technical feasibility check succeeds. Keep supplier secrets on the server.

Online search must clearly distinguish current responses from cached references. Show source-specific unavailability or no matches honestly; never label fabricated, cached or ordinary web-search snippets as live supplier results. Existing manual request entry remains available during outages without being represented as completion of this live-search requirement. No automatic supplier checkout is included.

**Follow-up public-source verification, 1 October 2026:** the [Shopee Philippines Affiliate Open API page](https://affiliate.shopee.ph/open_api) resolves but exposes no readable API documentation in the research tool. Shopee's [official affiliate application guidance](https://help.shopee.ph/portal/4/article/115728) describes a promotional program with application review; approval there is not evidence of permission for this internal procurement use case or marketplace-wide API access. Confirm eligibility, search coverage and display/image rights before applying or paying. The developer-guide page remained unreadable; no authenticated API call was tested.

Wilcon's official [electrical product listings](https://shop.wilcon.com.ph/products/electrical/electrical-accessories.html) are publicly indexed, but no public product-search API documentation or self-service key application was located. This is not proof that a private partner API does not exist. Ask via [Wilcon contact](https://shop.wilcon.com.ph/contact/index/) or customer care listed in its [FAQ](https://shop.wilcon.com.ph/faq) about a supported product feed/API and permission to show photos/specifications in WorkMate without prices. No supplier was contacted and no credentials, integration permissions, commercial terms or successful live API search have been verified. Website/search-engine results are not an API integration demonstration. The live-search requirement remains required, with an unresolved external access dependency.

### B. Quantity changes


**Quantity terminology:** **Still needed** means remaining request demand not yet handed over, accounting for accepted changes and fulfillment. **Still to buy** means the purchasing shortage after accounting for usable stock allocated to the request and purchases already covering it. Bought-but-undelivered goods may still be needed at site without needing to be bought again. Avoid “outstanding” as a purchasing quantity label. Exact corrections, substitutions and return calculations belong in Stage 2.

The requester and admin/staff can increase or decrease quantities, even after purchasing starts. Team leaders can edit requests they submitted for members.

Changing the quantity needed does not erase what was already purchased or delivered.

| Situation | What happens |
|---|---|
| Worker changes 10 to 12 | The extra 2 become additional demand; after cutoff, default them to the next batch while preserving the original 10's schedule, with admin/staff override available. |
| Worker changes 10 to 8 before purchase | Purchase only the remaining need after checking available stock. |
| 10 purchased, but only 8 needed | Keep the purchase record at 10. The extra 2 become usable inventory after receipt is confirmed. |
| All 10 already issued to the worker | Mark the extra 2 as awaiting return. Admin/staff confirms their return before they become available stock. |

If goods are still with the supplier, admin/staff coordinates cancellation or delivery. Undelivered goods are not counted as available inventory.

**Reducing a quantity spread across batches:** reduce the newest portion not yet arranged for purchase first. For example, 10 arranged this week plus 2 unarranged next week, reduced to 9: cancel the later 2 first, then flag 1 of this week's arranged quantity for admin/staff action. Do not erase a placed order or completed purchase. If the remaining excess has already been purchased or issued, use the existing cancellation, receipt or confirmed-return process. Release any unused stock reservation consistently and preserve the change history.

Keep a record of who changed an item, when and why. Cancelling a request does not delete completed purchases, tool loans or outstanding returns.

### C. Inventory at sites and the warehouse

Track materials at the central warehouse and each project site.

For each item, show its location and quantities available, reserved for requests, in transit, awaiting return or damaged. Materials already issued to a worker are no longer available store stock.

Only admin/staff confirms material receipts and returns. Each confirmation records the actual quantity, condition, location and person who confirmed it.

Transfers have two steps: sent from the source and received at the destination. Until receipt is confirmed, the materials remain in transit. Missing or damaged quantities remain visible for resolution.

Keep a history of every receipt, issue, return, transfer and stock correction. Different sizes, specifications and units must remain distinguishable; matching names alone is not enough.

Before launch, admin/staff checks opening quantities and locations. Staff may encode supported purchase information. Unknown historical costs remain marked unknown until the main owner verifies a supported opening cost for financial assignment.

**Release stock to other job:** admin/staff can record warehouse materials physically released to a job outside Project Control, such as a PM job. Require the item, quantity/unit, source warehouse, recipient, destination name, release date and reason. Keep a source-stock reference and the recording staff member. This is an admin stock movement, not a destination available in the worker request picker.

On confirmed physical release, reduce warehouse stock once and retain the movement history. Do not wait for financial review to correct the physical count. The operation must check available quantity and must not silently consume stock reserved for another request. For example, 20 cement bags minus 5 released to Los Churreros leaves 15 in the warehouse. No PM record is created or updated.

The release initially shows **External cost handling pending**. Only the main owner can confirm **Cost handled outside this app**, with a required external reference or explanation of where/how it was recorded. Preserve who confirmed it and when. Unknown cost or missing evidence remains unresolved; the physical release itself is not proof that the cost has been accounted for. Returns or corrections link back to the original release instead of deleting its history.

### D. Reusable tools

Register each reusable tool with an asset number, such as TOOL-0001, plus its photo, location and condition. Drill bits and cutting discs remain quantity-based materials.

When issuing a tool, record:

- The specific tool.
- The named worker or team leader responsible for returning it.
- The selected project.
- Who issued it and its condition.

Admin/staff and team leaders can confirm tool issuance and returns. Leaders do this for their own team. For new issues, use the linked request's procurement-eligible project, including an explicitly enabled upcoming site; Time In is not required. Returns remain linked to the original custody record even if that project is now hidden or completed. Admin/staff confirms newly purchased tools entering inventory.

A tool can have only one current responsible person. A damaged returned tool stays unavailable until cleared for use. Team changes and account deactivation do not erase outstanding tool responsibility. Lost/damaged tools never trigger automatic salary deductions.

### E. Offline requests

Workers can prepare requests and quantity changes without internet. The app clearly shows whether something is a draft, pending sync, received by the system, failed or needs resolution.

When internet returns, send each operation once. Keep pending requests and photos until receipt is acknowledged. Switching accounts must not show or send another worker's data.

If a worker changes a quantity to 8 offline while staff changes it to 12 online, retain both versions. Admin/staff resolves the conflict instead of silently overwriting either change.

**Approved MVP limit:** stock confirmations, stock reservations, tool handovers and cost assignments require internet. Offline requests remain supported, but an old stock balance cannot guarantee availability. Attendance continues syncing independently.

### F. Materials expenses and inventory

Keep the existing Materials expense workflow and link purchases to requests and inventory.

**Confirmed purchase/payment rule:** a project material purchase counts toward Spent when recorded, whether Paid or Unpaid. Marking it Paid records payment details only and must not create another expense or change Spent or Profit by itself. Offline drafts do not count until server acceptance. General warehouse stock retains its separate unassigned-cost and main-owner-confirmed project assignment rules. Payment and physical receipt remain separate events.

**Confirmed warehouse rule (30 September 2026):** a warehouse purchase recorded in Stage 2, including an unplanned warehouse purchase, is **company stock cost, not any project's Spent**. Stage 2 keeps it as a company-stock cost record outside every project's Spent, Labor/Material/Overhead buckets and G&A; the main owner assigns the issued portion to a Project Control project later. It is never charged to a job by default and is not company overhead. Stage 4 completes the assignment/reconciliation reporting on top of these records.

The Inventory option becomes **Track this purchase in inventory**, with **Received now** or **Awaiting delivery**. Payment alone does not make goods available stock.

Record the purchase once and the actual physical receipt once. Entering the expense, marking delivery and retrying a save must not add the same stock twice. Paying a purchase already recorded must not create another material expense.

For purchases made for a project, keep the original receipt and project cost history. Moving materials between stores is a stock movement, not another purchase or payment.

**Project A to Project B example:** A buys 10 outlets at PHP 100 each. B later receives 2 unused outlets. The main owner can confirm a PHP 200 cost transfer, leaving A with PHP 800 and B with PHP 200. Total purchase spending remains PHP 1,000.

Admin/staff handles physical transfers. Only the main owner account confirms the cost transfer, using the original purchase cost. Both sides must succeed together. Moving A's leftovers into warehouse storage alone leaves their cost with A.

**Warehouse purchase example:** the company buys materials for general stock. Their cost remains with company stock until issued to a project. The main owner then assigns the issued portion to that project; the unused portion remains unassigned stock cost. Pending cost assignments must be visible.

For **Release stock to other job**, show released quantities and attributable costs separately from stock still on hand. Keep unresolved external costs visible until main-owner confirmation; do not leave released goods appearing as available company stock or silently discard their cost. Confirmation records external handling in the reconciliation history and creates no new purchase, payment, PM expense or automatic PC-to-PM cost transfer. Preserve original purchase/source-project cost records; any financial correction to those records requires its own authorized, traceable handling. Existing purchase cost must be counted once across on-hand stock, PC assignment and pending/confirmed external handling.

Billed or closed projects require main-owner review before changing cost attribution. Stock transfers must not silently change client invoices, fees or warranty records. Project-to-project cost transfers in this MVP are between Project Control projects only, with verified billing-period and funding treatment. PM cost records are not changed. Similar project names never establish a transfer relationship.

### G. Project Item History — find and request an item again

**User need:** a worker remembers an item previously bought for Project A but cannot recall its exact name. Today procurement searches old Messenger messages and photos to identify it. The app must retain searchable item history with project labels and images so the worker and admin/staff can identify the same item quickly.

**Proposed simple experience:** inside Requests, offer **New Request** and **Find Previous Item**. Start with the selected project's history and a photo-card view. Search by common name, official name, brand, specification or item code. Filter by project, trade, material/tool and date. An optional list view helps admin/staff scan large histories. Viewing another project's history remains subject to explicit access rules.

Each card shows a clear product photo, official name, key specification/unit, project label, Main Contract or Additional Works label, and latest recorded activity/date. Display a clear placeholder when no image exists; allow admin/staff to add a product photo later. Common worker terms can be saved as search aliases without creating a second stock item.

Opening a card shows the photo gallery and dated history of requests, actual purchases, receipts, issues and returns, with quantities and units. Keep these events distinct: requested does not mean purchased, and issued does not prove installed or consumed. Use labels such as **Previously purchased for House A** or **Issued to House A**, rather than claiming an item was used without a usage record. Show current available stock and location separately, only when the inventory feature is active; old purchase quantities are never shown as current availability.

**Request this item again** copies the known item/specification and reference photo into a new draft. The worker confirms destination project, Main Contract/Additional Works, team, quantity and needed-by date before submitting. Carry a link to the historical reference for admin/staff. Do not copy old purchase status, payments, reservations, responsible person or cost, and do not submit automatically. If the item is obsolete or substituted, explain that and let admin/staff identify a suitable replacement.

Example: a worker opens House A → Electrical and recognizes a photo of a white two-gang outlet. The card shows the brand, specification and earlier delivery. They tap **Request this item again**, choose House B and enter 6 pieces. Admin/staff sees the exact reference instead of searching Messenger. The new request does not imply any of House A's stock has been transferred.

Build history from linked operational records rather than asking staff to encode it twice. Stable item and event links must prevent an expense plus its receipt from appearing as two separate purchases. Preserve historical descriptions, photos and actual substitutions even if the catalogue name changes. A tool model may be requested again, but a particular tool asset still follows its availability and custody rules.

For older materials missing from the app, admin/staff can manually add a labelled **Historical reference** with project, description and optional photo/date/source note. Unknown details remain unknown. This entry helps identify an item; it must not create stock, expenses, payment or a fictitious confirmed purchase. Bulk Messenger imports and automatic image recognition are outside the MVP.

**Launch preparation:** before Stage 1b, run a short seeding session with admin/staff to add useful item photos and specifications for active Project Control sites. Choose sites using verified operational needs. Start with frequently requested or hard-to-identify items. Do not seed PM project records into this worker app. Do not promise a complete old purchase history; receipt images containing prices cannot simply become worker gallery photos.

**Two kinds of photos:** store approved product photos in a separate, access-controlled storage area from receipts and raw request attachments. A raw request photo remains restricted to its requester, an authorized team leader and admin/staff; it is never automatically published to the project gallery. Only admin/staff-approved product photos may enter that gallery. Check for visible prices, personal information and unrelated private content; publish a safe product-only image or keep it private. Approval is recorded, and replacing an approved image requires a fresh review. Approval to publish a photo is not a new approval gate on the request itself.

**Proposed visibility:** workers/leaders see a project item reference view containing product photos, specifications and nonfinancial event information for authorized projects. It does not expose colleagues' private requests, contact details, purchase prices or receipt images containing amounts. Admin/staff retains its agreed purchase-encoding access. The worker-facing product gallery must be separate from financial documents; project selection alone is not a blanket permission to read every historical record.

A prior request does not grant permanent access to the entire project's shared history. Keep access to the worker's own request records separate from current authorization to browse shared project references. Final history-access rules must be defined and tested before Stage 1b launches.

Offline, previously cached authorized references can be browsed with a last-updated label and used to prepare a pending request. Do not promise complete history or current stock without a connection. Apply the existing account-isolation and sync rules to history photos and drafts too.

Bound the offline gallery cache to selected projects/recent items, with an explicit size limit in the Stage 1b plan. Remove older cached gallery images as needed. Pending-upload request photos are stored separately and must not be deleted by gallery-cache cleanup.

**Pilot expectations:** Stage 1a shows request records and privately attached photos. Stage 1b adds searchable request history and approved historical references/product photos. Before Stage 2 integration, neither stage claims verified Purchased, Received, Issued or Available stock information. Those events appear only when backed by the corresponding operational records.

## 5. Simple screens

| Worker app | Purpose |
|---|---|
| Home | Today's attendance, request updates and pending actions. |
| Attendance | Existing Time In, Time Out and history. |
| Requests | Stage 1a: create, edit and track requests. Stage 1b: Find Previous Item opens searchable project history and approved photos. |
| My Tools | See tools currently assigned and return history. |
| Profile | Existing account details and settings. |

Team leaders also get access to their team's requests and tool handovers.

Dacs Web provides the request queue, project item history/photo search, team setup, inventory by location, tool register and owner-only cost review. Admin/staff can open the worker's historical item reference directly from a request. These labels are proposed; the agreed permissions do not depend on the final screen layout.

## 6. Build order

| Stage | Deliverable | Release boundary |
|---|---|---|
| 0. Foundation and Attendance parity | Follow the Stage 0 roadmap; 0B is next. | Separate Android WorkMate app; maintain Attendance and preserve its queue/data. |
| 1a. Requests pilot | Combined requests, catalogue/unlisted-item matching, teams, Main Contract/Additional Works selection, manual Allow requests, completed-project rules, weekly batches, per-item urgency, quantity portions by batch, private request photos and offline editing/conflicts. | Storage repair verified first. Preserve Attendance and staff payroll encoding. Replace legacy broad worker request access on screen and on the server. No shared gallery or unverified purchase/stock claims. Tool requests are allowed; asset tracking arrives in stage 3. |
| 1b. Item history and photos | Find Previous Item, project labels, approved product photos, seeded historical references, request-again drafts and bounded offline reference browsing. | Define and verify shared-history permissions. Raw request photos remain private. Display requested events and labelled references only until verified purchase/movement integration arrives. |
| 2. Inventory and purchasing | Site/warehouse balances, reservations, purchase links, receipts, issues, transfers, returns and Release stock to other job; enrich item history with verified purchasing/movement events and separate current availability. | External releases reduce physical stock once and retain pending external cost handling. Replace duplicate stock-add paths. Keep current expense treatment until stage 4. |
| 3. Tools | Asset registration, named responsibility, team-leader handovers and condition-aware returns. | Introduce existing tools through a checked opening register. |
| 4. Expense integration | Company-stock costs, main-owner-confirmed assignments/transfers between Project Control projects, external-release cost reconciliation and matching reports. | Verify Project Control billing-period, funding and report effects before enabling. External handling requires main-owner confirmation/reference; automatic PM cost integration and cross-system transfers are excluded. |

Each stage must work before moving to the next. Keep Attendance usable throughout. New features are enabled only when their supporting functions are ready. Historical data from the old procurement app is preserved.

At Stage 1a launch, remove workers' and team leaders' broad access to colleagues' requests through the legacy Construction screen and its data endpoints. Hiding navigation alone is insufficient. Provide the new own-request/team-scoped workflow and appropriate historical access before switching over, without deleting old records or blocking admin/staff operations.

## 7. Approved MVP defaults

The user approved these defaults for the first release:

- Workers without a team can still submit an individual request.
- Admin/staff may assign a worker to more than one team; choose one team per request.
- Physical stock confirmations and tool handovers initially require internet.
- Asset numbers are included. Printable/scannable QR labels are optional and may follow after basic tool tracking.
- Suggest the oldest usable received stock first, while keeping its original purchase source identifiable.

## 8. What can wait

The first version does not need supplier portals, automatic supplier ordering, purchase forecasting, offline stock/tool handover confirmation, advanced dashboards or automated tool depreciation/rental charges.

It also does not include a redesign of Attendance's business rules, a new payroll calculation or automatic client billing from stock movements. Reimplementing the existing Attendance behavior in Flutter is required by the approved technology choice; preserve its rules and verify parity rather than introducing a new attendance algorithm. These exclusions do not remove the material requests, inventory, tools or owner-controlled cost rules agreed above.

## 9. How we know the MVP works

- A worker uses one login for attendance and requests.
- Attendance, requests, project item history, project tool assignments and project cost integration remain within Project Control. PM projects cannot be submitted through the new request endpoints, even by bypassing the picker; PM records/statuses remain unchanged.
- Similarly named PC and PM projects retain separate identities and lifecycle states; no automatic merge, link or cost transfer occurs.
- Workers and leaders can select ordinary eligible projects before Time In, plus upcoming projects explicitly enabled for procurement. Attendance checks remain unchanged.
- A request can identify Main Contract or a specific Additional Works job under its selected project.
- Regular requests follow the weekly cycle; admin/staff date changes appear to workers without rewriting completed-event dates. Urgent requests and available-stock fulfillment need not wait for the weekly batch.
- An offline draft arriving after the Philippine-time cutoff joins the next batch unless admin/staff records an override. Retrying the same accepted request preserves its original batch.
- One urgent line does not make the whole combined request urgent. Adding 2 after cutoff to 10 already arranged preserves the original 10 and schedules the extra 2 separately.
- Hiding a site from Attendance does not automatically disable its separately enabled requests. Completed sites block new requests but retain authorized history, returns and transfers.
- A leader submits electrical, plumbing and tool needs in one project request.
- A profile with the team-leader role can act for Team A only when explicitly assigned as Team A's leader; another team's records and handovers remain inaccessible through both the UI and direct calls.
- A completed Additional Works job rejects a new request even with an open parent, while history/returns remain available. A completed parent likewise cannot be bypassed through an open child.
- A worker can submit an unlisted item with a description/photo; admin/staff matches or adds its official catalogue entry without duplicating stock or mixing specifications and units.
- A worker finds a previously purchased item by project and photo, checks its specification and creates a new request without searching Messenger.
- Request-again copies the item reference into a draft, not the old purchase, stock reservation, amount or custody record; admin/staff can open the original reference.
- Item history distinguishes requested, purchased, received and issued quantities from current available stock. Product photos remain accessible without exposing restricted receipt documents.
- Adding an old photo as a historical reference creates no stock, expense or invented transaction; cached references remain isolated by signed-in account.
- A request for 10 can be fulfilled with 4 from stock and 6 purchased.
- Changing 10 to 8 preserves actual purchases and correctly handles the extra 2.
- Reducing 10 arranged this week plus 2 unarranged next week to 9 removes the later 2 first and flags the remaining 1 for cancellation/return handling without altering purchase history.
- A returned material does not become available before admin/staff confirms it.
- Admin/staff releases 5 of 20 warehouse bags to another job: warehouse stock becomes 15 once, and External cost handling pending appears. Only the main owner can confirm external handling with a reference/explanation; no PM record, purchase or payment is created.
- External-release retries cannot deduct stock twice; returned quantities link to the original release, and unresolved costs remain visible without inflating on-hand stock or duplicating source costs.
- Duplicate clicks, retries and expense recording cannot duplicate stock or spending.
- Two requests cannot reserve the same last item; two people cannot receive the same tool at once.
- Offline edits survive closing the app, and conflicting edits reach admin/staff for resolution.
- All staff can encode and review purchase amounts and receipts, and their existing payroll encoding/access continues as a documented exception. New procurement features do not expose unrelated financial records or permit staff cost-transfer approval.
- Workers and team leaders cannot retrieve procurement amounts through any app/Web screen, photo, history, notification, cache, export or direct data call.
- Before Stage 1a ships, document-storage checks deny unauthorized file access while preserving each client/partner's permitted documents and staff encoding access.
- The legacy Construction screen and its endpoints no longer allow workers to browse colleagues' requests; scoped replacement access works.
- Only admin/staff-approved safe product photos appear in the shared gallery; raw request photos remain private. Cache cleanup cannot delete unsent photos.
- Stage 1b begins with clearly labelled seeded references, not invented purchases or stock. History access and photo caching remain account-scoped and bounded.
- Only the main owner can confirm cost transfers, preserving original receipts and total purchase cost.
- Attendance, payroll, project expenses and existing financial reports remain correct.

## 10. Notes for implementation planning

Preserve the repository's existing money rules, project identities and financial isolation requirements. Company stock is not company overhead or a fourth project-spending category. Attendance hours do not determine pay.

The current source has two independent stock-add paths: the Materials inventory option and procurement delivery. Expense editing/deletion does not currently reconcile stock. Replace these paths carefully for migrated items, keeping physical movement history and correction records.

Preserve Attendance's existing Project Control workflow. Do not interpret backend support for PM identifiers as a requirement to introduce PM Attendance. Procurement adds explicit eligibility for upcoming Project Control projects and an Additional Works selection beneath the parent project. New request/project tool endpoints reject PM destinations; hiding PM options alone is insufficient. Project Control jobs and billing periods retain their distinct identities, and PM records remain separate. New procurement permissions must be enforced by the backend, not only by hiding fields on screen. The separate storage repair must still preserve authorized PM client/partner document access because existing PM operations remain in use outside this app.

The existing request-line save deletes and reinserts rows, and the compatibility layer's batch saves are sequential. New stock and linked request operations need stable record identities and database transactions, with safe retry handling. Preserve actual purchase quantity and original unit cost independently of expense funding splits, whose current quantity field cannot reliably represent the original purchase.

**Approved: use new procurement tables** for the new workflow instead of reusing the legacy `requests`/`request_items` save path. Preserve existing requests as read-only history with appropriate permissions; do not delete them or leave their old broad access in place. Define exact table names and migrations in the Stage 1a plan after inspecting the current schema. Give request lines stable identities and enforce Project Control destinations through references to valid Project Control records. Legacy requests remain historical references, not invented new stock or purchases.

Old requests without a project link must not automatically appear in project history. Admin/staff must explicitly map any retained reference to the correct Project Control project before gallery inclusion, with photo approval and history-access rules still applied.

Before Stage 4 is implemented, settle and document the receiving Project Control billing period, client-versus-Cover treatment, source funding history and effect on Direct allocation reports. Project Control-only scope, new procurement tables and `admin@dacsbuilding.com` as the main owner are confirmed. Verify live data counts and the confirmed account's stable identity before configuring access or basing migration work on external observations; this is implementation verification, not a pending user decision.

Before coding a stage, inspect its current database columns and every affected save, display, print and export path. Add migrations for new data, preserve both client portals where affected, and test retries, partial failures, permissions and money totals. Never run the Web build stub.

Reference: [System architecture](../../ARCHITECTURE.md) and the earlier design saved in Git commit `fdc8e19` contain the technical background. This MVP document replaces the longer presentation while retaining the agreed product direction.

**Next step: Stage 0B - Flutter WorkMate foundation**, following the [Stage 0 roadmap](../plans/2026-09-29-workmate-stage0-roadmap.md). Storage repair is recorded complete and Stage 0A is reported live. Complete foundation, Attendance parity and safe transition before Stage 1a. This documentation edit deploys nothing.

### Planning readiness and later-stage decisions

The team rule is settled: one team per request, optional intended member per material line. The user has confirmed `admin@dacsbuilding.com` as the main owner. Storage repair is recorded complete; continue Stage 0B and subsequent roadmap stages before Stage 1a. The plans must still define exact schemas, permissions, cutoff time, notification behavior, deployment order and acceptance checks; this document alone is not implementation or launch verification. Verify the confirmed main owner's stable account identity when configuring privileged actions.

Before Stage 2/3 implementation, resolve the external-release details in their focused specs:

- Distinguish company-purchased stock from Project Control leftovers whose cost still belongs to the original project. Show the source and require main-owner review of any original-project cost correction; an external-handling acknowledgement cannot silently reduce that project's Spent.
- Specify whether Stage 2 offers an evidence-only external-handling acknowledgement, with peso reconciliation in Stage 4. Do not label unverified financial reconciliation complete.
- Specify how partial returns reduce outstanding external quantity and attributable cost, including returns after owner confirmation. Link corrections to the original record and preserve completed confirmations rather than rewriting history.
- The currently approved external-release feature covers materials only. Lending reusable tools to outside jobs requires a separate decision; it is not implicitly authorized by material release approval.

These later-stage decisions do not prevent Stage 1a planning, but must be resolved before implementing the affected stock, tool or financial operations.
