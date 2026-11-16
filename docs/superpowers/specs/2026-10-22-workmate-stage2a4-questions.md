# WorkMate Stage 2A-4 — Paying for purchases: questions before the plan

Date: 22 October 2026

Status: **Answered and confirmed by the user, 22 October 2026: all recommended (A); Q10 with two cases added (supplier-credit-funded and company-direct refunds).** The answer lines were first filled in by Claude from a pasted review; the user confirmed them as their own the same day. No plan, code or database change in the repo yet.

Related: [Mobile Purchasing spec](2026-09-30-workmate-mobile-purchasing-design.md) (sections *Supplier payments*, *Owner-authorized personal advances*, *Overpayment refunds and supplier credit*) · [Stage 2 questions (answered 12 Oct)](2026-10-12-workmate-stage2-questions.md) · [2A-3 questions](2026-10-20-workmate-stage2a3-questions.md) · [2A-3b plan + pilot notes](../plans/2026-10-21-workmate-stage2a3b-buyer-app.md)

**How to answer:** write a letter on each **Answer** line (e.g. `A`), or your own rule. *(R) = recommended.* Writing "all R" is fine.

---

## Where we are

**2A-1 to 2A-3 are built.** A purchase is recorded once, on the web or the phone, and its cost goes into the project's **Spent** at that moment, **paid or not** (the rule you confirmed on 12 Oct). What does **not** exist yet is anything about **paying**:

- No record of **who paid the supplier, how much, when, and from which money**. The purchase form has only a "Paid with" word (Cash, GCash…).
- No **petty cash**: what the owner hands a buyer, what the buyer spent, what was returned, and what the buyer still holds.
- No **"Company owes buyer"** for when a buyer pays with their own money.
- No **Unpaid / Partially paid / Paid**, no **Overpaid**, refunds or supplier credit.

**Already decided on 12 Oct (not asked again):**
- **Payments never change Spent, Earned or Profit.** Petty cash, personal money, refunds and credit are outside the money model (CLAUDE.md rule, already applied).
- A purchase can have **several payments** (deposit, then the rest). Each is kept, never overwritten.
- Overpaying is **kept and flagged "Overpaid"** for office review. It is resolved by a **refund** or a **supplier credit**, never by a note alone.
- **Unused petty cash goes back at the end of the buying run.** The buyer **reports** a return, and only the **owner's confirmation** lowers the buyer's balance.
- The **daily report** formula: opening cash + petty cash received + refunds received into petty cash − supplier payments from petty cash − owner-confirmed returns = closing cash.
- Using **personal money** is a fallback, **only when the owner allows it**, and tracked as **"Company owes buyer"** until repaid.
- Project Control shows a small **Unpaid / Partially paid / Paid** badge to **owner/admin only**. Staff see no badge there.

**Today's live data:** 5 recorded purchases, all entered in Project Control. Nobody has been given petty cash in the system yet.

---

## A. Scope

