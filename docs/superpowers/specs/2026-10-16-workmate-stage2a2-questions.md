# WorkMate Stage 2A-2 — Purchasing tab and Buyer switch: questions before the plan

Date: 16 October 2026

Status: **Open — for the owner to answer.** Nothing here is built. The implementation plan is written after these answers.

Related: [Mobile Purchasing spec](2026-09-30-workmate-mobile-purchasing-design.md) · [Stage 2 questions (all answered 12 Oct)](2026-10-12-workmate-stage2-questions.md) · [2A-1 plan, as built](../plans/2026-10-14-workmate-stage2a1-purchase-recording.md)

**How to answer:** write a letter on each **Answer** line (e.g. `A`), or your own rule. *(R) = recommended.*

---

## Where we are

**2A-1 is done and live (15 Oct):** one server operation records every purchase. Expenses → Materials and Project Control already use it. Today a purchase is **not linked to any request**, and the supplier is **free text**.

**What 2A-2 adds (office side, Dacs Web):**

1. The **Buyer switch**: which staff may buy and see purchase prices.
2. A **Purchasing tab inside Requests**: the shopping list, who is buying what, *Mark arranged*, and **Needed · Bought · Still to buy**.
3. **Recording a purchase from that list.** One receipt can cover several request lines and projects, and the purchase updates **Bought** on each request.
4. A **supplier list**.
5. A **purchases list**: see, correct and void purchases.

The phone screens are **2A-3**. Payments, petty cash and the paid badge are **2A-4** (Q12).

---

## A. The Buyer switch

**1. Where does the owner turn the Buyer switch on?**
- **A (R):** On each **staff account** in the existing account screen: a **Buyer** on/off switch. Only the **main owner** can change it, and the server refuses everyone else.
- B: A separate "Buyers" list inside the Purchasing tab.

Answer:

**2. What does a staff member WITHOUT the Buyer switch see?**
- **A (R):** Requests exactly as today (arrange, quantities, catalogue), but **no Purchasing tab and no prices**. They can still enter material expenses in Project Control, as decided on 15 Oct.
- B: The Purchasing tab without prices (read-only shopping list).

Answer:

**3. Admin accounts with limited sections (e.g. `admin-pm@`, PM only)**
- **A (R):** **No purchasing**, as the spec says ("PM-only accounts are excluded"). Only the main owner, full admin accounts and Buyer staff can buy.
- B: Allow them if they also have the Expenses section.

Answer:

---

## B. Who is buying what (assignment)

**4. Assigning part of a quantity**
Request lines are already split into **portions per weekly batch** (e.g. 10 bags this week).
- **A (R):** The office can assign a **whole portion or part of it** to a buyer. Part of it, e.g. 4 of 10, splits off a new portion. Every assign and reassign is **recorded with who and when**. Buyers can also click **"I'll buy this"** on an unassigned portion.
- B: Whole portions only (simpler; to share 10 bags you'd edit quantities by hand).

Answer:

**5. Taking over another buyer's portion**
- **A (R):** The **office** can reassign at any time, recorded. A **buyer** cannot take another buyer's portion; they ask the office.
- B: Any buyer can take over, with a reason, recorded.

Answer:

**6. "Mark arranged" stays separate from "who is buying"** (spec: two different facts). Today the office already marks portions arranged.
- **A (R):** Keep it as it is today. Assigning a buyer **does not** mark it arranged, and releasing a buyer **does not** undo an arrangement.

Answer:

---

## C. Recording a purchase against requests

**7. Linking a purchase line to a request**
- **A (R):** Each purchase line can link to **one request line**, optional. **Bought** = the total quantity of that request's non-void purchase lines. **Still to buy** = Needed − From stock (0 until 2B) − Bought.
- B: Link to the exact portion (more precise, more clicks).

Answer:

**8. Buying MORE than Still to buy** (spec: allowed with a required reason)
- **A (R):** Allowed. A **reason** is required (pack size, spare, cheaper in bulk) and so is a **destination for the extra**: *same project* or *warehouse*. Until stock arrives in 2B, the extra is **flagged for the office only**. It never fills another request by itself.
- B: Allowed with a reason; the extra always stays on the same project.

Answer:

**9. A different unit than the request** (e.g. request in *pcs*, bought a *box*)
- **A (R):** Allowed, but it **does not count toward Bought** automatically. The line is flagged **"Different unit — office check"**, and the office sets how many request units it covers. Units are never converted automatically.
- B: Refuse it until the request is changed to the new unit.

Answer:

**10. Unplanned purchases** (no request)
- **A (R):** Allowed for Buyers with a **required reason** and a project/work or warehouse destination, as the spec says. It shows as **Unplanned** in the purchases list.

Answer:

**11. Suppliers**
- **A (R):** A simple **supplier list** (name, optional branch and contact). A buyer can add a new one while recording. Old free-text suppliers stay as text and are not converted.

Answer:

---

## D. What waits for later

**12. Payments, petty cash and the "Unpaid / Paid" badge**
The 12 Oct plan put the petty-cash tracker in 2A-2. Since then 2A was split into four steps.
- **A (R):** Keep them in **2A-4** (payments, deposits, Overpaid, petty cash, daily report, Company owes buyer, the Project Control badge). 2A-2 stays focused on buying and the shopping list.
- B: Move the petty-cash tracker back into 2A-2 (a much bigger 2A-2).

Answer:

**13. Correction approvals** (spec: a staff change of project/work, or any change on a completed project, needs the owner's approval)
- **A (R):** In 2A-2 these are simply **owner-only actions**: staff get "ask the owner", which is how 2A-1 works today. A request-and-approve queue comes later, if needed.
- B: Build the approval queue now (staff submit → owner approves in a list).

Answer:

**14. Receipt photos on a multi-project purchase** (Q17: office-only)
- **A (R):** One receipt is stored once in a new private **`purchases/`** storage folder. Only the owner, admin and **Buyer staff** can read it; clients and partners never can. The project's own expense rows stay as they are today.

Answer:

---

## After the answers

1. I write the 2A-2 implementation plan (server migration + Purchasing tab + tests), with every answer above built in.
2. You review the plan, then the build runs task by task with reviews, like 2A-1.
