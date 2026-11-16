# WorkMate Stage 2B + 2C — Stock and cost moves: questions before the plan

Date: 24 October 2026

Status: **Answered by the user, 24 October 2026: "I approve all R" — every question A (revision 2's recommended answers).** Revision 2 had tightened Q12, Q13, Q15, Q17, Q19–Q20 and Q24/Q27 after review. No plan, code or database change yet. 2B (stock) and 2C (owner-confirmed cost moves) stay **one launch scope** (Q28 of 12 Oct).

Related: [Mobile Purchasing spec](2026-09-30-workmate-mobile-purchasing-design.md) (sections *Warehouse cost assignment*, *Project-to-project material cost transfers*, §3.8) · [Stage 2 questions (answered 12 Oct)](2026-10-12-workmate-stage2-questions.md) (Q9, Q11–Q15, Q25, Q28) · [2A-4 questions](2026-10-22-workmate-stage2a4-questions.md) · [2A-4b plan + pilot notes](../plans/2026-10-23-workmate-stage2a4b-buyer-payments.md)

**How to answer:** write a letter on each **Answer** line (e.g. `A`), or your own rule. *(R) = recommended, with the reason.* Writing "all R" is fine.

---

## Where we are

**2A is live** (WorkMate 0.8.1 published 24 Oct). A purchase is recorded once; a **project** line goes into that project's **Spent** when recorded; a **warehouse** line writes **no** Spent anywhere — its cost is "company stock cost" waiting for 2C. Payments, petty cash and credits are outside Spent.

What does **not** exist yet:
- **No stock ledger.** Nothing knows how many bags are in the warehouse or left over at a site. The old `inventory` table (the "Add to inventory" tickbox) is **empty**; one old test link row points at nothing.
- **No receiving, issuing, returning or moving** of goods, and no "From stock" on the shopping list.
- **No cost moves**: nothing can take cost out of one project and put it into another, or move warehouse cost into a project.

**Live data today:** 0 warehouse purchase lines, 6 catalogue items, 11 recorded purchases (all project lines).

**Already decided on 12 Oct (not asked again):**
- **Warehouse → project (Q11):** staff records the physical issue; it shows **Cost assignment pending** until the **main owner** confirms. Only the issued portion becomes that project's **Material/Spent**; the rest stays company stock cost. No second purchase or supplier payment. Each issued portion is assigned **once**.
- **Project → project (Q12):** staff records the move; the cost stays with the source as **Cost transfer pending** until the **main owner** confirms. Then the source goes **down** and the destination **up** by the **same original purchase cost**, together and once. Total spending never changes.
- **Which months (Q25):** the source reduction comes off the **original rows and periods** that carried that cost; the destination is charged in the **month it actually received** the goods.
- **Outside jobs (Q13–Q14):** evidence only in Stage 2 (who, quantity, photo, date); money in Stage 4. Returns from outside jobs reduce the quantity still out, as a new record.
- **Stock must be a catalogue item (Q9).** An unlisted line can be bought, but must be matched to a catalogue item before it becomes stock.
- **Cost moves are their own records (spec §3.8):** never negative purchase rows, never an edit of the original purchase; read the same way by every place that shows Spent.
- **Leftovers stored in the warehouse keep their project's cost** until a confirmed project-to-project move — they do not become company stock.
- **Completed projects are the only lock** (`folders.completed_at`).
- **Only the main owner approves cost moves** (CLAUDE.md).

---

## A. Scope and plans

**1. How to plan and pilot one launch**
- **A (R):** Three plans, one launch. **2B-a:** server + Dacs Web for stock (locations, receiving, issuing, returns, moves, counts). **2C:** server + Dacs Web for cost moves (owner approvals, the money). **2B-b:** the phone. **One joint pilot** of all three on ZZ data, then launch together. *Reason: same rhythm as 2A; each plan stays reviewable; nothing reaches users half-done.*
- B: Two plans (2B and 2C), each with its own phone part.

Answer: A

---

## B. Where stock lives and what counts as stock

**2. Locations**
- **A (R):** **One company warehouse** plus **each Project Control project's site** as a place where leftovers can sit. *Reason: project-to-project moves (Q12) start from leftovers at a site; one warehouse matches today's business.*
- B: Warehouse only — site leftovers are not tracked.
- C: Several named warehouses from day one.

Answer: A

**3. Which purchases become tracked stock**
- **A (R):** **Warehouse purchases always.** **Project purchases are taken as used by that project** — they become tracked stock only when someone records **leftovers** (at the site, or brought to the warehouse), and their cost **stays with the project**. *Reason: nobody logs daily use on site; tracking only what is left over is realistic and keeps project Spent exactly as today.*
- B: Every project purchase line becomes site stock and must be marked used or left over.

Answer: A

**4. A warehouse purchase that is not yet a catalogue item**
- **A (R):** It can be recorded; it waits in a **"To match"** list in the office and **cannot be issued** until the office matches it to a catalogue item (or adds one). *Reason: the buyer should never be blocked at the counter (Q9), but untyped stock can't be counted reliably.*
- B: The buyer must pick a catalogue item before saving a warehouse line.

Answer: A

**5. Units**
- **A (R):** Stock is counted in the **catalogue item's unit**. A purchase in another unit (e.g. a box of 50 when the item is "piece") becomes stock only after an **office unit check** that says how many units it is — the same check purchases already use. *Reason: mixing units silently is the commonest stock error.*
- B: Any unit, no conversion.

Answer: A

---

## C. Receiving

**6. When a warehouse purchase becomes usable stock**
- **A (R):** When someone **confirms receipt** at the warehouse. Partial deliveries are received in parts; the rest shows **Awaiting delivery**. Anything never delivered is **closed by the office with a reason** — the quantity never silently disappears, and the money goes through the supplier refund/credit of 2A-4. *Reason: the spec says only confirmed usable quantity is stock.*
- B: It is stock as soon as the purchase is recorded.

Answer: A

**7. Who may confirm receipt**
- **A (R):** The **owner, office staff, and the buyer who bought it**. *Reason: covers deliveries to the warehouse and goods the buyer carries in, without a new role.*
- B: A named "warehouse keeper" switch, like the Buyer switch.
- C: Owner only.

Answer: A

---

## D. Issuing, partial use and returns

**8. Issuing from the warehouse to a project**
- **A (R):** An issue names the **project (Main Contract or Additional Works)**, the **quantity** and the **date received**; it can **fill a request line** ("From stock" lowers Still to buy) or be **unplanned with a reason**, like purchases. Several issues may come from one purchase (8 of 20 bags now, 5 next week). *Reason: same habits as purchasing; partial use is just several issues.*
- B: Issues are never linked to requests.

Answer: A

**9. "From stock" on the shopping list**
- **A (R):** **No reservations.** A request line counts stock as covered **only when it is actually issued**. The shopping list shows **"In warehouse: 12"** as a hint so the buyer checks before buying. *Reason: reservations go stale and block stock; issuing is the real event.*
- B: The office can **reserve** warehouse quantity for a request line before issuing.

Answer: A

**10. Unused issued stock returned to the warehouse**
- **A (R):** A return moves the quantity back. If the issue's cost was **already assigned** to the project, the return is a **cost move back to company stock** at the **same value**, confirmed by the main owner. If the cost was **not yet assigned**, the pending assignment simply shrinks. *Reason: cost must follow the goods both ways, once.*
- B: Returns move quantity only; cost stays with the project.

Answer: A

**11. Who records issues, returns, leftovers and moves**
- **A (R):** **Owner, office staff and Buyer staff** (web, and phone per question 26). Team leaders and workers **do not record** stock movements at launch. *Reason: keep the people who handle money and goods; widen later.*
- B: Also team leaders, for their own site.

Answer: A

---

## E. What a moved portion is worth

**12. The value of an issued or moved portion**
- **A (R):** The **exact purchase it came from** ("by lot"): that line's cost **including its share of delivery fees and discounts**, divided by its quantity, times the quantity moved. The **lot is fixed when the goods are moved** (oldest received first unless staff names the lot the goods actually came from) — the owner does **not** choose a different lot at approval; a wrong lot is fixed only by a **correcting record with evidence** (question 23). **Centavos:** each move is rounded to the centavo, and the **last portion of a lot takes whatever is left**, so all the portions of a line always add up to **exactly** its cost (₱100 for 3 pieces → ₱33.33 + ₱33.33 + ₱33.34). *Reason: matches "same original purchase cost" (Q12); every peso traces back to one receipt, which is what stops double counting — and no rounding leftover can appear or vanish.*
- B: The **average** cost of all stock of that item.
- C: The owner types a value each time.

Answer: A

**13. Stock that is already there on launch day (bought before 2B)**
- **A (R):** The office records an **opening count** per location (main owner confirms). **Where the goods can be traced** to a purchase already recorded in the system (e.g. leftovers of a 2A purchase), the count names that purchase line: the cost **stays with its original project**, and a later approved move reduces that project and raises the destination by the same amount, as any leftover. **Only goods whose cost cannot be traced** get **no value (₱0)**: their cost was counted somewhere in the past, so moving them moves **quantity only**. *Reason: traceable cost keeps following its goods; giving untraceable old stock a value would charge projects a second time for things already paid for.*
- B: Everything opening gets ₱0, traceable or not.
- C: The owner enters a value for opening warehouse stock; issuing it then charges projects.

Answer: A

---

## F. The money of a cost move (2C)

**14. Warehouse cost assigned to a project: which billing period**
- **A (R):** The receiving project's period for the **month it received the goods** (as Q25 for transfers), with the **same funding order** as purchases (earliest billing number with funds first) and the **same Cover rule** when the client's money for that month runs out. *Reason: one rule for every cost that enters a project.*
- B: The month the owner confirms.

Answer: A

**15. Taking cost out of a project whose original cost was split** (part client-funded, part Cover)
- **A (R):** Reduce each original row **in proportion** (a ₱200 move out of a ₱1,000 purchase reduces every original row by 20%), rounded to the centavo so the parts add up to **exactly** the moved amount (any leftover centavo goes to the largest row, the same way purchase fees are split today). *Reason: keeps client-funded vs Cover honest on both sides without picking favourites.*
- B: Take it out of the Cover part first.
- C: Take it out of the client-funded part first.

Answer: A

**16. Completed projects**
- **A (R):** A cost move **into or out of a completed project is refused** — reopen it first (the main owner can). The physical record of the goods can still be made. *Reason: completed is the only lock; a closed project's figures must not move silently.*
- B: Allowed with the main owner's approval anyway.

Answer: A

**17. Showing unassigned warehouse stock**
- **A (R):** A **"Company stock"** value on the owner's Purchasing screen, by item, in two parts: **In the warehouse**, and **Issued — cost assignment pending** (goods already with a project whose cost the owner has not yet confirmed — still company cost). **Never** in any project's Spent and **never** in company overhead (G&A). *Reason: the money exists and the owner should see all of it, including what has left the warehouse but is not yet anyone's cost.*
- B: Not shown in Stage 2.

Answer: A

---

## G. Owner approval

**18. Where the main owner approves**
- **A (R):** The existing **Owner approvals** tab, one card per move: item, quantity, from → to, value, which months on each side, and the evidence (photo, note). **Approve**, or **reject with a reason**. One at a time at launch. *Reason: one place for every owner decision; bulk approval can come once the pilot shows it is safe.*
- B: A separate Stock tab with bulk approve.

Answer: A

**19. When the main owner rejects a cost move**
- **A (R):** The **goods' movement stays recorded** (they really moved), but the **cost stays where it was**, marked **"Cost move rejected — kept with source"**. Staff can **resubmit the cost request against that same movement** (e.g. with the right lot or evidence) — **no new movement record**, so the goods are never counted as moving twice. A new movement is recorded only if goods **actually move again**. *Reason: a rejection is about money, not about whether bags moved.*
- B: Rejecting also undoes the physical movement.

Answer: A

**20. Approving only part of a move**
- **A (R):** **Whole or nothing.** To approve less, reject with a reason; staff **resubmits the cost request** for the same movement (question 19). If the **recorded quantity itself** was wrong, that is fixed with a reversing record first (question 23) — never by recording the goods moving again. *Reason: one record = one decision keeps the history readable, and the physical quantity is never doubled.*
- B: The owner may approve a smaller quantity.

Answer: A

---

## H. Corrections and voids

**21. Correcting a purchase line after some of it was issued or moved**
- **A (R):** Allowed only if it **doesn't touch moved stock**: quantity can't go below what was already received and moved, and a price change is refused while **approved** moves use that line — reverse those moves first (each reversal owner-confirmed). Moves still **pending** are re-valued automatically. *Reason: an approved move's value must never change behind the owner's back.*
- B: Any correction re-values approved moves automatically.

Answer: A

**22. Voiding a purchase whose stock was issued or moved**
- **A (R):** **Refused** until those movements are reversed. *Reason: otherwise the receiving project keeps cost from a purchase that no longer counts — Spent twice in one direction, or cost from nowhere.*
- B: Void anyway; the moves stay.

Answer: A

**23. A mistaken issue, return or move**
- **A (R):** **Never edited.** A **reversing record** undoes it (owner-confirmed when cost had moved), then the right one is recorded. *Reason: same as purchases and payments — history is never rewritten.*
- B: Office may edit quantity/date directly.

Answer: A

---

## I. Never in Spent twice

**24. The rule, and how it is checked**
- **A (R):** Every peso of a purchase line sits in **exactly one** of four places at a time: **its project's Spent**, **company stock** (in the warehouse or issued with assignment pending), **a receiving project's Spent**, or **company stock loss** (question 27). The server **refuses** any move whose value or quantity would exceed what is still in its place, every retry is recorded **once** (operation ids, as in 2A), and the money tests check every Spent site with cost moves included. *Reason: this is the rule the whole stage rests on; making the database refuse is safer than hoping screens get it right.*
- B: Checked by reports only.

Answer: A

**25. How moves show in Project Control and reports**
- **A (R):** Moved cost shows as its **own labelled rows** under Materials — **"From warehouse"**, **"Moved to Project B"**, **"Moved from Project A"** — so the list always adds up to Spent; prints and CSV show them the same way. **Client billing is not changed automatically**: if a client should be charged or credited for moved goods, the office adjusts the bill by hand. *Reason: totals that don't match their rows cause doubt; billing is a separate agreement with each client.*
- B: Only the totals change; no extra rows.

Answer: A

---

## J. Phone, counts and visibility

**26. What the phone does in 2B**
- **A (R):** For **Buyer staff and office staff**: confirm receipt, issue to a project, record leftovers and returns, record moves between projects — **online only** (no offline queue for stock). Workers and team leaders see **"From stock"** on their requests only. *Reason: stock actions need live quantities so two people can't issue the same bags; purchases stay offline-capable as today.*
- B: Web only at launch; the phone later.

Answer: A

**27. Stock counts, losses and damage**
- **A (R):** Office records a **count**; any difference is an **adjustment** the main owner confirms, with a reason (lost, damaged, expired, miscounted). A **warehouse** loss's cost moves to **company stock loss** — the fourth place in question 24 (not any project's Spent, not G&A); a loss of **project leftovers** stays with that project (it was already Spent). *Reason: losses are real but must not land on an unrelated project, and the lost peso still has exactly one place.*
- B: No counts in Stage 2.

