# WorkMate Stage 2 — plan and open questions

Date: 12 October 2026

Status: **All 28 questions answered (12 October 2026) — design only.** Written into the purchasing spec (Section 3 + Other decisions) on 12 October; awaiting the user's spec review. Funding, staged supplier payments, overpayment handling and main-owner-confirmed warehouse assignments and Project Control project-to-project cost transfers were confirmed on 12 October 2026. Q28 confirms separate 2B stock and 2C cost-move plans, with one joint launch. Remaining questions and implementation details are open; the complete spec still needs review and approval before any build.

Related: [Mobile Purchasing spec](2026-09-30-workmate-mobile-purchasing-design.md) (Sections 1–2 agreed) · [WorkMate MVP scope](2026-09-29-unified-worker-app-design.md) · [Next three priorities](../plans/2026-10-12-next-three-priorities.md) §2

**How to answer:** fill in the **Answer** line under each question — a letter is enough (e.g. `A`), or write your own rule. *(R) = recommended.*

---

## How a material expense is saved today

From `handleAddExpense` in `js/expenses-module.js`:

- It picks **one billing period**: the active one if it still has budget left → otherwise the first one with budget left.
- Whatever doesn't fit goes to **Cover** (the project's president period if it has one, otherwise the row is flagged `coverExpense`). So one save can become **two expense rows** — "(1/2)" and "(2/2)".
- Expenses have **no Paid/Unpaid** today.
- An **"Add to inventory"** tickbox also writes to the old `inventory` table — a second stock-add path the spec says must be replaced.

---

## Part 1 — The plan

### Design (now)

1. Answer the questions in Part 2.
2. Write **Section 3 (money)** and the other decisions into the [purchasing spec](2026-09-30-workmate-mobile-purchasing-design.md); you review it.
3. Update **CLAUDE.md** with the staff purchasing exception (Q18), before any Stage 2 code.

### Build (after My Work / Stage 1c, per the agreed order)

| Plan | What it delivers |
|---|---|
| **2A-1 Server** | New tables: suppliers, purchases, purchase lines, shared charges, payments, **petty-cash issues/returns and linked balances, owner-authorized personal advances/repayments**, Buyer switch. **One "record purchase" server operation** with the period → Cover split. Corrections, voids, multiple supplier payments, overpayment review, acceptance SQL test. Migration number = highest on disk + 1 when implementation starts; do not reserve **0093** before My Work migrations. |
| **2A-2 Dacs Web** | Purchasing tab, purchases list, Buyer switch, **owner petty-cash tracker + daily report and separate personal-advance balances**, "From purchase" link on expenses. **Expenses → Materials switches to the same operation.** |
| **2A-3 WorkMate app** | Buyer screens: shopping list, *I'll buy this*, record a purchase with receipt photos (offline drafts), record multiple payments and show remaining balance/overpayment. |
| **2A-4 Pilot** | Real buying with a test buyer on a test phone. |
| **2B — stock** | Receiving, stock at sites and warehouse, *From stock*, issuing, physical transfers, returns, releases to outside jobs, Purchased/Received/Issued events in Item history, **retire the old "Add to inventory" tickbox**. |
| **2C — cost moves** | **Main-owner-confirmed warehouse-to-project cost assignment and PC-to-PC material cost transfers**. Separate implementation/pilot plan from 2B; **launch 2B and 2C together** (Q28 approved). |

---

## Part 2 — Questions

### A. Money — how a purchase becomes Spent (Section 3)

**1. Which billing period does a purchase line charge?**
- **A (R, revised after confirmation):** The **server uses the purchase month's billing periods** normally: the earliest billing number with funds first, then the next eligible period in the same month/year (Q22). Only the remaining shortage goes to Cover. It does not automatically use another month's fund. If no matching period exists, use Cover and flag office review (Q23). Additional Works keeps its own no-monthly-limit treatment (Q24). Missing/equal billing-number tie-breaks still need definition.
- B: The buyer picks the period on the phone.
- C: Lines wait unassigned until the office picks.

Answer: **Confirmed (12 October):** an October purchase normally charges the October period, including when entered later. Use the actual purchase date. Same-month ordering is confirmed in Q22; no matching period uses Cover with office review (Q23). Additional Works keeps today's separate no-monthly-limit treatment (Q24). Missing/equal-number tie-breaks remain to specify.

