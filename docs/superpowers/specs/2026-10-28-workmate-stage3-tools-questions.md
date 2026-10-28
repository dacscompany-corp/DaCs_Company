# WorkMate Stage 3 — Tools: questions

Date: 28 October 2026

Status: **Answered by the user, 28 October 2026: questions 1–2 A (3a web first, 3b phone later), then "I approve all R for the remaining Tools questions" — every question A.** Revision 2, 28 October 2026. Revision 2 follows the user's review of revision 1: (1) a tool at a project always has a **named responsible person** (questions 7, 8, 10); (2) a tool **waiting for Lost or Retired confirmation cannot be issued**, and what an owner's **rejection** does is spelled out (questions 16, 17); (3) a new question 14 — **one tool fills a request line once**, whether it was bought for it, issued for it, or both, and what returns, handovers and reversed issues do (corrected after review: a reversed issue reopens the line only when that issue counted on its own; a tool bought for the same request stays counted through its purchase); (4) the **Tools switch** goes on for the ZZ pilot and then stays on for launch or is switched off if the pilot fails (question 23). No code or database change yet; the Stage 3a plan follows.

Related: [WorkMate guide](2026-09-29-workmate-prototype-and-workflow-guide.md) §12 *Reusable tools* and §16 (Stage 3) · [Mobile Purchasing spec](2026-09-30-workmate-mobile-purchasing-design.md) (Q15) · [2B+2C questions](2026-10-24-workmate-stage2bc-questions.md) · [2B-b plan + pilot notes](../plans/2026-10-27-workmate-stage2b-b-phone.md)

**How to answer:** write a letter on each **Answer** line (e.g. `A`), or your own rule. *(R) = recommended, with the reason.* Writing "all R" is fine.

---

## Where we are

**Stage 2 is live** (WorkMate 0.9.0 published 28 Oct): purchases, payments, petty cash, stock and owner-approved cost moves.

What does **not** exist yet:
- **No tool register.** Nothing knows which drills, grinders or mixers the company owns, where each one is, or who has it.
- **Tools are only a kind of catalogue item.** A request line can be a tool, and it is bought like a material. Since 2B a tool bought for the warehouse would go into **stock as a quantity** ("3 drill") — never as three separate drills.
- **No custody**: no record of who received a tool, on which project, in what condition, or whether it came back.

**Live data today:** 1 tool catalogue item (a test item, "ZZ pilot drill"), 1 tool request line, 0 tools in stock. **2 teams** (4 members), **8 workers**, **2 team leaders**, 1 office staff.

**The crew is still on the old Attendance app.** Moving the workers to WorkMate (0E) waits until the current project ends. Until then, **workers and team leaders cannot use anything new on the phone** — which shapes question 2.

**Already decided (WorkMate guide §12, not asked again):**
- Each real tool is registered on its own with a number, like **TOOL-0001**. **Consumables** (drill bits, blades, sandpaper) stay **materials**, counted by quantity.
- A request may ask for a **tool model** ("grinder"); a **particular** tool is chosen only when one is available.
- A tool has **one responsible person at a time**. Their responsibility stays even if they change teams or their account is deactivated.
- A return stays linked to the original custody, **even if the project is completed or hidden**.
- **No automatic salary deduction** for a lost or damaged tool.
- Tool actions **need internet** (like stock).
- QR labels are **optional, later**.

**Deferred scope (not in Stage 3):**
- **Outside jobs.** The company does not give or lend materials **or tools** to outside jobs. Outside-job material release was deferred on 28 Oct; tool lending to outside jobs (Q15 of 12 Oct) is deferred with it.
- **Separate follow-ups, not part of this sheet:** turning on the Item history switch now that the app is published; letting office staff without the Buyer switch record stock on the phone.

---

## A. Scope, plans and the phone

**1. How to plan Stage 3**
- **A (R):** **Two plans.** **3a:** server + Dacs Web — the tool register, issuing, handovers, returns, condition, and the request link. **3b:** the phone — "My Tools" for workers, issue and return for team leaders. *Reason: the same rhythm as Stage 2; 3a is useful on its own (the office records everything), and 3b depends on the crew moving to WorkMate.*
- B: One plan covering web and phone together.

Answer: A