Answer: A

**28. Who sees stock values (₱)**
- **A (R):** **Owner/admin owner** see values and cost moves. **Staff** see quantities; **Buyer staff** keep seeing purchase prices in their scope (existing rule) but **not** company stock value or cost moves. **Workers and team leaders** see quantities on their requests only. *Reason: follows CLAUDE.md — cost moves are main-owner money.*
- B: Buyer staff also see stock values.

Answer: A

---

## K. Old data and the pilot

**29. The old "Add to inventory" tickbox**
- **A (R):** **Remove** it when 2B launches; keep the empty old `inventory` table read-only until a later clean-up. *Reason: the spec says there must be one stock path; the table has no rows to migrate.*
- B: Keep the tickbox, writing to the new stock instead.

Answer: A

**30. The pilot**
- **A (R):** One joint pilot on the test phone and the web with a **ZZ warehouse lot** and **two ZZ projects** — receive, issue part, return, leftovers, move A → B, approve and reject, correct, void refused, count — then a **guarded clean-up**. Launch only after it passes. *Reason: the same discipline that caught F1–F3 in 2A-4b.*
- B: Pilot on real stock.

Answer: A

---

*Next after the answers: the 2B-a, 2C and 2B-b plans (or as answered in question 1), each built and tested in scratch before review, like 2A.*