**1. How to split the work**
- **A (R):** Two plans, like 2A-3. **2A-4a:** server + Dacs Web (payments on a purchase, the owner's petty-cash tracker and daily report, personal-money balances, Overpaid review). **2A-4b:** the phone (pay at the counter, record a later payment, "My cash", report a return). 2A-4a goes live on its own first.
- B: One plan for everything.

Answer: A

**2. Purchases recorded before 2A-4**
They have no payment records. Calling them all "Unpaid" would be wrong: they were paid outside the system.
- **A (R):** They read **"Payment not tracked"**: no badge, no balance, no Overpaid. The owner *may* record payments on one, which turns tracking on for that purchase only.
- B: They read "Unpaid" like new ones.
- C: The owner marks them all "Paid" in one go when 2A-4a goes live.

Answer: A

---

## B. Recording a payment

**3. When a payment is recorded**
The buyer usually pays at the counter, at the moment of buying.
- **A (R):** **Both.** The Record purchase form gets a **"Paid now?"** part: *Paid in full* / *Paid part (deposit)* / *Not paid yet*, plus **paid from** *(question 5)*. The purchase and its "paid now" payments are accepted by the server in **one transaction: both or neither.** If the payment part is refused, the purchase is not recorded either, and the phone keeps both as "Needs attention". A purchase can never appear paid without its payment saved, or saved without the payment the buyer entered. Later payments go through **Record payment** on the purchase.
- B: Payments only through Record payment, after the purchase is saved.

Answer: A

**4. Who may record a payment**
- **A (R):** The **buyer, on purchases they bought**; **Buyer staff** within their buying scope; the **owner**, any purchase. Workers and team leaders never. Payments are recorded on the **whole purchase** (one receipt), never per project (already decided).
- B: Owner only. Buyers just say "paid" on the purchase.

Answer: A

**5. What a payment says**
- **A (R):** **Amount**, **actual date**, **method** (Cash · GCash · Bank transfer · Check · Other), **who handed the money** (the buyer, office staff or the owner), and **paid from**: **Petty cash** · **My own money** (only if allowed, see Q21) · **Company, paid directly** (owner or office paid, e.g. bank transfer) · **Supplier credit** (Q11). One payment has **one** source. A part from petty cash and a part from personal money are **two** payments. A proof photo (GCash screenshot, deposit slip) is **optional**, and a note is optional.
- B: Same, but a proof photo is **required** for anything not cash.

Answer: A

**6. Payments with no signal**
- **A (R):** Like purchases: saved on the phone, **sent once** when there is signal, and shown as **"Waiting to send"** until then. The phone shows the purchase's balance including payments not yet sent, marked as such. The owner's tracker counts a payment only once the server has it.
- B: Payments need signal (online only).

Answer: A

**7. A payment entered by mistake**
- **A (R):** Payments are **never edited or deleted**. The person who recorded it, or the owner, **voids it with a reason**, then records the right one. The voided payment stays in the history. A voided petty-cash payment puts that cash back on the buyer's balance.
- B: Only the owner can void a payment.

Answer: A

**8. When the purchase changes after it was paid**
- **A (R):** Payments are **kept as they are**. The status is worked out again: if payments now exceed the corrected total, it shows **Overpaid ₱…**. A **voided** purchase with payments shows **"Voided — ₱… paid, to recover"** in the same Overpaid review, resolved the same way (refunds tied to the money that paid, Q10). Nothing changes Spent.
- B: A purchase with payments cannot be voided until its payments are voided first.

Answer: A

---

## C. Overpaid, refunds and supplier credit

**9. Who resolves Overpaid**
- **A (R):** The **main owner**, on Dacs Web, from an **Overpaid** list. For each one: record a **refund** *(Q10)* and/or **confirm a supplier credit** *(Q11)*. The same peso can be resolved only once: refunds + credit can never add up to more than the overpaid amount (partly refund, partly credit, as the spec's ₱200 + ₱300 example).
- B: The owner or Buyer staff.

Answer: A

**10. Where a refund goes**
A refund gives back money that came from somewhere. It has to go back to **that** money, or a balance ends up wrong.
- **A (R):** Every refund is **tied to the money that paid**. The Overpaid screen lists the purchase's payments by source (petty cash / the buyer's own money / company direct). The refund is **split across those sources**, and each part can't exceed what that source paid. For a purchase paid from one source, the split is filled in for you. Then, for each part, the owner says **who actually received it**, and the effect follows. Nothing is chosen automatically, and nothing else moves:

  | Part refunds money paid from… | Actually received by… | Effect |
  |---|---|---|
  | Petty cash | the buyer, **back into the petty cash** | the buyer's **cash held goes up** (shown in that day's report as *refund received*) |
  | Petty cash | the owner / company | no balance changes (the company has its money back) |
  | The buyer's own money | the buyer | **"Company owes buyer" goes down** |
  | The buyer's own money | the owner / company | "Company owes buyer" is **unchanged** (the company now holds the buyer's money, and still owes it) |
  | Company, paid directly | the owner / company | no balance changes |
  | Company, paid directly | the buyer *(added 22 Oct)* | **company cash held by the buyer**: their cash held goes up, shown in the daily report as *refund received*, until returned or otherwise reconciled |
  | Supplier credit *(added 22 Oct)* | — (not refunded) | **by default the excess goes back to that supplier's credit balance**; only if the owner records an actual refund (with who received it and where it went) is it handled as a refund instead |

  Example: ₱500 overpaid on a purchase paid ₱700 petty cash + ₱300 own money. The supplier refunds ₱500 in cash to the buyer: ₱300 back into the petty cash and ₱200 for their own money. Cash held +₱300; company owes buyer −₱200.