**2. When the phone part (3b) is built and launched**
- **A (R):** **3a now, launched on its own.** The office records every issue, handover and return on the web for the whole crew. **3b is built later, just before the crew moves to WorkMate (0E)**, and launched with it. *Reason: the crew cannot use a phone feature until they are on WorkMate; building it now means it sits unused while the app keeps changing around it.*
- B: Build 3a and 3b now; 3b goes out in the next app update but only buyer accounts see it until 0E.
- C: Wait and build all of Stage 3 together with 0E.

Answer: A

---

## B. What is a tool

**3. Which catalogue items are numbered tools**
- **A (R):** **Every catalogue item of kind "tool" is tracked as numbered tools** (TOOL-0001…). Cheap hand tools the office does not want to number (buckets, trowels, shovels) are set up as **materials** and counted by quantity, like today. *Reason: one clear rule; the office chooses per item when it creates the catalogue item (the kind is fixed once used).*
- B: A per-item switch "track each one" on tool items; tool items without it are counted by quantity.

Answer: A

**4. Tool numbers**
- **A (R):** **Automatic**, per company: TOOL-0001, TOOL-0002… never reused, even for a lost or retired tool. An optional **brand / model / serial** note for the office. *Reason: no typing mistakes or duplicate codes; the serial helps identify a stolen or returned tool.*
- B: The office types its own code (e.g. a label already painted on the tool).

Answer: A

**5. Money on the tool register**
- **A (R):** **No pesos on the tool register.** A tool's cost stays where its purchase put it today (a project's Spent, or company stock cost) — no value per tool, no depreciation, no charge to a project for using a tool. The owner can open the purchase a tool came from. *Reason: Stage 3 is about where tools are and who has them; it stays outside the money model, like 2B stock quantities.*
- B: Show the owner each tool's purchase price on the register (read from its purchase, never changing Spent).

Answer: A

**6. Tools already in stock as quantities**
- **A (R):** From Stage 3a, a **tool** catalogue item **cannot be quantity stock**: receiving, leftovers, issue, move, count and opening stock refuse it, and a tool bought for the warehouse waits as "**Tools to register**" instead. Today there are **0** tools in stock, so nothing has to be converted. *Reason: one path per thing — materials in stock, tools in the register — so a drill can never be counted twice.*
- B: Keep tools in quantity stock too, and register numbers on top.

Answer: A

---

## C. Getting tools into the register

**7. The opening register (tools the company already owns)**
- **A (R):** The office (owner, or staff allowed Expenses) registers each tool: catalogue item, **one photo**, condition, and **where it is now** — the warehouse, or **with a named responsible person on a project**. A tool registered at a project **cannot be saved without that person** (question 10). **No owner confirmation** (there is no money in it); every registration is in the tool's history with who did it. *Reason: the existing tools need to be entered quickly once; the owner can review the list at any time.*
- B: The main owner confirms each opening registration (as counts and opening stock in 2B).

Answer: A

**8. Newly bought tools**
- **A (R):** A purchase line matched to a **tool** item shows on Dacs Web as "**Tools to register: 3 grinder**". The office registers them — **one number each, linked to that purchase line** — when they arrive. Warehouse lines are registered at the warehouse; a project line's tools at the warehouse or **with a named responsible person on that project** — never at a project with no one responsible. A line can never register more tools than it bought. *Reason: the purchase stays the single record of the cost; the link answers "where did TOOL-0007 come from?".*
- B: Register tools by hand, with no link to the purchase.

Answer: A

**9. A tool bought for a project**
- **A (R):** It is registered like any tool and **belongs to the company**: when the project ends it goes back to the warehouse and can be issued to another project. **Its cost stays with the project that bought it** — no cost move. *Reason: tools outlive projects; moving the cost of a used tool would change old projects' Spent for no real benefit.*
- B: It stays the buying project's tool; using it on another project needs a cost move like 2C.

Answer: A

---

## D. Custody — who has a tool

**10. Where a tool can be**
- **A (R):** Always in **one** of these states: **Available** (in the warehouse), **Issued** (to one **named responsible person**, **on one project**), **Under repair**, **Lost — waiting for the owner**, **Lost**, **Retire — waiting for the owner**, or **Retired**. **A tool at a project always has a named responsible person**: there is no "at the site, no one responsible" state, and the server refuses an issue, handover or opening registration at a project without one. **Only an Available tool can be issued.** *Reason: one active custodian (§12); the project tells the office where to find it and the person who answers for it.*
- B: A tool at a project is held by a **team**, with that team's leader responsible by default.

Answer: A