**2. Can one line split across a period and Cover, like today?**
- **A (R):** Yes, same as today. The purchase shows **one line**; behind it there may be two or more expense rows when multiple same-month funds are used (Q22).
- B: No — if it doesn't fit, the whole line goes to Cover.

Answer: **A — confirmed (12 October).** Example: ₱10,000 purchase, ₱6,000 October fund remaining → ₱6,000 October + ₱4,000 Cover. Spent = ₱10,000; Cover = a ₱4,000 subset.

**3. Which date decides the period?**
- **A (R):** The **receipt date** (when it was bought).
- B: The date it was recorded.

Answer: **Actual purchase date — confirmed (12 October).** Use when the goods were bought, not when the purchase was entered or synchronized. A receipt/document date that differs from that date must not silently replace it.

**4. How do shared delivery fees and discounts become Spent?** *(How they are split across projects is already agreed.)*
- **A (R):** A **fee** becomes its own expense row per project — *"Delivery fee (share)"*. A **discount** reduces the line amounts. No negative rows; item prices stay honest.
- B: Fold both into the line amounts (simpler, but unit prices look wrong).

Answer: **A — approved (12 October).** A shared delivery fee becomes its own expense row per project, *"Delivery fee (share)"*, using the agreed split. A discount reduces the affected line amounts. No negative expense rows.

**5. Expenses → Materials in Dacs Web**
- **A (R):** Switch it to **the same server operation in 2A**, so the period/Cover rule lives in one place.
- B: Leave it as is; only purchases use the new operation (two copies of the rule can drift apart).

Answer: **A — approved (12 October).** Expenses → Materials uses the same server recording operation in 2A, so the funding rule lives in one place. **Behaviour change accepted:** a backdated receipt entered in the office now charges its actual purchase month (Q1/Q22/Q23) instead of today's active-period pick. Update the money tests accordingly.

**6. Who may Mark Paid?**
- **A (R):** The **buyer who recorded it**, plus admin/owner and Buyer staff.
- B: Office only (admin/owner).

Answer: **Actual payer confirmed (12 October):** buyer, office staff or owner may pay, depending on the purchase. Record the actual payer separately from whoever encodes the payment. Exact recording permissions within the authorized purchasing scope still need definition.

**7. Paid amount doesn't match the purchase total?**
- **A (R):** Allow it, and show **"Payment differs by ₱…"** until the office resolves it (matches the Section 2 rule).
- B: Refuse unless it matches exactly.

Answer: **A — confirmed (12 October), with multiple payments.** Deposits and later payments are supported; retain every payment separately with payer, amount, actual date and method. Show Unpaid / Partially paid / Paid and the remaining balance. Preserve an actual overpayment and flag its excess for office review; never increase purchase cost or Spent automatically. Example: ₱10,500 paid against ₱10,000 purchase → ₱500 Overpaid. Q27 approves actual refunds and confirmed supplier credits; exact recipient, review/application and payment-correction rules remain to specify.

**8. Show Unpaid/Partially paid/Paid in Project Control on purchase-made expenses?**
- **A (R):** Yes — a small read-only badge, owner/admin only.
- B: No — Purchasing only.

Answer: **A — approved (12 October).** Show Unpaid / Partially paid / Paid as a small read-only badge on purchase-made expenses in Project Control, owner/admin only. Staff never see it there.

### B. Stock and warehouse (2B stock + 2C cost moves; joint launch)

**9. Must a purchase line be a catalogue item?**
- **A (R):** **Not to buy it** (an unlisted request line can be bought), **but it must be matched to a catalogue item before it can become stock** in 2B.
- B: Catalogue items only, from day one.

Answer: **A — approved (12 October).** An unlisted request line can be bought; it must be matched to a catalogue item before it can become stock in 2B.

**10. Suppliers**
- **A (R):** A simple **supplier list** (name, optional branch/contact) that buyers can add to.
- B: Free text each time.

Answer: **A — approved (12 October).** A simple supplier list (name, optional branch/contact) that buyers can add to.