- B: Refunds always go to the owner, and the owner adjusts balances by hand.

Answer: **A, clarified (22 Oct):** **supplier-credit-funded** overpayments **restore the excess to that supplier's credit balance**, unless the owner records an actual refund with its recipient and destination. A **company-direct** payment refunded **to the buyer** is recorded as **company cash held by that buyer**: it raises their cash held and appears in the daily report (*refund received*) until returned or otherwise reconciled.

**11. Using a supplier credit**
- **A (R):** A confirmed credit is a **balance with one supplier**, not a single-use voucher. When paying that supplier later, "Paid from: **Supplier credit**" is offered, showing **the credit left**. It can be used **in parts, on several purchases, until it is used up**. Each use is recorded **once** (a retry never uses it twice) and lowers the balance left, and the server never lets the uses add up to more than the credit. A credit is **not cash**: no petty cash moves, and the purchase cost stays the full amount (spec example: ₱1,000 purchase = ₱500 credit + ₱500 cash). A use made by mistake is voided with a reason, which gives that amount back to the credit.
- B: Credits are only noted; the owner settles them by hand.

Answer: A

**12. Who may use a supplier credit**
- **A (R):** The **buyer** when recording a payment to that supplier, and the owner. The credit list is visible to Buyer staff and the owner.
- B: Owner only.

Answer: A

---

## D. Petty cash

**13. Who gives petty cash, and where**
- **A (R):** The **main owner**, on Dacs Web: buyer, amount, date, method (cash / GCash) and an optional note. It shows on the buyer's phone at once.
- B: The main owner, and owner/admin accounts that have the Expenses section.

Answer: A

**14. Does the buyer confirm receiving it?**
- **A (R):** It **counts at once** (the owner is recording money they handed over). The buyer sees it on the phone and can press **"I did not receive this"** with a note, which flags it on the owner's tracker. A flag does not change the balance until the owner corrects it.
- B: It counts only after the buyer presses **Received** (until then: "Sent, not yet received").

Answer: A

**15. The "buying run"**
The spec says unused cash goes back at the end of the run.
- **A (R):** **No run records.** Each buyer has **one running balance**. The tracker shows how long cash has been held (e.g. *₱3,500 held · last given 4 days ago*). The run ends when the buyer reports a return.
- B: Explicit runs: the owner starts a run when giving cash, and the buyer closes it with the return. Each run has its own report.

Answer: A

**16. Paying more from petty cash than the buyer holds**
- **A (R):** **The payment is kept, and the gap is shown as a shortfall, never as negative cash.** The phone warns first ("You hold ₱800. This payment is ₱1,000."). If it's saved anyway (it really happened, and it may have been saved offline), **cash held reads ₱0**, and the owner's tracker and daily report show **"Unreconciled shortfall ₱200 — paid beyond the petty cash recorded"**, apart from the cash. Real cash cannot go below zero, so the shortfall means something is missing: a petty-cash handover never recorded, or the buyer's own money. The owner clears it by recording what really happened (the missing petty cash, or that part as own money). No expense or balance is made up.
- B: Refused. The buyer must split it into petty cash + own money before saving.

