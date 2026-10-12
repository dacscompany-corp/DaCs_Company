# WorkMate Stage 1c (My Work / Meetings & Work Plan) — plan and open questions

Date: 12 October 2026

Status: **All 13 answered (12 October 2026) — design only.** Written into the Meetings & Work Plan spec; awaiting the user's spec review.

Spec: [Meetings & Work Plan](2026-09-30-workmate-meetings-work-plan-design.md) (feature approved for design on 30 September) · Build order agreed in [Stage 2 questions](2026-10-12-workmate-stage2-questions.md) Q21: **My Work (1c) → 2A → 2B + 2C**.

**How to answer:** fill in the **Answer** line — a letter is enough, or write your own rule. *(R) = recommended.*

---

## What already exists (checked 12 October)

| Piece | Today | Use for 1c |
|---|---|---|
| **Teams** | `pr_teams`, `pr_team_members` (1a, migration 0085): one team per request, leaders | Reuse for task teams and leader authority |
| **AI** | Cloudflare Worker `dacs-ai.dacsbuilding.workers.dev` running **Workers AI — Llama 3.1 8B** (powers "AI budget summary"). Note: its `SETUP.md` still says Groq — out of date | Candidate for meeting-note drafting (Q1) |
| **Push notifications** | **Browser only** — Web Push (VAPID) + Cloudflare cron worker (`cloudflare-worker-notify`), `push_subscriptions` (0011). **Nothing for the Android app** | Phone reminders would be new work (Q2) |
| **WorkMate app** | Flutter, Attendance + Requests + Item history (0.5.0, not published). Workers stay on the old app until the switch-over | My Work screens go here |

## Already decided in the spec

AI only drafts — **staff always review and publish**; manual drafting always works · each task has **one** PC project + Main Contract/AW job · **one responsible person** + helpers; **individual tasks** allowed · done → leader check (if any) → **admin/staff final approval**; a leader can't approve own work · while a blocker or unfinished earlier task remains, **Start work / Report done stay locked** · delivered materials don't clear blockers automatically · delays only **suggest** dates · **no pay or attendance penalties** · offline acknowledgements/blockers with **Pending sync**.

---

## Part 1 — The plan

### Design (now)
1. Answer Part 2.
2. Write the answers into the Meetings & Work Plan spec; you review it.

### Build

| Plan | What it delivers |
|---|---|
| **1c-1 Server** | Tables + RLS + RPCs: meetings, notes versions, tasks, assignments (responsible/helpers), acknowledgements, blockers, dependencies, progress/done/checks/approval, send-back. Acceptance SQL test. Migration = highest on disk + 1. |
| **1c-2 Dacs Web** | **Work Plan** section: meeting editor, AI/manual drafts, clarification list, recipient review, publish, task board, acknowledgement monitor, blockers, final approval. Follow the CLAUDE.md nav checklist (`PRIMARY_NAV`, `_FOCUS_SUBVIEWS`, view group, `_visibleNav()`, markup/script, RLS, ARCHITECTURE.md). |
| **1c-3 WorkMate app** | **My Work**: Today / Upcoming / Waiting, task detail, *I've read this*, report blocker (with photo), progress, Report done, shared meeting notes, changes highlighted, offline Pending sync. |
| **1c-4 Pilot** | The 10-step scenario in spec §12 + acceptance checks §13 on a test phone with test workers. |

---

## Part 2 — Questions

### A. Timing

**1. When does My Work reach workers?** Workers only get WorkMate at the switch-over (0E), which waits until the current project ends. Buyers (2A) can use WorkMate **before** that (Q19). So 1c helps nobody until the switch-over, while 2A could be used right away.
- **A (R):** Keep **1c first** (as agreed) but plan it to ship **with 0.5.0 at the switch-over**; start 2A right after, so buyers aren't waiting long.
- B: Swap: build **2A first** (buyers benefit now), then 1c in time for the switch-over.
- C: Bring the switch-over forward to release 0.5.0 + 1c sooner.

Answer: **A — approved (12 October).** Build 1c first; it ships with 0.5.0 at the worker switch-over. 2A starts right after 1c.

### B. AI drafting

**2. Which AI drafts tasks from meeting notes?** Notes are Tagalog/Taglish and contain names and site details.
- **A (R):** Reuse the **existing Cloudflare AI worker**, switched to the larger **Llama 3.3 70B** model for better Taglish. No new provider or account; the key stays on the server. Manual drafting always available.
- B: **Claude API** through a server endpoint — best Taglish understanding, paid per use; notes are sent to Anthropic (needs your OK).
- C: **No AI in 1c** — manual drafting only; add AI later.