**11. Warehouse stock issued to a project in Stage 2**
- A: Quantities only; postpone main-owner-confirmed cost assignment until Stage 4 (the earlier plan).
- **B (approved):** In **Stage 2B**, staff records the physical issue; **2C** handles cost assignment in the same joint launch. It shows **Cost assignment pending** until the **main owner** confirms. Only the issued portion then becomes the receiving Project Control project's Material cost and Spent; unused stock cost remains with company stock.

Answer: **B — explicitly approved (12 October).** Example: 20 warehouse cement bags cost ₱10,000; 8 bags issued to Project A → ₱4,000 Material/Spent after main-owner confirmation, ₱6,000 remains warehouse stock cost. No second purchase or supplier payment. Q28 subsequently separates physical stock operations into 2B and owner-approved warehouse assignments/PC-to-PC cost transfers into 2C, with both launching together. External cost reconciliation stays in Stage 4.

**12. Leftovers moved from one project to another in Stage 2**
- A: Physical move only; leave the cost with the source project until main-owner-confirmed transfer in Stage 4 (the earlier plan).
- **B (approved, clarified):** In **Stage 2B**, staff records the movement; **2C** handles the cost transfer in the same joint launch. **Only the main owner** may confirm transfer of the issued portion's original purchase cost between Project Control projects. This is not an automatic cost move.

Answer: **B — explicitly approved (12 October).** Until confirmation, cost stays with the source project and shows **Cost transfer pending**. After confirmation, reduce the source Material/Spent and increase the destination Material/Spent by the same amount, together and once. Example: A bought 10 outlets for ₱1,000; B receives 2 → after approval A carries ₱800 and B ₱200, total ₱1,000. Retain original purchase, payment, receipt and source history; no new purchase or supplier payment. Outside-job releases are a separate open decision.

### C. Outside jobs (the three open decisions)

**13. Leftover material released to an outside job**
- **A (R):** Stage 2 records **evidence only** — who took it, quantity, photo, date. **The original project's Spent doesn't change**; the money is reconciled in Stage 4.
- B: Reduce the original project's Spent immediately.

Answer: **A — approved (12 October).** Stage 2 records evidence only — who took it, quantity, photo, date. The original project's Spent does not change; money is reconciled in Stage 4.

**14. Partial returns from an outside job**
- **A (R):** A return **reduces the quantity still out**, **linked to the original release**. After owner confirmation it is a **new correcting record** — history is never edited.
- B: Edit the original release.

Answer: **A — approved (12 October).** A return reduces the quantity still out and is linked to the original release; after owner confirmation it is a new correcting record. History is never edited.

**15. Lending tools to outside jobs**
- **A (R):** **Not now** — decide in Stage 3 (Tools).
- B: Allow it in Stage 2.

Answer: **A — approved (12 October).** No tool lending to outside jobs in Stage 2; decide in Stage 3 (Tools).

### D. Access and privacy

**16. Who can sign into WorkMate for purchasing?** *(Today WorkMate refuses staff accounts.)*
- **A (R):** **Staff with the Buyer switch on**, plus admin/owner within their account scope — **Purchasing + Profile only, no Attendance** (unless they are also a worker).
- B: Only Buyer staff; admin/owner use Dacs Web.

Answer: **A — approved (12 October).** Staff with the Buyer switch, plus admin/owner within their account scope, may sign into WorkMate for purchasing: Purchasing + Profile only, no Attendance unless they also qualify as a worker. Enforced on the server.

**17. Receipts covering several projects**
- **A (R):** The **receipt photo stays office-only** (owner/admin/Buyer staff). Clients and partners never see purchase receipts. Each project's own expense rows stay visible as today.
- B: Show the receipt to every project on it.

Answer: **A — approved (12 October).** Multi-project receipt photos stay office-only (owner/admin/Buyer staff). Clients and partners never see purchase receipts; each project's own expense rows stay visible as today.

**18. CLAUDE.md wording**
- **A (R):** I draft the new staff rule — *staff may see purchase prices, totals, payments and receipts within their buying scope; project profit, reimbursements, warranty fund and quotations stay restricted* — and you approve it before any code.

Answer: **A — approved, extended (12 October).** Draft two CLAUDE.md rules for approval before any Stage 2 code: (1) the staff purchasing exception; (2) **petty cash, personal advances, refunds and supplier credits are outside the money model** — they never feed Spent / Earned / Profit (like Reimbursements and the Warranty Fund).

### E. Rollout

