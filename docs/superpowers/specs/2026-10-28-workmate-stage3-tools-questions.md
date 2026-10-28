# WorkMate Stage 3 — Tools: questions

Date: 28 October 2026

Status: **Revision 1, for the user's answers.** No plan, code or database change yet.

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

Answer:

**2. When the phone part (3b) is built and launched**
- **A (R):** **3a now, launched on its own.** The office records every issue, handover and return on the web for the whole crew. **3b is built later, just before the crew moves to WorkMate (0E)**, and launched with it. *Reason: the crew cannot use a phone feature until they are on WorkMate; building it now means it sits unused while the app keeps changing around it.*
- B: Build 3a and 3b now; 3b goes out in the next app update but only buyer accounts see it until 0E.
- C: Wait and build all of Stage 3 together with 0E.

Answer:

---

## B. What is a tool

**3. Which catalogue items are numbered tools**
- **A (R):** **Every catalogue item of kind "tool" is tracked as numbered tools** (TOOL-0001…). Cheap hand tools the office does not want to number (buckets, trowels, shovels) are set up as **materials** and counted by quantity, like today. *Reason: one clear rule; the office chooses per item when it creates the catalogue item (the kind is fixed once used).*
- B: A per-item switch "track each one" on tool items; tool items without it are counted by quantity.

Answer:

**4. Tool numbers**
- **A (R):** **Automatic**, per company: TOOL-0001, TOOL-0002… never reused, even for a lost or retired tool. An optional **brand / model / serial** note for the office. *Reason: no typing mistakes or duplicate codes; the serial helps identify a stolen or returned tool.*
- B: The office types its own code (e.g. a label already painted on the tool).

Answer:

**5. Money on the tool register**
- **A (R):** **No pesos on the tool register.** A tool's cost stays where its purchase put it today (a project's Spent, or company stock cost) — no value per tool, no depreciation, no charge to a project for using a tool. The owner can open the purchase a tool came from. *Reason: Stage 3 is about where tools are and who has them; it stays outside the money model, like 2B stock quantities.*
- B: Show the owner each tool's purchase price on the register (read from its purchase, never changing Spent).

Answer:

**6. Tools already in stock as quantities**
- **A (R):** From Stage 3a, a **tool** catalogue item **cannot be quantity stock**: receiving, leftovers, issue, move, count and opening stock refuse it, and a tool bought for the warehouse waits as "**Tools to register**" instead. Today there are **0** tools in stock, so nothing has to be converted. *Reason: one path per thing — materials in stock, tools in the register — so a drill can never be counted twice.*
- B: Keep tools in quantity stock too, and register numbers on top.

Answer:

---

## C. Getting tools into the register

**7. The opening register (tools the company already owns)**
- **A (R):** The office (owner, or staff allowed Expenses) registers each tool: catalogue item, **one photo**, condition, and **where it is now** — the warehouse, or **with a named person on a project**. **No owner confirmation** (there is no money in it); every registration is in the tool's history with who did it. *Reason: the existing tools need to be entered quickly once; the owner can review the list at any time.*
- B: The main owner confirms each opening registration (as counts and opening stock in 2B).

Answer:

**8. Newly bought tools**
- **A (R):** A purchase line matched to a **tool** item shows on Dacs Web as "**Tools to register: 3 grinder**". The office registers them — **one number each, linked to that purchase line** — when they arrive. Warehouse lines are registered at the warehouse; project lines with the person or at the project. A line can never register more tools than it bought. *Reason: the purchase stays the single record of the cost; the link answers "where did TOOL-0007 come from?".*
- B: Register tools by hand, with no link to the purchase.

Answer:

**9. A tool bought for a project**
- **A (R):** It is registered like any tool and **belongs to the company**: when the project ends it goes back to the warehouse and can be issued to another project. **Its cost stays with the project that bought it** — no cost move. *Reason: tools outlive projects; moving the cost of a used tool would change old projects' Spent for no real benefit.*
- B: It stays the buying project's tool; using it on another project needs a cost move like 2C.

Answer:

---

## D. Custody — who has a tool

**10. Where a tool can be**
- **A (R):** Always in **one** of these states: **Available** (in the warehouse), **Issued** (to one responsible person, **on one project**), **Under repair**, **Lost**, or **Retired**. Only an Available tool can be issued. *Reason: one active custodian (§12), and the project tells the office where to find it.*
- B: Also "**At a site, no one responsible**" (left on site between workers).

Answer:

**11. Who records an issue, handover or return**
- **A (R):** **On the web: the office** (owner, or staff allowed Expenses) for anyone. **On the phone (3b): a team leader, only for members of their own teams** (the server checks the team, not the role alone). Workers record nothing; they see their tools. *Reason: matches §12 and the request rules (a leader acts only for their team).*
- B: Office only, on the web and on the phone; team leaders only see.

Answer:

