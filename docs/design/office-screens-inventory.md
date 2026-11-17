# DAC'S Web office portal: Attendance, Requests and Work Plan
## The complete screen inventory, for the layout redesign

**What this is.** Every screen, tab, list, button, form field, status label, warning and empty state that exists
today in three top tabs of the office portal (`admin.html`): **Attendance**, **Requests** and **Work Plan**. Use it
to redesign the layouts so that **nothing is missed**.

**Who uses these screens.** A Philippine construction company's office: the **owner** accounts (the *main owner*
plus other owner accounts), **staff** (office) accounts, staff with the **Buyer** switch, and accounts narrowed to a
few sections. Workers and team leaders never use this portal; they use the phone app **DAC'S WorkMate**.

---

## 0. Rules for the redesign

1. **Keep everything.** Every item below must still be reachable somewhere visible in the new layout: buttons,
   fields, help text, states, warnings, confirmations, reason boxes, "type a word to confirm" steps, empty states and
   role variants. You may move things, regroup them, put secondary actions under a **More (…)** menu, turn pop-ups
   into side-panel forms, and change the visual style. Do not drop anything.
2. **Do not invent features.** Draw only the actions listed here. One action seen in earlier mockups does **not**
   exist and must not be drawn as if it did: **"Mark all arranged"** on a request. (These **do** exist and are listed
   below: Move… a request line to another batch, tools "Found…", receiving "Not delivered…", Hours report "Close this
   day", Catalogue's Active switch.)
3. **Who sees peso amounts.** This rule matters more than the layout. Never put an amount in a list row, count,
   badge, chip, tooltip or panel where that account cannot see amounts today.
   - **Attendance:** the only amounts are the Weekly bonus amounts, and **only owner accounts** see them. Staff see
     no amount column and no total.
   - **Requests → Queue, Setup, Stock, Tools:** **quantities only, no prices anywhere.** One exception: inside Stock,
     owner accounts see the peso value of a **stock cost move** (staff see the row and its state, never the amount).
   - **Requests → Purchasing:** shows prices, but **only buyers** reach it (owner, admin with Expenses, or staff with
     the Buyer switch). Everyone else does not see the Purchasing tab at all.
   - **Work Plan:** no money anywhere.
4. **Wording that must stay exactly as it is** (each label carries a business rule): "Stock cost move", "Cover is
   right", "Bill checked", the temporary-password warning text, the App-updates "will be BLOCKED" warning, "Record
   only, no payments", "Hours record attendance — not a basis for pay", "Closing a day records no hours and changes
   no pay", and every "Type OFF / STOCK / TOOLS / the worker number / the word shown to confirm" step.
5. **Phone width.** Must work at ≤ 720 px. The direction already chosen: the list fills the screen, tapping a row
   opens the detail full-width with a **Back** button, and **Next** still works.
6. **Look and feel already in use.** Colours: brand green `#1A5C3A` (dark `#134428`, light `#267A4E`), soft green
   `#EAF2EC`, ink `#1C1C1E`, grey text `#6C6C70`, surfaces `#FFFFFF` / `#F5F5F5`, hairlines `#E5E5E5`. Fonts:
   **Playfair Display** (titles), **Barlow** (text), **IBM Plex Mono** (times, quantities, numbers). Status pills:

   | Tone | Background / text | Means |
   |---|---|---|
   | done | `#EAF2EC` / `#1A5C3A` | finished, arranged, recorded, on track |
   | working (gold) | `#F5EFE2` / `#7C5E2A` | on site, to arrange, to approve, waiting |
   | red | `#FBEDEB` / `#C0392B` | problem, conflict, overdue, blocked (solid red = overdue by days) |
   | check (blue) | `#E8EEF6` / `#2A4D7A` | reported done, leader checked, "Costing job" |
   | pm | `#EDEBE6` / `#5C5344` | "Site works" |
   | none | `#F0F0EE` / `#6C6C70` | absent?, older, neutral |

7. **Layout direction already chosen (the "triage split view").** It is the reference: a header line (title, short
   grey sub-line, optional More (…) menu, optional green primary button), **tabs with counts** (the first tab is
   "Needs you" / "Needs action" where there is one), then a **list on the left** (about 440 px, own search box,
   sticky group headers, rows with a title, a grey sub-line, chips, a mono figure and a status pill on the right) and
   a **panel on the right** (kicker, title, pills, notice box, form fields, photos, text, lines, blockers, facts
   table, history, and a footer with action buttons on the left and **Next ›** on the right). Forms open **in the
   panel**, not as pop-ups. Photo and receipt viewers may stay as overlays. **Requests → Queue is already built this
   way** (§2.1); every other screen below is still in the old full-page layout.

---

## 1. Portal chrome around these three tabs

- **Top tabs** (one row): Project Control · Project Management · **Attendance** · **Requests** · **Work Plan** ·
  Quotations · Appointments · Construction · Users. Only the three in bold are being redesigned now.
- **Modules row** under the top tabs (the secondary links of the chosen top tab):
  - **Attendance:** Today on site · Workers · Sites & schedule · Hours report · Weekly bonus · App updates *(owner
    accounts only)*.
  - **Requests:** Queue · Purchasing *(buyers only)* · Stock *(once switched on; the main owner always sees it)* ·
    Tools *(once switched on; the main owner always sees it)* · **Setup ▾** (a menu: Weekly batches · Teams ·
    Catalogue · Item history · Projects). While a Setup screen is open, the Setup link is highlighted and shows that
    screen's name. If an account can see only one setup screen or none, no menu is drawn.
  - **Work Plan:** Board · Meetings.
- **Red "needs you" counts:** on the **Requests** top tab and on **Queue** (the number of requests in the Queue's
  "Needs action" tab). Counts are numbers of items, never amounts. A failed count shows no badge. (Attendance and
  Work Plan are meant to get the same counts when they are redesigned.)
- **Drill-down pages** that open from a list today: one worker's day (Attendance), one request (Requests, already a
  panel), one purchase (Purchasing), one task and one meeting (Work Plan), one stock item and one tool (Stock /
  Tools, inside their tab). In the new layout each becomes the right-hand panel of its list, and other screens must
  still be able to link straight to an item.
- **Accounts narrowed to some sections** (for example a project-management-only account, or a Purchasing-only,
  Stock-only or Tools-only account) see only their sections. A Purchasing/Stock/Tools-only account sees a Requests
  tab holding just those modules. The redesign must not give or take away any screen.
- The bell at the top right is the Construction notifications bell. It stays as it is.

---

## 2. Requests

### 2.1 Queue: incoming material and tool requests *(already in the new split view)*

**Who:** owner and staff. Quantities only.

**Header.** Title **"Request queue"**. Sub: "Materials and tools from DAC'S WorkMate · urgent first, then by weekly
batch", plus " · N overdue" when some are overdue.

**Beside the tabs: "This week" box.** Cutoff → Buy → Deliver dates · the note "Requests received after the cutoff
go to the next week." · link **Change batch dates** (opens Setup → Weekly batches).

**Notice above the split** (only when over 300): "Showing the newest 300 requests. Requests with a reduction or an
offline edit to resolve are always included."

**Tabs, each with a count:** Needs action · Urgent · To resolve · To arrange · Arranged · All open · **Closed** (the
Closed tab loads separately; its count shows once loaded). A "Needs action" tab with nothing in it gives way to the
next tab.

**List controls:** search "Search worker, project, item…"; weekly batch select "All weekly batches" (each option
shows its open portions); a "Showing X of Y" line.

**Group headers** (sticky, with a count): **Urgent** "Needed soonest first" (red) · **Cutoff [date]** with a "This
week" pill and "Buy [date] · Deliver [date]" · **Waiting on the office** "No batch left to arrange" (red) · **Nothing
left to arrange** (muted) · **Closed requests** (Closed tab).

**List row:** title "requester · project"; sub-line = the items; meta "work · team · N items" (or "1 of 2 open",
"· closed"); right side = received day and status pill; chip "URGENT · needed today" / "URGENT · by [date]" /
"OVERDUE · needed [date]"; urgent rows have a red left bar, overdue rows are tinted, finished rows are dimmed.

**Status pills:** Needs resolution · Reduction to resolve · To arrange · Partly arranged · Arranged · Cancelled ·
Closed.

**Empty states:** "No open requests. New ones appear here as soon as a worker sends them." · "No closed requests
yet." · "No request matches these filters." + **Clear filters** · "Nothing in this tab." · "Nothing here. You're
done." · error "This request could not be opened. Reload the page."

**Panel: one request.**
- Kicker "Request · received [when]"; title = project; sub "work · from [name] · team"; pills: status,
  urgent/overdue, Cancelled.