**19. Can buyers use WorkMate before the workers switch over?**
- **A (R):** **Yes.** Buyers are staff, not workers, so 2A doesn't need to wait for the switch-over (0E).
- B: Everything goes out together at the switch-over.

Answer: **A — approved (12 October).** Buyers may use WorkMate for purchasing before the worker switch-over (0E).

**20. Pilot buyer** — which staff member(s) test buying, and on which project?

Answer: **Decide later** — choose the pilot buyer(s) and project when 2A is ready to test.

**21. Build order** — finish this design → build **My Work (1c)** → build **2A** → **2B stock + 2C cost moves (joint launch)**. Still right?

Answer: **Yes — approved (12 October).** Finish this design → My Work (1c) → 2A → 2B + 2C (joint launch).

### F. Funding details, personal advances and delivery structure

These questions were added for review on 12 October. **Only explicitly approved answers are decisions.** Q11/Q12 approve owner-confirmed warehouse assignments and PC-to-PC transfers in Stage 2. Q28 refines delivery into separate 2B stock and 2C cost-move plans, with both launching together.

**22. Two billing periods in the same month: which goes first?**
- **A (R):** Use the **earliest billing number** in that purchase month that still has funds; then the next eligible period in the same month. Only the shortage after those funds is Cover. The buyer still sees one purchase line; there may be more than two funding rows.
- B: Use the newest period in that month first, then earlier same-month periods with funds.
- C: The office chooses; there is no automatic ordering.

Example: October period 1 has ₱3,000 left, period 2 has ₱4,000, and the purchase is ₱8,000. A uses ₱3,000 + ₱4,000 + ₱1,000 Cover. Do not automatically use September or November funds. Define a stable tie-break when billing numbers are missing or equal.

Answer: **A — approved (12 October).** Use the earliest billing number with funds in the actual purchase month/year, then the next eligible same-month period. Any shortage after those funds goes to Cover; do not automatically use another month. Example: ₱8,000 purchase → October period 1 ₱3,000 + period 2 ₱4,000 + Cover ₱1,000. Keep one purchase line with linked funding splits. Stable handling of missing/equal billing numbers remains an implementation detail.

**23. No billing period for the purchase month: Cover, nearest earlier period, or office review first?**
- **A (R):** Record the real project purchase against **Cover**, clearly flag **No matching monthly period — office review needed**. The office can later create/select the right period and make an authorized funding correction without adding the cost again.
- B: Automatically use the nearest earlier period with funds, then Cover. This would be an exception to the matching-month rule.
- C: Keep it awaiting office funding selection; define how the actual purchase and its project cost remain visible while waiting.

A missing monthly period must not make a real purchase disappear or silently understate a recorded project's Spent. Define the valid Cover billing-period link if the project has no existing Cover period; do not invent a client allocation or rely on a nonexistent database field.

Answer: **A — approved (12 October).** If the actual purchase month/year has no matching billing period, record the real project purchase under Cover and flag **No matching monthly period — office review needed**. Do not automatically use an earlier month or hide the cost while waiting. Any later authorized funding correction preserves the original purchase/date and counts its cost once; Cover remains a subset of Spent. The valid Cover billing-period link and exact correction permissions still need implementation design.

**24. Additional Works: keep today's no-limit funding rule?**
- **A (R):** Keep today's treatment: charge the selected Additional Works job's own period without applying the normal monthly-fund limit. Record actual costs even above its contract; do not route the excess to Cover merely because the contract is exceeded.
- B: Give Additional Works an explicit funding limit and route its shortfall to Cover. This changes today's behavior and needs a separately agreed funding rule.

No monthly limit does not mean unlimited authority to change the agreed scope or contract. Additional Works remains its own Project Control destination; its contract, actual costs and profit use the existing money rules.

Answer: **A — approved (12 October).** Keep today's Additional Works treatment: charge its own job/period without the normal monthly funding limit. Record the full actual cost even above the agreed contract; do not automatically put the excess in Cover merely because the contract was exceeded. Example: ₱20,000 contract and ₱22,000 cost → ₱22,000 Spent and the overrun remains visible. This does not authorize changes to scope/contract or unlimited purchasing; preserve existing explicit funding/source history and the Earned/Forecast money rules.