**12. Does the worker accept a tool?**
- **A (R):** **No acceptance step at launch.** Whoever issues it records it (an optional photo of the tool as handed over); the worker sees it under **My Tools** (3b) and can **report a problem** ("I don't have this", "it's broken"), which the office sees. *Reason: workers are not on WorkMate yet; an acceptance step would leave every web issue "pending" with no one able to accept it.*
- B: The worker must accept on the phone before they become responsible (pending until then).

Answer:

**13. Must an issue name a project and a request?**
- **A (R):** **A project is required** (a Project Control project or Additional Works job that is not completed). **A request line is optional:** if a tool request line is named, it shows "**Tool issued: TOOL-0007**" and counts as filled. *Reason: the project says where the tool is; many tools go out without a request.*
- B: A request line is always required.

Answer:

**14. Handing a tool from one person to another**
- **A (R):** A **handover** moves the responsibility straight from one person to another (and, if needed, to another project) **without going back to the warehouse**. The office records any handover; a team leader records one only when **both** people are in their teams. *Reason: tools change hands on site all the time; forcing a trip back to the warehouse would make the records wrong.*
- B: Handovers only through the warehouse (return, then issue again).

Answer:

---

## E. Returns and condition

**15. Condition on return**
- **A (R):** Every return records the condition — **Good**, **Needs repair**, **Damaged beyond repair**, or **Missing parts** — an optional photo and note. **Good** → Available. **Needs repair** or **Missing parts** → **Under repair** (cannot be issued) until the office marks it **Repaired**. **Damaged beyond repair** → waits for the **main owner** to confirm **Retired**. *Reason: a damaged tool must not go out again by mistake; retiring a tool is a decision for the owner.*
- B: Only Good / Damaged; the office decides the rest by hand.

Answer:

**16. A lost tool**
- **A (R):** The office reports it **Lost** with who had it and a note; the **main owner confirms**. The record keeps the responsible person (no salary deduction — already decided). If it turns up later, the office records **Found**, and it comes back as Available (or Under repair). *Reason: losing a tool is serious enough for the owner to see; "found" keeps the history honest instead of deleting the loss.*
- B: The office marks it Lost; no owner confirmation.

Answer:

**17. Mistakes**
- **A (R):** Records are **never edited**. A wrong issue, handover or return is **reversed with a reason** by whoever recorded it or an owner, and only if nothing came after it (as stock in 2B). *Reason: the same rule as stock; the history stays trustworthy.*
- B: The office can edit a record within the same day.

Answer:

**18. Due dates and reminders**
- **A (R):** **No due dates at launch.** Dacs Web shows "**Tools out**" — each issued tool with its person, project and **how many days** they have had it, longest first. *Reason: tools stay out for the whole job; a due date would mostly be guessed.*
- B: An expected return date on each issue, with an "overdue" flag.

Answer:

**19. Completing a project with tools still out**
- **A (R):** **Completing is not blocked**, but Project Control's completion shows "**3 tools are still out on this project**" with the list, and the tools stay in "Tools out" until returned or handed over. *Reason: completion is the only lock on money (2B/2C); it should not be held up by a tool, but the office must see what to collect.*
- B: A project cannot be completed while tools are out on it.

Answer:

---

## F. Visibility, the phone and the pilot

**20. Who sees what**
- **A (R):** **Office (owner, staff allowed Expenses):** the whole register and history. **Team leader (3b):** the tools of their teams' members. **Worker (3b):** their own tools ("My Tools") and each one's history while they had it. **No pesos anywhere** (question 5). *Reason: people see what they are responsible for; the office sees everything.*
- B: Workers also see every Available tool (to ask for a particular one).

Answer:

**21. Lost answers on the phone (3b)**
- **A (R):** The same rule as stock: every tool action is **saved with its operation id before it is sent**; after a lost answer it can be **sent again unchanged, checked, or cancelled** by the server — never sent twice, never sent by itself. *Reason: proven in the 2B-b pilot; one tool must never be issued twice.*
- B: No saved retry: after a lost answer the person checks Dacs Web or asks the office before trying again.

Answer:

**22. A switch for launch**
- **A (R):** **A tools switch** like stock: the main owner switches tools on after the ZZ pilot passes; until then the Tools screens show "not switched on" and every write is refused. *Reason: the pilot runs on live data before anyone uses it, and there is a way back if it fails.*
- B: No switch; launch as soon as 3a is deployed.

Answer:

**23. The pilot**
- **A (R):** A **ZZ pilot** on Dacs Web: register tools (opening and from a ZZ purchase), issue, hand over, return in each condition, repair, lose and find, retire, reverse a mistake, complete a project with a tool out — then a guarded clean-up script (dry run first) that removes only ZZ rows. *Reason: the same safe rhythm as Stage 2.*
- B: Pilot on the first real tools instead of ZZ data.

Answer:
