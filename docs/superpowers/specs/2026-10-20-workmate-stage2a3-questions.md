# WorkMate Stage 2A-3 — Buying from the phone: questions before the plan

Date: 20 October 2026

Status: **Q1–Q22 answered 20 October 2026: all recommended (A). Q23 (added after those answers) answered 21 October 2026: A.** Implementation plan: [2A-3a](../plans/2026-10-20-workmate-stage2a3a-server-web.md) (server, sign-in, Dacs Web); [2A-3b](../plans/2026-10-21-workmate-stage2a3b-buyer-app.md) (the app, written 21 Oct).

Related: [Mobile Purchasing spec](2026-09-30-workmate-mobile-purchasing-design.md) · [Stage 2 questions (all answered 12 Oct)](2026-10-12-workmate-stage2-questions.md) · [2A-2 questions (answered 16 Oct)](2026-10-16-workmate-stage2a2-questions.md) · [2A-2 plan, as built + execution notes](../plans/2026-10-16-workmate-stage2a2-purchasing-office.md)

**How to answer:** write a letter on each **Answer** line (e.g. `A`), or your own rule. *(R) = recommended.* Writing "all R" is fine.

---

## Where we are

**2A-1 and 2A-2 are done and live (0096, 0097).** The server already:
- records a purchase once, funds it by month, and puts any shortage in Cover;
- has the Buyer switch, the shopping list, "I'll buy this" / assign / release, and links each line to the exact portion;
- covers a different unit or a substitute only after an office check;
- has the owner approval queue and the buyer-only `purchases/` receipt folder.

The server **already accepts phone purchases** (`source = 'workmate'`, Buyer switch required). **2A-3 is mostly the phone screens**, plus:
1. **Letting buyers sign in to WorkMate.** Today the sign-in (`attendance-signin`, shared with the old Attendance app) **refuses every account that is not a worker or team leader**.
2. Two Dacs Web fixes carried from today's clean-up incident (Q17, Q18).
3. Four questions parked during the 2A-2 build (Q13–Q16).

**Not in 2A-3:** supplier payments, deposits, Unpaid/Paid, Overpaid, petty cash, the daily report and "Company owes buyer" all stay in **2A-4**. Stock and cost moves are **2B + 2C**.

---

## A. Signing in and what a buyer sees