**11. Who records an issue, handover or return**
- **A (R):** **On the web: the office** (owner, or staff allowed Expenses) for anyone. **On the phone (3b): a team leader, only for members of their own teams** (the server checks the team, not the role alone). Workers record nothing; they see their tools. *Reason: matches §12 and the request rules (a leader acts only for their team).*
- B: Office only, on the web and on the phone; team leaders only see.

Answer: A

**12. Does the worker accept a tool?**
- **A (R):** **No acceptance step at launch.** Whoever issues it records it (an optional photo of the tool as handed over); the worker sees it under **My Tools** (3b) and can **report a problem** ("I don't have this", "it's broken"), which the office sees. *Reason: workers are not on WorkMate yet; an acceptance step would leave every web issue "pending" with no one able to accept it.*
- B: The worker must accept on the phone before they become responsible (pending until then).

Answer: A

**13. Must an issue name a project and a request?**
- **A (R):** **A project is required** (a Project Control project or Additional Works job that is not completed). **A request line is optional:** if a tool request line is named, it shows "**Tool issued: TOOL-0007**" and that tool fills it (question 14). *Reason: the project says where the tool is; many tools go out without a request.*
- B: A request line is always required.

Answer: A

**14. One tool fills a request line once**

A tool request line (say "grinder × 2") can be filled two ways: **bought** for it (a purchase line linked to the request, as in Stage 2) and **issued** for it (a registered tool handed out against it). Today "Still to buy" counts purchases (and, since 2B, stock). With tools, the same grinder could be **bought for the line, registered, then issued for the line** — it must count **once**, not twice.
- **A (R):** A tool request line is filled by **tools, each counted once**: **Filled = tools bought for this line + tools issued for this line that were not bought for it** (from the warehouse, another project or another person). A tool registered from a purchase line bought for this request and then issued for it is **the same tool** — it counts once. The line never shows more filled than its quantity, and "Still to buy" never goes below zero. The shopping list says, per line, "**Bought 1 · Issued 1 (TOOL-0007)**".
  - **A return does not reopen the line.** The need was met; if the crew needs the tool again, that is a new request. (The same as stock: a return keeps "From stock", R95.)
  - **A handover does not reopen it.** The same tool is still out for the same job, now with another person.
  - **A reversed issue (a mistake) reopens the line only if that issue counted on its own** — that is, the tool was **not** bought for this line (it came from the warehouse, another project or another person). Then the line reopens by exactly that one tool.
  - **A tool bought for this same request stays counted through its purchase.** Reversing its issue only removes "Issued (TOOL-0007)"; the line stays filled by "Bought 1", and the tool is simply not handed out yet.
  - A **cancelled** request line, as today, stops asking for anything.
  - *Reason: one rule that cannot double count, and the request shows what was actually given out.*
- B: Only an **issue** fills a tool line; buying shows "bought, to register and issue" but never fills it (so a bought tool that is never issued keeps the line open).

Answer: A

**15. Handing a tool from one person to another**
- **A (R):** A **handover** moves the responsibility straight from one person to another (and, if needed, to another project) **without going back to the warehouse**. The office records any handover; a team leader records one only when **both** people are in their teams. *Reason: tools change hands on site all the time; forcing a trip back to the warehouse would make the records wrong.*
- B: Handovers only through the warehouse (return, then issue again).

Answer: A

---

## E. Returns and condition

**16. Condition on return**
- **A (R):** Every return records the condition — **Good**, **Needs repair**, **Damaged beyond repair**, or **Missing parts** — an optional photo and note. **Good** → Available. **Needs repair** or **Missing parts** → **Under repair** (cannot be issued) until the office marks it **Repaired**. **Damaged beyond repair** → **Retire — waiting for the owner**: the tool **cannot be issued or handed over** while it waits. The office can also ask to retire a tool that is Under repair.
  - **The owner confirms** → **Retired** for good (its number is never reused).
  - **The owner rejects** (with a reason) → the tool goes back to **Under repair**, never straight to Available: it was reported damaged, so the office repairs it (then Repaired → Available) or asks again. The office can **withdraw** its own request before the owner decides, with the same result.
  - *Reason: a damaged tool must not go out again by mistake; retiring a tool is a decision for the owner.*
- B: Only Good / Damaged; the office decides the rest by hand.

Answer: A

