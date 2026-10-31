# WorkMate Stage 4 — Cost reconciliation and reports: questions

Date: 30 October 2026

Status: **Answered by the user, 30 October 2026: questions 1–7 and 9–15 = A.** **Question 8 = A as an approach only** (each payment reviewed one by one): **no purchase has been confirmed paid**, and all 18 stay Unpaid until the user confirms each one in the table under question 8. **Question 6 = A approves the "Cover is right" feature only**: it does **not** confirm that Cover is correct for the two Eagle Residence purchases, which each still need their own decision. Revision 3, 30 October 2026: the answers, plus a reference code for each purchase in questions 6 and 8 and a blank confirmation table. (Revision 2 listed the exact purchases and made explicit that **a payment method chosen on the form never marks a purchase paid or clears an "Office review" mark**.) **Confirmed by the user, 30 Oct: the 19 purchases in questions 6 and 8 are legitimate real purchases, not test data — preserve all of them.** That confirms only that they are real; their **payment dates, amounts paid and where the money came from**, and **whether Cover is correct** for the two Eagle Residence purchases, are still **pending**. No plan, code or database change; **no live record changed**.

Related: [WorkMate guide](2026-09-29-workmate-prototype-and-workflow-guide.md) §4 (main-owner screens), §14 *Cost flow*, §16 (Stage 4), §17, §18 · [MVP design](2026-09-29-unified-worker-app-design.md) §6 (Stage 4 "Expense integration") · [Stage 2 questions](2026-10-12-workmate-stage2-questions.md) (Q11–Q15, Q23–Q25, Q28) · [2A-4 questions](2026-10-22-workmate-stage2a4-questions.md) (Q2, Q3) · [2B+2C questions](2026-10-24-workmate-stage2bc-questions.md) (Q10–Q28) · [2C plan](../plans/2026-10-26-workmate-stage2c-cost-moves.md) (R73–R88)

**How to answer:** write a letter on each **Answer** line (e.g. `A`), or your own rule. *(R) = recommended, with the reason.* Writing "all R" is fine.

---

## What the guide says Stage 4 is

- **§16:** "4 — **Owner cost assignment/transfers and reconciliation**. Before release: verify **funding/billing/report effects** and **balanced original-cost treatment**, including **external cost review**."
- **§4:** the main owner's Stage 4 screens are "Pending cost assignment, PC cost transfer, external cost review".
- **MVP design §6:** "Expense integration — external-release cost reconciliation, **broader reconciliation and matching reports**"; verify Project Control billing-period, funding and report effects before enabling; **no automatic PM cost integration or cross-system transfers**.
- **§18, before Stage 4:** "External cost handling and broader reconciliation/reporting, source funding and financial report effects."

On 12 October (Q28) you moved cost assignment and project-to-project transfers **forward into 2C**, so most of the guide's Stage 4 list is **already built**. What is left is listed under *What remains*.

## Already built (not asked again)

| Stage 4 item in the guide | Built in | Today |
|---|---|---|
| **Pending cost assignment** (warehouse → project), approved by the main owner | 2C (Q11, R73, R84) | Live: Purchasing → Owner approvals |
| **Project-to-project cost transfer** | 2C (Q12, Q25, R77) | Live |
| Cost goes back to company stock when goods return | 2C (Q10) | Live |
| **Balanced original cost**: value by lot, the last portion takes the rest, every peso in exactly one of four places, the server refuses anything more, a retry counts once | 2C (Q12, Q24, R76) | Live; fenced by the money tests |
| **Funding effects**: received month, earliest billing number first, then Cover; Additional Works uses its own period; the giving side comes off its original periods and Cover in proportion | 2A-1 (Q1–Q3, Q22–Q24), 2C (Q14, Q15) | Live |
| No billing period for the purchase month → charged to Cover with an **"Office review"** mark; Project Control's report has a "No billing period — office review" line | 2A-1 (Q23) | Live, with 2 lines waiting (see *Live data*) |
| A purchase under approved cost moves can't be re-priced or re-funded | 2C (R81) | Live |
| **Completed projects are the only lock** | 2C (Q16, R82) | Live |
| **Billing effects**: client bills never change automatically; the office adjusts them by hand | 2C (Q25) | Live, but nothing reminds anyone (question 10) |
| **Report effects**: an approved move becomes ordinary, labelled Material rows ("From warehouse", "Moved to B", "Moved from A") in every list, total, print and CSV | 2C (Q25, R77, R86) | Live |
| **Company stock** value: in the warehouse, issued with the assignment pending, awaiting delivery, company stock loss | 2C (Q17, Q27, R78, R84) | Live: Purchasing → Company stock, owner accounts |
| Stock counts and owner-confirmed adjustments | 2B (Q27) | Live |
| Petty cash: daily report, counts, shortfall, returns awaiting confirmation | 2A-4 | Live |
| Supplier payments, Overpaid, refunds, supplier credit, company owes buyer | 2A-4 | Live |
| Who sees pesos: owner accounts only; staff never see stock value or cost moves | Q28, R83 | Live |