**1. How buyers sign in to WorkMate**
- **A (R):** The **same sign-in screen**. The sign-in function also lets in **Buyer staff, and admin/owner accounts allowed to buy** (the server's existing `pur_buyer()` rule), but **only when the request comes from WorkMate**. The **old Attendance app keeps refusing them** exactly as today. An account that is neither a worker nor a buyer gets "This account has no WorkMate access".
- B: A separate sign-in function just for buyers (the old app's function is never touched).

Answer: A

**2. What a buyer sees in the app**
Q16 (12 Oct) says Purchasing + Profile only, with no Attendance, because staff/admin/owner are never workers.
- **A (R):** Three tabs: **Shopping list · My purchases · Profile**. No Time In, no worker Requests, no My Work. If the **Buyer switch is turned off**, the next time the app talks to the server it shows "Buying is turned off for your account", hides the price screens and wipes the phone's saved copy of prices and receipts.
- B: Same tabs, plus a read-only Requests view (what workers asked for, by project).

Answer: A

**3. Owner approvals on the phone**
- **A (R):** **Not in 2A-3.** The main owner approves change requests on Dacs Web, as today. On the phone a buyer only sees "Waiting for the owner" on their own purchase.
- B: Add an owner Approvals screen to the phone.

Answer: A

---

## B. The shopping list on the phone

**4. What the list shows first**
- **A (R):** **This week's batch**, with **Mine** at the top, then **Unassigned**, then other buyers' portions (their name shown, read-only). **Urgent / needed-by** items are marked, **quantity changes** are flagged, and there is a **project filter**. Each line reads **Needed · Bought · Still to buy** with the unit and specification. Prices of earlier purchases are not shown on the list.
- B: Only Mine and Unassigned (other buyers' portions hidden).

Answer: A

**5. "I'll buy this" and Release on the phone**
The spec says claiming and releasing need internet.
- **A (R):** **Online only.** A buyer can claim an unassigned portion, **whole or part** (e.g. 4 of 10, which splits it as on the web), and **release** what they haven't bought. **Reassigning someone else's portion stays office-only** (Dacs Web), as decided in 2A-2 Q5.
- B: Whole portions only on the phone.

Answer: A

**6. Mark arranged on the phone**
Today only the office marks a portion arranged, but Buyer staff are office accounts and the buyer is usually the one who orders from the supplier.
- **A (R):** A buyer can **Mark arranged** on their **own** portions (optional note: supplier and expected date). It stays separate from claiming, as now.
- B: Office only (Dacs Web).

Answer: A

---

## C. Recording a purchase on the phone

**7. No signal at the supplier**
- **A (R):** The buyer can **record offline**. It is saved on the phone as **"Waiting to send"** (not yet counted anywhere) and sent automatically when back online, **once** (operation id). The server runs every check when it arrives. If it is refused (e.g. the request was reduced, or a portion was reassigned), it stays on the phone as **"Needs attention"** with the reason, and the buyer fixes it or discards the draft. A draft is never silently dropped. Claiming and releasing still need internet (Q5).
- B: Online only. The buyer waits for signal before recording.

Answer: A

**8. Receipt photo**
- **A (R):** **At least one receipt photo is required** on the phone (camera or gallery, several allowed). If the supplier gave no receipt, the buyer taps **"No receipt"** and must give a reason, and the purchase shows **"No receipt"** for the office. Photos go to the buyer-only `purchases/` folder, as on the web.
- B: Optional, like the web form.

Answer: A

**9. One receipt covering several projects**
- **A (R):** **Same as the web:** several lines, each for its own project/work or the warehouse; a delivery fee or discount is split by line amount (the buyer may adjust it); saving is refused unless lines + fees − discounts = the receipt total.
- B: One project per phone purchase; multi-project receipts are entered on Dacs Web.

Answer: A

**10. Substitutes and different units**
Parked from 2A-2: the substitute prompt exists only on the web.
- **A (R):** The phone asks the same thing: **"Is this the same item?"** If the buyer picks *different unit* or *substitute (an important spec differs)*, a **reason** is required, plus an **optional photo** of what was bought. The line covers the request **only after the office check**, exactly as on the web. A message to the requester (the spec's "confirm before buying") waits for a later stage.
- B: The phone allows only exact matches. Substitutes and different units are entered on Dacs Web.

Answer: A

**11. Extras, warehouse and unplanned purchases**
- **A (R):** **Same as the web:** buying more than Still to buy needs a reason and a location (same project or warehouse; the location never moves the cost). An **unplanned purchase** (no request) needs a reason and a project/work or the warehouse.
- B: Phone purchases must come from the shopping list (no unplanned purchases on the phone).

Answer: A

**12. "My purchases" — which purchases a buyer sees**
- **A (R):** Purchases **they bought or recorded** in the **last 60 days**, with totals, status (recorded / voided / waiting for the owner / needs office check) and receipts. Everyone else's purchases stay on Dacs Web.
- B: All the company's purchases in their buying scope.

Answer: A

---

## D. Corrections, voids and the four parked questions

**13. Correcting and voiding on the phone**
- **A (R):** On the phone a buyer can **correct their own purchase** within the same project on an open project: quantity, amount, supplier, date, photos. Anything that needs the owner (another project, a completed project) is **sent to the owner**, as on the web. **Voiding stays on Dacs Web.** A void can't be undone, and one wrong tap on a small screen is too easy (today's clean-up showed that).
- B: Full parity with the web, voids included.

Answer: A

**14. Parked: staff voiding a purchase linked to a request**
Today staff may void a request-linked purchase (the void puts the quantity back into Still to buy). They cannot *unlink* one.
- **A (R):** **Keep it.** Voiding is how a wrongly recorded purchase is undone, and Still to buy comes back automatically.
- B: Only the owner may void a purchase linked to a request.

Answer: A

**15. Parked: an approval compares the purchase as it was when the change was sent**
Today, if the purchase changes in any way after a change request is sent (a correction, unit check or receipt), the owner's approval is refused as **"stale"** and the sender must send it again.
- **A (R):** **Keep it.** The owner never approves something they didn't see.
- B: Let the owner approve anyway, after a warning showing what changed.

Answer: A

**16. Parked: staff without the Buyer switch can't see or withdraw a change they sent from Project Control**
- **A (R):** In Project Control, the purchase row shows **"Waiting for the owner"** to the person who sent it, with a **Withdraw** button. They still see **no prices** outside the data-entry exception.
- B: Leave it (only the owner and buyers see change requests).

Answer: A

---

## E. Dacs Web fixes from today's clean-up

**17. The Purchases list: show where each purchase came from**
Today the list mixes Project Control entries with Purchasing ones, with no way to tell them apart. That is how 4 real purchases got voided.
- **A (R):** Add a **Source** column (*Project Control* / *Purchasing* / *Phone*) and a **Project** column, plus a **project filter** and a **search box**. The Void dialog repeats the **project, supplier and amount** and asks the person to type the project's first word before it voids.
- B: Columns and filter only (no typing to confirm).

Answer: A

**18. "Record again" from a voided purchase**
- **A (R):** Yes. A voided purchase gets **"Record again"**, which opens the form **filled in** from it (lines, supplier, original date, photos). Nothing is saved until the person presses Save, and it records a **new** purchase; the voided one stays as history.
- B: No. Re-enter by hand.

Answer: A

**19. Additional Works job with no billing period** (left open in 2A-1: browser checks B9/B10)
Today the server refuses a purchase for an AW job without a period (`AW_NO_PERIOD`). The web avoids that by quietly creating one hidden period for the job first; the phone can't do that.
- **A (R):** Move that step onto the server: when a purchase (from any screen) is for an AW job with no period, the server creates its **one hidden AW period** the same way the web does today, then records it. Same money result as today, with no new rule.
- B: The phone shows only AW jobs that already have a period; the rest say "Open this job once in Project Control first".

Answer: A

---

## F. Version, pilot and release

**20. App version and pilot**
- **A (R):** **0.7.0+1007**, built on top of 0.6.0. First pilot on the test phone with a **test Buyer staff account** and a **ZZ test project** (every test row starts with ZZ, so clean-up can filter by it). Then **one real buyer** for one buying run. You pick that buyer when the build is ready (Stage 2 Q20).
- B: Real buyer from the first day.

Answer: A

**21. Publishing**
Workers are still on the old Attendance app, and WorkMate's newer builds (0.4.0–0.6.0) are only on the test phone. Stage 2 Q19 says buyers may use WorkMate before the worker switch-over.
- **A (R):** After the pilot passes, **publish 0.7.0 to the WorkMate stream**, so the real buyer can install it. Workers are unaffected: they don't have WorkMate, and the old app's stream doesn't change.
- B: Keep it on the test phone until the worker switch-over.

Answer: A

**22. Language on the buyer screens**
- **A (R):** **English, with the Tagalog line underneath** on the key labels and messages, as the worker screens already do (e.g. *Still to buy / Kulang pang bilhin*).
- B: English only (buyers are office staff).

Answer: A

---

## G. Added after the answers

**23. The Terms screen for buyers**
Today WorkMate shows every signed-in person the **Attendance Terms** (version `2026-09-v3`: time records, photos and location) and won't open until they accept. Buyers never use attendance.
- **A (R):** Buyers **skip the Attendance Terms**. They are office accounts and never take a Time In, a photo or a location, so those terms don't apply to them. If a buyer account ever also needed attendance, that is a separate decision.
- B: Buyers accept the same Attendance Terms as workers before the app opens.

Answer: **A** (21 October 2026)

---

## After the answers

1. I write the 2A-3 plan: the sign-in change, any small server migration (Q6, Q16, Q19), the phone screens, the two web fixes, tests, and the pilot checklist. Each answer goes in as written.
2. You review the plan. Then the build runs task by task with reviews, like 2A-1 and 2A-2.
3. Pilot on the test phone, then one real buyer.

---

## Answers (20 October 2026)

**Q1–Q22: all recommended (A).** Those were the questions on the sheet when "all R" was given.

**Q23 (added afterwards): A, answered 21 October 2026.** It was still pending on 20 Oct (the user corrected an earlier note that called it approved). Buyers skip the Attendance Terms; this goes into plan 2A-3b. Nothing in plan 2A-3a depends on it.

Checked while recording the answers:
- **Q21 is safe to publish.** In the live database only one account has ever used WorkMate (test worker W-0007, build 1006, last on 16 Oct). Publishing 0.7.0 reaches no real worker. The 1b-3 "publish-day" to-dos (deactivate the ZZ pilot items, switch Item history ON for the 10 sites) stay tied to the **worker switch-over**, not to this publish.
- **Q1 needs an app change as well as the sign-in change.** The app checks the role itself after sign-in (`eligibilityOf` in `lib/auth/worker_profile.dart`, used by `app_controller.dart`) and would sign a buyer out as "not a worker". The plan changes both.
- **Q8 needs a small database field** to store a "No receipt" reason, because the web form treats receipts as optional. It goes in the same migration as Q6/Q16/Q19.