Answer: A

**17. Reporting a return**
- **A (R):** The buyer reports it on the phone (amount, date handed over, to whom; optional photo) → **"Return awaiting confirmation"**. The **main owner confirms** on Dacs Web (or rejects it with a reason). The pending amount is shown separately and does not lower the balance until confirmed.
- B: The owner records returns directly on Dacs Web; the buyer only sees them.

Answer: A

**18. A late confirmation in the daily report**
Example: handed over Friday, confirmed by the owner on Monday.
- **A (R):** The balance drops on the **confirmation day** (Monday). Monday's report lists it with *"handed over Fri"*. Past days' closing amounts **never change**.
- B: The balance drops on the **handover day** (Friday), and Friday's closing is re-worked when it is confirmed.

Answer: A

**19. Counting the cash (discrepancies)**
- **A (R):** The owner can record a **cash count** for a buyer ("counted ₱3,200"). The tracker shows the difference from the recorded balance, e.g. **"Short ₱300"**, with a note. It is a record only: no expense, and the balance is not changed. The owner settles it by correcting the entries.
- B: No cash counts in 2A-4.

Answer: A

**20. The daily report**
- **A (R):** On Dacs Web, **owner only**: one buyer, one Philippine day (or a date range). Opening, received, refunds in, each payment (supplier, items, project, receipt link), confirmed returns, closing (never below ₱0), plus pending returns, any unreconciled shortfall *(Q16)* and flags shown separately. **Print** and **CSV**. Days with nothing on them are skipped. On the phone the buyer sees their own balance and their own list, not the owner's report.
- B: Same, without CSV.

Answer: A

---

## E. Personal money — "Company owes buyer"

**21. How the owner allows personal money**
- **A (R):** A switch per buyer on Dacs Web: **"May use own money"**, main owner only, with history (who, when, on/off). While on, "Paid from: My own money" is offered on the phone. A personal-money payment made while it is off is **kept**, but flagged **"Not authorized — owner review"** (spec: never discard real evidence).
- B: The owner approves each personal-money payment after the fact. Until approved it reads "Waiting for approval" and is not owed.

Answer: A

**22. Repaying the buyer**
- **A (R):** The **main owner** records a repayment on Dacs Web (amount, date, method), partial or full. It lowers "Company owes buyer" only. It is not a supplier payment, an expense or petty cash. A mistake is **voided with a reason**, never deleted.
- B: As A, plus **"Settle from petty cash held"**: the buyer keeps that much of the petty cash they hold, which lowers both their cash held and what the company owes them, in one entry.

Answer: A

---

## F. Screens and who sees what

**23. On the phone**
- **A (R):** No new tab. **Record purchase** gets the "Paid now?" part. **My purchases** shows Unpaid / Partially paid / Paid / Overpaid with the balance left, and a **Record payment** button on the purchase. A **"My cash"** card at the top of My purchases shows petty cash held, returns awaiting confirmation and "company owes me", with **Report a return**.
- B: A fourth tab, **Cash**, for the card, the return and the buyer's own day list.

Answer: A

**24. Who sees which money**
- **A (R):** A **buyer** sees only **their own** cash, returns and "company owes me", plus payments on purchases in their buying scope. **Buyer staff never see another buyer's cash.** The **tracker, daily report, Overpaid list and repayments** are **main owner only** on Dacs Web. Workers, team leaders, clients and partners see none of it.
- B: As A, but owner/admin accounts with the Expenses section also see the tracker and daily report.

Answer: A

---

## After the answers

1. I write plan **2A-4a** (server + Dacs Web) from a tested scratch build, as for 2A-3a: new tables and server functions in one migration, tests that payments, petty cash and advances **never** reach Spent / Earned / Profit (money tests extended), browser checks with a ZZ test project.
2. You apply the migration and push the web; we check it live.
3. Then plan **2A-4b** (phone) and a pilot on the test phone, ahead of the real buyer's launch.