## Deferred or separate (not in this sheet)

- **Outside jobs: deferred (28 Oct).** The company does not give or lend materials or tools to outside jobs. So there is **no external release, no external cost review and no external cost handling** to build. That removes the guide's "external cost review" and "external-release cost reconciliation" from Stage 4. Revisit only if that changes.
- **Project Management (PM).** The guide excludes automatic PM cost integration and cross-system transfers.
- **0E + 3b** (crew to WorkMate, tools on the phone; R7 still undecided) and **office staff recording stock on the phone** are separate follow-ups.

## What remains for Stage 4

1. **The guide's exit check:** prove on real data that the funding, billing and report effects are right. The tests prove this on test data, but **no real stock movement or cost move has happened yet**.
2. **"Broader reconciliation and matching reports":** one owner view that shows the numbers add up and what is still waiting.
3. **Billing and report follow-through:** how the office learns that an approved move changed a month already billed or reported.
4. **Two gaps found while checking live data** (below): purchases waiting for a billing period, and purchases reading "Unpaid".

## Live data today (read-only, 30 Oct)

- **27 recorded purchases, ₱202,876**, from 19 to 30 Oct, across 5 projects. **All were entered by the owner in Project Control → Add Expense**, and all are project purchases. **There are no warehouse purchases**, and **none has a supplier** (that form has no supplier field).
- **Stock has been on since 28 Oct**, but there are **no real stock records and no cost moves** (the pilot's rows were cleaned up). Tools have been on since 29 Oct.
- **2 purchase lines are waiting for office review**, both for **Eagle Residence**: ₱344 (20 Oct) and ₱500 (24 Oct). Eagle Residence's billing periods run January–May 2026 (April and May are president/Cover periods), so the server charged both to **Cover** and marked them. Nothing gathers these marks in one place, and a mark can't be cleared without adding an October period.
- **Payments:**
  - **The 18 purchases from 24 Oct on (₱148,952) read "Unpaid"** to the owner. Project Control's form saves the purchase and its payment method (GCash, Bank Transfer) but **no payment** (2A-4a: Project Control records "without payments"). **No payment has been recorded anywhere.**
  - The 9 purchases from 19–22 Oct (₱53,924) read **"Payment not tracked"** (2A-4 Q2).
  - **No petty cash** has been given.

So on the **stock side there is nothing to reconcile yet**. **The real gaps today are on the purchase side.**

---

## A. Scope

**1. What Stage 4 builds**
- **A (R):** **A small Stage 4 now:**
  - a verification pass;
  - **one owner "Reconciliation" view** (questions 3–5 and 9–11);
  - the two purchase-side fixes (questions 6–8).

  **No new money rule.** The view only reads and points: it never moves a peso, and nothing it shows feeds Spent, Earned or Profit. *Reason: the money rules are already built (2A–2C). What's missing is one place where you can see they add up, and the two gaps are real today.*
- B: Verification only (tests and a live check), no new screen.
- C: Wait until real warehouse stock and cost moves have been in use for a few weeks, then design Stage 4 from real cases.

Answer: A

**2. How to plan it**
- **A (R):** **One plan**, server + Dacs Web, with **no phone part**. As in Stages 2–3, it's built and tested in scratch first, then sent for review. *Reason: it's an office/owner screen. The phone and the crew (0E, 3b) stay separate.*
- B: Two plans: first a small plan for the purchase-side fixes (questions 6–8), then the Reconciliation view.

Answer: A

---

## B. The Reconciliation view

**3. Where it lives and who sees it**
- **A (R):** A **"Reconciliation" tab in Requests → Purchasing**, for **owner accounts only** (like Company stock). Staff never see it, Buyer staff included. *Reason: it shows company stock, stock loss and money owed, which Q28 keeps to owner accounts. It sits next to Company stock and Owner approvals, where those numbers already are.*
- B: In Project Control → Reports, as a company-wide section.
- C: A new section in the main navigation.

Answer: A

**4. "Where every purchase peso is"**
- **A (R):** For purchases made in a chosen period (default: this month), show **where their pesos sit today**:
  - in the **buying project's Spent**;
  - **moved** to another project (moved out = moved in, so moves net to zero);
  - in **company stock**: in the warehouse, or issued with the assignment pending;
  - in **company stock loss**.

  These must add up to the **recorded purchases**. The view says **"Adds up ✓"**, or **"Difference ₱X"** with the purchases involved. A difference means a bug to report to the developer, not a business event. Voided purchases are listed separately and count nowhere. **Print and CSV.** *Reason: the database already refuses double counting (Q24). This lets you see it with real numbers, at month-end or any time.*
- B: Only a warning when something doesn't add up; no table.
- C: Not needed; trust the database and the tests.

Answer: A

**5. What's waiting, at a glance**
Today, decisions wait in five places:
- Purchasing → Owner approvals: cost moves and change requests.
- Cash: own money to accept, Overpaid, returns to confirm.
- Stock → Waiting for owner: counts.
- Tools: Lost and Retire.
- The "Office review" marks.

- **A (R):** The Reconciliation tab opens with **counts and links**, e.g. "2 lines waiting for a billing period · 18 purchases Unpaid · 1 return to confirm". Each links to the screen where it is decided. **Decisions stay where they are**; this list only points to them. *Reason: one look at month-end, and no second button that could decide the same thing differently.*
- B: Decide everything from the Reconciliation tab.
- C: No summary.

Answer: A

---

## C. Purchases waiting for a billing period

**6. Clearing an "Office review" mark**
Today the mark clears only when the office adds that month's billing period and saves the row again (the server then re-funds it). If **Cover is the right answer**, for example because Eagle Residence has no client allocation for October, there is no way to clear the mark.

The two lines waiting today (both **Eagle Residence**, both charged to **Cover**, both entered by the owner in Project Control):

| # | Ref | Purchase date | Entered | Description | Category (as entered) | Amount | Charged to now |
|---|---|---|---|---|---|---|---|
| 1 | `8c78b328` | 20 Oct 2026 | 20 Oct, 11:29 | PAINTING MATERIALS | Painting Materials | ₱344.00 | Cover, marked Office review |
| 2 | `7a03382a` | 24 Oct 2026 | 24 Oct, 15:26 | Materials | Painting Works (Yogen) | ₱500.00 | Cover, marked Office review |

**Real purchases (user, 30 Oct): preserve both.** Whether Cover is correct for either one is **still pending**.

Line 2 is also #2 in question 8's list. Nothing about its payment affects its mark.

- **A (R):** Two ways to clear it. The Reconciliation tab lists every marked line with its project, purchase date, amount and days waiting.
  1. **Add the month's billing period**, then **save the row again**. The server re-funds it as today (this is refused while approved cost moves rely on it, R81).
  2. An owner account marks it **"Cover is right"** with a short reason. The **mark clears but the money doesn't move**: it stays in Cover and in Spent, and who, when and why are kept.

  Nothing re-funds or clears on its own: not from a payment, and not from the payment method. *Reason: some purchases really do belong in Cover, and a mark that can never clear stops meaning anything.*
- B: Only the first way (add a period); the mark stays until then.
- C: Re-fund automatically when a matching billing period is added.

Answer: A — the feature only (30 Oct). **This does not confirm that Cover is correct** for the two Eagle Residence purchases above; each still needs its own decision (add an October billing period, or "Cover is right" with a reason) once the feature exists.

---

## D. Payments and suppliers

**7. Project Control purchases from now on**
- **A (R):** Project Control's **Add Expense** form gets the same **"Paid now?"** part as Record purchase (*Paid in full* / *Not paid yet*, and **paid from**), plus an **optional supplier**. This is for accounts allowed to record payments: **owner accounts and Buyer staff**. The purchase and its payment are saved **together or not at all** (2A-4 Q3). Staff without the Buyer switch record as they do today, and their purchases read Unpaid until a payment is recorded. **Choosing a payment method alone still never marks a purchase paid**: only *Paid in full* / *Paid part*, entered by the person, does. *Reason: you already choose GCash or Bank Transfer on that form. Recording the payment in the same step makes "Unpaid" mean really unpaid.*
- B: Project Control purchases read **"Payment not tracked"** unless someone records a payment (as before 2A-4).
- C: Leave as is, and record payments in Purchasing when you want the balances right.

Answer: A

**8. The 18 purchases already reading "Unpaid"** (24–30 Oct, ₱148,952)

All 18 were entered by the owner in Project Control. The last two columns show what was chosen or attached on the form, **only to help you check; neither is proof of payment**.

| # | Ref | Purchase date | Project | Description | Category (as entered) | Amount | Method chosen | Payment-receipt photo |
|---|---|---|---|---|---|---|---|---|
| 1 | `31b72b5e` | 24 Oct | De Leon Residence | ALUMINUM KITCHEN CABINET | Carpentry Works (Francis Febra) | ₱28,120.00 | Bank Transfer | Yes |
| 2 | `7a03382a` | 24 Oct | Eagle Residence | Materials | Painting Works (Yogen) | ₱500.00 | GCash | Yes |
| 3 | `bf412646` | 26 Oct | Sulit Residence | Carpentry Materials | Carpentry (Marc Kelley (Carpentry)) | ₱975.00 | GCash | Yes |
| 4 | `34585ad3` | 26 Oct | De Leon Residence | DaCs Delivery | Carpentry Works (Francis Febra) | ₱852.00 | GCash | Yes |
| 5 | `a002e0bb` | 26 Oct | Sulit Residence | Solid Surface Materials | Stone Works | ₱16,240.00 | Bank Transfer | Yes |
| 6 | `1c67809c` | 28 Oct | Sulit Residence | T&B WORKS | Tiling Works | ₱7,782.00 | Bank Transfer | Yes |
| 7 | `5a0211de` | 28 Oct | De Leon Residence | DaCs Delivery | Francis Febra | ₱106.00 | GCash | Yes |
| 8 | `d4eda687` | 28 Oct | De Leon Residence | DaCs Delivery | Francis Febra | ₱366.00 | GCash | Yes |
| 9 | `2748f656` | 28 Oct | Barlin Additional Works | DaCs Delivery | Mark Frias (CEILING MATERIALS AND DRYWALL) | ₱519.00 | GCash | Yes |
| 10 | `1896dcfe` | 28 Oct | De Leon Residence | DaCs Delivery | Francis Febra | ₱852.00 | GCash | Yes |
| 11 | `15eceded` | 28 Oct | Sulit Residence | DaCs Delivery | Painting (Marc Kelley (Painting)) | ₱450.00 | GCash | Yes |
| 12 | `2fb4f495` | 28 Oct | Sulit Residence | DaCs Delivery | Materials | ₱1,141.00 | Bank Transfer | Yes |
| 13 | `a5a31c40` | 28 Oct | J. Apo Residence | Painting Materials | Painting Works (Yogen) | ₱3,727.00 | GCash | Yes |
| 14 | `bb121dd2` | 28 Oct | Sulit Residence | TITANIUM GOLD | Stone Works | ₱44,600.00 | GCash | Yes |
| 15 | `f4b1fe77` | 28 Oct (entered 29 Oct) | Sulit Residence | Shower Set | Tiling Works | ₱13,000.00 | GCash | Yes |
| 16 | `fa4baf71` | 28 Oct (entered 29 Oct) | Sulit Residence | LIGHTING MATERIALS | Electrical Lighting | ₱21,591.00 | Bank Transfer | Yes |
| 17 | `b9503219` | 29 Oct (entered 30 Oct) | Sulit Residence | Primatech Lighting | Electrical Lighting | ₱1,108.00 | GCash | Yes |
| 18 | `c04e7d83` | 30 Oct | De Leon Residence | Carpentry Materials | Carpentry Works (Francis Febra) | ₱7,023.00 | Bank Transfer | **No** (purchase-order photo only) |
| | | | | | **Total** | **₱148,952.00** | | |

**Real purchases (user, 30 Oct): preserve all 18.** That they are real is the only thing confirmed. Payment dates, amounts paid and where the money came from are **still pending**.

- **A (R):** You go through the list. **For each purchase you confirm was actually paid**, you give the **date paid**, the **amount** (in full or part) and **where the money came from**. A **guarded script** then records **only those confirmed payments**, through the **normal payment function**. You run it in the SQL editor, dry run first. Anything you don't confirm stays **Unpaid**. **Nothing is recorded from the payment method or the photo alone.** *Reason: 18 by hand is slow and error-prone; the normal function keeps every rule and the history, and nothing is assumed.*
- B: You record them by hand in Purchasing → Purchases → Record payment.
- C: Switch them to "Payment not tracked" (goes with 7B).

**Your confirmations (blank until you fill them in).** A blank or "not sure" row means **not confirmed**: that purchase stays Unpaid and the script never touches it. *Paid from*: company directly · petty cash (none has been given yet) · a staff buyer's own money · supplier credit (none exists yet).

| # | Ref | Amount | Paid? (yes / no / not sure) | Date paid | Amount paid | Paid from |
|---|---|---|---|---|---|---|
| 1 | `31b72b5e` | ₱28,120.00 | | | | |
| 2 | `7a03382a` | ₱500.00 | | | | |
| 3 | `bf412646` | ₱975.00 | | | | |
| 4 | `34585ad3` | ₱852.00 | | | | |
| 5 | `a002e0bb` | ₱16,240.00 | | | | |
| 6 | `1c67809c` | ₱7,782.00 | | | | |
| 7 | `5a0211de` | ₱106.00 | | | | |
| 8 | `d4eda687` | ₱366.00 | | | | |
| 9 | `2748f656` | ₱519.00 | | | | |
| 10 | `1896dcfe` | ₱852.00 | | | | |
| 11 | `15eceded` | ₱450.00 | | | | |
| 12 | `2fb4f495` | ₱1,141.00 | | | | |
| 13 | `a5a31c40` | ₱3,727.00 | | | | |
| 14 | `bb121dd2` | ₱44,600.00 | | | | |
| 15 | `f4b1fe77` | ₱13,000.00 | | | | |
| 16 | `fa4baf71` | ₱21,591.00 | | | | |
| 17 | `b9503219` | ₱1,108.00 | | | | |
| 18 | `c04e7d83` | ₱7,023.00 | | | | |

Answer: A — as an approach only (30 Oct): each payment is reviewed one by one. **No purchase has been confirmed paid**; all 18 stay Unpaid until the confirmations table above is filled in.

**9. Money still out**
- **A (R):** One box on the Reconciliation tab showing:
  - **still owed to suppliers**: Unpaid and Partly paid balances, by supplier where one was recorded, otherwise "No supplier recorded";
  - **Overpaid** purchases waiting;
  - **supplier credit left**;
  - **petty cash held by buyers**;
  - **what the company owes buyers**.

  Each links to its purchase or to the Cash tab. **None of it is ever added to Spent** or to any project figure. *Reason: all of these have existed since 2A-4, but nothing adds them up in one place.*
- B: Supplier balances only.
- C: Nothing new; the Cash tab and each purchase already show the parts.

Answer: A

---

## E. Billing and reports

**10. Client bills to check after a cost move**
Project Control's billing periods and the client's bills (payment requests, statements, weekly bills) are **two separate systems with no link between them**, so nothing knows which months were already billed. Q25 says the office adjusts a bill **by hand**.
- **A (R):** Each **approved** cost move appears in a **"Bills to check"** list on the Reconciliation tab, with the months it changed on each side (e.g. "Project A · billing #3 · Sep 2026 · −₱200"). Once an owner account has decided whether to adjust the bill, it ticks **"Bill checked"** (with an optional note). **This never changes a bill.** *Reason: "by hand" needs a reminder or it gets forgotten. Linking the two billing systems would be a much bigger change.*
- B: No list; the office keeps track itself.
- C: Link Project Control periods to client bills so the system knows what was billed (a separate, bigger project).

Answer: A

**11. An earlier month changed later**
A move reduces the giving project's **original** periods (Q25), which may be months back. So a report printed back then can differ from today's.
- **A (R):** In Project Control → Reports and its prints, a period changed by a cost move **approved after that month ended** shows a short note, e.g. **"Changed 5 Nov by a stock cost move: −₱200"**, with those rows listed. The figures are always today's; there is no frozen copy. *Reason: anyone comparing with an old printout sees why at once, and there's still only one set of numbers.*
- B: No note; the labelled rows already explain it.
- C: Keep a frozen copy of each printed month and show the differences.

Answer: A

**12. Company stock and stock loss in Project Control Reports**
- **A (R):** **Not in Project Control Reports.** They stay on Purchasing → Company stock and the Reconciliation tab. *Reason: Reports are about projects' Spent. Putting company stock next to them invites adding it to Spent or overhead, which the money rules forbid (never Spent, never G&A).*
- B: A separate "Outside projects" box in company-wide Reports (company stock and stock loss), never part of any total.

Answer: A

---

## F. Month-end and proof

**13. A monthly sign-off**
- **A (R):** **No sign-off and no new lock.** Completed projects stay the only lock (24 Oct). The Reconciliation tab is for checking at any time. *Reason: a month lock would conflict with Q25 (moves reduce original months) and with the approved rule that completion is the only lock.*
- B: An owner account can mark a month **"Reconciled"** (a dated note, not a lock). Anything that changes that month afterwards shows "changed after it was reconciled".

Answer: A

**14. Proof before launch**
- **A (R):** Three checks:
  1. A **read-only live check** that works out question 4's figures straight from the records and compares them with the screen, before launch and whenever you ask.
  2. The **money tests**, extended so that nothing on the Reconciliation tab can feed Spent, Earned or Profit.
  3. A **ZZ pilot** on Dacs Web: a ZZ warehouse purchase, an issue, an approval, a move A → B, a return, a count loss, a refused re-fund and a reversal, plus whatever questions 6 and 10 add. It checks that Project Control, Reports, prints and CSV agree, and ends with a **guarded clean-up** (dry run first).

  *Reason: the stock side has never run on real data. This is the same discipline as Stages 2–3.*
- B: Tests only, no pilot.

Answer: A

> **Note (30 Oct):** the 19 purchases in questions 6 and 8 are confirmed real by the user. The pilot and its clean-up must leave them **and every other non-ZZ record exactly as they are**: no payment, re-fund, void or "Cover is right" mark on any of them unless the user decides it.

---

## G. Old data

**15. The old `inventory` table**
It has **0 rows**. Q29 kept it read-only "until a later clean-up", and stock replaced it on 28 Oct.
- **A (R):** **Leave it** during Stage 4: it's empty, read-only and harmless. Remove it, together with its dead code, in a later clean-up of its own. *Reason: dropping a table is hard to undo, and Stage 4 shouldn't mix clean-up with money checks.*
- B: Remove it in Stage 4's migration.

Answer: A

---

*Next after the answers: the Stage 4 plan (or plans, per question 2), built and tested in scratch before review. No code or database change before then.*
