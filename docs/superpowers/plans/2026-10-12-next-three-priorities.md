# Next three priorities — 12 October 2026

Agreed order: **1. Staff peso leak → 2. Finish the Stage 2 design → 3. Build My Work (Stage 1c) → then build Stage 2.**

Why this order:

- **#1 is a live problem.** It breaks a hard rule (*"staff must not see peso amounts"*) on the site staff use today. The others are future work.
- **#2 is half done.** Sections 1–2 are agreed and saved; finishing while the decisions are fresh is far cheaper than restarting.
- **#3 is small and independent.** My Work needs no inventory, so it can ship before the large Stage 2 build. Workers only get WorkMate at the switch-over, so 1c and 0.5.0 can go out together.

Still waiting outside this list (not forgotten): **publish-day to-dos** for 1b-3 — deactivate ZZ pilot drill / ZZ test pipe (and RAM if it was a test), switch **Item history ON for the 10 open sites**, phone check.

---

## 1. Fix the staff peso-amount leak in Project Control

**Status (checked 12 Oct, 13:20): code done, NOT committed, needs your browser check.** The work was done today (13:07–13:11) by another Dacs Web chat (*dacs-web-74*). All test suites pass (including the new staff suite, **27/27**, and `money-math` **239/239**); `node --check` OK.

**The rule:** staff accounts (`currentUserRole === 'staff'`) must not see peso amounts anywhere in Project Control. Staff see **percentages, counts and status** instead.

### What was fixed (uncommitted changes)

| Place | Before | Now for staff |
|---|---|---|
| **Recent Entries** feed | `₱` on every row | **Amount hidden** |
| **Labor history** | Export CSV with `Amount (PHP)`; Pay / Add Payment / Edit / Receipt buttons; worker statement (SOA) menu; contract actions | Export CSV, payment buttons, SOA and contract actions **hidden**; export handler refuses staff even if triggered |
| **Material history** | Export CSV with amounts; Edit button; receipt/image previews; print | CSV, Edit, previews and print **refused for staff**; document pills show *attached / missing* only, can't be opened |
| **Overhead** | ₱ totals, ₱ per row, receipt links, add/edit form | **Shares (%) of overhead** and of the contract; no receipt links; add/edit form can't open |
| **Cover Expenses banner** | `₱` Cover total and "₱50,000 limit" | **"OK" / "OVER LIMIT"** only — no peso figure |
| **Additional Works** | Priced breakdown editor | Editor **hidden** |
| **Contract roll-up** | Caps and payments | **Not shown** to staff |
| **Billing periods / folder header** | New / Edit period, folder budget editor | **Hidden**, and the actions recheck the role when clicked |
| **Expense Inbox embed** | Receipt previews with amounts | **Not embedded** for staff |
| **Folder card shortcuts** | AI budget summary, Edit folder | **Hidden** for staff |

**Already safe before today (no change needed):** Ledger hero, cost budget, flow cards, billing-period stats (owner-only). The *"Current Fund Spent"* / *"Cover Expenses"* lines on the old folder cards are **dead code** (after a `return`, never rendered).

**New guard against regressions:** `tests/project-control-staff.test.js` renders each Project Control screen **as staff and as owner** and fails if staff output contains ₱ / a fixture amount, an image, or an openable financial document. It's wired into `npm test`, so a **salvs merge** that reverts a staff branch now turns CI red.

### Still to do

