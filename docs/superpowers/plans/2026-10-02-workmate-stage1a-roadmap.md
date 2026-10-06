# WorkMate Stage 1a — Requests pilot roadmap

**Goal:** workers and team leaders request materials and tools from DAC'S WorkMate; admin/staff process them in Dacs Web. Spec: `docs/superpowers/specs/2026-09-29-unified-worker-app-design.md` §4A, §4B (1a parts), §4E, §6 row 1a, §9.

Stage 1a is four plans, built in order. Each one works and is verified before the next starts.

| Plan | Builds | Depends on |
|---|---|---|
| **1a-1. Server** (done 2026-10-02, 0085 live) | Migration 0085: teams, item catalogue, *Allow requests*, weekly batches (Saturday 12:00 noon Manila cutoff), requests with stable line identities, quantity portions by batch, per-line urgency, change history and conflicts, retry-safe RPCs, private `request-photos` bucket; legacy `requests`/`request_items` locked to own-read-only for workers | Stage 0 done |
| **1a-2. Dacs Web admin** (built 2026-10-05, 0086 live; plan `2026-10-05-workmate-stage1a2-requests-office.md`) | Request queue (urgent first, by batch), line detail with history, unlisted-item matching to the catalogue, batch date changes, *Mark arranged*, conflict resolution, pending-reduction handling, Teams setup, Catalogue, *Allow requests* toggle per Project Control project | 1a-1 applied live |
| **1a-3. WorkMate Requests** (built 2026-10-06, 0.4.0+1004, phone-verified; plan `2026-10-05-workmate-stage1a3-requests-app.md`) | Requests tab: New Request (project → Main Contract / Additional Works → team → items), private photos, offline drafts and a send-once queue, quantity edits and cancels, status / expected-delivery tracking, conflicts shown as *Needs resolution*, Home "request updates" | 1a-1 applied live (1a-2 for real end-to-end) |
| **1a-4. Pilot** | End-to-end checklist on the phone + Dacs Web, permission checks with two workers and a leader, the spec §9 acceptance rows for 1a | 1a-1 – 1a-3 |

## Decisions carried into every 1a plan

| Topic | Decision | Source |
|---|---|---|
| Weekly cutoff | **Saturday 12:00 noon, Asia/Manila**, by the server's received time; purchasing Monday, delivery Wednesday by default; admin/staff may change a batch's dates | User, 2026-10-02 |
| Notifications | **Inside the apps only** — WorkMate Requests tab + Home; urgent items on top of the Dacs Web queue. No push service in 1a | User, 2026-10-02 |
| Who uses it first | Workers stay on the old DACS Attendance app until the current project ends; 1a is piloted by the office and the test account (W-0007) | User, 2026-10-02 |
| Scope | Project Control only (folders). PM is never a destination | Spec §1, §3 |
| Money | 1a stores **no prices, amounts or costs** at all | Spec §2 |
| Tables | New `pr_*` tables; legacy `requests`/`request_items` (2 requests, 3 items, last March 2026) become read-only history | Spec §10 |
| Live supplier search (§A1) | **Not in 1a** — its external access is unverified; manual entry is the 1a flow | Spec §A1 |
| Tool tracking | Tools can be requested; asset tracking is Stage 3 | Spec §6 |
| Additional Works | A child folder (`folders.parent_folder_id`) under the Project Control project; its own `completed_at` | Live schema |