**25. Project-to-project cost transfer: which source period is reduced, and which receiving period is charged?**
- **A (R):** Reduce the **actual source expense/funding rows that originally carried the transferred material's cost**; never pick an unrelated source period just because it has money. Charge the destination's period matching the **actual date the receiving project received the materials**. Resolve its eligible same-month period and client/Cover treatment explicitly before implementation. Preserve source purchase/funding history and let the main owner review both sides before confirming.
- B: The main owner selects both periods explicitly for every transfer, with the original source rows still identified and preserved in the history.

Example: A bought the outlets in September and B receives some in October. The source correction belongs to A's linked September cost rows; B's receiving cost normally belongs to October. Receiving, shipping and owner-confirmation dates are retained separately; a later owner approval does not silently move the receiving month. Define how original client/Cover portions are reversed when the source cost was split, how the destination Cover portion is shown, and what to do if an old material has no verified original cost. Neither option creates a purchase/payment or changes client allocations, invoices or contract values. The source reduction and receiving charge must match and succeed together.

Answer: **A — approved as clarified (12 October).** Reduce the original source cost rows/periods that carried the transferred materials and charge the receiving project in the **month/year it actually received them**. Retain the receiving date separately from shipping and owner-confirmation dates. Example: A bought 10 outlets for ₱1,000 in September; B receives 2 worth ₱200 in October → after main-owner approval, reduce A's linked September cost by ₱200 and charge B's October cost ₱200. Original purchase, supplier payments and source history remain intact; total Spent stays ₱1,000. Exact handling of original funding splits, client/Cover attribution, multiple receiving periods, missing receiving periods and unverifiable legacy cost remains to define.

**26. Buyer paid with personal money: track “company owes buyer”?**

**Petty cash — confirmed 12 October:** the owner sends or hands actual company money to the buyer for material purchases; the agreed name is **petty cash**. The buyer **returns unused money to the owner**, rather than keeping it automatically for later purchases. The owner requires a **day-by-day petty-cash report**. **Return deadline — approved 12 October: unused cash is returned at the end of the buying run** (not necessarily the same day); until then the tracker shows it as held. Evidence/corrections and handling of delayed/offline reports still need clarification. Owner confirmation itself is approved below.

**Petty-cash return confirmation — approved 12 October:** when the buyer records a cash return, show **Return awaiting confirmation**. The buyer cannot clear their recorded balance merely by reporting a return. Only the owner confirms that the money was actually received; only then does that returned amount reduce the buyer's recorded balance. Keep pending-return amounts visibly separate so they are not mistaken for confirmed returns. Retain reported handover and owner-confirmation details/history. Issuing, reporting or confirming a return does not change project Spent or create another supplier payment.

The cash is company money held by the buyer, not a personal advance and not merely a spending limit. Issuing or returning petty cash does not itself create project Spent, a new material expense or a billing allocation. Owner-issued cash does not automatically make a purchase Cover; normal project funding rules determine that. Cash usage follows actual payments from petty cash, not all recorded purchase costs: an Unpaid purchase can enter Spent without reducing cash held yet. **Owner tracker + daily report — approved:** show each buyer's petty cash received, supplier payments made from it, money returned, money still held and unexplained differences. The owner can open payment details to see what was bought, the project, actual payment date and receipts. Generate the day-by-day report from the same accepted records; no second encoding or duplicate payment entry. For a daily report, show opening cash held plus money given that day and actual supplier refunds received back into that petty cash that day, minus that day's petty-cash-funded supplier payments and **owner-confirmed returns**, yielding the recorded closing balance. Pending reported returns remain separately visible until confirmed. The tracker shows the latest accepted/synced figures and a last-updated indication; offline/unsent updates must not appear as confirmed owner balances. Unpaid purchases and supplier balances remain separate because they have not used petty cash yet. Daily dates follow Philippine time. Receipt of returned money must be evidenced rather than inferred from a report alone. The tracker and reports respect the owner's company/account scope. Owner confirmation is required; exact evidence/correction rules, report-date treatment of late confirmations, other recording/review permissions, discrepancies, refunds and reconciliation remain design details. Q26 now approves personal advances only as an owner-authorized fallback, separately from the primary petty-cash workflow; see the answer below.
- **A (approved with condition):** Ask the owner for additional petty cash first. If the owner allows personal funding, distinguish **company money** from **personal money** and track the owner-authorized personal advance/repayment balance. Paying the person back settles that balance; it does not create another material expense or increase project Spent.
- B: Record the actual payer, but leave repayment to the company’s existing manual process outside WorkMate.