- [ ] **Browser check as owner** (`admin.html`, log in as owner): every amount, export, print and edit button still works as before.
- [ ] **Browser check as a staff account:** open a project → dashboard, Labor, Material, Overhead, Additional Works, Billing Periods. Expect **no ₱ anywhere**, no Export CSV, no Pay/Edit buttons, Cover banner shows only OK / OVER LIMIT.
- [ ] **Confirm the staff workflow still works:** staff can still **encode payroll and expenses in the Expenses module** (unchanged — that's the approved exception). Project Control is now view-only for staff; check that's what you want.
- [ ] **Commit** the changes (`js/portal-app.compiled.js`, `tests/project-control-staff.test.js`, `tests/billing-allocation.test.js`, `package.json`).
- [ ] Not affected: `Client Management.html` / `Dacs Partnership.html` have no staff concept — nothing to mirror.

**Done when:** both browser checks pass and it's committed.

---

## 2. Finish the Stage 2 (Inventory & Purchasing) design

**Status:** design only, about half done. Spec: [2026-09-30-workmate-mobile-purchasing-design.md](../specs/2026-09-30-workmate-mobile-purchasing-design.md). No code until the design is complete and approved.

### Already agreed and saved (12 October)

- **Section 1 — buyer's phone:** quantities *Needed · From stock · Bought · Still to buy*; claiming ≠ ordering ("Arranged" is separate); substitutes with an important spec change need **confirmation before buying**; extra quantities need a **reason + destination**; workers may see safe supplier names, never prices.
- **Shared delivery fees / discounts:** split by item amount by default, adjustable, must add up to the receipt total.
- **Section 2 — office side (Dacs Web):** Buyer switch managed by the owner; Purchasing tab; offline conflicts never erase a real purchase; one correction updates purchase + expenses + Bought (+ stock later) together; **completed projects are the only lock** (staff corrections there need main-owner approval); voids ≠ returns/refunds; "Payment differs by ₱…" instead of silently changing payments; staff access table.
- **2B stock / 2C cost moves — Q28 approved (12 October):** prepare separate implementation/pilot plans for 2B receiving, site/warehouse stock and physical movements, and 2C main-owner-confirmed warehouse-to-project cost assignment and PC-to-PC material cost transfers. **Launch both together** as the complete Stage 2 stock-and-cost capability. Show Cost assignment pending / Cost transfer pending until main-owner confirmation. External cost handling and broader reconciliation/reporting remain in Stage 4.
- **Overpayment resolution — Q27 approved:** actual refunds and confirmed supplier credits, with linked evidence/history. A note alone cannot clear the excess; credit is not returned cash. Preserve original purchase cost/Spent and payments, prevent duplicate resolution, and define refund recipients, source allocation, credit application and review permissions.
- **Payments — confirmed 12 October:** deposits and multiple payments, with actual payer (buyer/office staff/owner), remaining balance and overpayment review. Payment never creates another expense or increases Spent by itself.
- **Petty cash — confirmed 12 October:** owner gives actual company money to the buyer; unused cash is returned; **owner tracker per buyer + daily report from the same records** are approved. Show actual supplier payments with purchase/project/date/receipt details, returned money, remaining cash and latest-sync information; avoid double encoding. Daily opening cash + received + actual supplier refunds back into petty cash − payments from petty cash − owner-confirmed returns = recorded closing balance. **Return confirmation approved:** buyer-reported returns show Return awaiting confirmation, with pending amounts separate; only the owner confirms receipt and clears that amount from the buyer's recorded balance. Keep handover/confirmation history. Keep unpaid purchases separate from cash used. Cash given/returned does not change Spent or automatically make a purchase Cover. Still define return deadline, evidence/corrections and report handling of late confirmations, Philippine-day reporting, offline behavior, other permissions and reconciliation. **Q26 personal-advance fallback approved:** request more petty cash first; if the owner permits personal funding, track authorization, actual personal-funded payment and Company owes buyer/repayments separately. Repayment does not duplicate Spent, supplier payments or petty-cash issues; evidence, verification and repayment permissions still need design.

### Still to design

**A. Section 3 — money rules on the server** (the most important remaining part)

- [ ] **How a purchase becomes Spent:** project purchases count in Spent **when recorded**, regardless of payment status (already decided). Recording a payment later must **never** add a second expense or change Spent/Profit.
- [ ] **One shared server operation** for recording purchases, used by **both** the phone and Dacs Web (Expenses → Materials too), so the *billing period → overflow to Cover* split lives in **one place**. Today that split is in `expenses-module.js` on the Web side.
- [ ] **Funding — normal rule confirmed:** use the actual purchase month/year; earliest billing number with remaining funds first, then the next eligible same-month period, then Cover. If no matching period exists, record under Cover with **No matching monthly period — office review needed** (Q23 approved). Additional Works keeps today's separate no-monthly-limit rule and full cost/overrun reporting (Q24 approved); contract excess alone does not become Cover. Still define a valid Cover billing-period link, missing/equal-number tie-breaks, valid Additional Works owning-period handling and correction/reallocation permissions.
- [ ] **Warehouse purchases — 2C assignment approved, joint launch with 2B stock:** company stock cost stays outside project Spent and G&A until the main owner confirms the issued portion's assignment. Still define receiving billing period/Cover treatment, source valuation, partial issues/returns, retries and reports.
- [ ] **PC-to-PC leftover cost transfers — 2C approved, joint launch with 2B stock:** staff records the move; cost stays with the source until main-owner confirmation. Confirmed source/destination Material/Spent adjustments must balance and happen once. Q25 confirms the original source cost rows/periods and receiving project's actual receiving month/year. Still define split-row reversals, client/Cover attribution, eligible same-month ordering/missing periods, portion valuation, returns, pending/rejected decisions and report effects.
- [ ] **Safe retries:** a phone that sends the same purchase twice must not create two expenses.
- [ ] Check every rule against the **money invariants in CLAUDE.md** (Cover is a subset of Spent, never a fourth bucket; billing allocations stay outside Spent; etc.).

**B. Open decisions from the MVP spec** ([unified-worker-app-design.md](../specs/2026-09-29-unified-worker-app-design.md) §10)

- [ ] **Leftovers released to an outside job:** keep company-bought stock separate from Project Control leftovers whose cost still belongs to the original project. Stage 2 = evidence-only acknowledgement, with peso reconciliation in Stage 4? An acknowledgement must not silently reduce the original project's Spent.
- [ ] **Partial returns:** how a return reduces the outstanding quantity and cost, including returns after owner confirmation — linked to the original record, never rewriting history.
- [ ] **Lending tools to outside jobs:** a separate **yes / no**. Approving material release does not approve tool lending.

**C. Other items to settle before coding**

- [ ] **Buyer sign-in:** who manages the Buyer switch on screen; how a staff-only buyer signs into WorkMate (Purchasing + Profile, **no Attendance**); dual-role accounts; limited-owner scopes checked on the server.
- [ ] **Shared receipt privacy:** a receipt covering several projects must not show one project's viewers another project's lines or amounts (storage rules under 0081).
- [ ] **Update CLAUDE.md:** the blanket *"staff never see peso amounts"* rule gets the approved **procurement exception** (staff may see purchase prices, totals, payments and receipts within their buying scope) while project profit, reimbursements, warranty fund and quotations stay restricted. Do this **after #1** so the rule and the code agree.

**Done when:** Sections 1–3 and all open decisions are written into the spec, you've reviewed it, and it's ready to turn into implementation plans (2A, 2B stock, 2C cost moves; joint 2B/2C launch).

---

## 3. Build My Work (Meetings & Work Plan) as Stage 1c

**Status:** fully designed, **never put on the build order**. Spec: [2026-09-30-workmate-meetings-work-plan-design.md](../specs/2026-09-30-workmate-meetings-work-plan-design.md).

### What it is

Staff turn meeting notes into **clear tasks** that workers can find, acknowledge and follow — instead of hunting through old Messenger messages.

- **Dacs Web (staff):** paste typed meeting notes (Tagalog/Taglish OK) → **AI drafts** tasks and shared notes → staff **review and publish** (manual drafting always works without AI). Task board, acknowledgement monitor, blockers, completion checks, reminder controls.
- **WorkMate (workers):** **My Work** with **Today / Upcoming / Waiting**, task detail, **"I've read this"**, **report a blocker**, progress (responsible person), shared meeting notes, changes highlighted, **Pending sync** offline.
- **Team leaders:** propose tasks/problems and check their team's work — but **cannot publish** and **cannot give final approval**.

### Key rules already approved

- **AI never publishes** anything by itself; staff always review first.
- Each task belongs to **one** Project Control project and Main Contract / one Additional Works job.
- Each team task has **one responsible person** + helpers; **individual tasks** (one worker, no team) are allowed.
- Completion: responsible person reports done → leader checks (if any) → **admin/staff final approval**. Leaders can't verify their own work.
- **Blocked tasks:** while a blocker or unfinished earlier task remains, **Start work** and **Report done** stay locked.
- Delivered materials **don't** clear a blocker automatically; staff confirm readiness. A blocker never creates a purchase or changes a deadline.
- Delays **suggest** new dates; only a staff-published change moves the schedule.
- Reminders are allowed but **no salary deductions or attendance penalties**.
- Attendance, payroll, procurement amounts and stock are **unaffected** by task status.

### Decisions still needed before building

- [ ] **Confirm the slot:** Stage **1c**, built **before** Stage 2 coding (recommended).
- [ ] **AI provider:** which provider, what data is sent and kept — **needs your OK** before any real notes leave the system. Runs on a server endpoint (e.g. a Supabase Edge Function), never in the app or browser.
- [ ] **Phone notifications (push):** WorkMate has none today. Choose how reminders reach phones; until then, My Work in the app is the record.
- [ ] **Reminder details:** how often, quiet hours, who gets escalations.
- [ ] **Rejected work / reopening:** what happens when staff reject a "done" report, and the effect on later tasks.
- [ ] **Exact task states** (Not started, In progress, Blocked, Reported done, Awaiting verification, Completed) and how they change.

### Build steps (to become plans 1c-1 … 1c-4, like 1a/1b)

1. **1c-1 Server:** new tables + RLS + RPCs (meetings, tasks, assignments, acknowledgements, blockers, dependencies), acceptance SQL test; next migration number **0093**.
2. **1c-2 Dacs Web:** Meetings section — follow the **nav checklist in CLAUDE.md** (`PRIMARY_NAV`, **`_FOCUS_SUBVIEWS`**, `*_VIEWS` group, `_visibleNav()` role filter, markup + script tag, RLS, ARCHITECTURE.md), plus the AI draft flow.
3. **1c-3 WorkMate app:** My Work screens, offline acknowledgements/blockers with Pending sync, role-aware navigation.
4. **1c-4 Pilot:** phone pilot with test workers using the 10-step prototype scenario in the spec (§12) and the acceptance checks (§13).

**Done when:** all §13 acceptance checks pass on a real phone, and the app ships with (or right after) 0.5.0 at the switch-over.

---

## After these three

**Build Stage 2** from the finished, reviewed design: 2A purchasing, then separate 2B stock and 2C owner-approved cost-move plans, with **2B and 2C launching together**. Follow with Stage 3 (Tools) and Stage 4 (Expense integration). Q28 approves this delivery split; unanswered build-order questions still need confirmation.