- Overdue notice: "Needed [date]. Arrange it now or tell the worker when it will arrive."
- Summary chips: items, urgent/overdue, N to resolve, N to arrange, arranged, cancelled.
- Text "Note from the worker".
- **Items (N)**, one card per line: number, description, "Tool / Material · size/spec · unit · category", URGENT
  chip "URGENT · by [date]", state pill. Facts: Still needed · Catalogue [match or "Not in the catalogue"] with a
  **Match** / **Change** link · Requested again from · For · Why urgent · Notes.
  - **Offline-edit block** (when a phone edit arrived late): "Offline edit needs a decision. [name] changed this to
    [qty] on a phone that had not seen the change to [qty]. Nothing was overwritten." Buttons **Apply [qty]** /
    **Keep [qty]**.
  - **Weekly portions** of the line: Weekly batch · Buy → Deliver · Quantity · Arranged ("Arranged by [name] ·
    [when]" or "Not yet") · "Reduction −N". Buttons per portion: **Mark arranged** (primary) · **Move…** · **Undo
    arranged** · **Resolve reduction…** (warning colour).
  - Line photos (click = full size).
  - Line buttons: **Change quantity…** · **Cancel item…** (warning colour).
- Facts table: Requested by · Project · Work · Team · Received · Drafted on phone.
- **Photos** (two-up; click opens full size; "Photo unavailable" when a link fails).
- **History** (collapsed when more than 6 events; "No history yet."). Event wording: Sent the request · Changed the
  quantity · Offline edit to … arrived after the quantity had changed to … — needs resolution · Cancelled the item ·
  Cancelled the request · Added a photo · Marked … arranged · Undid "arranged" on … · Reduced the order by … / Kept …
  as surplus · Office changed the quantity · Office cancelled the item — … · Applied the offline edit (…) / Kept the
  current quantity; offline edit (…) not applied · Matched to a catalogue item / Removed the catalogue match · Moved …
  to another weekly batch.
- Footer: **Next request ›**. On a phone: **Back** at the top.
- Mark arranged / Undo arranged act at once (the button is disabled while saving; an error shows as an alert).

**Forms (open in the panel):**
| Form | Fields and text | Buttons |
|---|---|---|
| Change quantity | "· now [qty]" · New quantity ([unit]) · Reason · help "Lowering below what is already arranged does not erase it: the difference waits as a reduction for you to resolve." | Save · Cancel |
| Cancel this item | Reason · warning (if arranged) "Part of this is already arranged. That quantity will wait as a reduction for you to resolve." | Cancel item · Cancel |
| Resolve the reduction | "[qty] was arranged; the request now needs [qty] less. What happened to the order?" · choice: "The supplier order was reduced" / "Kept the full order — the extra is surplus" · Note (optional) | Resolve · Cancel |
| Move to another weekly batch | batch select | Move · Cancel |
| Apply the offline edit / Keep the current quantity | "The item will need [qty]" or "The item stays at [qty]; [name]'s edit is kept in the history only." · Reason | Apply / Keep current · Cancel |
| Match to the catalogue | Search the catalogue · Catalogue item ("— No match —") · help "Missing? Add it in Requests → Catalogue first. The worker's own words stay on the request." | Save match · Cancel |

Errors appear inside the form (for example "Enter a quantity above 0 (up to 1,000,000, at most 3 decimals).",
"Write a short reason. It is saved in the item's history.", "Arranged quantity cannot be moved. Undo "arranged"
first.", "A reduction is waiting on this quantity. Resolve it first.").

---

### 2.2 Purchasing *(buyers only, shows prices)*

An account without the Buyer right sees only a lock notice: "This needs an account that may buy: the owner, or staff
with the Buyer switch on. …"

**Header.** Title **"Purchasing"**. Sub: "Who is buying what, what was bought, and what is still to buy. Prices show
here only."

**Tabs:** Shopping list · Purchases · Owner approvals · Cash · **Company stock** *(owner accounts, once Stock is on)*
· **Reconciliation** *(owner accounts)*. The Record purchase form is a further page reached from the Shopping list.

#### 2.2.1 Shopping list
- Toolbar: search "Search item, project, worker…" · weekly batch select ("All weekly batches", options show "· Buy
  [date]") · project select "All projects" · checkboxes **Mine** · **Unassigned** · **Urgent** · **Clear**.
- Button **Purchase with no request**. Hint: "Bought something on the list? Tick it, then press **Record purchase**."
- Summary chips: N to buy · quantity changed · unit check.
- **One card per request line:** tick box "Add to the purchase" · item, project, "· requested by [name]" · chip
  "Office check waiting" · stock hint "In warehouse: [qty] — check before buying" + **Issue from stock…** ·
  figures **Needed · From stock · Tools issued · Bought · Still to buy · Extra**.
  - Its weekly portions: Weekly batch · Cutoff · To buy ("needed · from stock · tools issued · bought · still to
    buy") · Buyer (name, "You", or "Unassigned") · flags Arranged / Quantity changed. Buttons: **I'll buy this** ·
    **Assign…** / **Reassign…** · **Release** · **Mark arranged** / **Undo arranged**.
- Sticky bottom button **Record purchase (N)** (N = ticked lines).
- Empty: "Nothing left to buy in this batch." · "Nothing matches these filters."
- **Assign / Reassign form:** "Still to buy: [qty]. What was already bought stays with whoever bought it." · buyer
  select (You / buyers) · Quantity ("Less than all of it splits that part off for this buyer; the rest stays as it
  is.") · Note (optional).

#### 2.2.2 Record purchase (also used for Correct and Record again)
- Titles: "Purchase details" / "Correct this purchase" / "Record again — purchase details". Sub "Who sold it, when it
  was bought and how it was paid." Record again also says: "Record again — a new purchase copied from a voided one.
  Check every line: it is saved as a new purchase. The voided one stays voided, as history." A purchase with no
  request starts with: "Bought something nobody asked for? Add each item below, choose the project it was for (or
  Warehouse), and say why it was bought."
- **Header fields:** Date bought · Supplier (select + **+ New supplier**) · Paid by (Cash / Bank transfer / Check /
  On account / Not yet paid / not known) · Bought by ("You (…)" or another buyer; only the owner records for someone
  else) · Notes.
- **"What was bought"**, one card per item ("One card for each item on the receipt."): kind tag "From a request" /
  "No request" · **Remove** · Item · Quantity · Unit · Amount (₱) · Category · Charged to (project + its work, or
  "Warehouse (company stock)", help "Pick the project it was for, or Warehouse if it goes to company stock.") ·
  "Compared with the request" (Same as requested / Same item, other words / Substitute — an important specification
  differs) → "What changed, and who agreed" · when more than needed: "Why more than needed?" + "Extra goes to" (Same
  project / Warehouse (cost stays on the project)) · for no-request lines: "Why was it bought without a request?" ·
  expandable "Weekly portions (optional — leave empty for your own, then unassigned, earliest first)" with a
  quantity per portion · live preview line ("Covers … in the portions picked · … still to buy · Extra", "Warehouse —
  company stock, outside every project's Spent", "Unplanned — no request", "Substitute — counts toward Bought after
  an office check", "Different unit from the request (…) — counts toward Bought after an office check").
- **+ Add a line with no request**.
- **"Delivery fees and discounts"** (optional): **+ Delivery fee** · **+ Discount**; each row = kind · amount ·
  "Adjust the split" (per-line shares) · ×. Help: "Shared across the lines by line amount unless you adjust it.
  Never charged to one project automatically." Preview "Split by line amount: …".
- **Receipt photos:** Purchase order · Delivery receipt · Supplier invoice · Payment receipt; each "choose a photo",
  "(uploads when you save)", "On file — choose a photo to replace it", **Remove**. Note: "Kept once for the whole
  receipt, office buyers only — never shown to clients, partners or workers."
- **"Paid now?"** (optional; "A payment never changes Spent — it only says how the receipt was paid."): Paid at the
  counter? Not paid yet / record later · Paid in full · Paid part (deposit) → Amount paid (₱) · Paid from (Petty
  cash / Own money / Company (paid directly) / Supplier credit) · Credit to use · How (Cash / GCash / Bank transfer /
  Check / Other). Hint "Petty cash and own money belong to a staff buyer: pick them in "Bought by" to use theirs."
  Petty-cash shortfall note: "You hold [₱] of petty cash on record. This payment is [₱] … It is saved, and the owner
  sees the difference as a shortfall to check."
- Correct only: "Reason for the change (kept in the history)".
- Footer: **Receipt total** · Cancel · **Save purchase** / **Save correction**.
- Extra steps: "Send to the owner?" ("Only the owner can make this change (another project, or a completed
  project)…") → **Send for approval**; "Already saved" notice when a double press is caught.
- **New supplier form:** Name · Branch (optional) · Contact (optional) → **Add supplier**.

#### 2.2.3 Purchases list
- Filters: From / To dates · status (Recorded / Voided / All) · "All projects" · search "Search supplier, project,
  person, source…". Notices: "Showing the newest 300 — narrow the dates." and "Project Control purchases are listed
  here too — check the Source and the project before you void anything."
- Table: Date · Supplier · For (project, Warehouse, "from requests") · Source (Project Control / Purchasing / Phone)
  · Total · Payment · Bought by ("recorded by …") · Status. Row flags: Void · No receipt · Owner approval pending ·
  Unit check · Office review · Extra · Unplanned.
- Empty: "No purchases in these dates." · "Nothing matches the search."

#### 2.2.4 One purchase (drill-down)
- Title "Purchase · [date]"; sub "[supplier or No supplier] · [₱ total] · bought by [name], recorded by [name] ·
  entered in [source]".
- Buttons: **← Purchases** · **Correct…** · **Void…** · **Record again…** (on a voided one).
- Notices: "Voided — it counts for nothing in Spent or Bought. It was replaced by a newer version. *Open the newer
  version*" or "… Its receipt and history are kept." · "This is a newer version: it replaced an earlier purchase.
  *Open the earlier version*" · "A change is waiting for the owner (kind, by name): reason" · "No receipt: reason".
- Lines table: # · Item · Quantity · Amount · Request ("For request: … · covered … · extra …", "same project",
  "Substitute", "Different unit — office check needed", "Checked: covers …", portions "Cutoff … · bought by …",
  "Warehouse — company stock", "Unplanned") · **Check substitute…** / **Check unit…** (Office review). Fee and
  discount rows with their per-line split.
- Receipt photos (links open a viewer).
- **Payments section:** "How this receipt was paid. Payments never change Spent — the purchase counted once, when it
  was recorded." (older ones: "Recorded before payments were tracked. Record a payment to start tracking it.").
  Figures: Receipt · Paid · Left to pay · Over (· resolved). Payment status: Payment not tracked / Unpaid / Partially
  paid / Paid / Overpaid / Voided — paid, to recover. Table: Paid on · Amount · How · From · Note (proof link,
  "recorded by", "carried over from the earlier version of this purchase") · **Void…**. "Refunds and supplier
  credit" list (each with **Void…**). "Voided payments (N)". Buttons **Record payment…** · **Resolve overpaid…**.
  Warning when refunds exceed what is over.
- **History:** Recorded · Corrected · Billing periods re-checked · Voided · Replaced by a new version · Office check
  (different unit or substitute) · owner approvals (Waiting for the owner / Approved / Rejected / Withdrawn / Out of
  date — the purchase changed).
- **Forms:**
  - *Void this purchase?* "It leaves Spent and Bought — all N line(s). The receipt and history are kept; it does not
    say goods were returned or money refunded." · Reason (kept in the history) · **Type [word] to confirm** · **Void
    purchase**. (A completed project: "Only the owner can void this one… It was sent to the owner for approval.")
  - *Check a substitute / Check a different unit:* "Bought … instead of …. If it does the job, how many … of the
    request does it cover (0 if it does not)?" · Covers (…) · How you know · "Someone other than the buyer checks it;
    it is kept in the history." · **Confirm**.
  - *Record payment:* "[supplier] · receipt [₱] · [₱] left to pay. A payment never changes Spent." · Amount (₱) · Paid
    on · Paid from · Whose money · Credit to use · How · Note (optional) · Proof photo (optional — GCash screenshot,
    deposit slip) · note "Own money counts as "Company owes you" once the owner has allowed it (or accepts it
    afterwards)." · "Already recorded" when a double press is caught.
  - *Resolve overpaid:* "[₱] over. A refund goes back to the money that paid it; a credit stays with the supplier for
    later purchases. Nothing here changes Spent." Per payment: Refund of (₱) · Money it paid from · Received on ·
    Where it went (To the owner / company · Back into [buyer]'s petty cash · to the buyer for their own money · …) ·
    Buyer who received it · Note. Then Supplier credit (₱) · Credit note. Help "Started from the latest payments —
    change any amount, or set one to 0 to leave it out." **Save**.
  - *Void this payment / refund / supplier credit?* (each with its own consequence sentence) · Reason · **Void**.

#### 2.2.5 Owner approvals
- Owner view: "Changes your staff asked for that only you can make. Approving applies exactly the "Asked for"
  column, through the normal correction — and only while the purchase still reads as it did when they asked."
  Staff view: "Changes you sent to the owner."
- Each request: kind (Void / Replace / Correct) "— asked by [name]", When asked, a field-by-field "Asked for" table
  ("every field is listed; changed ones are marked"), warning "The purchase changed after this was asked (a
  correction, an office check or a receipt). It cannot be approved — ask for a new request." Buttons **Open
  purchase** · **Approve** (disabled when out of date) · **Reject…** · **Withdraw** (the requester).
- "Decided" list (Approved / Rejected / Withdrawn / Out of date). Empty "Nothing is waiting."
- Forms: *Approve this void?* ("The whole purchase leaves Spent and Bought. There is no undo.") → **Approve void** ·
  *Reject this change?* → "Why (the requester sees this)" → **Reject**.

#### 2.2.6 Cash (petty cash, own money, refunds, supplier credit)
Intro: "Petty cash, a buyer's own money, refunds and supplier credit say who holds or is owed company money. None of
it changes Spent or Profit — a purchase counted once, when it was recorded."

**Main owner view:**
- Buttons **Give petty cash…** · **Daily report…**.
- Buyers table: Buyer · Cash held · Returns waiting · Company owes · May use own money (switch Allowed / Off) · Last
  given · Last count · **Details…**. Flags: Buyer switch off · Unreconciled shortfall · Not-received flag · N to
  review. Empty: "No staff buyer yet. Turn a staff member's Buyer switch on in Users."
- Sections, each with buttons:
  - **Returns waiting for you** ("The buyer says they handed this back…") → **Confirm received** · **Reject…**
  - **"I did not receive this"** ("A buyer says petty cash you recorded never reached them…") → **It was handed
    over…** · **Void the entry…**
  - **Own money to review** ("Paid with a buyer's own money while "May use own money" was off… Accept it and the
    company owes it; reject it, with a reason, and it is never owed.") → **Accept** · **Reject…**
  - **Overpaid** ("More was paid than the purchase now costs…") → **Resolve…**
  - **Supplier credit** ("A balance with one supplier, used in parts when paying that supplier, until it is gone.
    Not cash.") → **Void…**
  - Empty: "Nothing here."
- **Buyer details panel:** Cash held · Company owes · To review · **Count cash…** · **Repay own money…** · **Close**;
  lists: Petty cash given (90 days) · Returns (90 days: waiting for you / withdrawn by the buyer / voided) · Cash
  counts · Repayments of own money — each entry with **Void…**.
- Forms: *Give petty cash* (Buyer · Amount (₱) · Given on · How · Note) → **Record** · *Count cash —
  [name]* (Counted (₱) · On; "A record only: it changes no balance.") → **Record count** · *Repay [name]* ("A
  repayment is not an expense and not petty cash."; Amount · Paid on) → **Record repayment** · *Reject this return?*
  · *The cash was handed over* → **Clear the flag** · *Void this petty cash entry / confirmed return / cash count /
  repayment / supplier credit?* · *Reject this own-money claim?*
- *Daily report:* buyer · From · To · **Print**; table Day · Entry · Detail · In (PHP) · Out (PHP) · Cash held (PHP) ·
  Unreconciled shortfall (PHP); Opening / Closing; "Returns waiting for your confirmation (not in the balance
  yet)"; note "A voided entry stays on its own day, marked…"; "Allow pop-ups for this site to print."

**Staff buyer's own view:** "Company money you hold for purchases, and what the company owes you for your own money.
None of it changes a project's costs." Cards: Cash held · Return waiting ("Counts once the owner confirms it.") ·
Company owes you (… "waiting for the owner's OK"). Warning "You paid more than the petty cash on record — the owner
will check it." Line "You may use your own money when petty cash runs short." / "Ask the owner before using your own
money." Button **Report a return…**. Lists: Petty cash you were given (90 days) with **I did not receive this…** ·
Returns ("Reported returns wait for the owner.") with **Withdraw** · Repaid to you (90 days). Forms: *I did not
receive this* (note) → **Send** · *Report a return* (Amount · Handed over on · To whom (optional) · Photo (optional))
→ **Report**. Accounts without petty cash: "Petty cash is held by staff buyers. Nothing to show for this account."

#### 2.2.7 Company stock *(owner accounts, Stock on)*
"Goods bought for the warehouse that no project carries yet. Never in a project's Spent, and not company overhead.
Issued goods stay here until the main owner approves their cost assignment." Table: Item · In the warehouse · Issued,
assignment pending · Awaiting delivery · Company stock loss. Total line "Company stock: [₱] (warehouse + pending
assignments + awaiting delivery; losses not included)". Empty "No company stock."

#### 2.2.8 Reconciliation *(owner accounts; some parts main owner only)*
Intro: "Checks, not a ledger: nothing here moves a peso or changes a bill. Owner accounts only."
- **Waiting** — "What needs someone, and where it is decided." Rows with counts and a **go** button each: waiting for
  a billing period · to check on a client's bill · stock cost move waiting for approval · purchase change waiting for
  the owner · Unpaid or Partly paid · own money to accept or reject · returns to confirm · Overpaid · stock record
  waiting for the owner · tools waiting for the owner (Lost or Retire). Empty "Nothing is waiting."
- **Where every purchase peso is** — From · To · **Show** · **Print**. Summary sentence (in own projects / other
  projects / company stock / company stock loss). Table: Date · Ref · What · where · Recorded · Own project · Other
  projects · Company stock · Stock loss · Difference ("Adds up ✓" or "Difference — please tell the developer (a
  difference is a bug, not a business event)."). "Voided in these days (counted nowhere): …". Empty "No purchases in
  these days."
- **Waiting for a billing period** — "Charged to Cover because the purchase month had no billing period. Add the
  period and save the row again, or mark it "Cover is right"." Each line card: Office review tag, "· bought … ·
  waiting · on …", hint "A billing period for that month exists now. To charge it there, open the row in Project
  Control and save it again." → **Cover is right…**. List of ""Cover is right" marks" (Applies / Withdrawn / No longer
  applies (the line changed)) → **Withdraw…**. Empty "No line is waiting for a billing period."
  Forms: *Cover is right* ("This only clears the "Office review" mark: the cost stays on Cover and in Spent, and
  nothing is billed." · "Why Cover is right (kept with the mark)") → **Mark Cover is right** · *Withdraw "Cover is
  right"* (Reason) → **Withdraw**.
- **Money still out** — Purchases · Still owed (N partly paid); "Nothing Unpaid or Partly paid."; older purchases
  "recorded before payments were tracked — never counted as owed"; Supplier credit left; to refund or keep as
  credit (Cash tab); per buyer: holds / shortfall / company owes / own money to review. Note "Payments never change
  Spent…".
- **Bills to check** — "Each approved or reversed stock cost move changed these months. Client bills are never
  changed automatically: decide by hand, then tick." Each card: Approved / Reversed · To check / Bill checked →
  **Bill checked…** / **Un-tick…**. Form note "You decided whether the client's bill needs adjusting for this cost
  move. This never changes a bill." · Note (optional). Empty "No stock cost move has changed a project's months yet."
- Print header "Where every purchase peso is — …", footer "For internal use only…".

---

### 2.3 Stock *(quantities only; owner + staff allowed Expenses; once switched on)*

**Header.** Title **"Stock"**. Sub: "Where goods are, in catalogue units. When goods reach someone else's project,
the main owner approves where their cost goes."

**Tabs:** Stock · Receiving · Waiting for owner · History.

**Action buttons:** **Issue / move** (primary) · **Record leftovers** · **Count** · **Opening stock**. Main owner
only, at the bottom: **Switch stock off…**.

- **Stock tab:** one card per catalogue item: name, size/spec, total + unit, places ("Warehouse: 12", "[project]:
  4"). Click opens the item. Empty: "No stock yet. Receive a warehouse purchase, record leftovers or opening stock."
- **Item page:** **← All items** · item name · lots ("Untraced (old stock)" or the purchase line · bought/counted
  [date] · "[project]'s leftovers"; places per lot or "Nothing left"; cost layers) · "No lots yet." · buttons
  **Issue / move** · **Count** · **History** (records, below).
- **Receiving tab:** **Match a project purchase line…** · one card per warehouse purchase line awaiting delivery:
  item · quantity · unit · "bought [date] by [name]" · "Received … · not delivered … · awaiting …" · pill "Counts as
  …" or "Not matched yet" · **Received…** · **Not delivered…** · **Match…** / **Change match…**. Empty: "No
  warehouse purchase is awaiting delivery or a match."
- **Waiting for owner tab:** counts and opening stock waiting (with **Confirm** / **Reject** for the main owner,
  **Withdraw** for the recorder) and stock cost moves. Empty: "No count or opening stock is waiting for the owner."
  Note for others: "Only the main owner confirms counts and opening stock, and approves where moved goods' cost goes."
- **History tab:** every record. Empty: "No stock records yet."
- **A record row:** kind (Received · Not delivered · Leftovers recorded · Issued to project · Returned to warehouse ·
  Moved · Count · Opening stock) · state pill (Reversed · Waiting for the owner · Rejected · Withdrawn) · text ·
  "For request: …" · "Difference …" (counts) · reason / note · "[recorder] · [date] · confirmed/rejected by … ·
  reversed by …: reason". Buttons: **Return…** (issues) · **Confirm** / **Reject** (main owner, pending) ·
  **Withdraw** / **Reverse**.
  - Under it, its **stock cost moves**: state pill (Cost assignment pending · Cost transfer pending · Back to company
    stock — pending · Cost move rejected — kept with source · Cost request withdrawn · Cost move reversed · Cost
    assigned · Cost transferred · Cost back in company stock · Company stock loss) · text · **peso value (owner
    accounts only)** · reason · buttons **Approve…** · **Reject…** · **Reverse cost…** (main owner) · **Ask again…**
    (owner and office).
- **Forms:**
  - *Issue from stock / Move goods / Return to the warehouse:* Item ("Pick an item…") · From / To place ("Pick a
    place…") · Quantity · Date · Fills request (a request line, or "None — unplanned") · Why it is needed (unplanned)
    · Note (optional). Help: "Quantities in the catalogue item's unit. The oldest goods go first unless you name the
    lot." / "The same lots go back. A return never reopens the request — the goods were delivered." → **Save** /
    **Return**.
  - *Record leftovers:* "Goods a project bought and did not use. Their cost stays with that project." Project ·
    Purchase line ("Counts as …", "Already recorded as stock: …", "Not matched to a catalogue item yet — match it
    first." + **Match…**) · Quantity · Where (Still at the site / Brought to the warehouse) · Date.
  - *Count:* "Count one item at one place. A difference waits for the main owner, with a reason." Item · Place ·
    Counted · "If it differs from the books: why —" → **Save count**; result "Count saved — …, the books say …. The
    difference waits for the main owner."
  - *Opening stock:* "Goods already there before stock tracking. Name the purchase when you know it (its cost stays
    with that project); otherwise it is untraced. The main owner confirms." Item · Place · Quantity · Date counted ·
    Bought for project (optional; "Not known — untraced") · Purchase line → **Send to the owner**.
  - *Received:* Quantity received (unit) · Date received. *Will not be delivered:* "… Any money back goes through a
    supplier refund or credit." Quantity · Reason → **Close it**.
  - *Match to a catalogue item:* Catalogue item · "How many item units is the whole line?" · Note (needed for
    another unit) · "Same unit — one for one." / "Another unit: … = how many …" · "The office checks this, not
    whoever bought it." → **Match**. *Match a project purchase line:* project → purchase line ("· not matched yet")
    → **Next** → match.
  - *Reverse / Withdraw:* "The record stays, marked reversed; record the right one afterwards." · Reason.
    *Confirm / Reject* (main owner): note / reason.
  - *Stock cost moves:* **Approve cost move** ("The whole of what is still there; it cannot be edited afterwards,
    only reversed." · funding explanation: "funded like a purchase for [month] — its billing periods for that
    month, earliest first, the rest Cover" / giving project's periods "in proportion" · "Only … of the … are still
    there — approving charges those only." · Note) · **Reject cost move** ("The goods stay recorded where they are;
    the cost stays where it was." · Reason (the recorder sees this)) · **Reverse cost move** ("Its rows leave Spent;
    the record stays, marked reversed." · Reason) · **Ask the owner again** ("Say what changed (the evidence, the
    right project)." · Note → **Ask again**).
- **Switched off state:** "Not switched on yet." Main owner sees "Switch stock on only at launch — …" and **Switch stock
  on…** → "Type STOCK to confirm. Do this only at launch." → **Switch on**. *Switch stock off:* "Type OFF to
  confirm. Only if the pilot failed…" + consequence text → **Switch off**.

---

### 2.4 Tools *(no money at all; owner + staff allowed Expenses; once switched on)*

**Header.** Title **"Tools"**. Sub: "Every tool by number, and who answers for it. No prices here — a tool's cost
stays with its purchase."

**Tabs (with counts):** Tools · Out (N) · To register (N) · Waiting for owner (N) · Problems (N).

**Primary button:** **Register tools**. Main owner only, at the bottom: **Switch tools off…**.

- **Tools tab:** one card per tool: number (TOOL-0001…) · item name · brand/model/serial · state pill (Available ·
  Issued · Under repair · Lost — waiting for the owner · Lost · Retire — waiting for the owner · Retired · Cancelled)
  · where ("Warehouse", "Issued to [name] · [project]", "Last with …", "Repaired — still with …"…). Click opens the
  tool. Empty: "No tools yet. Register the tools the company owns, or a purchase of tools."
- **Tool page:** **← All tools** · large photo · facts (Bought / Opening register, condition, where, who) · action
  buttons by state: Available → **Issue…** · **Report lost…**; Issued (good) → **Hand over…** · **Return…** ·
  **Report lost…**; Issued (needs repair / missing parts) → **Repaired…** · **Return…** · **Report lost…**; Under
  repair → **Repaired…** · **Ask to retire…** · **Report lost…**; Lost → **Found…**. **History** (records; "Nothing
  yet.").
- **Out tab:** each tool out: number · item · condition pill "… — not usable" · holder · project · "Out N days" ·
  **Hand over…** (or **Repaired…** if broken) · **Return…**. Empty "No tool is out."
- **To register tab:** purchase lines of tools: item · quantity · "bought [date] for the warehouse / for [project]" ·
  "Registered N of N" · **Register…**. Empty "No purchase of tools is waiting to be registered."
- **Waiting for owner tab:** Lost reports and Retire requests with **Confirm** / **Reject** (main owner) and
  **Withdraw**. Note for others: "Only the main owner confirms or rejects a Lost report or a Retire request." Empty
  "Nothing is waiting for the owner."
- **Problems tab:** problems reported from the phone ("I don't have this", "It's broken", Problem): tool · "Reported
  … · now with …" · "Closed by …" · **Open tool** · **Close**; checkbox **Show closed**. Empty "No open problems." /
  "No problem has been reported."
- **A record row:** "[number] · [kind]" (Registered · Issued · Handed over · Returned · Repaired · Reported lost ·
  Found · Retire request) · state pill (Waiting for the owner / Rejected / Withdrawn / Reversed) · text · "Request: …
  (bought for it — counted through its purchase)" · note · photo · "[recorder] · [date] · confirmed by … · reversed
  by …" · **Confirm** / **Reject** / **Withdraw** / **Reverse**.
- **Forms:**
  - *Register tools:* "Tools the company already owns, or bought before. Each one gets its own number (TOOL-0001…)."
    (from a purchase: "From [line] … registered. Its cost stays where the purchase put it.") · Tool ("Pick a tool…")
    · How many · Condition (Good / Needs repair / Missing parts / Damaged beyond repair) · Where is it now (Warehouse
    / With someone at [project]) · Responsible person ("Who has it…") · Brand / model / serial (optional) · Photo of
    the tool ("Needed for the opening register. Several identical tools registered together share it.") · Note
    (optional) · consequence lines ("At the warehouse, under repair — and the main owner is asked to retire it." /
    "Under repair until you mark it Repaired (at the warehouse).") → **Register**.
  - *Issue:* "The person named answers for it until it is returned or handed over." Project · Responsible person ·
    Fills a request (optional; "No request") · Note → **Issue**.
  - *Hand over:* "Now with … Straight to the next person — no trip back to the warehouse." Person · project → **Hand
    over**.
  - *Return:* "A tool that is not in good condition cannot be issued until it is repaired." Condition · consequence
    ("Back to the warehouse, available." / "Under repair until you mark it Repaired." / "Under repair, and the main
    owner is asked to retire it.") → **Return**.
  - *Repaired:* "It stays with …, now in good condition — it can be handed over." / "It is available again, in good
    condition."
  - *Ask to retire:* "The main owner decides. Until then it cannot be issued." Reason → **Send to the owner**.
  - *Report lost:* "The main owner decides; until then it cannot be issued, handed over or returned." What happened →
    **Report**.
  - *Found [tool number]:* "It comes back to the warehouse: available if good, otherwise under repair." Condition ·
    Note (optional) → **Found**.
  - *Confirm / Reject* (main owner) with outcome text; *Withdraw / Reverse* with outcome text ("The tool goes back to
    where it was.", "The tool is cancelled; its number is never used again.").
  - *Close problem:* "Closing it changes no tool: fix the tool with its own actions." What was done → **Close
    problem**.
- **Switched off state:** like Stock, with "Type TOOLS to confirm." / "Type OFF to confirm."

---

### 2.5 Setup screens (under **Setup ▾**)

#### Weekly batches
- Title "Weekly batches". Sub "When each week's requests are bought and delivered." Note: "Requests received before
  Saturday 12:00 noon (Manila) join that week's batch. Holidays or supplier delays? Use **Change dates** to move
  purchasing and delivery — workers see the new dates."
- Table: Cutoff · Purchasing · Delivery · Open items (**View in queue** or "None") · Last changed ("Dates changed" /
  "Default dates") · **Change dates…**. Row state: This week ("Closes in …") / Upcoming / Closed ("Cutoff has
  passed"). Empty "No batches yet."
- *Change batch dates* form: three cards: Cutoff ("— the cutoff itself does not change") · Purchasing · Delivery,
  each with the day, "Pick a date", and the change ("· was …", "Saved date", "Same day"). Buttons **Move both** ·
  **−1 day** · **+1 day** · **+1 week** · **Reset to saved**. Preview "Workers will see: Buy … Deliver …" / "No change
  yet". → **Save dates**. Errors: "Enter both dates." · "Delivery cannot be before purchasing."

#### Teams
- Title "Teams". Sub "Members can send requests for their team. A leader also sees them and checks the team's work.
  Only people with the Team Leader role can be made leader." Primary **New team**.
- Stats: Active teams · Team(s) need a leader · Workers not in a team.
- Search "Search a team or worker" · **Show inactive (N)**.
- Team card: name · Inactive pill · edit icon ("Rename or deactivate") · "Led by [name]" + **Remove as leader** · or
  warning "No valid leader. / No leader. Pick one below. / Add someone with the Team Leader role." + **Clear leader
  mark** · inactive note "Inactive — this team can't send requests." + **Clear old leader mark** · members list
  (name, "Leader" / "Can't lead" tag, **Make leader**, remove ×) · "No members yet." · **Add members**.
  Leader problems: "… no longer has the Team Leader role." / "… has a switched-off account." / "Requests still reach
  the office, but no leader sees them or checks the team's work."
- *New team / Edit team:* Team name ("e.g. Masonry crew A") · Active (can send requests) → **Create team** / **Save**.
- *Add members:* search "Search by name or worker number" · ticked list (role tag "Team Leader role" / "Worker", "Can
  lead") · "None selected" · **Add N to team**. Empty "No worker matches that search." / "Everyone is already in
  this team." Result "Some people could not be added."
- Confirm remove: "Remove [name]? The team will have no leader until you pick one. Continue?"
- Empty: "No teams yet. Create one, add workers, then pick a leader." · "No active teams." · "No team or worker
  matches that search."

#### Catalogue
- Title "Item catalogue". Sub "The materials and tools workers pick from. Unlisted items are matched to an entry here
  from the request screen." Primary **New item**.
- Search "Search name, size, unit, category, brand, other names…" · kind filter All / Materials / Tools · **Show
  inactive** · "Showing N".
- Table: Item (+ "Also called: …") · Kind (Tool / Material pill) · Unit · Category · Active (switch: "Workers can pick
  this item." / "Hidden from workers.") · **Edit…**.
- *New item / Edit item:* "One row = one exact item. A different size or unit is a different item." Kind (Material /
  Tool) · Category (optional) · Name · Size / spec (optional) · Unit · Brand (optional) · Other names workers use
  (optional — for search only) · Active (workers can pick it) · lock note "Already used in requests, so kind and
  unit are locked. To change them, add a new item and deactivate this one." · duplicate warning "Already in the
  catalogue: … Open that item to change it, or make this one different (size or unit)." → **Add item** / **Save**.
- Confirm deactivate: "Make "…" inactive? Workers can no longer pick it. You can turn it back on any time."
- Empty: "No items yet. Workers can only pick what is listed here — add the first one with New item." / "No item
  matches." + **Clear filters**.

#### Item history
- Title "Item history". Sub "Items the company asked for before, with their dated history and reviewed photos.
  Workers see a project's history only when Item history is on for it (Projects tab). No prices are ever shown."
- Two tabs: **Search items** · **Photos to review**.
- **Search items:** search "Name, other names, brand, size, category…" · kind (Materials and tools / Materials /
  Tools) · "All categories" · "All projects" · From · To · **Search**. Table: Item ("Also called:", "No longer
  listed") · Kind · Brand · Latest. **Show more**. Empty "No item matches. Items are added in the Catalogue tab."
- **One item page:** **Back to results** · name ("also called …", "no longer listed — workers cannot request it
  again"). **Photos** ("Workers see approved photos only, cover first. Retired photos stay here for the record.") —
  cards with Cover / Retired tags, source (Uploaded by the office / Copy of a request photo / For a historical
  reference), **Make cover**, **Retire…**; **Upload photo…**; "No photos yet." **History** ("Requests matched to
  this item and hand-entered historical references, newest first. A historical reference creates no expense, stock
  or purchase.") — table What · Where · When · Quantity · Details (Requested / Requested — cancelled / Historical
  reference, "Requested by", retire button) · **Add historical reference…**.
- **Photos to review:** "Photos workers attached to requests for catalogue items. Approve a COPY for the workers'
  gallery, or keep it private. The worker's original always stays private." Each photo: **Approve a copy…** · **Keep
  private** (confirm "Keep this photo private? It leaves this list and never goes to the gallery."). Empty "No photos
  waiting for review."
- *Upload a product photo:* Photo · For a historical reference (optional; "No — a general photo of the item") ·
  Make it the cover photo · three required ticks ("No price, amount, receipt or price tag is visible" · "No face,
  name, phone number or other personal detail is visible" · "It shows only the product") → **Upload**.
- *Approve a copy for the gallery:* the photo · Make it the cover photo · the same three ticks · "If anything in the
  photo fails a check, keep it private instead…" → **Approve copy**.
- *Retire this photo* ("Workers stop seeing it on their next refresh…" · Why) → **Retire**. *Retire historical
  reference* (Why) → **Retire**.
- *Add historical reference* ("— for items used before WorkMate. It creates no expense, stock or purchase."):
  Project · Main Contract or Additional Works · What was used · Date (Exact day / Around a month / Date unknown) ·
  Day · Where this came from (optional) · warning "Workers can read what was used and where it came from. Never type
  a price, an amount or a person's name." → **Add reference**.

#### Projects
- Title "Projects open to requests". Sub "Which Project Control projects workers can send requests for."
- "How this works" (expandable): "A project accepts requests while it is on today's Time In list. Allow requests
  opens one that is not — use it for an upcoming site with no geofence yet. Completed projects never accept
  requests. Open Additional Works under a project are offered with it. Item history is separate: it lets workers
  browse what was requested on that project before (Find Previous Item), and it stays on after the project is
  completed."
- Summary chips: N open to workers · N not open · N override(s) on. Search "Search projects…".
- No tabs today. (The earlier mockup suggested All · Open in WorkMate · Closed, which you may use.)
- Table: Project · Additional Works · Status (Open: "Allow requests is on" / "On today's Time In list"; Not open:
  "Hidden from Time In" / "Not on today's Time In list"; Completed: "Completed projects never accept requests") ·
  **Allow requests override** switch (On/Off with explanations) · **Item history (Find Previous Item)** switch
  ("Workers can browse").
- Empty: "No Project Control projects yet." / "No project matches." + **Clear filters**.

---

## 3. Attendance

**Who:** owner and staff (App updates: owner accounts only). Workers never see this.

### 3.1 Today on site
**Header.** Title **"Today on site"**. Sub "[weekday, date] · last loaded [time]" (the screen does not refresh by
itself). Controls: view switch **By site** / **Full list** · day picker (any past day) · **Refresh** · **Add a
worker** · **Download for Excel** (primary).

**Count tiles** (each opens the Full list filtered): Expected · On site · Finished · **Absent?** (before the day
starts: "Not in yet") · **Needs you**. Status line under them, for example "All 8 of your workers are on site today.
Workers are due at 9:00 AM, and 8 can time in from the app. Spread across 3 sites. One worker did not time in at
all. One day was closed by the office." Other leads: "The day has not started yet." · "Nobody timed in today."

**"Needs you" panel** (only when there is something): "N things need you — Clear these and the day is finished.
Nothing here changes anyone's pay." Three kinds of item, each with **Open the record**:
- "[name] never timed out" — "Timed in at [time] … and the day ended with no time out. Close it so the hours report
  stops waiting. Closing a day records no hours and changes no pay."
- "[name] recorded nothing that day" — "No time in came from the phone. Check whether this is leave, an absence, or
  simply no signal — a record saved offline can arrive later in the day."
- "[name] timed in with a location problem" — "… The record was kept, not thrown away — check it with them before
  the week is paid."
- Empty banner: "Nothing needs you".

**By site view.** One card per site with crew first, quiet sites last:
- Card: site name · sub "N of N crew timed in" · pill **Costing job** (Project Control) or **Site works** (Project
  Management) · crew table Worker · In · Out · Hours · Status · footer notes ("N never timed out. Close the day from
  the panel above — it records no hours and changes no pay." / "N not timed out yet. Nothing to do until the day is
  over." / "The office closed a day here because no time out was ever recorded. No hours were counted for it.").
- **"Workers not timed in yet / not on site today / not on site that day"** card: each worker "No record" or "Not due
  yet"; note "Check whether this is leave or an absence. A record saved without signal can still arrive later." or
  "Workers are due at [time]. Nothing is late and nothing is missing — the day has not started."
- Quiet sites: "nobody timed in today".

**Full list view.** Card "Everyone's day — Click any row to see the two photos the worker took." Search "Search a name
or a site…" · site filter "All sites" · status chips with counts: Everyone · Needs you · On site · Absent? (Not in
yet) · Finished · legend "The colour on the left means: Finished the day · Still on site · Closed by the office ·
Not on site" · table Worker · Which site · Arrived · Left · Hours · Photos · What happened. Empty "No worker matches
this search or filter."

**Status words used:** Finished / On site / Closed / Absent? (pills) · Finished the day / Still on site / Closed by
the office / Not on site · "What happened" texts: "Nothing came from the phone today", "No time out, so the day
records no hours", "Saved without signal, arrived later", "Timed in, no time out yet", "Phone clock was N min
behind", "Both photos received", "Recorded without both photos", "Not checked — recorded before location checking",
"On site, both stamps verified".

**Small badges on a record:** **offline** ("Captured with no signal and synced later") · **clock** ("Device clock is N
min behind the server on an online capture") · location flags: **off site** (Recorded away from the site; "The phone
reported "N m away", and this site allows N m") · **fake GPS** · **location blocked** · **location off** · **weak
GPS** · **no location** · **no site pin** (each with its explanation tooltip).

**Download for Excel** columns: Worker · Worker no · Project · Time in · Time out · Hours · Status · Location check ·
Metres from site. Note shown with it: "Hours here are attendance only. Nobody is paid by the hour — labour is
contract-based (pakyaw), so these figures never move money. They are a record of who was on site." Alert "Nothing
to export for this day."

**Empty / error:** "No active workers yet. Add them in Workers, or in Users → Navigator." · "Could not load
attendance: …".

### 3.2 One worker's day *(drill-down from Today, Hours report and Weekly bonus)*
- Back link **Today on site** · worker name · sub (role · site · date) · buttons **Close this day** (only for a past
  open day) · **Print this day**.
- Summary sentence: "On site from [in] to [out]." / "Timed in at [in], and still on site." / "Timed in at [in]. The
  office closed the day."
- Notice: "Both photos came through and the day is finished. Nothing needs your attention." / "The day is finished,
  but one of the two photos never arrived." / "No time out yet, so no hours are recorded for this day. If the day is
  over, close it below — closing records no hours and changes no pay." / "No time out was ever recorded, so the day
  counts no hours. This has already been dealt with; nothing further is needed."
- Facts: Hours recorded · How the day ended · Where they were · Worker number · Job on site · Who recorded it ("The
  worker, on their own phone") · Reached the office ("Saved without signal, sent later" / "Straight away"). If closed:
  Who closed it ("account since removed") · When it was closed · reason.
- Two photo cards: **When they arrived (time in)** and **When they left (time out)**: photo ("Photo unavailable" /
  "No photo taken at …") · "Photo taken at …" · "Site picked at …" · "What they wrote" · location badge.
- Explanations: "The worker takes both photos personally, in the app. They cannot be added or replaced from this
  screen." · "A site is picked twice — once arriving, once leaving. If the two differ, both are shown…" · ""Saved
  without signal" means the phone had no data and sent the record later. It is normal on remote sites, not a
  warning."
- Nothing recorded: "Nothing was recorded for this day. No time in came from the phone, so there is no record to
  open. …"
- **Close this record** form: "Timed in at [time] on [date], and never timed out. Closing marks the day Closed by the
  office so it stops counting as still on site. The day will still report no hours. Nobody knows when this worker
  left, so the record never says — closing it does not add a Time Out, and there is no way to type one in." ·
  Reason (optional), placeholder "e.g. Forgot to time out; crew left around 5pm", help "Saved on the record with your
  name and the time, so this edit can be explained later." → **Cancel** · **Close this day**. Errors: "Still today —
  this worker may be on site right now.", "This record has already been closed.", "Your session has expired. Sign in
  again." and others.

### 3.3 Workers
- Title **"Workers"**. Sub "Everyone who can time in from the app". Buttons **Refresh** · **Add a worker**.
- Summary: "N workers can time in from the phone app. N have been switched off."
- Table: Worker (name, worker number, position; "Can lead a team" for team leaders) · Signs in with (email) · Job on
  site · Can use the app (**Yes** "Appears in today's list" / **Switched off** "Cannot time in; old records kept") ·
  actions: **Edit details** · **Switch off app access** (red) / **Switch back on** · **Make Team Leader** / **Remove
  Team Leader** *(main owner only)* · **Set temporary password** *(main owner only, active workers)*.
- Info strip: "**Switching a worker off is safe.** They disappear from today's list and can no longer time in — … —
  but every day already recorded stays exactly as it is. Switch them back on any time. Office, engineer and staff
  accounts are made in **Users**, not here."
- Empty: "No workers yet. Use Add a worker above — staff and engineer accounts are created in Users → Navigator."
- **Add worker account:** "The worker signs in with the email and password you set here." First name * · Last name * ·
  Email address * ("worker@dacsbuilding.com") · Role * (Worker / Team Leader) · Position / Trade ("e.g. Mason,
  Carpenter"; "Shown on every attendance record.") · Password * ("Min. 8 characters") · Confirm password * · note
  "Passwords are stored hashed, never as plain text. The worker number is assigned automatically, and the Terms are
  accepted by the worker in the app on first sign-in — they are not signed here." → Cancel · **Create account**.
  Errors per field and "An account with this email already exists."
- **Edit worker:** First name * · Last name * · Position / Trade ("Shown on every future attendance record.") ·
  Status (Active / Deactivated) · notes "Renaming changes the roster from here on. Attendance already recorded keeps
  the name it was saved with…", "Email is not editable here. It lives on the login account.", "Role and temporary
  password have their own buttons on the Workers list, for the main owner." → Cancel · **Save changes**.
- **Make / Remove Team Leader** (confirm): "This only makes them eligible. They get a leader's powers when the office
  names them leader of a team on Requests → Teams." / "They stop being able to lead. This is refused while they lead
  an active team. Any old leader mark on a turned-off team is cleared." · "Their teams, attendance, rewards and own
  requests do not change." → Cancel · the action. Refusal: "This person still leads N team(s). Pick another leader
  on Requests → Teams first."
- **Set temporary password** (two steps, keep both): (1) warning text, verbatim: "Their old password stops working.
  They'll need to sign in again when their phone's current access expires. First check "Not sent yet" in the old app
  on their phone. Attendance waiting to send stays on the phone. It can sync before the worker signs in again if the
  phone's current access is still valid. Otherwise, the same worker needs to sign in again." · **Type the worker
  number to confirm** → Cancel · **Set temporary password**. (2) result "Temporary password set — Shown once. Tell it
  to the worker directly. WorkMate asks them to change it when they sign in." · the password · possible warning "The
  password is set, but WorkMate may not ask them to change it. Ask them to change it in Profile." → **Done**.

### 3.4 Sites & schedule
- Title **"Sites & schedule"**. Sub "The sites a worker can choose from on the phone, and the days each one expects
  them." Button **Refresh**.
- "How this page works" (expandable): "You cannot add or rename a site here — sites arrive on their own from the
  module that owns them. Project Control owns the ones you cost and bill; Project Management owns the ones you run
  day to day. What you do set here is the schedule: the working days, the time workers are due, and any day the site
  was closed. You can also hide a site from workers so it stops appearing on their phone. Workers only ever see a
  site's name — contract values and budgets are never sent to the app."
- Summary: "N sites · N from Project Control · N from Project Management · N hidden from workers".
- Search "Search sites" · filter chips with counts: All · Custom schedule · Hidden · Has closed days · view switch
  **Table** / **Cards**.
- Table: Site (Costing job / Site works pill, "N here today") · Working days ("Mon–Fri", "Not set yet") · Workers due
  at · Closed days · Visible to workers (switch Visible / Hidden) · Schedule (**Set schedule** / **Change
  schedule**).
- Cards: name · "Hidden from workers" pill · Working days · Workers due at ("The default — not changed yet" / "The
  company default") · Closed days · notes ("Workers cannot pick this site on their phone. Anyone already timed in
  here can still time out, and a Time In saved offline before you hid it still counts." / "N closed days are set. A
  closed day is required of nobody, so it shrinks the bonus week instead of failing it." / "Every working day counts
  towards the weekly bonus.") · **Set the schedule** / **Change the schedule** · **Hide from workers** / **Show to
  workers**.
- Confirm hide: "Hide "[site]" from workers? It stops appearing on their phone. Anyone already timed in there can
  still time out. You can show it again any time."
- Empty: "No sites yet. Create one in Project Control or Project Management — until a site exists the workers' app
  has nothing to pick, and a worker cannot time in at all." · "No sites match … in this filter."
- **Schedule form** ("Schedule — [site]"), three tabs:
  - **Working days & time:** note "The reward only ever counts **Monday to Friday**. Marking Saturday here records
    that the site works it — it does not add a sixth day to the reward." · day toggles Mon–Sun · Quick pick:
    **Mon–Fri** · **Mon–Sat** · **Every day** · "A day outside this pattern is never required, so it shrinks the
    reward week instead of failing it." · **Workers due at:** Company default ([time]) / Custom time for this site
    [time] · "A Time In after this is late, and one late day forfeits the whole week." · **Reset to company default** ·
    summary "N days count towards the weekly bonus, workers due by [time]".
  - **Location:** "Check attendance against this location — A worker standing outside the radius is refused; one
    whose phone cannot get a clear fix is recorded and flagged, never refused." · Latitude · Longitude · Radius
    (metres) (default 150; "Radius runs 10 to 5000 m. 150 m suits most sites.") · **Use my location** · **Save
    location** · note "Editing appends a new location rather than replacing the old one, so attendance already
    recorded keeps being judged against the location that was in force when it was captured." · status "No location
    set. Attendance here is recorded unverified until one is." / "Reading this device location…" / "Filled from this
    device. Press Save location to store it." · errors (coordinates, radius).
  - **Closed dates:** Add a closed date [date] [Reason, e.g. Independence Day] **Add** · "A closed day is not required
    of anyone posted here, so the week shrinks and four on-time days out of four still earn the full reward." · list
    with **Remove** · "No closed dates recorded."
  - Footer: **Close** · **Save working days & time**. Notes "This tab saves with its own Save location button." /
    "Closed dates save as soon as you add them." Confirm "Discard the changes to working days and time?"

### 3.5 Hours report
- Title **"Hours report"**. Sub "Who was on site, and for how long · [range]".
- Period: **Just today** · **Last 7 days** · **Last 30 days** · From [date] · To [date]. **Export** menu: **Excel — one
  row per worker** (Worker, Position, Days worked, Hours, Days not closed, Days abandoned) · **Excel — one row per
  day** (Work date, Worker, Position, Project, Time in, Time out, Hours, Status, Captured offline, Location check,
  Metres from site, Closed by admin, Reason).
- Banner sentence: "N on site, N waiting for a time out. N days were finished properly / closed by the office. N time
  ins not confirmed on site."
- **"N days are waiting for a time out"** panel: "These workers timed in but never timed out, so the day records no
  hours. Closing a day tells the report to stop waiting — it does not invent hours, and it changes no pay." Table Day ·
  Worker · Site · Arrived · **Close this day** (warning colour) per row.
- Stats: Total hours · Average day · Days finished · Needs a time out (highlighted when > 0). Note: "Hours record
  attendance — **not a basis for pay**. Labour is pakyaw, capped by contract."
- Tabs **By worker** / **By site**. By worker: Worker (position) · Days on site · Hours recorded · Anything to fix
  (pills "N days need a time out", "N days closed by the office", or "Nothing") · total row "All N workers". By site:
  Site · Days worked · Hours recorded · total row.
- Empty / error: "Nobody was recorded on site in these days." · "The start date is after the end date." · "Could not
  load: …".

### 3.6 Weekly bonus
- Title **"Weekly bonus"**. Week navigation: **Week before** · Week of [date] · **Week after** · **Show** · **Download
  the list** (blocked until final: "This week is not final yet, so there is no list to download. It can be downloaded
  once the week has been worked out.").
- Tiles (filters), **live week:** On track · At risk · No bonus · *Bonus if all hold [₱] (owner only)*. **Final
  week:** Earned · No bonus · Not handed over yet · *Total bonus [₱] (owner only)*.
- Status line: "N of N workers are still on track for the bonus. This week is not final yet — these are the numbers
  so far. It becomes final around noon on [day], once late offline records have had time to arrive." / "N earned the
  bonus this week. [₱] in total. [₱] of it has not been handed out yet. / All of it has been handed over." / "Nobody
  earned it this week, so nothing is owed." Staff get the lines without pesos instead: "N of them have not been
  handed the bonus yet." / "Every bonus earned has been handed over."
- Legend: On time · Late · Missed · ? Unverified · Today / upcoming.
- Filters: search "Search worker…" · "All trades" · "All supervisors" · note **"Record only, no payments"** (tooltip
  "This page keeps a record, it does not pay anyone. No money moves, and nothing here touches payroll or a
  contract.") · day chips with counts: Everyone · All on time · Late · Missed · Unverified.
- Table, grouped and collapsible ("▾ On track · N"): Worker (position) · **Mon–Fri** day cells (On time / Late / Missed
  / Could not be verified / Not yet / Not a working day; tooltip with In/Out times; a recorded day opens that worker's
  day) · Status pill (**Gets the bonus** / **No bonus** / **Week still running**, with the reason: "On time every
  expected day", "On time so far · N days to go", "was late on …", "N days that could not be verified (outside the
  site, or a time no clock could confirm)", "No day was ever required this week", "— one late day forfeits the
  week") · *Amount (owner only)* · **Handed over** column (final week only): **Mark as handed over** / "Handed over".
- Confirm: "Mark [name]'s bonus as handed over? This page only keeps a record. No money moves, and nothing here
  touches payroll or a contract."
- Empty: "Nothing has been worked out for this week yet. A week is frozen once it has ended and its grace period has
  passed, so attendance captured offline has time to arrive first." · "No worker matches these filters."

### 3.7 App updates *(owner accounts only)*
- Title **"App updates"**. Sub "Publish a new version of a worker app. Every phone on an older version of that app
  must update before it can Time In or Time Out." Two apps: **DACS Attendance** (old app) and **DAC'S WorkMate**.
- **Publish a new version** card: "Upload the signed release APK. The file itself says which app it is, and the
  version number is read from it." · "Use the same signing key every time. Phones refuse an update signed with a
  different key, and a debug build cannot be installed over the real app." · drop zone **Choose the release APK** "or
  drop the file here" · "What's new (optional, shown to workers)" · status "Choose an APK to continue." / "Reading the
  file…" · **Choose another file** · **Publish update**.
- File check: "Ready to publish · [app] · Version [x]" · ticks "Release build, not a debug build" · "Newer than the
  live version (…)" or "First version of this app: nothing is live yet" · warning "Every phone on an older version of
  [app] will be blocked from Time In and Time Out until it installs this update." · **Technical details**
  (expandable). Problems: "This file is not an Android app." · "This is a DEBUG build. Phones cannot install it as an
  update." · "This is not the DACS Attendance app or DAC'S WorkMate (…)" · "Could not read the version number from
  this file." · "This is version X, but version Y is already published. [app-specific fix: raise the build number,
  rebuild, and upload again]" · "Fix the problem above to continue."
- **Confirm step** (keep it separate): "Publish [app] [version]? Every phone on an older version of [app] **will be
  BLOCKED from Time In and Time Out** until it installs this update. Make sure this APK is already on at least one
  phone and working before you publish." → **Publish**. Progress "Publishing…". Success "Phones will show the update
  the next time the app is opened with internet."
- **Published versions:** "Each phone downloads the newest one once. Mind the size: every worker downloads it." Per
  app: "Live now: [version] · published [date]" or "Nothing yet". Filter **All** / per app. Table Version · App ·
  What's new · Size · Published · "Current" pill. Empty "Nothing published yet. Phones keep the version they have
  until you publish one here." / "No versions of this app yet."

---

## 4. Work Plan

**Who:** owner and staff. No money anywhere. Workers see their own tasks in WorkMate (My Work).

### 4.1 Board
- Title **"Work Plan"**. Sub "Tasks from meetings and the office. Workers see their own tasks in DAC'S WorkMate (My
  Work)." Primary **New task** (once there are tasks).
- Summary chips: N waiting for your check · N not acknowledged after 24 hours · …
- Toolbar: "All projects" select · search "Search task, project, person…" · count "Showing N".
- Table: Task · People ("No one yet") · Planned · Status · Open. Row chips: Blocked · Sent back · Overdue · Not read
  after 24 h · N to check.
- **Groups, in order:** Waiting for your check · Blocked · Not acknowledged after 24 hours · Overdue · Not started
  and in progress · Drafts and proposals · Completed in the last 30 days. No tabs today. (The earlier mockup
  suggested Needs you · In progress · Drafts · Completed · All, which you may use.)
- Status pills: Draft · Proposal · Not started · In progress · Reported done · Leader checked · Completed · Cancelled.
- Empty board: "No tasks yet — A task starts in one of two places." **From a meeting** ("Record a meeting and turn its
  notes into draft tasks." → **Open Meetings**) · **Directly** ("Add a one-off task for a project." → **New task**) ·
  three steps: **Draft** "Only the office sees it." → **Publish** "Workers see it in My Work and read it." → **Check**
  "When they report it done, you check it."
- Empty filter: "No task matches these filters." + **Clear filters**.

### 4.2 One task *(drill-down)*
- **← Work Plan** · "· See its meeting" link · title · pills (status, Blocked, Sent back).
- **Header actions by status:** Reported done / Leader checked → **Approve — completed** (primary) · **Send back** ·
  Draft → **Publish** · Completed → **Reopen** · any open status → **Edit**. Separately, at the bottom (danger link):
  **Cancel this task…** (or **Decline this proposal…** for a leader's proposal).
- Notices: "Checked by the team leader, waiting for your approval" / "Reported done, waiting for your approval" —
  "Approve it as completed, or send it back with what needs fixing. A leader's check never replaces the office
  approval." · "This task is blocked — N open problem(s) below. Clear each one after checking it is really solved." /
  "It waits for another task to be approved." · "Proposed by a team leader — Publish it to make it a task, or decline
  it with a reason the leader will see." · "To check before publishing" (the AI's notes).
- **Problems and waiting:** each problem (Materials / Tool / Preparation / Other, text, photo) with **Clear…**; "Waits
  for" tasks with **Open**; "Nothing is holding this task."
- **Instructions** ("No instructions yet. Use Edit to add them.") · **From the meeting notes** (the source passage) ·
  **Photos (N)** (task photos, "· problem photo").
- **People:** Responsible / Helper, each with Read / "Not read yet"; line "Everyone has read version N" / "N of N
  have read version N"; "No one is assigned yet. Use Edit to choose the responsible person."
- Facts: Task · Project · Work · Team ("Individual task (no team)") · Planned · Version.
- **History** (expandable): Drafted · Proposed by a team leader · Edited · Revised — everyone on the task must read it
  again · Published · Read it ("I've read this") · Started work · Progress · Reported a problem · Problem cleared ·
  Sent back · Approved — completed · Reopened · Added a photo · Meeting created · Shared notes published. "No history
  yet."
- **Forms:** *Clear this problem* ("Only after checking the materials, tool or preparation really are ready for this
  task." · What was checked) → **Clear problem** · *Publish this task?* ("Everyone on it sees it in My Work and must
  read it.") · *Approve as completed* ("Tasks that wait for this one can then start." · Note (optional)) →
  **Approve** · *Send back* ("The task returns to In progress, marked Sent back." · What needs fixing (the workers see
  this)) · *Reopen this task* ("Tasks that wait for it are held again until it is approved." · Why (the workers see
  this)) · *Cancel this task* ("It leaves the Board; its history stays." · Reason) → **Cancel task** · *Decline this
  proposal* ("The team leader who proposed it sees this reason." · Reason) → **Decline**.

### 4.3 New task / Edit task form
- Intro: "Four short parts: what, where, who and when. Only the title and the project are needed (marked *).
  Everything else can wait, and you can change it all before you publish."
- **What needs to be done:** Task title * ("e.g. Install ceiling lights, 2nd floor"; "Keep it short. Workers read
  this first.") · Instructions ("Optional. Say what to do, which part of the site, and anything to be careful
  about.").
- **Where is the work:** Project * ("Choose a project…"; "A published task keeps its project.") · Main Contract or
  Additional Works ("Pick Main Contract unless the task is for an Additional Work.").
- **Who will do it:** Team ("No team (individual task)") · Responsible person ("The main person for this task. You can
  choose later, but choose someone before you publish."; "No one yet (choose before publishing)") · Helpers
  (optional; ticks).
- **When:** Planned start · Planned end (optional; "The end date is before the start date.").
- **Waits for other tasks** (optional, expandable): ticks of same-project tasks ("Untick a task to remove its link.").
- AI-drafted tasks add: fields marked **"Needs your choice"**, a "To check:" list with **All checked — clear these
  notes**, "From the meeting notes", and required ticks "I have checked the helpers (the AI named someone it could not
  match)" / "I have checked the dates (the notes were unclear)".
- Editing a published task: "Saving makes a **new version**: everyone on the task must read it again. Changed: …" ·
  tick "Only a spelling correction — keep the current version" · "What changed (optional, shown in the history)".
- Footer note "What happens next: after you save, the task stays a draft that only the office can see. Open it and
  press Publish when it is ready for the workers." → **Save as draft** / **Save** · Cancel.

### 4.4 Meetings list
- Title **"Meetings"**. Sub "Type or paste the notes, let the AI suggest tasks, check each one, then publish." Buttons
  **Board** · **New meeting** (primary).
- Notice: "N meetings have draft tasks waiting — Open it, check each draft, then publish so workers see the tasks and
  the notes."
- Table: Held on · Meeting · Shared notes ("Published · version N" / "Not published") · Tasks ("No tasks yet") · Open.
- Empty: "No meetings yet — Paste the notes from your meeting. The AI suggests the tasks; you check them before
  anything reaches workers."

### 4.5 One meeting *(drill-down)*
- **← Meetings** · Meeting (title) · Held on (date) · **Original notes (office only — never shown to workers)** →
  **Save meeting** / **Save notes**. Hint "Save the notes first; then draft tasks with AI or add them by hand."
- **AI drafts:** "Saves the notes, then sends them to Cloudflare's AI to suggest tasks. Nothing reaches workers until
  you review and publish." **Draft tasks with AI** / **Draft again** (confirm "Draft again? The suggestions you have
  not added yet will be replaced. Added drafts and your notes stay."). Progress "Saving the notes and drafting… this
  can take up to a minute. You can keep typing; nothing is lost." Notes "Suggestions stay only in this browser tab
  until you add them as drafts. Reloading the page discards suggestions you have not added; saved notes and draft
  tasks stay." Each suggestion row (title, project or "No project") → **Review and add…** / "Added as draft".
  "Suggested shared notes" → **Use as shared notes** (confirm "Replace your shared notes?"). Empty "No AI suggestions
  yet. You can also add tasks by hand below." / "The AI found no tasks in these notes." AI limit and error messages
  (for example "AI limit reached (per person: 10 drafts in 10 minutes, 50 in any 24 hours)…").
- **Tasks from this meeting:** rows (title, responsible or "No responsible person yet", status pill, **Open**) ·
  **Add task** · "N waiting to be published — Check each one, make sure it has a responsible person, then use
  Publish." · "No tasks yet. Draft them with AI, or add one by hand."
- **Shared notes (workers read this — no prices, pay or private matters; check it yourself, the AI is not enough)** ·
  **Who receives the notes:** Everyone assigned a task from this meeting / Choose people (ticks) · What changed
  (optional) · "N draft tasks will be published with the notes. Each needs a responsible person." / "No draft tasks —
  this publishes the notes only." → **Publish…** (confirm "Publish to workers? Draft tasks become live in My Work; the
  shared notes go to everyone assigned a task from this meeting / the people chosen.").
- **Published versions** (expandable): "Version N · [date] · to [people]" / "Not published yet."

---

## 5. Things every screen has (draw them once, reuse everywhere)

- **Loading** line ("Loading…", "Loading requests…", "Loading the task…"), **error** box ("Could not load …",
  "Something went wrong: …"), **empty** state text.
- **Form error line** inside each form (server messages in plain words).
- **Double-press protection** on every save (buttons go to "Saving…" / "Creating…" / "Closing…" / "Publishing…").
- **Reason boxes** on every void, reverse, reject, cancel and correction ("kept in the history").
- **Typed confirmations:** worker number (temporary password), the word shown (void purchase), OFF / STOCK / TOOLS
  (switches).
- **Photo viewer** overlay (request, task, tool, receipt, attendance photos; signed links that expire).
- **Print** buttons open a print window ("Allow pop-ups for this site to print.").
- **Escape** closes a form; **Enter / Space** opens a focused row.