**17. A lost tool**
- **A (R):** The office reports it **Lost** with who had it and a note → **Lost — waiting for the owner**. While it waits the tool **cannot be issued, handed over or returned**; the person who had it stays recorded.
  - **The owner confirms** → **Lost**. The record keeps the responsible person (no salary deduction — already decided). If it turns up later, the office records **Found** with its condition: Good → Available, otherwise Under repair.
  - **The owner rejects** (with a reason, e.g. "it is at the other site") → the tool goes back **exactly where it was before the report** — issued to the same person on the same project, or Available / Under repair at the warehouse. The office can **withdraw** its own report before the owner decides, with the same result (e.g. the tool turned up the next day).
  - *Reason: losing a tool is serious enough for the owner to see; a rejected report changes nothing, and "found" keeps the history honest instead of deleting the loss.*
- B: The office marks it Lost; no owner confirmation.

Answer: A

**18. Mistakes**
- **A (R):** Records are **never edited**. A wrong issue, handover or return is **reversed with a reason** by whoever recorded it or an owner, and only if nothing came after it (as stock in 2B). *Reason: the same rule as stock; the history stays trustworthy.*
- B: The office can edit a record within the same day.

Answer: A

**19. Due dates and reminders**
- **A (R):** **No due dates at launch.** Dacs Web shows "**Tools out**" — each issued tool with its person, project and **how many days** they have had it, longest first. *Reason: tools stay out for the whole job; a due date would mostly be guessed.*
- B: An expected return date on each issue, with an "overdue" flag.

Answer: A

**20. Completing a project with tools still out**
- **A (R):** **Completing is not blocked**, but Project Control's completion shows "**3 tools are still out on this project**" with the list, and the tools stay in "Tools out" until returned or handed over. *Reason: completion is the only lock on money (2B/2C); it should not be held up by a tool, but the office must see what to collect.*
- B: A project cannot be completed while tools are out on it.

Answer: A

---

## F. Visibility, the phone and the pilot

**21. Who sees what**
- **A (R):** **Office (owner, staff allowed Expenses):** the whole register and history. **Team leader (3b):** the tools of their teams' members. **Worker (3b):** their own tools ("My Tools") and each one's history while they had it. **No pesos anywhere** (question 5). *Reason: people see what they are responsible for; the office sees everything.*
- B: Workers also see every Available tool (to ask for a particular one).

Answer: A

**22. Lost answers on the phone (3b)**
- **A (R):** The same rule as stock: every tool action is **saved with its operation id before it is sent**; after a lost answer it can be **sent again unchanged, checked, or cancelled** by the server — never sent twice, never sent by itself. *Reason: proven in the 2B-b pilot; one tool must never be issued twice.*
- B: No saved retry: after a lost answer the person checks Dacs Web or asks the office before trying again.

Answer: A

**23. A switch for launch**
- **A (R):** **A Tools switch, like stock**, set by the **main owner** only. It is **off** when 3a is deployed: the Tools screens show "not switched on" and every write is refused.
  - **For the ZZ pilot**, the main owner switches it **on temporarily** (typed, as stock).
  - **Pilot passes →** the ZZ rows are cleaned up and the switch **stays on: that is the launch.**
  - **Pilot fails →** the main owner **switches it off** (typed OFF, as stock's "Switch stock off…"); the ZZ rows are cleaned up; nothing real was recorded, and the fix is piloted again later.
  - Switching off **refuses new writes and undoes nothing**: every record stays in the history.
  - *Reason: the pilot runs on live data before anyone relies on it, with a tested way back — the same rhythm that worked for stock.*
- B: No switch; launch as soon as 3a is deployed.

Answer: A

**24. The pilot**
- **A (R):** A **ZZ pilot** on Dacs Web: register tools (opening and from a ZZ purchase), a project registration refused without a responsible person, issue, hand over, return in each condition, repair, lose and find, retire, the owner **rejecting** a Lost report and a Retire request (and the tool refused for issue while each waits), a tool request line **bought for and then issued for** (filled once; a return and a handover keep it filled; **reversing that issue keeps it filled through the purchase**), and a second tool request line filled by a **warehouse tool not bought for it** (reversing that issue **reopens** the line by one), reverse a mistake, complete a project with a tool out — then a guarded clean-up script (dry run first) that removes only ZZ rows, and the switch kept on or switched off (question 23). *Reason: the same safe rhythm as Stage 2.*
- B: Pilot on the first real tools instead of ZZ data.

Answer: A