Answer: **A — approved (12 October).** Reuse the existing Cloudflare AI worker, switched to **Llama 3.3 70B** for meeting drafts. Key stays on the server; manual drafting always available.

### C. Reminders

**3. Phone notifications for new tasks and reminders?**
- **A (R):** **No phone push in 1c.** My Work shows a count/badge and highlights new or changed tasks whenever the app opens; the office sees who hasn't acknowledged. Add push later.
- B: Add **Android push (Firebase Cloud Messaging)** in 1c — needs a Firebase project, device registration and a sending job; more setup and testing.

Answer: **A — approved (12 October).** No phone push in 1c. My Work shows a badge and highlights new/changed tasks when the app opens. Push later.

**4. If no push (Q3 = A): when does the office get alerted?**
- **A (R):** Dacs Web shows **Not acknowledged after 24 hours**, **Overdue**, and **Blocked** lists, grouped per project — no automatic messages.
- B: Same, plus a daily summary on the office's browser push (existing Web Push).

Answer: **A — approved (12 October).** Dacs Web lists: Not acknowledged after 24 hours, Overdue, Blocked — per project; no automatic messages.

### D. Task rules

**5. Task states — approve this list?**
**Draft → Not started → In progress → Reported done → Leader checked (if a leader) → Completed**, plus **Blocked** (shown while any blocker/earlier task is open), **Sent back** and **Cancelled**.
- **A (R):** Yes.
- B: Change it (write your list).

Answer: **A — approved (12 October).** Draft → Not started → In progress → Reported done → Leader checked (if a leader) → Completed, plus Blocked, Sent back, Cancelled.

**6. Staff reject a "done" report — what happens?**
- **A (R):** **Send back with a reason** → task returns to **In progress**, the leader's check is cleared, history keeps both reports, and any later task that had become ready goes back to waiting.
- B: Reopen as a new task linked to the old one.

Answer: **A — approved (12 October).** Send back with a reason → In progress; leader check cleared; history keeps both reports; dependent tasks return to waiting.

**7. Reopening a Completed task?**
- **A (R):** Only **admin/staff**, with a reason; same effect as Send back. Completion history stays.
- B: Not allowed — create a new task instead.

Answer: **A — approved (12 October).** Admin/staff may reopen a Completed task with a reason; same effect as Send back; completion history stays.

**8. Tasks without a meeting?**
- **A (R):** Staff may create a **standalone task** (same rules, no meeting notes).
- B: Tasks only come from published meetings.

Answer: **A — approved (12 October).** Staff may create standalone tasks (no meeting).

**9. "Earlier task must finish first" links (dependencies):**
- **A (R):** Only between tasks of the **same project**; the system refuses circular links.
- B: Allow links across projects.

Answer: **A — approved (12 October).** Dependencies only within the same project; circular links refused.

**10. Photos on blocker / progress reports?**
- **A (R):** Yes — optional photo, private storage (like request photos), seen by the responsible person, leader of that team, and office.
- B: Text only in 1c.

Answer: **A — approved (12 October).** Optional photo on blocker/progress reports, private storage; seen by the responsible person, that team's leader and the office.

### E. Access

**11. Where does it live in Dacs Web, and who can use it?**
- **A (R):** New top-level **Work Plan** section for **owner, admin and staff**. PM-only accounts (e.g. `admin-pm@`) don't get it unless granted in `allowed_modules`.
- B: Inside Project Control.
- C: Inside the Requests area.

Answer: **A — approved (12 October).** New top-level **Work Plan** section for owner/admin/staff; PM-only accounts only if granted in `allowed_modules`.

**12. Shared meeting notes — who sees them?**
- **A (R):** Only the **people staff select** when publishing (default: everyone assigned a task from that meeting). Never amounts or private details.
- B: Everyone on that project's teams.

Answer: **A — approved (12 October).** Shared notes go only to people staff select (default: everyone assigned a task from that meeting); never amounts or private details.

### F. Pilot

**13. Pilot workers and project?**
- **A (R):** Reuse the 1a/1b test workers (**W-0007, W-0019, W-0021**, Team test / Team pilot B) on **Barlin Residence**, with synthetic tasks.
- B: Name others.

Answer: **A — approved (12 October).** Test workers W-0007, W-0019, W-0021 (Team test / Team pilot B) on Barlin Residence, synthetic tasks.

---

## After the answers

1. Write the answers into the Meetings & Work Plan spec; you review it.
2. Implementation plans 1c-1 → 1c-4.
3. Before 2A coding: apply the two approved-for-drafting CLAUDE.md rules from the purchasing spec (*Other decisions*).