Keep this separate from **Client Reimbursement**: that existing module tracks an owner/admin advance recovered from a client, not the company repaying a buyer. Do not automatically create a reimbursement, payroll, invoice or accounting entry. Define who may view/confirm advances and repayments, supporting evidence, partial repayment and the difference between the payer and the person recording the payment.

Answer: **A — approved with owner-permission condition (12 October).** Default: ask the owner for more petty cash. If the owner allows the buyer to use personal money, record the authorization, actual personal-funded amount and supporting payment evidence, then track **Company owes buyer** and repayments separately from petty cash and supplier balances. Example: ₱4,000 company petty cash + ₱500 owner-authorized personal payment for a ₱4,500 purchase → purchase Spent ₱4,500 once; Company owes buyer ₱500. Repaying ₱500 clears that balance, without increasing Spent or counting as another supplier payment/petty-cash issue. Exact verification, authorization/evidence and repayment permissions remain implementation-design details.

**27. Overpaid: refund, supplier credit, or a closing note?**
- **A (R):** Support an actual **refund** or confirmed **supplier credit**, each linked to the original overpayment and kept with its own evidence/history. A refund reduces the amount still recoverable; a credit remains visible until used or otherwise resolved. A note alone does not count as money returned.
- B: Refunds only; leave supplier-credit handling outside WorkMate with a visible unresolved balance.
- C: Allow the main owner to close an unrecovered amount with a reason and reference. Keep the amount and decision in history; do not describe it as a refund or invent an automatic project expense.

Example: ₱500 overpaid → ₱200 refunded + ₱300 confirmed supplier credit. These are two distinct records, not a changed original payment. Define who approves a credit/refund, who receives the refund when personal money funded the payment, and how credits are applied without counting the same money twice. Payment/refund/credit handling does not automatically rewrite the original purchase cost or Spent; a genuine purchase correction is a separate audited action.

Answer: **A — approved (12 October).** Support both actual cash refunds and confirmed supplier credits, linked to the original overpayment with evidence/history. A note alone does not clear the unresolved amount. Refunds reduce the recoverable overpayment; confirmed credit stays visibly available until applied/resolved and is not cash returned. Example: ₱500 excess → ₱200 refunded + ₱300 supplier credit. Preserve the original payment and purchase cost/Spent; a genuine purchase-cost correction is separate. Record the actual refund recipient and original funding source. Only an actual refund received back into company petty cash increases that cash balance; credit and personal-money refunds do not automatically do so. Exact review permissions, refund-recipient handling after personal-advance repayment, credit application and corrections remain to define.

**28. Split 2B into 2B (stock) and 2C (cost moves)?**
- A: Keep stock, warehouse cost assignment and PC-to-PC cost transfers in one 2B implementation plan/release.
- **B (approved):** Use separate **2B stock** and **2C owner-approved cost moves** implementation/pilot plans, but launch them together as the complete Stage 2 stock-and-cost capability. This separates development and verification without postponing the approved cost features to Stage 4.
- C: Release stock first and cost moves later. Show pending costs throughout that gap and explicitly agree the release timing and effect on project cost reports.

Q28 refines Q11/Q12’s earlier single-2B delivery structure: physical stock operations are planned in 2B, and owner-approved warehouse assignments and PC-to-PC cost transfers in 2C. **Launch both together**; a standalone stock release is not approved. The main-owner approval rule, balanced original-cost transfers and ban on duplicate purchases/payments remain. Stage 4 retains external cost handling and broader reconciliation/reporting.

Answer: **B — explicitly approved (12 October).** Prepare separate 2B stock and 2C owner-approved cost-move implementation/pilot plans, then launch them together as the complete Stage 2 stock-and-cost capability. This approves the delivery structure only; remaining design questions and full-spec approval still precede implementation.

---

## After the answers

1. Write the answers into the purchasing spec (Section 3 + decisions); remove this file's open status.
2. You review the spec.
3. CLAUDE.md update (Q18).
4. Implementation plans start with **My Work (1c)**, then **2A-1**.
