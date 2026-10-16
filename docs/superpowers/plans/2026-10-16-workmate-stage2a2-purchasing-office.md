# WorkMate Stage 2A-2 — Purchasing tab and Buyer switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office can buy against requests: the main owner turns on a per-staff **Buyer** switch; buyers see a **shopping list** inside Requests (Needed · Bought · Still to buy per weekly-batch portion, who is buying each), claim or assign portions, and **record one receipt** across lines and projects that covers its exact request portions — with extras, different units, Unplanned purchases, a supplier list, buyer-only receipt photos and an **owner-approval queue** for staff changes only the owner may make.

**Architecture:** One migration, `0097_purchasing_office.sql`, extends 2A-1's single recording operation (0096) instead of adding a second one. Bought is **never a counter**: `purchase_line_covers` is rebuilt from the stored purchase lines by `pur_cover_lines` inside every record / correct / replace / void / unit check — the same transaction that writes the expense rows — and only recorded purchases count. **Picked portions are authoritative, and a line's earlier covers are its history**: a later change covers the same portions again and looks elsewhere only for quantity it adds. Linking a request needs the Buyer switch whatever the source; purchase rows are readable by buyers only. Dacs Web gets a **Requests → Purchasing** tab (four new `js/purchasing-admin-*.js` files) shown only to accounts the server lets buy (an account focused on Expenses gets it alone); the Buyer switch sits on staff rows in Users → Navigator; Project Control's edit / void offers staff "Send to the owner" for owner-only changes, and reads the purchase behind a row through `pur_entry_row`.

**Revision 2 (16 Oct 2026)** answers the review of revision 1 — five findings and three rulings. See **Review response** below; every fix has a regression test that fails on revision 1.

**Tech Stack:** PostgreSQL / Supabase (plpgsql, RLS, Storage policies), vanilla JS (no build step), Node test scripts (zero-dependency `npm test`; `npm run test:sql` = PGlite + embedded-postgres in `supabase/tests` only).

**Spec:** `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md` (Buyer assignment, Partial buying, One receipt across projects, Office side). Answers: `docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md` (Q1–Q14 + six rules, 16 Oct 2026). Base: 2A-1 as built — `docs/superpowers/plans/2026-10-14-workmate-stage2a1-purchase-recording.md`.

## Review response (revision 2, 16 Oct 2026)

The review of revision 1 ran its 27 database tests (all passed) and four more checks that exposed gaps. Each is fixed below; each fix has a regression test that **fails on revision 1 and passes now** (see *Execution evidence*).

| # | Finding | Fix | Where | Regression tests |
|---|---|---|---|---|
| 1 | The Buyer switch could be bypassed: a non-buyer sending `source: 'expenses_form'` recorded a request-linked purchase, claimed the portion and raised Bought. | A request link or portion picks that the line's history does not already have are a **buying decision**: `pur_cover_lines` refuses them (`BUYER_REQUIRED`) unless the caller may buy, **whatever the source**. Only someone who may buy hands an unassigned portion to the purchase's buyer, and only if that buyer may buy. A change request cannot smuggle a new link to the owner either (`pur_links_changed`). Ordinary Expenses entry, and Project Control's price fix of a linked purchase (link kept, not new), are unchanged. | `pur_cover_lines`, `pur_links_changed`, `pur_request_change` | 2a2 *review 1* (two tests: any source; a correction that adds quantity); static *review 1*; acceptance R1; mutations 1–3 |
| 2 | Exact weekly portions were not preserved: picking 4 from one week and buying 6 covered 2 from another week; a price-only correction moved coverage between weeks. | **Picked portions are authoritative**: a picked line covers only its picks (each at most its pick and its Still to buy); the rest is extra and needs a reason. A line's earlier covers are its **history** (`pur_cover_history`, taken before any correction, replacement or unit check): they are covered again first, in their old order, and other portions are covered only for quantity the change ADDS. The web form gains an optional per-line weekly-portion picker; its preview follows the same rule. | `pur_cover_history`, `pur_cover_lines`, `pur_correct`, `pur_replace`, `pur_insert`, `pur_check_unit`; `purchasing-admin-core.js` (`pickedStill`, `lineStill`), `-record.js` | 2a2 *review 2* (two tests: picks; price fix + unit check on another line + replacement + an added 2); static *review 2*; web *review 2*; acceptance R2; mutations 4–6 |
| 3 | Owner approvals were not fully reviewable (no quantities, units, dates, supplier changes or fee splits), and a unit check after submission did not make the request stale. | The request stores the purchase **exactly as the requester saw it** (`base_doc` = `pur_doc`). Approval applies only while `pur_doc` still equals it — any correction, unit check or receipt change makes it `stale`; a unit check also bumps `updated_at`. `pur_change_requests` returns `base`, `current` and `proposed` through `pur_review_doc` (every header field, line, pick, receipt and fee split — the automatic split when none is given) plus `changed_since`. The approval screen lists **every field**, as asked vs asked for, marks the changed ones, and disables Approve once the purchase has changed. | `purchase_change_requests.base_doc`, `pur_request_change`, `pur_decide_change`, `pur_check_unit`, `pur_review_doc`, `pur_change_requests`; `changeRows` in core, `-purchases.js` | 2a2 *review 3*; static *review 3*; web *review 3* (two tests); acceptance R3a–R3d; mutation 7 |
| 4 | Expenses-only accounts could not reach Purchasing although the server let them buy (contradicting Q3 = B). | An account whose module focus lacks Requests but which the server lets buy (`pur_me().can_buy`) gets a **Requests tab holding Purchasing alone** (and one purchase): `_purchasingOnly()` feeds `_visibleNav` and the view guard (`focusAllowedViews`); the tab lands on the visible section's default view. | `js/admin.js` | web *review 4* (runs the real `_visibleNav` / `focusAllowedViews`) |
| 5 | Replacing a receipt silently kept the old photo (the stored URL suppressed the upload); form redraws dropped unsaved photo choices. | Chosen photos live in the form state (`st.files`); each upload remembers which file it was (`st.uploaded`); Save uploads every choice not yet uploaded **as that file** (`docUploads`), so a replacement always goes up. A redraw shows each choice again with **Remove**; a correction shows "On file — choose a photo to replace it". | `-record.js`, `docUploads` in core | web *review 5* |
| R3 | Do not approve unrestricted purchase-record reads just for an Edit form. | **Revised:** `pur_reader()` is now `pur_buyer()` — purchase rows (purchases, lines, charges, shares, history, covers, change requests) are read by buyers only. Project Control's approved staff entry reads exactly what it needs through `pur_entry_row(line, charge)` (the one line, its purchase header, line and charge counts — no other line, cover, request, buyer or history) and `pur_review_lines()` (ids only). `expenses-module.js` no longer reads any purchase table. The 2A-1 acceptance script, which reads purchase rows as staff to check itself, gives its staff account the Buyer switch inside its rolled-back transaction. | `pur_reader`, `pur_entry_row`, `pur_review_lines`; `expenses-module.js`; `2a1_acceptance.sql`; `2a1_purchase.pglite.mjs` | 2a2 *R3*; static *R3*; web *R3*; 2A-1 suite `--with-0097`; acceptance R4a–R4b; mutation 8 |
| R13 | Existing signed links do not stop at once; specify the real window or change delivery. | **Delivery changed:** Dacs Web never gives a `purchases/` receipt a signed link. `dacsSignedUrl` downloads it with the viewer's own session (Storage checks `uploads_can_read` — the Buyer rule — on **every** download) and shows a `blob:` copy that exists only in that page or the tab it opened; never cached. **Real revocation window:** turning the switch off stops every new view immediately; a photo already on someone's screen stays visible until that page or tab is closed or reloaded; there is no link to copy or reuse. (Other receipt folders keep their one-hour signed links, unchanged.) | `js/supabase-config.js` §11b, `-purchases.js` | web *R13* |
| R14 | Specification-changing substitutes need confirmation or explicit exception handling in the web workflow. | **Explicit exception handling in the web:** a request-linked line whose name differs from the request must say "Same item, other words" or **"Substitute — an important specification differs"**. A substitute needs a reason (what changed, who agreed — `SUBSTITUTE_REASON_REQUIRED`), keeps the actual item beside the request's original, and covers **nothing until an audited office check** by the owner or another buyer (the same check as a different unit; history `unit_checked`). A check is kept only for the same request, item, unit, quantity and substitute mark. The requester / team-leader confirmation flow stays with the phone (2A-3). Payments, petty cash and stock stay deferred as before. | `purchase_lines.substitute` / `substitute_reason`, `pur_store`, `pur_cover_lines`, `pur_keep_checks` / `pur_apply_checks`; core `formProblems` / `buildBody`; `-record.js`, `-purchases.js` | 2a2 *R14*; static *R14*; web *R14*; acceptance R5a–R5b; mutations 9–10 |

Also found and fixed while proving the above (none was in the review):

- **The rev 1 live acceptance script could not pass**: it called `pr_line_bought()` as a signed-in user, but 0097 revokes that helper from them (`permission denied`). It now reads Bought the way a buyer does, from `pur_shopping_list`.
- **Stale caches**: rev 1 changed `js/admin.js` and `js/expenses-module.js` without bumping their `?v=` in `admin.html` (the file warns a stale `admin.js` hides new tabs). Bumped, with `supabase-config.js`; a wiring test now checks it.
- **Line endings**: `docs/DATABASE_SCHEMA.md` and `supabase/migrations/README.md` are stored with **CRLF** in the repo; every other file the plan touches is LF. Apply those two patches with the Edit tool (or convert the patch), keeping the files' CRLF endings — a plain `git apply` refuses them.

## Global Constraints

The owner's six rules (16 Oct 2026, verbatim):

1. Q2's "no prices" applies to Purchasing. Preserve the approved Project Control data-entry and Materials/Labor list exceptions for staff.
2. Link purchases to their exact assigned portions automatically where possible. Buying 6 of 10 leaves the remaining 4 assigned until explicitly released. Reassignment must preserve who bought earlier quantities.
3. Keep actual purchased quantity, quantity covering the request, and extras separate. "Still to buy" cannot become negative. Different-unit purchases count toward coverage only after an audited office confirmation.
4. A warehouse destination for project-owned extras records their location; it must not silently remove their cost from the original project. Cost moves follow the owner-approved 2C rules.
5. Recording, correcting, replacing or voiding a purchase must update its request coverage and expense rows together, without duplication.
6. Buyer permissions and receipt access must be enforced on the server within the correct company and account scope. Workers and team leaders receive quantity information only.

From CLAUDE.md (unchanged by this plan):

- Spent / Earned / Profit and Cover are computed exactly as 0096 does. **0097 redefines none of** `pur_fund`, `pur_charge_rows`, `pur_period_remaining`, `pur_cover_period`, `pur_clear_rows`, `pur_prorate`, `pur_move_stock` (fenced by `tests/purchasing-server.test.js`).
- Staff see peso amounts only in Project Control's data entry (owner decision 2026-10-15) and, with the Buyer switch, in Purchasing screens. Workers and team leaders never see prices, receipts or payments.
- Petty cash, personal advances, refunds and supplier credits stay outside the money model — and outside 2A-2 (they are 2A-4).
- Migrations: **0097** is highest on disk + 1. Never SQL-editor changes for the build; the live apply is an MCP `apply_migration` after a rolled-back dry run (Task 4).
- `js/portal-app.compiled.js` is not touched. `npm run build` is never run.
- **The user commits and pushes.** Every "Commit" step below means: stop, show the user the files and a suggested message.

## Answers → where each is built

| # | Answer | Built in | Proved by |
|---|---|---|---|
| Q1 A | Buyer switch on each staff row; main owner only | `pur_set_buyer`, `pur_office_buyers`; `js/user-navigator.js` | 2a2 §A (switch on/off, owner only), acceptance A |
| Q2 A | Non-buyer staff: Requests as today, no Purchasing, no prices there (rule 1) | `pur_buyer()` on every Purchasing RPC; no request link without it, whatever the source (`pur_cover_lines`); purchase rows buyers-only (`pur_reader`); `_visibleNav` hides the tab; Project Control's entry kept through `pur_entry_row` | 2a2 §A (sources need the switch; *review 1* ×2), §F (isolation; *R3*); acceptance A, H, R1, R4; `purchasing-admin.test.js` wiring, *R3* |
| **Q3 B** | Admin accounts focused elsewhere may buy **with the Expenses section**, own scope | `pur_can_buy` (module rule + `data_owner_id()` scope); `_purchasingOnly()` gives such an account Requests → Purchasing alone | 2a2 §A ("Q3 = B"); web *review 4* |
| Q4 A | Whole portion or part (split); recorded who/when; "I'll buy this" | `pur_assign_portion`, `pr_split_portion`, `pr_events` | 2a2 §B (claim; part splits) |
| Q5 A | Only the owner reassigns someone else's portion | `ASSIGNED_TO_OTHER` / `NOT_YOUR_PORTION` | 2a2 §B (no taking over), concurrency 1 |
| Q6 A | Arranged stays separate | assignment never touches `arranged_at` | by construction — `pur_assign_portion` writes only the buyer columns |
| **Q7 B** | Link to the **exact portion**, automatically where possible (rule 2) | `portion_picks` (authoritative: only the picks) + `pur_cover_lines` order; a line's earlier covers kept (`pur_cover_history`); the form's weekly-portion picker | 2a2 §B (6 of 10), §C (own, then unassigned; staff never another's; *review 2* ×2); acceptance R2; web *review 2* |
| Q8 A | Extra allowed with reason + location; never fills another request (rules 3–4) | `EXTRA_REASON_REQUIRED`, `extra_location` label only | 2a2 §C (extra), acceptance C |
| Q9 A | Different unit: no coverage until an audited office check (rule 3) — and a specification-changing **substitute** the same way (R14) | `unit_check`, `pur_check_unit` (`OWN_PURCHASE`, history `unit_checked`); `substitute` / `substitute_reason` | 2a2 §C (different unit; *R14*), acceptance D, R5 |
| Q10 A | Unplanned with a reason | `UNPLANNED_REASON_REQUIRED` | 2a2 §C (links and Unplanned) |
| Q11 A | Supplier list | `suppliers`, `pur_save_supplier` | acceptance (indirect), wiring |
| Q12 A | Payments / petty cash / badge stay in 2A-4 | nothing built | — |
| **Q13 B** | Approval queue now | `purchase_change_requests` (+ `base_doc`), `pur_request_change` / `pur_decide_change` (stale on any change), `pur_review_doc` / `pur_change_requests` (every field); the field-by-field approval screen | 2a2 §E (approval, stale, reject, withdraw, completed; *review 3*), acceptance G, R3; web *review 3* ×2 |
| Q14 A | Receipts: private `purchases/` folder, buyers only (rule 6) | `uploads_can_read/write`, overwrite policy, `receipt_uploads` kind; delivered by authenticated download, never a signed link (`supabase-config.js`); replacements and unsaved choices kept by the form | 2a2 §G, `storage-access.test.js`, acceptance H4; web *R13*, *review 5* |
| Rule 5 | Coverage and expense rows change together, never doubled | covers rebuilt inside `pur_insert` / `pur_correct` / `pur_replace` / `pur_check_unit`, on the same portions as before; void = ignored | 2a2 §C (correction, void, replace, retry; *review 2*), concurrency 2–4, the 2A-1 suite re-run with 0097 |

## Rulings for review (choices the spec left to the plan)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| R1 | The switch lives in its own table `pur_buyers` (+ `pur_buyer_events`), not a `profiles` column. | Staff can update their own profile row through the app; a column there could be self-set. A separate table has no write policy at all. | None. |
| R2 | "Main owner" = an owner account acting on **its own** staff (`is_owner()` and `staff.owner_id = auth.uid()`). An admin account such as `admin-pm@` is its own data scope (`data_owner_id()` = itself), so it can never touch the main company's switch, portions or purchases. | Matches every other owner check (0074, 0096) and the live roles (checked 16 Oct). | None. |
| R3 | **Revised after review.** `pur_reader()` (0096) is narrowed to `pur_buyer()`: purchase rows are read only by those who may buy. Project Control's staff entry reads exactly what its Edit form needs through `pur_entry_row(line, charge)` — the one line, its purchase header, line and charge counts — and the review marks through `pur_review_lines()` (ids). | Unrestricted reads are not approved just to support an Edit form (review). Staff keep the approved data-entry exception and see nothing more. | The 2A-1 live acceptance reads purchase rows as staff to check itself; it now gives its staff account the switch inside its rolled-back transaction (Task 1). |
| R4 | Covers are per portion and keep `request_line_id`; a portion the office later removes sets `portion_id` null (the line's Bought stays right). A void keeps its covers as history; readers count recorded purchases only. | Bought can never drift from the purchases (rule 5). | None. |
| R5 | **Revised after review.** Picked portions are **authoritative**: a picked line covers only its picks, each at most its pick and its Still to buy — the rest is extra. Without picks: the buyer's own, then unassigned (the buyer then holds them — "I'll buy this" by buying), then — owner only — other buyers' portions (without taking them over); earliest batch first. A line's earlier covers are its **history**: a correction, replacement or unit check covers them first, in their old order, and covers other portions only for quantity it ADDS. A new request link, new picks or handing an unassigned portion over need someone who may buy, for a buyer who may buy — whatever the source. | Rule 2: exact portions, automatic where possible; a price fix never moves coverage to another week; the Buyer switch cannot be bypassed through the Expenses form (review). | None. |
| R6 | Extra needs reason + location when recording or replacing, or when a change **raises** what a line counts toward its request. A change that does not (e.g. a price fix after the request was reduced) gets the system reason "The request was reduced after this was bought". | Never ask someone fixing a price for a buying reason they never had; never invent a buyer's reason either. | None. |
| R7 | An office check (different unit, or substitute — R14) is made by the owner or a buyer who neither recorded nor bought the purchase; it survives a correction or replacement only while the line's request, item, unit, quantity and substitute mark stay the same; it cannot cover more than is still needed (`MORE_THAN_NEEDED`); it counts as a change to the purchase (`updated_at`). | "Audited office confirmation" (rule 3). | None. |
| R8 | A Buyer may claim an unassigned portion, give an unassigned portion to another buyer, release their own; the owner may do anything. Handing over a partly bought portion splits off its still-to-buy part; the bought part stays with whoever bought it. | Q4/Q5, rule 2. | None. |
| R9 | `pr_apply_quantity`: a reduction removes unbought, unarranged quantity first (unassigned portions before assigned ones, newest first) and only FLAGS the rest on arranged **or bought** portions. New demand merges only into a portion nobody is buying and nothing covers. A bought portion cannot move batch (`BOUGHT`). | Spec: "reduce newest unarranged demand first, then flag supplier-arranged/purchased portions for action". | None. |
| R10 | `pur_correct` keeps a line's stored request link when the body leaves `request_line_id` out (Project Control's one-line form does). | Without it, fixing a price in Project Control would silently unlink the purchase from its request. | None. |
| R11 | `pur_replace` voids the old purchase **before** recording the new one. | Otherwise the old covers block the new purchase and the same quantity reads as extra. | None. |
| R12 | Change requests: correct / replace / void only; one pending per purchase; the request keeps the purchase as the requester saw it (`base_doc`) and goes **stale** if anything in it changed since — a correction, an office check, a receipt; the owner sees every field (as asked vs asked for, with the automatic fee split spelled out) and cannot approve a stale one; a staff member without the switch cannot ask for a new request link; approval runs the same `pur_correct` / `pur_replace` / `pur_void`, and history says who asked. | Q13 = B without a second write path; the owner approves exactly what is shown (review). | None. |
| R13 | **Revised after review.** The `purchases/` storage rule runs **before** the uploader's own read-back: a buyer whose switch is turned off can no longer open receipts they uploaded. Dacs Web never gives this folder a signed link (a signed URL stays valid until it expires — one hour in this app): it downloads with the viewer's session, so the rule is checked on every view. **Revocation window:** immediate for every new view; a photo already open stays visible until that page or tab is closed or reloaded; no link exists to share. | Rule 6; the review asked for the real window or a different delivery — both are given. | A buyer switched off asks the owner for a receipt. |
| R14 | **Revised after review.** Not in 2A-2: payments, deposits, Overpaid, petty cash, the paid badge (2A-4); supplier grouping of the list; "From stock" (2B — shows 0); the phone screens and offline drafts (2A-3), including the requester / team-leader confirmation of a substitute. **In 2A-2, the web handles substitutes as an explicit exception:** a renamed request line must be marked "Same item, other words" or "Substitute"; a substitute needs a reason and covers nothing until an audited office check (R7). Worker and team-leader RPCs are unchanged (rule 6: quantities only). | Q12 and the agreed build order; the spec's 12 Oct substitute rule (confirmation before a specification-changing substitute counts) must hold in the web now (review). | None. |
| R15 | Apply 0097 before pushing the web change. Before 0097, `pur_me` is missing, so the tab stays hidden — but Project Control's purchase edit needs `pur_entry_row`, so the push must not come first. | Same order as 2A-1 (R12 there). | Pushed first by mistake: editing a purchase-made row in Project Control fails until 0097 is applied (nothing is changed). |
| R16 | An account focused on other sections that may buy (Q3 = B) gets a Requests tab holding Purchasing alone; the tab lands on Purchasing. | Q3 = B must be reachable, not only allowed by the server (review). | None. |
| R17 | Every web file this stage changes gets a fresh `?v=` in `admin.html` (`admin.js`, `expenses-module.js`, `supabase-config.js`, `receipt-storage.js`). | A stale `admin.js` silently hides the new tab. | None. |

## File map

| File | Task | What |
|---|---|---|
| `supabase/migrations/0097_purchasing_office.sql` | 1 | The whole server side (tables, rules, RPCs, storage) |
| `supabase/tests/pr_base.mjs` | 1 | Minimal Requests tables + lifted helpers for PGlite / PostgreSQL tests |
| `supabase/tests/2a2_purchasing.pglite.mjs` | 1 | 34 behaviour tests on PGlite |
| `supabase/tests/2a2_concurrency.mjs` | 1 | 5 two-session races on a throwaway PostgreSQL |
| `supabase/tests/2a2_acceptance.sql` | 1 | Live acceptance, self-rolling-back |
| `supabase/tests/2a1_acceptance.sql` | 1 | Its staff account gets the Buyer switch inside its own rolled-back run (R3) |
| `supabase/tests/2a1_purchase.pglite.mjs` | 1 | `--with-0097`: the 45 2A-1 tests with 0097 on top |
| `tests/purchasing-server.test.js` | 1 | 20 static checks on 0097 |
| `tests/storage-access.test.js` | 1 | `purchases` folder class + rule check |
| `supabase/migrations/README.md`, `package.json` (part 1) | 1 | 0097 entry, next number 0098; test scripts |
| `js/purchasing-admin-core.js`, `-list.js`, `-record.js`, `-purchases.js`, `css/purchasing-admin.css` | 2 | The Purchasing tab |
| `js/receipt-storage.js` | 1 | The `purchase` receipt kind → `purchases/` |
| `js/admin.js`, `admin.html` | 2 | Nav, views, scripts |
| `js/user-navigator.js` | 2 | The Buyer switch |
| `js/expenses-module.js` | 2 | Project Control: "Send to the owner"; the purchase behind a row through `pur_entry_row` |
| `js/supabase-config.js` | 2 | `purchases/` receipts downloaded with the viewer's session, never signed (R13) |
| `tests/purchasing-admin.test.js`, `package.json` (part 2) | 2 | 24 screen / wiring checks |
| `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `.github/workflows/ci.yml`, the questions doc | 3 | Documentation |

---

### Task 1: Server — migration 0097 and its proof

**Files:**
- Create: `supabase/tests/pr_base.mjs`, `supabase/tests/2a2_purchasing.pglite.mjs`, `supabase/tests/2a2_concurrency.mjs`, `tests/purchasing-server.test.js`, `supabase/migrations/0097_purchasing_office.sql`, `supabase/tests/2a2_acceptance.sql`
- Modify: `supabase/tests/2a1_purchase.pglite.mjs`, `supabase/tests/2a1_acceptance.sql`, `tests/storage-access.test.js`, `supabase/migrations/README.md`, `js/receipt-storage.js`, `package.json`

**Interfaces:**
- Consumes: 0096 as live (`pur_record` / `pur_correct` / `pur_replace` / `pur_void` / `pur_refund`, `pur_reader`, `pur_op_begin`, `pur_lock`, `pur_open`, `pur_charge_rows`); 0085/0086 Requests tables; 0089 storage rules.
- Produces (RPCs Task 2 calls, all `jsonb` unless noted): `pur_me()` → `{can_buy, is_owner, user_id}`; `pur_office_buyers()`; `pur_set_buyer(p_user uuid, p_on boolean)`; `pur_buyer_options()`; `pur_suppliers()`; `pur_save_supplier(p_id, p_name, p_branch, p_contact, p_active)`; `pur_assign_portion(p_portion uuid, p_buyer uuid, p_quantity numeric, p_note text)`; `pur_shopping_list(p_batch uuid, p_folder uuid, p_scope text)`; `pur_purchases(p_from date, p_to date, p_folder uuid, p_status text)`; `pur_purchase(p_purchase uuid)`; `pur_check_unit(p_op, p_purchase, p_line_no int, p_covers numeric, p_note)`; `pur_request_change(p_op, p_purchase, p_kind text, p_body jsonb, p_reason)`; `pur_change_requests(p_scope text)`; `pur_decide_change(p_op, p_request, p_approve boolean, p_note)`; `pur_withdraw_change(p_request)`. Body fields added to `pur_record` / `pur_correct` / `pur_replace` lines: `request_line_id`, `portion_picks [{portion_id, quantity}]`, `extra_reason`, `extra_location` (`project`/`warehouse`), `unplanned_reason`; purchase level: `source: 'purchasing'`, `bought_by`, `supplier_id`. Results gain `covers [{line, covered, extra, unit_check}]`.

- [ ] **Step 1: Write the tests first** — the shared base, the behaviour tests, the races, the static checks, the `--with-0097` mode of the 2A-1 suite and the storage-test entry.

Create `supabase/tests/pr_base.mjs`:

````js
// ════════════════════════════════════════════════════════════════════
// The extra tables and helpers migration 0097 needs on PGlite, on top of
// the 2A-1 base schema (2a1_purchase.pglite.mjs): minimal copies of the
// Requests tables (0085), the request helpers 0097 calls (lifted VERBATIM
// from their migrations), and stand-ins for Supabase Storage. Shared by
// 2a2_purchasing.pglite.mjs and by the 2A-1 suite's --with-0097 run.
// ════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export const fnText = (src, name) => {
  const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found');
  return m[0];
};

export function prBase(ROOT) {
  const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
  const M02 = mig('0002_rls.sql');
  const M85 = mig('0085_workmate_requests.sql');
  const M87 = mig('0087_pr_person_name_office.sql');
  const M86 = mig('0086_workmate_requests_office.sql');
  const M89 = mig('0089_receipt_storage.sql');
  return `
alter table profiles add column if not exists display_name text;
alter table profiles add column if not exists email text;
alter table profiles add column if not exists worker_no int;
create table pr_catalog_items (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null);
create table pr_batches (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  cutoff_at timestamptz not null, purchase_on date not null, delivery_on date not null,
  updated_by uuid, updated_at timestamptz not null default now(), unique (owner_id, cutoff_at));
create table pr_requests (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  requester_id uuid not null references profiles(id), team_id uuid, folder_id uuid not null references folders(id),
  work_folder_id uuid not null references folders(id), client_op_id uuid not null default gen_random_uuid(),
  drafted_at timestamptz, received_at timestamptz not null default now(), note text not null default '',
  status text not null default 'submitted' check (status in ('submitted', 'cancelled')), cancelled_at timestamptz);
create table pr_lines (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id), position int not null default 0,
  kind text not null default 'material', catalog_item_id uuid references pr_catalog_items(id),
  description text not null, spec text not null default '', unit text not null, category text not null default '',
  intended_member_id uuid, urgent boolean not null default false, urgent_reason text, needed_by date,
  notes text not null default '', status text not null default 'open' check (status in ('open', 'cancelled')),
  version int not null default 1, has_conflict boolean not null default false, created_at timestamptz not null default now());
create table pr_line_portions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  line_id uuid not null references pr_lines(id), batch_id uuid not null references pr_batches(id),
  quantity numeric(12,3) not null check (quantity > 0), arranged_at timestamptz, arranged_by uuid references profiles(id),
  pending_reduction numeric(12,3) not null default 0 check (pending_reduction >= 0 and pending_reduction <= quantity),
  created_at timestamptz not null default now());
create table pr_events (
  id bigserial primary key, owner_id uuid not null references profiles(id), request_id uuid not null references pr_requests(id),
  line_id uuid references pr_lines(id), actor_id uuid not null references profiles(id), kind text not null,
  detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
${fnText(M85, 'pr_cutoff_after')}
${fnText(M85, 'pr_batch_for')}
${fnText(M87, 'pr_person_name')}
${fnText(M86, 'pr_office_change_quantity')}
${fnText(M86, 'pr_office_set_arranged')}
${fnText(M02, 'is_worker')}
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function dacs_try_uuid(p text) returns uuid language plpgsql immutable as
  $f$ begin return p::uuid; exception when others then return null; end $f$;
create function cproj_client_can_read(p uuid) returns boolean language sql stable as $f$ select false $f$;
create function cproj_partner_can_read(p uuid) returns boolean language sql stable as $f$ select false $f$;
create table receipt_uploads (
  path text primary key constraint receipt_uploads_path_check
    check (path ~ '^(expenseReceipts|payrollReceipts)/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\\.jpg$'),
  owner_id uuid not null references profiles(id),
  kind text not null constraint receipt_uploads_kind_check check (kind in ('expense', 'payroll')),
  uploaded_by uuid, state text not null default 'pending', created_at timestamptz not null default now(),
  attached_at timestamptz, deleted_at timestamptz);
alter table receipt_uploads enable row level security;
${fnText(M89, 'public.receipt_paths_of')}
`;
}
````

Create `supabase/tests/2a2_purchasing.pglite.mjs`:

````js
// ════════════════════════════════════════════════════════════════════
// STAGE 2A-2 PURCHASING TAB + BUYER SWITCH — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096 and 0097 VERBATIM on PGlite (PostgreSQL in memory)
// over a minimal copy of the tables they touch (see pr_base.mjs). Nothing
// here talks to the live database; supabase/tests/2a2_acceptance.sql
// repeats the key cases there, rolled back.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));
const M96 = read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql'));
const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql'));

// The 2A-1 base schema (same as 2a1_purchase.pglite.mjs).
const BASE = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id) on delete cascade, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null,
  monthly_budget numeric not null default 0);
create table expenses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false,
  split_group text, split_index int, split_total int, client_submission_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  total_salary numeric, cover_expense boolean default false);
create table inventory (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid,
  created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}
`;

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';   // Expenses, no Buyer switch
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const OTHER = '00000000-0000-0000-0000-00000000000d';    // another company's owner
const PMOWNER = '00000000-0000-0000-0000-000000000013';  // owner-role account focused on PM
const EXPOWNER = '00000000-0000-0000-0000-000000000014'; // owner-role account with PM + Expenses (own scope)
let opSeq = 0;
const op = () => '20000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);

async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(M97);
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', null, 'pedro@dacs.test', 'Pedro'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${PMOWNER}', 'owner', '${OWNER}', 'active', '["pm"]'::jsonb, 'admin-pm@dacs.test', null),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null);`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}

async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function period(db, folderId, budget = 100000, owner = OWNER) {
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [owner, folderId])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, owner, budget]);
  return id;
}
// A request line for a project, with its quantity in one portion of NOW's batch.
async function request(db, folderId, opts = {}) {
  const owner = opts.owner || OWNER;
  const batch = (await one(db, `select pr_batch_for($1, now()) b`, [owner])).b;
  const req = (await one(db, `insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id)
                               values ($1, $2, $3, $4) returning id`, [owner, opts.requester || WORKER, folderId, opts.work || folderId])).id;
  const line = (await one(db, `insert into pr_lines (owner_id, request_id, description, unit, urgent, urgent_reason, needed_by)
                                values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [owner, req, opts.description || 'Cement', opts.unit || 'bag', !!opts.urgent, opts.urgent ? 'pour' : null, opts.urgent ? '2026-10-20' : null])).id;
  const portion = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4) returning id`,
    [owner, line, batch, opts.quantity ?? 10])).id;
  return { req, line, portion, batch };
}
function body(lines, extra = {}) {
  const total = extra.receipt_total ?? lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'purchasing', purchase_date: '2026-10-14', date_time: '2026-10-14T09:30', supplier: 'Wilcon',
           notes: '', payment_method: 'CASH', docs: {}, ...extra, receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', unit: 'bag', ...l })) };
}
async function record(db, b, opId = op()) {
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [opId, JSON.stringify(b)])).r;
}
async function portions(db, line) {
  return (await all(db, `select id, quantity, pending_reduction, buyer_id, pr_portion_bought(id) as bought
                           from pr_line_portions where line_id = $1 order by created_at, id`, [line]))
    .map(p => ({ id: p.id, q: num(p.quantity), pending: num(p.pending_reduction), buyer: p.buyer_id, bought: num(p.bought) }));
}
async function listLine(db, line) {
  const rows = (await one(db, `select pur_shopping_list(null, null, 'all') l`)).l;
  return rows.find(r => r.line_id === line);
}
async function spent(db, folderId) {
  return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
}

console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097 on PGlite)');

// ── A. The Buyer switch ──────────────────────────────────────────────

await test('the owner turns the Buyer switch on and off; each change is logged once', async () => {
  const db = await fresh();
  await as(db, STAFF); eq((await one(db, `select pur_buyer() b`)).b, false, 'staff without the switch');
  await as(db, BUYER); eq((await one(db, `select pur_buyer() b`)).b, true, 'buyer');
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, false)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, false)`, [BUYER]);   // no change → no second event
  await as(db, BUYER); eq((await one(db, `select pur_buyer() b`)).b, false, 'switched off');
  eq(num((await one(db, `select count(*) n from pur_buyer_events where user_id = $1`, [BUYER])).n), 2, 'on + off');
  await as(db, OWNER); eq((await one(db, `select pur_buyer() b`)).b, true, 'the owner may buy');
});

await test('only the owner sets the switch, only for their own staff', async () => {
  const db = await fresh();
  await as(db, BUYER);
  assert((await code(db.query(`select pur_set_buyer($1, true)`, [STAFF]))).includes('OWNER_ONLY'), 'staff refused');
  await as(db, OWNER);
  assert((await code(db.query(`select pur_set_buyer($1, true)`, [WORKER]))).includes('NOT_STAFF'), 'a worker cannot buy');
  await as(db, OTHER);
  assert((await code(db.query(`select pur_set_buyer($1, true)`, [STAFF]))).includes('NOT_STAFF'), 'another company');
  await as(db, OWNER);
  const list = (await one(db, `select pur_office_buyers() l`)).l;
  eq(list.map(x => [x.name, x.is_buyer]).sort(), [['Juan', true], ['Pedro', true], ['staff', false]], 'staff list with names');
});

await test('Q3 = B: an admin account focused on PM cannot buy; with Expenses it buys in its own scope only', async () => {
  const db = await fresh();
  await as(db, PMOWNER); eq((await one(db, `select pur_buyer() b`)).b, false, 'PM-only');
  await as(db, EXPOWNER); eq((await one(db, `select pur_buyer() b`)).b, true, 'PM + Expenses');
  const f = await folder(db, 'Barlin'); await period(db, f);
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1, unplanned_reason: 'r' }])))).includes('BAD_PROJECT'),
    'the main company project is not in its scope');
});

await test('Purchasing and phone sources need the switch; the Expenses form keeps 0096 rules', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const b = body([{ folder_id: f, item_name: 'Nails', amount: 50, unplanned_reason: 'site ran out' }]);
  await as(db, STAFF);
  assert((await code(record(db, b))).includes('BUYER_REQUIRED'), 'purchasing refused');
  assert((await code(record(db, { ...b, source: 'workmate' }))).includes('BUYER_REQUIRED'), 'phone refused');
  await record(db, { ...b, source: 'expenses_form' });
  await as(db, BUYER); await record(db, b);
  await record(db, { ...b, source: 'workmate' });
  await as(db, OWNER);
  await db.query(`update profiles set status = 'inactive' where id = $1`, [BUYER]);
  await as(db, BUYER);
  assert((await code(record(db, b))).includes('NOT_OFFICE') || (await code(record(db, b))).includes('BUYER_REQUIRED'), 'inactive refused');
});

await test('review 1: without the switch no source links a request or takes a portion; ordinary entry still works', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, STAFF);
  const linked = { ...body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line }]), source: 'expenses_form' };
  assert((await code(record(db, linked))).includes('BUYER_REQUIRED'), 'the Expenses form cannot link a request');
  const picked = { ...body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line,
                              portion_picks: [{ portion_id: r.portion, quantity: 4 }] }]), source: 'expenses_form' };
  assert((await code(record(db, picked))).includes('BUYER_REQUIRED'), 'nor pick a portion');
  eq((await portions(db, r.line)).map(p => [p.bought, p.buyer]), [[0, null]], 'nothing bought, nobody holds it');
  eq(num((await one(db, `select count(*) n from pr_events where line_id = $1`, [r.line])).n), 0, 'no claim logged');
  // Ordinary Expenses entry is unchanged …
  const plain = await record(db, { ...body([{ folder_id: f, item_name: 'Nails', amount: 50 }]), source: 'expenses_form' });
  // … but neither a correction nor a request to the owner adds a link to it.
  const addLink = { ...body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 50, request_line_id: r.line }]), source: 'expenses_form' };
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'link it')`, [op(), plain.purchase_id, JSON.stringify(addLink)]))).includes('BUYER_REQUIRED'), 'correction');
  assert((await code(db.query(`select pur_request_change($1, $2, 'correct', $3::jsonb, 'link it')`, [op(), plain.purchase_id, JSON.stringify(addLink)]))).includes('BUYER_REQUIRED'), 'change request');
  eq((await portions(db, r.line)).map(p => p.bought), [0], 'Bought still 0');
  // A buyer switched off is a non-buyer again.
  await as(db, OWNER); await db.query(`select pur_set_buyer($1, false)`, [BUYER]);
  await as(db, BUYER);
  assert((await code(record(db, linked))).includes('BUYER_REQUIRED'), 'switched off');
});

await test('review 1: a correction by someone who may not buy never hands a portion over', async () => {
  // Juan bought 4 (this week's portion); next week's 6 is unassigned. A
  // non-buyer raising the quantity in Project Control must not give Juan
  // next week's portion; nor may the owner give it to Juan once his switch is off.
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 4 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const w2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 6) returning id`, [OWNER, r.line, next])).id;
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line }]));
  const pc = (q) => JSON.stringify({ purchase_date: '2026-10-14', date_time: '2026-10-14', supplier: 'Wilcon', receipt_total: q * 250, notes: '',
    payment_method: 'CASH', docs: {}, charges: [],
    lines: [{ destination: 'project', folder_id: f, item_name: 'Cement', category: 'Materials', quantity: q, unit: 'bag', amount: q * 250 }] });
  await as(db, STAFF);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'six, not four')`, [op(), res.purchase_id, pc(6)]))).includes('EXTRA_REASON_REQUIRED'),
    'the added 2 cannot come from a portion nobody holds');
  eq((await portions(db, r.line)).map(p => [p.bought, p.buyer]), [[4, BUYER], [0, null]], 'next week still unassigned');
  await as(db, OWNER); await db.query(`select pur_set_buyer($1, false)`, [BUYER]);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'six, not four')`, [op(), res.purchase_id, pc(6)]))).includes('EXTRA_REASON_REQUIRED'),
    'not to a buyer whose switch is off');
  eq((await one(db, `select buyer_id from pr_line_portions where id = $1`, [w2])).buyer_id, null, 'still unassigned');
});

// ── B. Who is buying what ────────────────────────────────────────────

await test('"I\'ll buy this": a buyer claims an unassigned portion; another buyer cannot take it', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin');
  const r = await request(db, f);
  await as(db, BUYER);
  const res = (await one(db, `select pur_assign_portion($1, $2, null, null) r`, [r.portion, BUYER])).r;
  eq(res.changed, true, 'claimed');
  eq((await portions(db, r.line))[0].buyer, BUYER, 'held by the buyer');
  eq((await one(db, `select kind from pr_events where line_id = $1 order by id desc limit 1`, [r.line])).kind, 'portion_claimed', 'logged');
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER2]))).includes('ASSIGNED_TO_OTHER'), 'no taking over');
  assert((await code(db.query(`select pur_assign_portion($1, null, null, null)`, [r.portion]))).includes('NOT_YOUR_PORTION'), 'no releasing another');
  await as(db, OWNER);
  await db.query(`select pur_assign_portion($1, $2, null, 'Juan is off today')`, [r.portion, BUYER2]);
  eq((await portions(db, r.line))[0].buyer, BUYER2, 'the owner reassigns');
});

await test('assigning part of a portion splits it; Needed is never rewritten', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin');
  const r = await request(db, f, { quantity: 10 });
  await as(db, OWNER);
  await db.query(`select pur_assign_portion($1, $2, 4, null)`, [r.portion, BUYER]);
  eq((await portions(db, r.line)).map(p => [p.q, p.buyer]), [[6, null], [4, BUYER]], '6 unassigned + 4 to Juan');
  eq(num((await listLine(db, r.line)).needed), 10, 'Needed stays 10');
  assert((await code(db.query(`select pur_assign_portion($1, $2, 7, null)`, [r.portion, BUYER2]))).includes('BAD_QUANTITY'), 'more than is left');
  assert((await code(db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, STAFF]))).includes('BAD_BUYER'), 'not a buyer');
});

await test('buying 6 of 10 keeps the other 4 assigned; releasing them leaves the 6 with the buyer who bought them', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER]);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 6, amount: 1500, request_line_id: r.line }]));
  let line = await listLine(db, r.line);
  eq([num(line.needed), num(line.bought), num(line.still_to_buy)], [10, 6, 4], 'Needed 10 · Bought 6 · Still 4');
  eq(line.portions.map(p => [num(p.bought), num(p.still_to_buy), p.buyer_name]), [[6, 4, 'Juan']], 'still assigned to Juan');
  await db.query(`select pur_assign_portion($1, null, null, null)`, [r.portion]);
  line = await listLine(db, r.line);
  eq(line.portions.map(p => [num(p.quantity), num(p.bought), p.buyer_name]), [[6, 6, 'Juan'], [4, 0, null]], 'the 4 is claimable');
  eq([num(line.needed), num(line.bought), num(line.still_to_buy)], [10, 6, 4], 'Needed unchanged');
  await as(db, BUYER2);
  const p4 = line.portions[1].id;
  await db.query(`select pur_assign_portion($1, $2, null, null)`, [p4, BUYER2]);
  const covers = await all(db, `select buyer_id, quantity from purchase_line_covers`);
  eq(covers.map(c => [c.buyer_id, num(c.quantity)]), [[BUYER, 6]], 'who bought the 6 never changes');
});

// ── C. Coverage ──────────────────────────────────────────────────────

await test('a purchase covers the buyer\'s own portion first, then unassigned ones (which the buyer then holds)', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, OWNER);
  await db.query(`select pur_assign_portion($1, $2, 4, null)`, [r.portion, BUYER]);
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 7, amount: 1750, request_line_id: r.line }]));
  eq((await portions(db, r.line)).map(p => [p.q, p.bought, p.buyer]), [[6, 3, BUYER], [4, 4, BUYER]], '4 own + 3 of the unassigned 6');
  eq(num((await listLine(db, r.line)).still_to_buy), 3, 'Still to buy 3');
});

await test('a staff buyer never covers another buyer\'s portion; the owner may', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER2]);
  await as(db, BUYER);
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 2, amount: 500, request_line_id: r.line }]);
  assert((await code(record(db, b))).includes('EXTRA_REASON_REQUIRED'), 'nothing it may cover → all extra');
  const pick = body([{ folder_id: f, item_name: 'Cement', quantity: 2, amount: 500, request_line_id: r.line,
                       portion_picks: [{ portion_id: r.portion, quantity: 2 }] }]);
  assert((await code(record(db, pick))).includes('ASSIGNED_TO_OTHER'), 'an explicit pick is refused');
  await as(db, OWNER);
  await record(db, b);
  eq((await portions(db, r.line))[0].bought, 2, 'the owner covered Pedro\'s portion');
  eq((await portions(db, r.line))[0].buyer, BUYER2, 'without taking it over');
});

await test('buying more than Still to buy: needs a reason and a location; Still to buy stays 0, never negative', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const base = { folder_id: f, item_name: 'Cement', quantity: 12, amount: 3000, request_line_id: r.line };
  assert((await code(record(db, body([base])))).includes('EXTRA_REASON_REQUIRED'), 'no reason');
  assert((await code(record(db, body([{ ...base, extra_reason: 'pack of 12' }])))).includes('EXTRA_REASON_REQUIRED'), 'no location');
  assert((await code(record(db, body([{ ...base, extra_reason: 'x', extra_location: 'garage' }])))).includes('BAD_EXTRA'), 'bad location');
  const res = await record(db, body([{ ...base, extra_reason: 'sold by the dozen', extra_location: 'warehouse' }]));
  eq(res.covers, [{ line: 1, extra: 2, covered: 10, unit_check: 'none' }], 'covers 10, extra 2');
  const line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy), num(line.extra)], [10, 0, 2], 'Bought 10 · Still 0 · Extra 2 (separate)');
  eq(await spent(db, f), 3000, 'the extra\'s cost stays on the project (location is not a cost move)');
});

await test('a different unit covers nothing until an audited office check; the buyer cannot check their own', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 24, unit: 'pcs', description: 'Hinge' });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Hinge', quantity: 2, unit: 'box', amount: 900, request_line_id: r.line }]));
  eq(res.covers, [{ line: 1, extra: 0, covered: 0, unit_check: 'pending' }], 'pending, nothing covered');
  let line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy), num(line.unit_checks)], [0, 24, 1], 'still 24, one check waiting');
  assert((await code(db.query(`select pur_check_unit($1, $2, 1, 24, '2 boxes of 12')`, [op(), res.purchase_id]))).includes('OWN_PURCHASE'), 'not their own');
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_check_unit($1, $2, 1, 30, 'x')`, [op(), res.purchase_id]))).includes('MORE_THAN_NEEDED'), 'cannot cover more than needed');
  await db.query(`select pur_check_unit($1, $2, 1, 24, '2 boxes of 12')`, [op(), res.purchase_id]);
  line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy), num(line.unit_checks)], [24, 0, 0], 'covered after the check');
  eq((await one(db, `select kind, reason from purchase_history where purchase_id = $1 order by id desc limit 1`, [res.purchase_id])),
     { kind: 'unit_checked', reason: '2 boxes of 12' }, 'audited');
});

await test('review 2: picked portions are authoritative — 4 picked from one week, 6 bought: 2 extra, never another week', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 4 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  await db.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 6)`, [OWNER, r.line, next]);
  await as(db, BUYER);
  const base = { folder_id: f, item_name: 'Cement', quantity: 6, amount: 1500, request_line_id: r.line,
                 portion_picks: [{ portion_id: r.portion, quantity: 4 }] };
  assert((await code(record(db, body([base])))).includes('EXTRA_REASON_REQUIRED'), 'the 2 beyond the pick are extra');
  const res = await record(db, body([{ ...base, extra_reason: 'sold in sixes', extra_location: 'project' }]));
  eq(res.covers, [{ line: 1, extra: 2, covered: 4, unit_check: 'none' }], 'covers the picked portion only');
  eq((await portions(db, r.line)).map(p => [p.q, p.bought, p.buyer]), [[4, 4, BUYER], [6, 0, null]], 'next week untouched and unassigned');
});

await test('review 2: a price fix, a unit check on another line or a replacement keeps each line on the portions it covered', async () => {
  // Juan buys 5 while week 1 is Pedro's, so it covers the unassigned week-2
  // portion. The owner then gives week 1 to Juan. Re-running "own portions,
  // earliest first" would now move the 5 to week 1 — history must win.
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 5 });
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const w2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 5) returning id`, [OWNER, r.line, next])).id;
  const h = await request(db, f, { quantity: 24, unit: 'pcs', description: 'Hinge' });
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER2]);
  await as(db, BUYER);
  const lines = [{ folder_id: f, item_name: 'Cement', quantity: 5, amount: 1250, request_line_id: r.line },
                 { folder_id: f, item_name: 'Hinge', quantity: 2, unit: 'box', amount: 900, request_line_id: h.line }];
  const res = await record(db, body(lines));
  const line1 = async (pid) => (await all(db, `select c.portion_id, c.quantity from purchase_line_covers c join purchase_lines l on l.id = c.line_id
                                                 join purchases pu on pu.id = l.purchase_id
                                                where l.purchase_id = $1 and l.line_no = 1 and pu.status = 'recorded' order by c.id`, [pid]))
    .map(c => [c.portion_id, num(c.quantity)]);
  eq(await line1(res.purchase_id), [[w2, 5]], 'covers week 2');
  await as(db, OWNER); await db.query(`select pur_assign_portion($1, $2, null, 'Pedro is off')`, [r.portion, BUYER]);
  await db.query(`select pur_check_unit($1, $2, 2, 24, '2 boxes of 12')`, [op(), res.purchase_id]);
  eq(await line1(res.purchase_id), [[w2, 5]], 'a unit check on line 2 leaves line 1 on week 2');
  await as(db, BUYER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), res.purchase_id, JSON.stringify(body([{ ...lines[0], amount: 1200 }, lines[1]]))]);
  eq(await line1(res.purchase_id), [[w2, 5]], 'a price fix leaves it on week 2');
  eq([num((await listLine(db, h.line)).bought), (await portions(db, r.line)).map(p => p.bought)], [24, [0, 5]], 'the check is kept; week 1 still to buy');
  const rep = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the tape') r`, [op(), res.purchase_id,
    JSON.stringify(body([{ ...lines[0], amount: 1200 }, lines[1], { folder_id: f, item_name: 'Tape', amount: 20, unplanned_reason: 'r' }]))])).r;
  eq(await line1(rep.purchase_id), [[w2, 5]], 'the replacement covers week 2 too');
  // Only quantity ADDED by a correction looks for more: 5 → 7 covers 2 of Juan's week 1.
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'two more')`, [op(), rep.purchase_id,
    JSON.stringify(body([{ ...lines[0], quantity: 7, amount: 1680 }, lines[1], { folder_id: f, item_name: 'Tape', amount: 20, unplanned_reason: 'r' }]))]);
  eq(await line1(rep.purchase_id), [[w2, 5], [r.portion, 2]], 'week 2 kept, the added 2 from week 1');
});

await test('R14: a substitute states why and covers nothing until someone else checks it', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10, description: 'Boysen paint white', unit: 'gal' });
  await as(db, BUYER);
  const sub = { folder_id: f, item_name: 'Davies paint white', quantity: 10, unit: 'gal', amount: 5000, request_line_id: r.line, substitute: true };
  assert((await code(record(db, body([sub])))).includes('SUBSTITUTE_REASON_REQUIRED'), 'a reason is needed');
  const res = await record(db, body([{ ...sub, substitute_reason: 'Boysen out of stock; same coverage per gallon' }]));
  eq(res.covers, [{ line: 1, extra: 0, covered: 0, unit_check: 'pending' }], 'waits for an office check');
  let line = await listLine(db, r.line);
  eq([num(line.still_to_buy), num(line.unit_checks)], [10, 1], 'Still to buy 10, one check waiting');
  assert((await code(db.query(`select pur_check_unit($1, $2, 1, 10, 'fine')`, [op(), res.purchase_id]))).includes('OWN_PURCHASE'), 'not the buyer');
  await as(db, BUYER2);
  await db.query(`select pur_check_unit($1, $2, 1, 10, 'Equivalent — confirmed with the foreman')`, [op(), res.purchase_id]);
  line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy)], [10, 0], 'covered after the check');
  const l = await one(db, `select item_name, substitute, substitute_reason from purchase_lines where purchase_id = $1`, [res.purchase_id]);
  eq([l.item_name, l.substitute, l.substitute_reason], ['Davies paint white', true, 'Boysen out of stock; same coverage per gallon'], 'actual item and reason kept');
  // Renaming the substitute is checked again (the check named another item).
  await as(db, BUYER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'brand')`, [op(), res.purchase_id,
    JSON.stringify(body([{ ...sub, item_name: 'Nation paint white', substitute_reason: 'Davies also out' }]))]);
  eq(num((await listLine(db, r.line)).bought), 0, 'a different substitute waits for its own check');
});

await test('Project Control\'s correction keeps the request link, rebuilds covers once, and Spent moves by the difference', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 6, amount: 1500, request_line_id: r.line }]));
  await as(db, STAFF);   // a non-buyer fixing the price from Project Control: no link, no source
  const pc = { purchase_date: '2026-10-14', date_time: '2026-10-14', supplier: 'Wilcon', receipt_total: 1560, notes: '', payment_method: 'CASH', docs: {},
               lines: [{ destination: 'project', folder_id: f, item_name: 'Cement', category: 'Materials', quantity: 6, unit: 'bag', amount: 1560 }], charges: [] };
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'receipt said 1,560')`, [op(), res.purchase_id, JSON.stringify(pc)]);
  await as(db, BUYER);
  eq((await one(db, `select request_line_id from purchase_lines where purchase_id = $1`, [res.purchase_id])).request_line_id, r.line, 'link kept');
  eq(num((await one(db, `select count(*) n from purchase_line_covers`)).n), 1, 'covers rebuilt, not doubled');
  eq(num((await listLine(db, r.line)).bought), 6, 'Bought still 6');
  eq(await spent(db, f), 1560, 'Spent +60');
});

await test('corrections: raising the quantity past Still to buy needs a reason; a request reduced after buying does not', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line }]));
  const raised = body([{ folder_id: f, item_name: 'Cement', quantity: 11, amount: 2750, request_line_id: r.line }]);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'one more')`, [op(), res.purchase_id, JSON.stringify(raised)]))).includes('EXTRA_REASON_REQUIRED'), 'raised');
  // The worker reduces the request to 7 after buying (0085/0097 rule: flagged on the bought portion).
  await db.query(`select pr_apply_quantity($1, 7, $2)`, [r.line, OWNER]);
  const priceOnly = body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2400, request_line_id: r.line }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'discount')`, [op(), res.purchase_id, JSON.stringify(priceOnly)]);
  const l = await one(db, `select covered_qty, extra_qty, extra_reason, extra_location from purchase_lines where purchase_id = $1`, [res.purchase_id]);
  eq([num(l.covered_qty), num(l.extra_qty), l.extra_reason, l.extra_location],
     [7, 3, 'The request was reduced after this was bought', 'project'], 'honest system reason');
  eq(num((await listLine(db, r.line)).still_to_buy), 0, 'never negative');
});

await test('void returns the quantity to Still to buy; the assignment stays; history keeps who bought', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line }]));
  eq(num((await listLine(db, r.line)).still_to_buy), 0, 'all bought');
  await db.query(`select pur_void($1, $2, 'wrong supplier')`, [op(), res.purchase_id]);
  const line = await listLine(db, r.line);
  eq([num(line.bought), num(line.still_to_buy), line.portions[0].buyer_name], [0, 10, 'Juan'], 'back to Still 10, still Juan\'s');
  eq(await spent(db, f), 0, 'Spent back to 0');
  eq(num((await one(db, `select count(*) n from purchase_line_covers`)).n), 1, 'the cover stays as history');
});

await test('replace covers the same portions once (the old purchase is voided first)', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  const r2 = await request(db, f, { quantity: 5, description: 'Sand', unit: 'cu.m' });
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line }]));
  const nb = body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 2500, request_line_id: r.line },
                   { folder_id: f, item_name: 'Sand', quantity: 5, unit: 'cu.m', amount: 4000, request_line_id: r2.line }]);
  const rep = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the sand') r`, [op(), res.purchase_id, JSON.stringify(nb)])).r;
  eq((await rep).covers.map(c => num(c.covered)), [10, 5], 'both covered in full');
  eq(num((await listLine(db, r.line)).bought), 10, 'Cement bought 10, not 20');
  eq(await spent(db, f), 6500, 'Spent once');
});

await test('a retry with the same operation id covers once', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  const id = op();
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 4, amount: 1000, request_line_id: r.line }]);
  await record(db, b, id);
  const again = await record(db, b, id);
  eq(again.replayed, true, 'replayed');
  eq(num((await listLine(db, r.line)).bought), 4, 'Bought 4, once');
});

await test('request links stay in their project and company; no request = Unplanned with a reason', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  const r = await request(db, f);
  await as(db, BUYER);
  assert((await code(record(db, body([{ folder_id: g, item_name: 'Cement', quantity: 1, amount: 1, request_line_id: r.line }])))).includes('BAD_REQUEST_LINK'), 'other project');
  assert((await code(record(db, body([{ destination: 'warehouse', item_name: 'Cement', quantity: 1, amount: 1, request_line_id: r.line }])))).includes('BAD_REQUEST_LINK'), 'warehouse line');
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 1, request_line_id: 'nope' }])))).includes('BAD_REQUEST_LINK'), 'not a uuid');
  assert((await code(record(db, body([{ folder_id: f, item_name: 'Tape', quantity: 1, amount: 1 }])))).includes('UNPLANNED_REASON_REQUIRED'), 'unplanned needs a reason');
  await record(db, body([{ folder_id: f, item_name: 'Tape', quantity: 1, amount: 1, unplanned_reason: 'leak at the roof' }]));
  await as(db, OTHER);
  const og = await folder(db, 'Theirs', { owner: OTHER }); await period(db, og, 100000, OTHER);
  assert((await code(record(db, { ...body([{ folder_id: og, item_name: 'Cement', quantity: 1, amount: 1, request_line_id: r.line }]), source: 'expenses_form' }))).includes('BAD_REQUEST_LINK'), 'another company\'s request');
});

await test('only the owner records a purchase for someone else, and only for a buyer', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const b = body([{ folder_id: f, item_name: 'Tape', amount: 10, unplanned_reason: 'r' }]);
  await as(db, BUYER);
  assert((await code(record(db, { ...b, bought_by: BUYER2 }))).includes('BAD_BUYER'), 'a buyer for another');
  await as(db, OWNER);
  assert((await code(record(db, { ...b, bought_by: STAFF }))).includes('BAD_BUYER'), 'not a buyer');
  const res = await record(db, { ...b, bought_by: BUYER2 });
  const pu = await one(db, `select recorded_by, bought_by from purchases where id = $1`, [res.purchase_id]);
  eq([pu.recorded_by, pu.bought_by], [OWNER, BUYER2], 'encoder and buyer kept apart');
});

// ── D. Quantity changes protect what was bought ──────────────────────

await test('a reduction removes unbought quantity first, then FLAGS the bought portion — a purchase is never erased', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 6, amount: 1500, request_line_id: r.line }]));
  await db.query(`select pr_apply_quantity($1, 5, $2)`, [r.line, OWNER]);
  const ps = await portions(db, r.line);
  eq(ps.map(p => [p.q, p.pending, p.bought]), [[6, 1, 6]], 'the unbought 4 went; 1 flagged on the bought 6');
  const line = await listLine(db, r.line);
  eq([num(line.needed), num(line.bought), num(line.still_to_buy)], [5, 6, 0], 'Needed 5, Bought 6, Still 0');
});

await test('new demand never merges into a portion someone is buying or bought', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin');
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER); await db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, BUYER]);
  await as(db, OWNER); await db.query(`select pr_office_change_quantity($1, 13, 'three more for the gate')`, [r.line]);
  await as(db, BUYER);
  eq((await portions(db, r.line)).map(p => [p.q, p.buyer]), [[10, BUYER], [3, null]], 'a new unassigned portion of 3');
  const line = await listLine(db, r.line);
  assert(line.portions[0].changed === true, 'Juan sees "quantity changed"');
});

await test('a bought portion cannot move to another batch', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10 });
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 2, amount: 500, request_line_id: r.line }]));
  const next = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  await as(db, OWNER);
  assert((await code(db.query(`select pr_office_move_portion($1, $2, null)`, [r.portion, next]))).includes('BOUGHT'), 'refused');
});

// ── E. Owner approval ────────────────────────────────────────────────

await test('a staff change for the owner: requested, approved once, applied through the normal correction', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  const moved = body([{ folder_id: g, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]);
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'wrong site')`, [op(), res.purchase_id, JSON.stringify(moved)]))).includes('OWNER_APPROVAL_NEEDED'), 'needs the owner');
  const reqOp = op();
  const cr = (await one(db, `select pur_request_change($1, $2, 'correct', $3::jsonb, 'wrong site') r`, [reqOp, res.purchase_id, JSON.stringify(moved)])).r;
  eq((await one(db, `select pur_request_change($1, $2, 'correct', $3::jsonb, 'wrong site') r`, [reqOp, res.purchase_id, JSON.stringify(moved)])).r.request_id, cr.request_id, 'retry = same request');
  assert((await code(db.query(`select pur_request_change($1, $2, 'void', null, 'again')`, [op(), res.purchase_id]))).includes('ALREADY_PENDING'), 'one pending per purchase');
  await as(db, BUYER2);
  eq((await one(db, `select pur_change_requests('pending') l`)).l.length, 0, 'another staff member does not see it');
  await as(db, OWNER);
  eq((await one(db, `select pur_change_requests('pending') l`)).l.length, 1, 'the owner sees it');
  const decideOp = op();
  const d = (await one(db, `select pur_decide_change($1, $2, true, null) r`, [decideOp, cr.request_id])).r;
  eq(d.status, 'approved', 'approved');
  eq((await one(db, `select pur_decide_change($1, $2, true, null) r`, [decideOp, cr.request_id])).r.replayed, true, 'decide retry');
  eq([await spent(db, f), await spent(db, g)], [0, 100], 'moved to Prado once');
  const h = await one(db, `select kind, reason from purchase_history where purchase_id = $1 order by id desc limit 1`, [res.purchase_id]);
  eq(h.kind, 'corrected', 'normal correction');
  assert(h.reason.includes('requested by Juan'), 'history names who asked');
});

await test('a request goes stale if the purchase changed; a rejection needs a note; the requester can withdraw', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin', { completed: false }); await period(db, f);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  const cr = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate') r`, [op(), res.purchase_id])).r;
  await as(db, OWNER);
  const fix = body([{ folder_id: f, item_name: 'Tape', amount: 90, unplanned_reason: 'r' }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), res.purchase_id, JSON.stringify(fix)]);
  eq((await one(db, `select pur_decide_change($1, $2, true, null) r`, [op(), cr.request_id])).r.status, 'stale', 'stale');
  eq(await spent(db, f), 90, 'nothing applied');
  await as(db, BUYER);
  const cr2 = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate') r`, [op(), res.purchase_id])).r;
  await as(db, OWNER);
  assert((await code(db.query(`select pur_decide_change($1, $2, false, '')`, [op(), cr2.request_id]))).includes('REASON_REQUIRED'), 'note needed');
  await db.query(`select pur_decide_change($1, $2, false, 'keep it')`, [op(), cr2.request_id]);
  await as(db, BUYER);
  const cr3 = (await one(db, `select pur_request_change($1, $2, 'void', null, 'dup') r`, [op(), res.purchase_id])).r;
  await db.query(`select pur_withdraw_change($1)`, [cr3.request_id]);
  eq((await one(db, `select status from purchase_change_requests where id = $1`, [cr3.request_id])).status, 'withdrawn', 'withdrawn');
  await as(db, OWNER);
  assert((await code(db.query(`select pur_request_change($1, $2, 'void', null, 'x')`, [op(), res.purchase_id]))).includes('OWNER_CAN_DO_IT'), 'the owner just does it');
});

await test('review 3: the owner sees the whole change, and any change since — even a unit check — makes it stale', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  const h = await request(db, f, { quantity: 24, unit: 'pcs', description: 'Hinge' });
  await as(db, OWNER);
  const sup = (await one(db, `select pur_save_supplier(null, 'Wilcon', 'Cubao', '', true) s`)).s;
  await as(db, BUYER);
  const hinge = { folder_id: f, item_name: 'Hinge', quantity: 2, unit: 'box', amount: 900, request_line_id: h.line };
  const res = await record(db, body([hinge, { folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }],
                                    { charges: [{ kind: 'delivery_fee', amount: 100 }], receipt_total: 1100 }));
  const moved = body([hinge, { folder_id: g, item_name: 'Tape', quantity: 3, unit: 'roll', amount: 150, unplanned_reason: 'r' }],
                     { purchase_date: '2026-10-13', date_time: '2026-10-13T08:00', supplier: '', supplier_id: sup.id, receipt_total: 1150,
                       charges: [{ kind: 'delivery_fee', amount: 100, shares: [{ line: 1, amount: 40 }, { line: 2, amount: 60 }] }] });
  const cr = (await one(db, `select pur_request_change($1, $2, 'correct', $3::jsonb, 'The tape was for Prado') r`,
                        [op(), res.purchase_id, JSON.stringify(moved)])).r;
  await as(db, OWNER);
  let req = (await one(db, `select pur_change_requests('pending') l`)).l[0];
  eq([req.base.purchase_date, req.proposed.purchase_date, req.proposed.date_time], ['2026-10-14', '2026-10-13', '2026-10-13T08:00'], 'dates');
  eq([req.base.supplier, req.proposed.supplier], ['Wilcon', 'Wilcon · Cubao'], 'supplier');
  eq(req.proposed.lines.map(l => [num(l.quantity), l.unit, num(l.amount), l.where]),
     [[2, 'box', 900, 'Barlin · Main Contract'], [3, 'roll', 150, 'Prado · Main Contract']], 'quantities, units, amounts, projects');
  eq([req.base.lines[1].quantity, req.base.lines[1].unit].map(String), ['1', 'bag'], 'the tape as it was');
  eq([req.base.charges[0].shares.map(num), req.proposed.charges[0].shares.map(num)], [[90, 10], [40, 60]], 'fee split before and asked for');
  eq([req.proposed.lines[0].request, num(req.proposed.receipt_total)], ['Hinge (pcs)', 1150], 'request and total');
  eq(req.changed_since, false, 'nothing changed yet');
  // An office check after the request changes what the purchase covers.
  await db.query(`select pur_check_unit($1, $2, 1, 24, '2 boxes of 12')`, [op(), res.purchase_id]);
  req = (await one(db, `select pur_change_requests('pending') l`)).l[0];
  eq(req.changed_since, true, 'the owner is warned before approving');
  eq((await one(db, `select pur_decide_change($1, $2, true, null) r`, [op(), cr.request_id])).r.status, 'stale', 'approval refused');
  eq([await spent(db, f), await spent(db, g)], [1100, 0], 'nothing applied');
});

await test('completed project: a staff void goes to the owner and is applied on approval', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  await db.query(`update folders set completed_at = now() where id = $1`, [f]);
  assert((await code(db.query(`select pur_void($1, $2, 'dup')`, [op(), res.purchase_id]))).includes('COMPLETED_PROJECT'), 'staff refused');
  const cr = (await one(db, `select pur_request_change($1, $2, 'void', null, 'duplicate receipt') r`, [op(), res.purchase_id])).r;
  await as(db, OWNER);
  await db.query(`select pur_decide_change($1, $2, true, null)`, [op(), cr.request_id]);
  eq((await one(db, `select status from purchases where id = $1`, [res.purchase_id])).status, 'void', 'voided');
});

// ── F. Isolation ─────────────────────────────────────────────────────

await test('workers, non-buyer staff and other companies read and change nothing purchase-related', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f);
  for (const who of [WORKER, STAFF, PMOWNER]) {
    await as(db, who);
    for (const call of [`select pur_shopping_list()`, `select pur_purchases()`, `select pur_suppliers()`, `select pur_buyer_options()`]) {
      const c = await code(db.query(call));
      assert(c.includes('BUYER_REQUIRED'), who + ' ' + call + ' → ' + c);
    }
    assert((await code(db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, who]))).includes('BUYER_REQUIRED'), who + ' assign');
  }
  await as(db, OTHER);
  eq((await one(db, `select pur_shopping_list(null, null, 'all') l`)).l, [], 'another company sees no lines');
  assert((await code(db.query(`select pur_assign_portion($1, $2, null, null)`, [r.portion, OTHER]))).includes('NOT_FOUND'), 'another company cannot assign');
});

await test('R3: purchase rows are read by buyers only; Project Control staff get the one line they edit', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const res = await record(db, body([{ folder_id: f, item_name: 'Tape', amount: 100, unplanned_reason: 'r' }]));
  const lineId = (await one(db, `select id from purchase_lines where purchase_id = $1`, [res.purchase_id])).id;
  eq((await one(db, `select pur_reader() r`)).r, true, 'a buyer reads purchase rows');
  await as(db, STAFF);
  eq((await one(db, `select pur_reader() r`)).r, false, 'staff without the switch no longer do (0096 let them)');
  const row = (await one(db, `select pur_entry_row($1, null) r`, [lineId])).r;
  eq([row.purchase.id, row.line.item_name, num(row.line.gross_amount), num(row.line_count), num(row.charge_count)],
     [res.purchase_id, 'Tape', 100, 1, 0], 'what the Edit Expense form needs');
  eq([Object.keys(row).sort(), 'bought_by' in row.purchase, 'request_line_id' in row.line],
     [['charge_count', 'line', 'line_count', 'purchase'], false, false], 'and nothing else');
  eq((await one(db, `select pur_review_lines() r`)).r, [], 'review flags: ids only');
  await as(db, WORKER);
  assert((await code(db.query(`select pur_entry_row($1, null)`, [lineId]))).includes('NOT_OFFICE'), 'a worker gets nothing');
  await as(db, PMOWNER);
  assert((await code(db.query(`select pur_entry_row($1, null)`, [lineId]))).includes('NOT_ALLOWED'), 'an account without Expenses gets nothing');
  await as(db, OTHER);
  assert((await code(db.query(`select pur_entry_row($1, null)`, [lineId]))).includes('NOT_FOUND'), 'another company gets nothing');
});

await test('the shopping list is quantities and names only — no peso amount anywhere', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 10, urgent: true });
  await as(db, BUYER);
  await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 3, amount: 777.77, request_line_id: r.line }]));
  const text = JSON.stringify((await one(db, `select pur_shopping_list() l`)).l);
  // '777.77', not '777': the ids in the list are random and may contain 777.
  assert(!text.includes('777.77') && !/amount|price|total|cost/i.test(text), 'no money: ' + text.slice(0, 200));
  assert(text.includes('"urgent":true'), 'urgent shown');
});

// ── G. Receipts ──────────────────────────────────────────────────────

await test('purchase receipts: buyers of that company only — not non-buyer staff, workers or other companies', async () => {
  const db = await fresh();
  const p = `purchases/${OWNER}/2026-10/30000000-0000-0000-0000-000000000001.jpg`;
  const can = async (who, fn) => { await as(db, who); return (await one(db, fn === 'r' ? `select uploads_can_read($1, null) x` : `select uploads_can_write($1) x`, [p])).x; };
  eq([await can(OWNER, 'r'), await can(BUYER, 'r'), await can(BUYER, 'w')], [true, true, true], 'owner and buyer');
  eq([await can(STAFF, 'r'), await can(STAFF, 'w'), await can(WORKER, 'r'), await can(OTHER, 'r'), await can(PMOWNER, 'r')],
     [false, false, false, false, false], 'everyone else refused');
  await db.query(`insert into receipt_uploads (path, owner_id, kind) values ($1, $2, 'purchase')`, [p, OWNER]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

Create `supabase/tests/2a2_concurrency.mjs`:

````js
// ════════════════════════════════════════════════════════════════════
// STAGE 2A-2 PURCHASING — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2a2_purchasing.pglite.mjs)
//
// Same approach as 2a1_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 VERBATIM over the same
// minimal tables, pairs of calls released at the same moment on two
// connections. Nothing touches the live database.
//   1. two buyers claim the SAME portion          → exactly one wins, no deadlock
//   2. two purchases cover the SAME last 10       → never more than 10 covered
//   3. a purchase against an office reduction     → no deadlock, never over-covered
//   4. purchase A+B against purchase B+A          → no deadlock
//   5. an assignment against a purchase           → no deadlock, one buyer holds it
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));

const OWNER = '00000000-0000-0000-0000-00000000000a';
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2a2-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2A-2 purchasing — two sessions at once (0096 + 0097 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id), completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int, created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null, monthly_budget numeric not null default 0);
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false, split_group text, split_index int, split_total int,
  client_submission_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade, total_salary numeric);
create table inventory (id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid, created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}`);
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql')));
  await admin.query(prBase(ROOT));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', 'Pedro'), ('${WORKER}', 'worker', '${OWNER}', 'active', 'Mark');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true); select pur_set_buyer('${BUYER2}', true);`);

  const mkFolder = async (name) => {
    const f = (await admin.query(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).rows[0].id;
    const p = (await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                  values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [OWNER, f])).rows[0].id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
    return f;
  };
  const mkLine = async (f, qty) => {
    const b = (await admin.query(`select pr_batch_for($1, now()) b`, [OWNER])).rows[0].b;
    const r = (await admin.query(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`, [OWNER, WORKER, f])).rows[0].id;
    const l = (await admin.query(`insert into pr_lines (owner_id, request_id, description, unit) values ($1, $2, 'Cement', 'bag') returning id`, [OWNER, r])).rows[0].id;
    const p = (await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4) returning id`, [OWNER, l, b, qty])).rows[0].id;
    return { line: l, portion: p };
  };
  const buy = (f, lines) => JSON.stringify({ source: 'purchasing', purchase_date: '2026-10-14',
    receipt_total: lines.reduce((s, l) => s + l.amount, 0),
    lines: lines.map(l => ({ destination: 'project', folder_id: f, item_name: 'Cement', unit: 'bag',
                             extra_reason: 'test', extra_location: 'project', ...l })) });
  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  async function pair(uidA, sqlA, argsA, uidB, sqlB, argsB) {
    const [a, b] = [await session(uidA), await session(uidB)];
    const run = async (c, sql, args) => {
      try {
        await c.query('begin');
        const r = await c.query(sql, args);
        await c.query('select pg_sleep(0.03)');
        await c.query('commit');
        return { ok: true, r: r.rows[0] && r.rows[0].r };
      } catch (e) {
        try { await c.query('rollback'); } catch {}
        return { ok: false, code: e.code, msg: e.message };
      }
    };
    const out = await Promise.all([run(a, sqlA, argsA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const REC = `select pur_record(gen_random_uuid(), $1::jsonb) r`;
  const CLAIM = `select pur_assign_portion($1, $2, null, null) r`;
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');
  const covered = async (line) => Number((await admin.query(`select pr_line_bought($1) n`, [line])).rows[0].n);
  const portionsOk = async (line) => (await admin.query(
    `select bool_and(pr_portion_bought(id) <= quantity) ok from pr_line_portions where line_id = $1`, [line])).rows[0].ok;

  // 1
  {
    let wins = 0, dead = 0, bad = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('claim ' + i);
      const t = await mkLine(f, 10);
      const out = await pair(BUYER, CLAIM, [t.portion, BUYER], BUYER2, CLAIM, [t.portion, BUYER2]);
      if (deadlock(out)) dead++;
      const ok = out.filter(o => o.ok).length;
      if (ok === 1 && out.some(o => !o.ok && /ASSIGNED_TO_OTHER/.test(o.msg))) wins++; else bad++;
    }
    check('1. two buyers claim the same portion: exactly one wins, the other is told it is taken', wins === ROUNDS && dead === 0,
      `wins ${wins}, deadlocks ${dead}, other outcomes ${bad}`);
  }
  // 2
  {
    let over = 0, dead = 0, errs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('cover ' + i);
      const t = await mkLine(f, 10);
      const out = await pair(BUYER, REC, [buy(f, [{ quantity: 7, amount: 700, request_line_id: t.line }])],
                             BUYER2, REC, [buy(f, [{ quantity: 7, amount: 700, request_line_id: t.line }])]);
      if (deadlock(out)) dead++;
      if (out.some(o => !o.ok)) errs++;
      if (await covered(t.line) > 10 || !(await portionsOk(t.line))) over++;
    }
    check('2. two purchases on the same last 10: both recorded, never more than 10 covered (the rest is extra)',
      over === 0 && dead === 0 && errs === 0, `over-covered ${over}, deadlocks ${dead}, failed calls ${errs}`);
  }
  // 3
  {
    let over = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('reduce ' + i);
      const t = await mkLine(f, 10);
      const out = await pair(BUYER, REC, [buy(f, [{ quantity: 6, amount: 600, request_line_id: t.line }])],
                             OWNER, `select pr_office_change_quantity($1, 3, 'site has some') r`, [t.line]);
      if (deadlock(out)) dead++;
      const still = Number((await admin.query(`select coalesce(sum(greatest(0, quantity - pending_reduction - pr_portion_bought(id))), 0) s
                                                 from pr_line_portions where line_id = $1`, [t.line])).rows[0].s);
      if (still < 0 || !(await portionsOk(t.line))) over++;
    }
    check('3. a purchase against an office reduction: no deadlock, nothing over-covered', over === 0 && dead === 0,
      `bad states ${over}, deadlocks ${dead}`);
  }
  // 4
  {
    let dead = 0, errs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('cross ' + i);
      const a = await mkLine(f, 10), b = await mkLine(f, 10);
      const out = await pair(BUYER, REC, [buy(f, [{ quantity: 3, amount: 3, request_line_id: a.line }, { quantity: 3, amount: 3, request_line_id: b.line }])],
                             BUYER2, REC, [buy(f, [{ quantity: 3, amount: 3, request_line_id: b.line }, { quantity: 3, amount: 3, request_line_id: a.line }])]);
      if (deadlock(out)) dead++;
      if (out.some(o => !o.ok)) errs++;
    }
    check('4. purchase A+B against purchase B+A: no deadlock, both recorded', dead === 0 && errs === 0, `deadlocks ${dead}, failed ${errs}`);
  }
  // 5
  {
    let dead = 0, bad = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('assign ' + i);
      const t = await mkLine(f, 10);
      const out = await pair(OWNER, CLAIM, [t.portion, BUYER2],
                             BUYER, REC, [buy(f, [{ quantity: 4, amount: 4, request_line_id: t.line }])]);
      if (deadlock(out)) dead++;
      const holders = (await admin.query(`select count(distinct buyer_id) n from pr_line_portions where line_id = $1 and buyer_id is not null`, [t.line])).rows[0].n;
      if (Number(holders) < 1 || !(await portionsOk(t.line))) bad++;
    }
    check('5. an assignment against a purchase on the same portion: no deadlock, someone holds it', dead === 0 && bad === 0,
      `deadlocks ${dead}, bad ${bad}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

Create `tests/purchasing-server.test.js`:

````js
// ════════════════════════════════════════════════════════════════════
// PURCHASING SERVER (0097) STATIC TESTS: run with  node tests/purchasing-server.test.js
//
// Zero dependencies. Reads supabase/migrations/0097_purchasing_office.sql
// and fences what behaviour tests cannot see (those are
// supabase/tests/2a2_purchasing.pglite.mjs, 2a2_concurrency.mjs and the
// 2A-1 suite re-run with 0097 — npm run test:sql):
//   1. Spent is untouched: 0097 redefines none of 0096's funding or
//      expense-row functions; covers never feed an amount.
//   2. Every function is either granted to signed-in users (and checks the
//      caller itself) or revoked from them; no policy for anon / public,
//      none "for all"; only SELECT policies — writes go through functions.
//   3. The shopping list is quantities and names only.
//   4. The live acceptance script is self-rolling-back; test:sql runs it all.
//   5. The review fixes (16 Oct): new request links need the Buyer switch
//      whatever the source; picks and history are authoritative; a change
//      request goes stale on ANY change; purchase rows are buyers-only with
//      Project Control's one-line read; substitutes wait for a check.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0097_purchasing_office.sql');
// SQL with -- comments removed, so a comment cannot satisfy a check.
const CODE = SQL.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function fnBody(name) {
  const m = CODE.match(new RegExp('create or replace function (?:public\\.)?' + name + '\\s*\\([\\s\\S]*?\\n(?:end )?\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found in 0097');
  return m[0];
}
const defined = [...CODE.matchAll(/create or replace function (?:public\.)?([a-z_]+)\s*\(/g)].map(m => m[1]);

console.log('\n0097: Spent is untouched');

test('0097 redefines none of the functions that turn a purchase into Spent', () => {
  for (const f of ['pur_fund', 'pur_charge_rows', 'pur_period_remaining', 'pur_cover_period', 'pur_clear_rows', 'pur_prorate', 'pur_move_stock']) {
    ok(!defined.includes(f), f + ' is redefined in 0097');
  }
});
test('covers carry quantities only — no amount column, and nothing reads them into an expense row', () => {
  const table = CODE.slice(CODE.indexOf('create table if not exists purchase_line_covers'), CODE.indexOf(');', CODE.indexOf('create table if not exists purchase_line_covers')));
  ok(!/amount|price|cost/i.test(table), 'a money column on purchase_line_covers');
  ok(!/insert into expenses/i.test(CODE), '0097 writes expense rows itself');
});
test('recording still writes its expense rows through 0096\'s pur_charge_rows, after the covers', () => {
  const ins = fnBody('pur_insert');
  ok(ins.indexOf('pur_cover_lines(v_id') < ins.indexOf('pur_charge_rows(v_id)'), 'pur_insert: covers, then charge rows');
  const cor = fnBody('pur_correct');
  ok(cor.includes('perform pur_clear_rows(p_purchase)') && cor.includes('pur_charge_rows(p_purchase)'), 'pur_correct still replaces its rows');
  ok(/drop function if exists pur_insert\(uuid, uuid, jsonb, jsonb\);/.test(CODE), 'the 4-argument pur_insert is dropped (no ambiguous overload)');
});
test('Bought counts RECORDED purchases only, and is rebuilt — never added to', () => {
  ok(/pu\.status = 'recorded'/.test(fnBody('pr_portion_bought')) && /pu\.status = 'recorded'/.test(fnBody('pr_line_bought')), 'recorded only');
  const cov = fnBody('pur_cover_lines');
  ok(/delete from purchase_line_covers c using purchase_lines l where l\.id = c\.line_id and l\.purchase_id = p_purchase;/.test(cov), 'covers rebuilt from scratch');
  ok(/greatest\(0, v_p\.quantity - v_p\.pending_reduction - pr_portion_bought\(v_p\.id\)\)/.test(cov), 'each portion up to its Still to buy');
  ok(/'EXTRA_REASON_REQUIRED'/.test(cov), 'an extra needs a reason');
});
test('a replacement voids the old purchase BEFORE recording the new one', () => {
  const rep = fnBody('pur_replace');
  ok(rep.indexOf("update purchases set status = 'void'") < rep.indexOf('pur_insert(v_owner'), 'void first');
});
test('a reduction protects bought quantity like arranged quantity', () => {
  const ap = fnBody('pr_apply_quantity');
  ok(/arranged_at is not null or pr_portion_bought\(id\) > 0/.test(ap), 'flagged on bought portions');
  ok(/buyer_id is null[\s\S]{0,80}pr_portion_bought\(id\) = 0/.test(ap), 'new demand never merges into a bought or assigned portion');
  ok(/'BOUGHT'/.test(fnBody('pr_office_move_portion')), 'a bought portion cannot move batch');
});

console.log('\n0097: access');

const PUBLIC = ['pur_me', 'pur_office_buyers', 'pur_set_buyer', 'pur_buyer_options', 'pur_suppliers', 'pur_save_supplier',
  'pur_assign_portion', 'pur_check_unit', 'pur_request_change', 'pur_withdraw_change', 'pur_decide_change', 'pur_change_requests',
  'pur_shopping_list', 'pur_purchases', 'pur_purchase', 'pur_correct', 'pur_replace', 'pur_buyer', 'pur_reader',
  'pur_entry_row', 'pur_review_lines'];
const STORAGE = ['uploads_can_read', 'uploads_can_write'];
const TRIGGER = ['receipt_mark_attached'];
test('every function is granted to signed-in users or revoked from them — none left in between', () => {
  for (const f of defined) {
    if (STORAGE.includes(f) || TRIGGER.includes(f) || f === 'pr_office_move_portion') continue;
    const granted = new RegExp('grant execute on function ' + f + '\\(').test(CODE);
    const revoked = new RegExp('revoke all on function ' + f + '\\([^)]*\\) from public, anon, authenticated').test(CODE);
    ok(granted !== revoked, f + (granted ? ' is both granted and revoked' : ' is neither granted nor revoked'));
    ok(granted === PUBLIC.includes(f), f + (granted ? ' is callable but not in the public list' : ' should be callable'));
  }
});
test('nothing is granted to anon or public; every policy is a SELECT policy for authenticated', () => {
  ok(!/grant [^;]* to [^;]*\b(anon|public)\b/i.test(CODE), 'a grant to anon/public');
  for (const m of CODE.matchAll(/create policy [^;]+;/g)) {
    const p = m[0];
    if (/on storage\.objects/.test(p) || /on public\.receipt_uploads/.test(p)) continue;
    ok(/for select to authenticated/.test(p), 'not a select-for-authenticated policy: ' + p.slice(0, 80));
  }
  ok(!/\bfor all\b/i.test(CODE), 'a "for all" policy');
});
test('every public function checks its caller first', () => {
  for (const f of PUBLIC.filter(f => !['pur_me', 'pur_buyer'].includes(f))) {
    const b = fnBody(f);
    ok(/pur_buyer\(\)|is_owner\(\)|pur_actor_owner\(|requested_by = v_uid/.test(b), f + ' does not check who is calling');
  }
});
test('the Buyer switch is the main owner\'s, for their own staff only', () => {
  const b = fnBody('pur_set_buyer');
  ok(/not coalesce\(is_owner\(\), false\)/.test(b) && /p\.role = 'staff' and p\.owner_id = v_uid/.test(b), 'owner, own staff');
  const can = fnBody('pur_can_buy');
  ok(/p\.allowed_modules \? 'expenses'/.test(can), 'Expenses section required (Q3 = B)');
  ok(/coalesce\(p\.status, 'active'\) = 'active'/.test(can), 'active accounts only');
});
test('only the owner reassigns someone else\'s portion; only the owner decides change requests', () => {
  const a = fnBody('pur_assign_portion');
  ok(/'ASSIGNED_TO_OTHER'/.test(a) && /'NOT_YOUR_PORTION'/.test(a) && /if not coalesce\(is_owner\(\), false\) then/.test(a), 'buyer limits');
  ok(/not coalesce\(is_owner\(\), false\)/.test(fnBody('pur_decide_change')), 'owner decides');
  ok(/'OWN_PURCHASE'/.test(fnBody('pur_check_unit')), 'never the buyer\'s own unit check');
});

console.log('\n0097: what workers and the shopping list can see');

test('the shopping list is quantities and names only', () => {
  const b = fnBody('pur_shopping_list');
  ok(!/gross_amount|receipt_total|'amount'|price/.test(b), 'money in the shopping list');
});
test('tables that hold purchase data are readable only through buyer / purchase-reader policies', () => {
  ok(/suppliers_buyer_read on suppliers for select to authenticated using \(can_access\(owner_id\) and pur_buyer\(\)\)/.test(CODE), 'suppliers');
  ok(/purchase_line_covers_reader on purchase_line_covers for select to authenticated using \(can_access\(owner_id\) and pur_reader\(\)\)/.test(CODE), 'covers');
  ok(/purchase_change_requests_read[\s\S]{0,200}is_owner\(\) or requested_by = auth\.uid\(\)/.test(CODE), 'change requests: owner or the requester');
});

console.log('\n0097: review fixes (16 Oct)');

test('review 1: a new request link, new picks or a takeover need the Buyer switch whatever the source', () => {
  const cov = fnBody('pur_cover_lines');
  ok(/if not v_may_buy and \(v_h is null or v_line\.portion_picks is distinct from v_h -> 'picks'\) then\s+raise exception 'BUYER_REQUIRED'/.test(cov), 'link guard');
  ok(/v_may_assign := v_may_buy and pur_can_buy\(v_buyer, pu\.owner_id\)/.test(cov), 'who may hand a portion over');
  ok(/p\.buyer_id is null and v_may_assign/.test(cov) && /if v_p\.buyer_id is null and v_may_assign then/.test(cov), 'unassigned portions only with that right');
  ok(/if p_kind <> 'void' and not pur_buyer\(\) and pur_links_changed\(p_purchase, p_body\) then\s+raise exception 'BUYER_REQUIRED'/.test(fnBody('pur_request_change')), 'nor through the owner');
});
test('review 2: picked portions are the only ones a line covers; history comes first and is taken before the change', () => {
  const cov = fnBody('pur_cover_lines');
  ok(/v_auto := case when v_picked then 0\s+when v_h is null then v_target\s+else greatest\(0, v_target - \(v_h ->> 'target'\)::numeric\) end;/.test(cov), 'automatic only for a new link or added quantity');
  ok(cov.indexOf("v_h -> 'covers'") > 0 && cov.indexOf("v_h -> 'covers'") < cov.indexOf('order by case when p.buyer_id = v_buyer'), 'history before automatic');
  const cor = fnBody('pur_correct');
  const h = 'v_hist := pur_cover_history(p_purchase)';
  ok(cor.indexOf(h) > 0 && cor.indexOf(h) < cor.indexOf('delete from purchase_lines'), 'correction: history before the lines go');
  ok(/pur_cover_lines\(p_purchase, v_uid, v_hist\)/.test(cor), 'correction uses it');
  const rp = fnBody('pur_replace');
  ok(rp.indexOf(h) > 0 && rp.indexOf(h) < rp.indexOf("update purchases set status = 'void'") && /pur_insert\(v_owner, v_uid, p_body, v_carry, v_keep, v_hist\)/.test(rp), 'replacement');
  const chk = fnBody('pur_check_unit');
  ok(chk.indexOf(h) > 0 && chk.indexOf(h) < chk.indexOf("set unit_check = 'confirmed'") && /pur_cover_lines\(p_purchase, v_uid, v_hist\)/.test(chk), 'unit check');
  ok(/pur_cover_lines\(v_id, p_actor, coalesce\(p_history, '\[\]'::jsonb\)\)/.test(fnBody('pur_insert')), 'a new purchase has no history');
});
test('review 3: a change request keeps the purchase as seen; approval re-checks all of it; a unit check counts as a change', () => {
  ok(/base_doc jsonb not null/.test(CODE), 'base_doc column');
  ok(/pu\.updated_at, pur_doc\(p_purchase\), v_uid, p_op/.test(fnBody('pur_request_change')), 'stored at request time');
  ok(/pu\.updated_at <> r\.base_updated_at or pur_doc\(pu\.id\) is distinct from r\.base_doc then/.test(fnBody('pur_decide_change')), 'stale on any change');
  ok(/update purchases set updated_at = now\(\) where id = p_purchase;/.test(fnBody('pur_check_unit')), 'a check changes the purchase');
  const cr = fnBody('pur_change_requests');
  ok(/'base', pur_review_doc/.test(cr) && /'proposed'/.test(cr) && /'changed_since'/.test(cr), 'the owner gets both versions');
  const rv = fnBody('pur_review_doc');
  for (const k of ["'purchase_date'", "'date_time'", "'supplier'", "'bought_by'", "'quantity'", "'unit'", "'picks'", "'shares'", "'receipts'"]) ok(rv.includes(k), 'review shows ' + k);
  ok(/pur_prorate\(/.test(rv), 'the automatic fee split is shown, not left blank');
});
test('R3: purchase rows are buyers-only; Project Control reads one line, nothing more', () => {
  ok(/create or replace function pur_reader\(\) returns boolean[\s\S]{0,120}begin\s+return pur_buyer\(\);\s+end;/.test(CODE), 'pur_reader = pur_buyer');
  const e = fnBody('pur_entry_row');
  ok(/pur_actor_owner\('expenses_form'\)/.test(e), 'accounts that may record');
  ok(!/purchase_line_covers|purchase_history|request_line_id|bought_by|change_requests/.test(e), 'nothing beyond the edit form');
  ok(/select coalesce\(jsonb_agg\(l\.id\), '\[\]'::jsonb\)/.test(fnBody('pur_review_lines')), 'review flags: ids only');
});
test('R14: a substitute needs a reason and an office check before it covers anything', () => {
  ok(/'SUBSTITUTE_REASON_REQUIRED'/.test(fnBody('pur_store')), 'reason');
  ok(/v_direct := lower\(btrim\(v_line\.unit\)\) = lower\(btrim\(v_req\.unit\)\) and not v_line\.substitute;/.test(fnBody('pur_cover_lines')), 'covers only after a check');
  ok(/'item', lower\(btrim\(l\.item_name\)\), 'substitute', l\.substitute/.test(fnBody('pur_keep_checks')), 'a check is kept for the same item only');
});

console.log('\n0097: proof');

test('the live acceptance script rolls back and ends with the success row', () => {
  const a = read('supabase/tests/2a2_acceptance.sql');
  ok(/^begin;$/m.test(a) && /\nrollback;\s*$/.test(a), 'begin … rollback');
  ok(!/create temp table/i.test(a), 'no temp table (the SQL editor breaks it)');
  ok(/'2a2 acceptance: all checks passed'/.test(a), 'success row');
});
test('npm run test:sql runs the 2A-2 suites and the 2A-1 suite with 0097', () => {
  const s = JSON.parse(read('package.json')).scripts['test:sql'];
  for (const part of ['2a2_purchasing.pglite.mjs', '2a2_concurrency.mjs', '2a1_purchase.pglite.mjs --with-0097']) ok(s.includes(part), part);
  ok(JSON.parse(read('package.json')).scripts.test.includes('tests/purchasing-server.test.js'), 'npm test runs this file');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

Patch `supabase/tests/2a1_purchase.pglite.mjs` (the `--with-0097` mode; the phone-purchasing refusal is now checked on a staff account without the switch — true before and after 0097):

````diff
diff --git a/supabase/tests/2a1_purchase.pglite.mjs b/supabase/tests/2a1_purchase.pglite.mjs
index e2e110c..05bcd8a 100644
--- a/supabase/tests/2a1_purchase.pglite.mjs
+++ b/supabase/tests/2a1_purchase.pglite.mjs
@@ -17,6 +17,11 @@ const HERE = path.dirname(fileURLToPath(import.meta.url));
 const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
 const MIG = process.env.DACS_0096 || path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql');
 const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
+// --with-0097: the same tests with 2A-2's migration applied on top — 0097
+// must not change how a purchase is recorded, funded, corrected or voided.
+const WITH_0097 = process.argv.includes('--with-0097');
+const PR_BASE = WITH_0097 ? (await import('./pr_base.mjs')).prBase(ROOT) : '';
+const M97 = WITH_0097 ? read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')) : '';
 const fnText = (src, name) => {
   const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i'));
   if (!m) throw new Error('function ' + name + ' not found');
@@ -87,6 +92,7 @@ async function fresh() {
   const db = new PGlite();
   await db.exec(BASE);
   await db.exec(read(MIG));
+  if (WITH_0097) { await db.exec(PR_BASE); await db.exec(M97); }
   await db.exec(`insert into profiles values
     ('${OWNER}', 'owner', null, 'active', null), ('${STAFF}', 'staff', '${OWNER}', 'active', null),
     ('${WORKER}', 'worker', '${OWNER}', 'active', null), ('${OTHER}', 'owner', null, 'active', null),
@@ -132,7 +138,7 @@ async function code(promise) {
   try { await promise; return 'no error'; } catch (e) { return e.message; }
 }
 
-console.log('\n2A-1 purchase recording (0096 on PGlite)');
+console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + ' on PGlite)');
 
 await test('§3.3 example: ₱8,000 on 14 Oct → ₱3,000 + ₱4,000 + ₱1,000 Cover (earliest billing number first)', async () => {
   const db = await fresh(); await as(db, OWNER);
@@ -519,7 +525,7 @@ await test('Expenses access only: a PM-focused account is refused; phone purchas
   assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }])))).includes('NOT_ALLOWED'), 'PM-only refused');
   await as(db, EXPSTAFF);
   await record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }]));
-  await as(db, OWNER);
+  // A staff account allowed Expenses but without the Buyer switch (2A-2).
   assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }], { source: 'workmate' })))).includes('BUYER_REQUIRED'), 'workmate refused');
 });
 
@@ -621,9 +627,13 @@ await test('reading purchases needs the same access as recording them: PM-only s
     await db.exec('reset role');
     return Object.values(n).join(',');
   };
+  // 0097 narrows this (review R3): purchase rows are read by those who may
+  // BUY — the owner and staff with the Buyer switch. Other staff keep
+  // Project Control's entry through pur_entry_row, and read no table.
+  if (WITH_0097) { await as(db, OWNER); await db.query(`select pur_set_buyer($1, true)`, [EXPSTAFF]); }
   eq(await seen(OWNER), '1,1,1,1,1');
   eq(await seen(EXPSTAFF), '1,1,1,1,1');
-  eq(await seen(STAFF), '1,1,1,1,1');
+  eq(await seen(STAFF), WITH_0097 ? '0,0,0,0,0' : '1,1,1,1,1', WITH_0097 ? 'staff without the Buyer switch read nothing (0097)' : 'staff');
   eq(await seen(PMONLY), '0,0,0,0,0', 'a PM-only account must read nothing');
   eq(await seen(WORKER), '0,0,0,0,0');
   eq(await seen(OTHER), '0,0,0,0,0', 'another company reads nothing');
````

Patch `tests/storage-access.test.js`:

````diff
diff --git a/tests/storage-access.test.js b/tests/storage-access.test.js
index 3a1b304..b23d6c7 100644
--- a/tests/storage-access.test.js
+++ b/tests/storage-access.test.js
@@ -72,6 +72,8 @@ const FOLDERS = {
   agreementDocs: 'template',
   signatures: 'uploaderOwn', 'signed-terms': 'uploaderOwn',
   expenseReceipts: 'tenant', payrollReceipts: 'tenant',
+  // 0097: one receipt per purchase — only accounts that may BUY in that company.
+  purchases: 'buyer',
 };
 const OWNER_ONLY_SQL = "('quotations', 'reimbursementReceipts')";
 const CLIENT_PROJECT_SQL = "('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms')";
@@ -182,6 +184,21 @@ test('receipt folders are tenant-locked (0089): owner/staff of THAT company only
     'overwrite policy is not tenant-locked for receipt folders');
 });
 
+test('purchase receipts are buyer-locked (0097): buyers of THAT company only, before every other rule', () => {
+  const r = lastFn('uploads_can_read');
+  const w = lastFn('uploads_can_write');
+  ok(r.includes("v_folder = 'purchases' then\n    return pur_buyer() and split_part(p_name, '/', 2) = data_owner_id()::text;"), 'read rule for purchases missing or reshaped');
+  ok(w.includes("v_folder = 'purchases' then\n    return pur_buyer() and v_seg2 = data_owner_id()::text;"), 'write rule for purchases missing or reshaped');
+  // Before the uploader read-back (a buyer switched off loses access) and the generic owner/staff grant.
+  ok(r.indexOf("v_folder = 'purchases'") < r.indexOf('p_owner_id = v_uid::text then return true'), 'read: purchases rule must precede the uploader read-back');
+  ok(r.indexOf("v_folder = 'purchases'") < r.indexOf('if is_owner() or is_staff() then return true'), 'read: purchases rule must precede the generic rule');
+  ok(w.indexOf("v_folder = 'purchases'") < w.indexOf('if is_owner() or is_staff() then return true'), 'write: purchases rule must precede the generic rule');
+  const sql = allRules();
+  const from = sql.lastIndexOf('create policy "uploads_admin_update"');
+  const upd = sql.slice(from, sql.indexOf(');', from) + 2);
+  ok(upd.includes("split_part(name, '/', 1) = 'purchases'") && upd.includes('pur_buyer()'), 'overwrite policy is not buyer-locked for purchases');
+});
+
 console.log('\nIII. Every upload folder is classified');
 function uploadFolders() {
   const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'js', f));
@@ -191,6 +208,7 @@ function uploadFolders() {
     /storage\.ref\(\s*[`'"]([A-Za-z][\w-]*)\//g,          // storage.ref('folder/…')
     /const path\s*=\s*[`'"]([A-Za-z][\w-]*)\//g,           // const path = `folder/…`
     /\b(?:store|contracts):\s*'([A-Za-z][\w-]*)'/g,        // expenses-module agreement config
+    /\b(?:expense|payroll|purchase):\s*'([A-Za-z][\w-]*)'/g, // receipt-storage.js FOLDER map
   ];
   for (const f of files) {
     const src = fs.readFileSync(f, 'utf8');
@@ -209,7 +227,8 @@ test('every folder the app uploads to has an access decision', () => {
 test('the scan still finds the known upload sites (guards against a silent regex miss)', () => {
   const found = uploadFolders();
   for (const f of ['expenseInbox', 'weeklyBillReceipts', 'procurementReceipts', 'signatures', 'signed-terms',
-                   'quotations', 'reimbursementReceipts', 'workerAgreementGlobal', 'workerAgreements']) {
+                   'quotations', 'reimbursementReceipts', 'workerAgreementGlobal', 'workerAgreements',
+                   'expenseReceipts', 'payrollReceipts', 'purchases']) {
     ok(found.has(f), 'scan no longer sees uploads to ' + f);
   }
 });
````

- [ ] **Step 2: Run them — they must fail for the right reason**

Run: `node supabase/tests/2a2_purchasing.pglite.mjs` → Expected: `ENOENT … 0097_purchasing_office.sql`.
Run: `node tests/purchasing-server.test.js` → Expected: `ENOENT … 0097_purchasing_office.sql`.
Run: `node tests/storage-access.test.js` → Expected: `FAIL purchase receipts are buyer-locked (0097)` (no `purchases` rule yet) and `FAIL the scan still finds the known upload sites` (no code uploads to `purchases/` yet).

- [ ] **Step 3: Write the migration, the acceptance scripts, the README entry and the test scripts**

`supabase/migrations/README.md` is stored with CRLF line endings: apply its hunk with the Edit tool (keep CRLF), not `git apply`.

Create `supabase/migrations/0097_purchasing_office.sql`:

````sql
-- 0097 — WorkMate Stage 2A-2: the office Purchasing tab and the Buyer switch.
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- (Buyer assignment, Partial buying, One receipt across projects, Office
-- side); answers: docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md;
-- plan: docs/superpowers/plans/2026-10-16-workmate-stage2a2-purchasing-office.md.
--
-- ── 1. The Buyer switch. The main owner turns it on per staff account.
--    Who may BUY: an active owner account, or an active staff account of that
--    owner with the switch on — and in both cases only an account allowed the
--    Expenses section (an account focused on other sections, e.g. admin-pm@ =
--    ["pm"], cannot buy; Q3 = B). Every rule is checked on the server, inside
--    the caller's own company (data_owner_id()). Phone purchasing ('workmate',
--    refused by 0096) and the Purchasing tab ('purchasing') need it; the
--    Expenses / Project Control forms ('expenses_form') keep 0096's rule for
--    ordinary entry — but linking a line to a request, picking portions or
--    taking a portion over needs the switch WHATEVER the source (review,
--    16 Oct). Purchase rows themselves are read only by those who may buy;
--    Project Control's staff entry reads the one line it edits through
--    pur_entry_row.
--
-- ── 2. Who is buying what. A request line's quantity already lives in
--    weekly-batch portions (0085). A portion now has a buyer. The office
--    assigns a whole portion or part of it (part = a new portion is split
--    off); a buyer claims an unassigned one ("I'll buy this"). Only the owner
--    reassigns someone else's portion. Assigning is NOT "arranged" — that
--    stays the separate 0086 mark. Every change is a pr_events row.
--
-- ── 3. Bought = covered by purchases, never a counter. A purchase line may
--    link to one request line. Portions PICKED on the form are authoritative:
--    the line covers those and nothing else. Without picks the server covers
--    the buyer's own portions, then unassigned ones (which the buyer then
--    holds), then (owner only) other buyers' — earliest batch first, each up
--    to its Still to buy. Once covered, a line's portions are its history:
--    a correction, replacement or unit check covers the SAME portions again
--    and covers others only for quantity it adds — a price fix never moves
--    coverage to another week. What a line cannot cover is EXTRA and needs a
--    reason and a location (same project or warehouse). The location is
--    where the goods are: the cost stays on the project's line (2C moves
--    cost, with the main owner's approval). A different unit, or a
--    substitute whose important specification differs, covers nothing until
--    the office confirms how much it covers (audited). Covers are rebuilt
--    from the stored purchase lines every time a purchase is recorded,
--    corrected, replaced or voided — in the same transaction as its expense
--    rows — so Bought can never be counted twice and Still to buy is never
--    negative.
--
-- ── 4. Owner approval. A staff correction that moves a cost to another
--    project, or touches a completed project, is sent to the owner as a
--    change request; approving runs the same correct / replace / void. The
--    request keeps the purchase exactly as the staff member saw it; any
--    change to the purchase since (a correction, a unit check, a receipt)
--    makes it stale. The owner sees every field of both versions.
--
-- ── 5. Suppliers and receipts. A simple supplier list. Purchase receipt
--    photos go to a private `purchases/` storage folder: readable only by
--    those who can buy in that company, checked on every download (Dacs Web
--    never hands out a signed link for this folder). Workers, team leaders,
--    clients and partners read nothing purchase-related.
--
-- Outside the money model: nothing here changes how a purchase becomes
-- Spent (0096 is unchanged in that respect).

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- The Buyer switch, one row per staff account that ever had it.
create table if not exists pur_buyers (
  user_id uuid primary key references profiles(id),
  owner_id uuid not null references profiles(id),
  is_buyer boolean not null default false,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);
create table if not exists pur_buyer_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  user_id uuid not null references profiles(id),
  is_buyer boolean not null,
  actor_id uuid not null references profiles(id),
  at timestamptz not null default now()
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  branch text not null default '' check (char_length(branch) <= 120),
  contact text not null default '' check (char_length(contact) <= 200),
  active boolean not null default true,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists suppliers_owner_name_branch on suppliers (owner_id, lower(btrim(name)), lower(btrim(branch)));

-- Who is buying a portion. Null = unassigned.
alter table pr_line_portions add column if not exists buyer_id uuid references profiles(id);
alter table pr_line_portions add column if not exists assigned_by uuid references profiles(id);
alter table pr_line_portions add column if not exists assigned_at timestamptz;
create index if not exists pr_line_portions_buyer on pr_line_portions (buyer_id) where buyer_id is not null;

-- Who actually bought (the encoder is recorded_by), and the supplier picked.
alter table purchases add column if not exists bought_by uuid references profiles(id);
alter table purchases add column if not exists supplier_id uuid references suppliers(id);
alter table purchases drop constraint if exists purchases_source_check;
alter table purchases add constraint purchases_source_check check (source in ('expenses_form', 'workmate', 'purchasing'));
alter table purchase_history drop constraint if exists purchase_history_kind_check;
alter table purchase_history add constraint purchase_history_kind_check
  check (kind in ('recorded', 'corrected', 'refunded', 'voided', 'replaced', 'unit_checked'));

-- A purchase line's link to a request, and what it did NOT cover.
alter table purchase_lines add column if not exists request_line_id uuid references pr_lines(id);
alter table purchase_lines add column if not exists portion_picks jsonb not null default '[]'::jsonb;
alter table purchase_lines add column if not exists covered_qty numeric(14,3) not null default 0 check (covered_qty >= 0);
alter table purchase_lines add column if not exists extra_qty numeric(14,3) not null default 0 check (extra_qty >= 0);
alter table purchase_lines add column if not exists extra_reason text not null default '' check (char_length(extra_reason) <= 300);
alter table purchase_lines add column if not exists extra_location text check (extra_location in ('project', 'warehouse'));
alter table purchase_lines add column if not exists unit_check text not null default 'none' check (unit_check in ('none', 'pending', 'confirmed'));
alter table purchase_lines add column if not exists unit_covers numeric(14,3) check (unit_covers >= 0);
alter table purchase_lines add column if not exists unit_checked_by uuid references profiles(id);
alter table purchase_lines add column if not exists unit_checked_at timestamptz;
alter table purchase_lines add column if not exists unit_note text not null default '' check (char_length(unit_note) <= 300);
alter table purchase_lines add column if not exists unplanned_reason text not null default '' check (char_length(unplanned_reason) <= 300);
-- A substitute: the buyer says an important specification differs from the
-- request (spec, 12 Oct). Its reason is kept; it covers the request only
-- after the office checks it, like a different unit.
alter table purchase_lines add column if not exists substitute boolean not null default false;
alter table purchase_lines add column if not exists substitute_reason text not null default '' check (char_length(substitute_reason) <= 300);
create index if not exists purchase_lines_request_line on purchase_lines (request_line_id) where request_line_id is not null;

-- Which portions a purchase line covers, and how much. Rebuilt with the
-- line; kept (as history) when the purchase is voided — every reader counts
-- only RECORDED purchases. A portion the office later removes keeps the
-- request line, so the line's Bought stays right.
create table if not exists purchase_line_covers (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  line_id uuid not null references purchase_lines(id) on delete cascade,
  request_line_id uuid not null references pr_lines(id),
  portion_id uuid references pr_line_portions(id) on delete set null,
  buyer_id uuid not null references profiles(id),
  quantity numeric(14,3) not null check (quantity > 0)
);
create index if not exists purchase_line_covers_line on purchase_line_covers (line_id);
create index if not exists purchase_line_covers_portion on purchase_line_covers (portion_id) where portion_id is not null;
create index if not exists purchase_line_covers_request_line on purchase_line_covers (request_line_id);

-- A staff change that needs the owner (Q13 = B).
create table if not exists purchase_change_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  kind text not null check (kind in ('correct', 'replace', 'void')),
  body jsonb,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  base_updated_at timestamptz not null,
  -- The purchase (pur_doc) exactly as the requester saw it. Approval applies
  -- only while the purchase still reads the same.
  base_doc jsonb not null,
  requested_by uuid not null references profiles(id),
  requested_at timestamptz not null default now(),
  op_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'stale')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  result jsonb,
  unique (requested_by, op_id),
  check ((kind = 'void') = (body is null))
);
create unique index if not exists purchase_change_requests_one_pending on purchase_change_requests (purchase_id) where status = 'pending';


-- ════ 2. Who may buy ═════════════════════════════════════════════════

-- May p_user buy for the company p_owner? An active account allowed the
-- Expenses section that is either that owner, or that owner's staff with
-- the Buyer switch on.
create or replace function pur_can_buy(p_user uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(p.status, 'active') = 'active'
       and (jsonb_typeof(p.allowed_modules) is distinct from 'array'
            or jsonb_array_length(p.allowed_modules) = 0
            or p.allowed_modules ? 'expenses')
       and ((p.role = 'owner' and p.id = p_owner)
            or (p.role = 'staff' and p.owner_id = p_owner
                and exists (select 1 from pur_buyers b
                             where b.user_id = p.id and b.owner_id = p_owner and b.is_buyer)))
      from profiles p where p.id = p_user), false)
$$;

-- The caller may buy in their own company. A boolean about the caller only:
-- the read policies below call it.
create or replace function pur_buyer() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_office() then
    return false;
  end if;
  return pur_can_buy(auth.uid(), data_owner_id());
end;
$$;

-- Who may READ purchase rows (0096's rule, narrowed — review R3): those who
-- may buy. 0096 let every staff account allowed Expenses read every
-- purchase, its lines, charges and history; Project Control's staff entry
-- now reads only the line it edits, through pur_entry_row / pur_review_lines
-- below. Every 0096 and 0097 read policy calls this.
create or replace function pur_reader() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return pur_buyer();
end;
$$;

-- What the screens need to know about the caller.
create or replace function pur_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('can_buy', pur_buyer(),
                            'is_owner', auth.uid() is not null and coalesce(is_owner(), false),
                            'user_id', auth.uid());
end;
$$;

-- A person's name for buyers and approvers: the display name, else the
-- part of the e-mail before the at sign (office accounts often have no
-- display name), else 'Office'.
create or replace function pur_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.display_name), ''), nullif(split_part(coalesce(p.email, ''), '@', 1), ''), 'Office')
    from profiles p where p.id = p_id
$$;

-- Reading: the office reads the switch; buyers read suppliers; the purchase
-- readers (buyers, above) read covers; change requests — the owner all of
-- them, buyers their own. Every write goes through the functions below.
alter table pur_buyers enable row level security;
alter table pur_buyer_events enable row level security;
alter table suppliers enable row level security;
alter table purchase_line_covers enable row level security;
alter table purchase_change_requests enable row level security;
drop policy if exists pur_buyers_office_read on pur_buyers;
create policy pur_buyers_office_read on pur_buyers for select to authenticated using (can_access(owner_id) and pr_is_office());
drop policy if exists pur_buyer_events_owner_read on pur_buyer_events;
create policy pur_buyer_events_owner_read on pur_buyer_events for select to authenticated using (can_access(owner_id) and is_owner());
drop policy if exists suppliers_buyer_read on suppliers;
create policy suppliers_buyer_read on suppliers for select to authenticated using (can_access(owner_id) and pur_buyer());
drop policy if exists purchase_line_covers_reader on purchase_line_covers;
create policy purchase_line_covers_reader on purchase_line_covers for select to authenticated using (can_access(owner_id) and pur_reader());
drop policy if exists purchase_change_requests_read on purchase_change_requests;
create policy purchase_change_requests_read on purchase_change_requests for select to authenticated
  using (can_access(owner_id) and pur_reader() and (is_owner() or requested_by = auth.uid()));

-- The owner's list of staff and their Buyer switch.
create or replace function pur_office_buyers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(is_owner(), false) then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', p.id, 'name', pur_person_name(p.id), 'email', p.email,
            'active', coalesce(p.status, 'active') = 'active',
            'is_buyer', coalesce(b.is_buyer, false),
            'expenses_ok', jsonb_typeof(p.allowed_modules) is distinct from 'array'
                           or jsonb_array_length(p.allowed_modules) = 0 or p.allowed_modules ? 'expenses',
            'can_buy', pur_can_buy(p.id, auth.uid()))
          order by pur_person_name(p.id)), '[]'::jsonb)
            from profiles p
            left join pur_buyers b on b.user_id = p.id
           where p.role = 'staff' and p.owner_id = auth.uid());
end;
$$;

-- The main owner turns a staff account's Buyer switch on or off.
create or replace function pur_set_buyer(p_user uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not coalesce(is_owner(), false) then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if p_on is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = p_user and p.role = 'staff' and p.owner_id = v_uid) then
    raise exception 'NOT_STAFF' using errcode = 'P0001';
  end if;
  insert into pur_buyers (user_id, owner_id, is_buyer, updated_by, updated_at)
  values (p_user, v_uid, p_on, v_uid, now())
  on conflict (user_id) do update set is_buyer = excluded.is_buyer, owner_id = excluded.owner_id,
                                      updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where pur_buyers.is_buyer is distinct from excluded.is_buyer or pur_buyers.owner_id <> excluded.owner_id;
  if found then
    insert into pur_buyer_events (owner_id, user_id, is_buyer, actor_id) values (v_uid, p_user, p_on, v_uid);
  end if;
  return jsonb_build_object('user_id', p_user, 'is_buyer', p_on, 'can_buy', pur_can_buy(p_user, v_uid));
end;
$$;

-- Who a portion can be assigned to: the company's accounts that may buy.
create or replace function pur_buyer_options() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', pur_person_name(p.id), 'is_me', p.id = auth.uid())
                                    order by p.id <> auth.uid(), pur_person_name(p.id)), '[]'::jsonb)
            from profiles p
           where (p.id = v_owner or (p.role = 'staff' and p.owner_id = v_owner))
             and pur_can_buy(p.id, v_owner));
end;
$$;

-- 0096's caller check, plus the Buyer switch: 'purchasing' (this tab) and
-- 'workmate' (the phone) need it; 'expenses_form' keeps 0096's rule (an
-- active owner/staff account allowed the Expenses section) for ordinary
-- entry. Whatever the source, a NEW request link, new picks or taking a
-- portion over need the switch too — pur_cover_lines refuses them.
create or replace function pur_actor_owner(p_source text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_mods jsonb;
begin
  if auth.uid() is null or not pr_is_office() then
    raise exception 'NOT_OFFICE' using errcode = 'P0001';
  end if;
  select p.allowed_modules into v_mods from profiles p where p.id = auth.uid();
  if jsonb_typeof(v_mods) = 'array' and jsonb_array_length(v_mods) > 0 and not (v_mods ? 'expenses') then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if coalesce(p_source, 'expenses_form') in ('workmate', 'purchasing') and not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

-- ════ 3. Suppliers ═══════════════════════════════════════════════════

create or replace function pur_suppliers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'branch', s.branch,
                                                       'contact', s.contact, 'active', s.active)
                                    order by s.active desc, lower(s.name), lower(s.branch)), '[]'::jsonb)
            from suppliers s where s.owner_id = data_owner_id());
end;
$$;

-- Add (p_id null) or change a supplier. A buyer can add one while recording.
create or replace function pur_save_supplier(p_id uuid, p_name text, p_branch text, p_contact text, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_branch, ''))) > 120 or char_length(btrim(coalesce(p_contact, ''))) > 200 then
    raise exception 'BAD_SUPPLIER' using errcode = 'P0001';
  end if;
  begin
    if p_id is null then
      insert into suppliers (owner_id, name, branch, contact, active, created_by)
      values (v_owner, btrim(p_name), btrim(coalesce(p_branch, '')), btrim(coalesce(p_contact, '')), coalesce(p_active, true), auth.uid())
      returning id into v_id;
    else
      update suppliers set name = btrim(p_name), branch = btrim(coalesce(p_branch, '')), contact = btrim(coalesce(p_contact, '')),
                           active = coalesce(p_active, active), updated_at = now()
       where id = p_id and owner_id = v_owner
      returning id into v_id;
      if v_id is null then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_SUPPLIER' using errcode = 'P0001';
  end;
  return (select jsonb_build_object('id', s.id, 'name', s.name, 'branch', s.branch, 'contact', s.contact, 'active', s.active)
            from suppliers s where s.id = v_id);
end;
$$;

-- ════ 4. Portions: who is buying, and how much is bought ════════════

-- How much of a portion RECORDED purchases cover (a voided purchase's
-- covers stay as history and count for nothing).
create or replace function pr_portion_bought(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0)
    from purchase_line_covers c
    join purchase_lines l on l.id = c.line_id
    join purchases pu on pu.id = l.purchase_id
   where c.portion_id = p_portion and pu.status = 'recorded'
$$;

-- How much of a request line recorded purchases cover (including covers
-- whose portion the office later removed).
create or replace function pr_line_bought(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0)
    from purchase_line_covers c
    join purchase_lines l on l.id = c.line_id
    join purchases pu on pu.id = l.purchase_id
   where c.request_line_id = p_line and pu.status = 'recorded'
$$;

-- Still to buy on a portion: what is needed and not yet covered. Never
-- negative — a portion covered beyond its (later reduced) need shows 0.
create or replace function pr_portion_still(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))
    from pr_line_portions p where p.id = p_portion
$$;

-- Split p_qty off a portion into a new portion of the same batch (same
-- "arranged" mark; the new one has no buyer yet). The caller holds the
-- line's lock and has checked that p_qty is part of the still-to-buy
-- quantity, so the original keeps everything bought and every pending
-- reduction.
create or replace function pr_split_portion(p_portion uuid, p_qty numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p record;
  v_id uuid;
begin
  select * into p from pr_line_portions where id = p_portion for update;
  if p.id is null or p_qty is null or p_qty <= 0 or p_qty >= p.quantity then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if p.pending_reduction > p.quantity - p_qty then
    raise exception 'REDUCTION_PENDING' using errcode = 'P0001';
  end if;
  update pr_line_portions set quantity = quantity - p_qty where id = p_portion;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity, arranged_at, arranged_by)
  values (p.owner_id, p.line_id, p.batch_id, p_qty, p.arranged_at, p.arranged_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- Assign, claim, reassign or release a portion (p_buyer null = release).
-- p_quantity null = all of its Still to buy; less = that part only (split
-- off into its own portion). Quantity already bought always stays where it
-- is, with the buyer who bought it: handing over a partly bought portion
-- splits off its still-to-buy part. Who may:
--   the owner — anything;
--   a Buyer — claim an unassigned portion ("I'll buy this"), give an
--   unassigned one to another buyer, release their own. Never someone
--   else's (ask the owner).
create or replace function pur_assign_portion(p_portion uuid, p_buyer uuid, p_quantity numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_line uuid;
  v_bought numeric;
  v_still numeric;
  v_qty numeric;
  v_target uuid;
  v_kind text;
  l record;
  p record;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  if char_length(btrim(coalesce(p_note, ''))) > 300 then
    raise exception 'BAD_NOTE' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion and owner_id = v_owner;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Same lock order as every other portion change (0085/0086): the line first.
  select ln.id, ln.owner_id, ln.request_id, ln.status, r.status as request_status
    into l from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = v_line for update of ln;
  if l.status <> 'open' or l.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if p_buyer is not null and not pur_can_buy(p_buyer, v_owner) then
    raise exception 'BAD_BUYER' using errcode = 'P0001';
  end if;
  if not coalesce(is_owner(), false) then
    if p_buyer is null and p.buyer_id is distinct from v_uid then
      raise exception 'NOT_YOUR_PORTION' using errcode = 'P0001';
    end if;
    if p_buyer is not null and p.buyer_id is not null and p.buyer_id <> p_buyer then
      raise exception 'ASSIGNED_TO_OTHER' using errcode = 'P0001';
    end if;
  end if;

  v_bought := pr_portion_bought(p.id);
  v_still := greatest(0, p.quantity - p.pending_reduction - v_bought);
  if p.buyer_id is not distinct from p_buyer and p_quantity is null then
    return jsonb_build_object('portion_id', p.id, 'changed', false);
  end if;
  if v_still <= 0 then
    raise exception 'NOTHING_TO_BUY' using errcode = 'P0001';
  end if;
  v_qty := coalesce(p_quantity, v_still);
  if v_qty <= 0 or v_qty > v_still or v_qty <> round(v_qty, 3) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;

  if v_bought = 0 and v_qty = v_still then
    v_target := p.id;           -- nothing bought: the whole portion changes hands
  else
    v_target := pr_split_portion(p.id, v_qty);   -- the bought part stays put
  end if;
  update pr_line_portions set buyer_id = p_buyer, assigned_by = v_uid, assigned_at = now() where id = v_target;

  v_kind := case when p_buyer is null then 'portion_released'
                 when p_buyer = v_uid and p.buyer_id is null then 'portion_claimed'
                 else 'portion_assigned' end;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, v_kind,
          jsonb_build_object('portion_id', v_target, 'from_portion_id', p.id, 'quantity', v_qty,
                             'from_buyer', case when p.buyer_id is null then null else pur_person_name(p.buyer_id) end,
                             'to_buyer', case when p_buyer is null then null else pur_person_name(p_buyer) end,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('portion_id', v_target, 'changed', true, 'split', v_target <> p.id);
end;
$$;

-- 0085's quantity rule, now protecting what was BOUGHT as well as what was
-- arranged (spec: "reduce newest unarranged demand first, then flag
-- supplier-arranged/purchased portions for action"):
--   increase → first take back quantity flagged for reduction (newest
--              first); the rest is new demand in NOW's batch, merged only
--              into a portion nobody is buying and nothing covers yet;
--   decrease → remove unbought, unarranged quantity first — unassigned
--              portions before assigned ones, newest first; a portion is
--              deleted only when nothing of it was bought. Whatever is left
--              is FLAGGED (pending_reduction) on arranged or bought
--              portions for the office: a placed order or a purchase is
--              never erased.
create or replace function pr_apply_quantity(p_line uuid, p_new numeric, p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_delta numeric;
  v_take numeric;
  v_free numeric;
  v_batch uuid;
  v_target uuid;
  p record;
begin
  select coalesce(sum(quantity - pending_reduction), 0) into v_total
    from pr_line_portions where line_id = p_line;

  if p_new > v_total then
    v_delta := p_new - v_total;
    for p in select * from pr_line_portions
              where line_id = p_line and pending_reduction > 0
                and (arranged_at is not null or pr_portion_bought(id) > 0)
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.pending_reduction);
      update pr_line_portions set pending_reduction = pending_reduction - v_take where id = p.id;
      v_delta := v_delta - v_take;
    end loop;
    if v_delta > 0 then
      v_batch := pr_batch_for(p_owner, now());
      select id into v_target from pr_line_portions
       where line_id = p_line and batch_id = v_batch and arranged_at is null and buyer_id is null
         and pr_portion_bought(id) = 0
       order by created_at desc, id desc limit 1 for update;
      if v_target is not null then
        update pr_line_portions set quantity = quantity + v_delta where id = v_target;
      else
        insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (p_owner, p_line, v_batch, v_delta);
      end if;
    end if;

  elsif p_new < v_total then
    v_delta := v_total - p_new;
    for p in select * from pr_line_portions
              where line_id = p_line and arranged_at is null
              order by (buyer_id is not null), created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_free := greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id));
      v_take := least(v_delta, v_free);
      continue when v_take <= 0;
      if v_take >= p.quantity then
        delete from pr_line_portions where id = p.id;
      else
        update pr_line_portions set quantity = quantity - v_take where id = p.id;
      end if;
      v_delta := v_delta - v_take;
    end loop;
    for p in select * from pr_line_portions
              where line_id = p_line and (arranged_at is not null or pr_portion_bought(id) > 0)
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.quantity - p.pending_reduction);
      if v_take > 0 then
        update pr_line_portions set pending_reduction = pending_reduction + v_take where id = p.id;
        v_delta := v_delta - v_take;
      end if;
    end loop;
  end if;
end;
$$;

-- 0086's move to another weekly batch, refusing a portion something was
-- already bought for (its purchase belongs to that batch's buying), and
-- merging only into a portion with the same buyer that nothing covers.
create or replace function pr_office_move_portion(p_portion uuid, p_batch uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  v_target uuid;
  v_merged boolean := false;
  l record;
  p record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.arranged_at is not null then
    raise exception 'ARRANGED' using errcode = 'P0001';
  end if;
  if pr_portion_bought(p.id) > 0 then
    raise exception 'BOUGHT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pr_batches b where b.id = p_batch and b.owner_id = l.owner_id) then
    raise exception 'BAD_BATCH' using errcode = 'P0001';
  end if;
  if p.batch_id = p_batch then
    return jsonb_build_object('moved', false, 'merged', false);
  end if;

  select id into v_target from pr_line_portions
   where line_id = v_line and batch_id = p_batch and arranged_at is null and id <> p_portion
     and buyer_id is not distinct from p.buyer_id and pr_portion_bought(id) = 0
   order by created_at desc, id desc limit 1 for update;
  if v_target is not null then
    update pr_line_portions set quantity = quantity + p.quantity where id = v_target;
    delete from pr_line_portions where id = p_portion;
    v_merged := true;
  else
    update pr_line_portions set batch_id = p_batch where id = p_portion;
  end if;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'portion_moved',
          jsonb_build_object('from_batch', p.batch_id, 'to_batch', p_batch, 'quantity', p.quantity,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('moved', true, 'merged', v_merged);
end;
$$;

-- ════ 5. Recording a purchase against requests ═══════════════════════

-- 0096's lock keys, plus each request line a body or stored purchase
-- covers ('pr_line:'), taken in the same single sorted pass (pur_lock), so
-- two purchases covering the same request line wait for each other.
create or replace function pur_body_keys(p_body jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(k), '{}') from (
    select 'pur_folder:' || coalesce(pur_uuid(l ->> 'folder_id')::text, btrim(l ->> 'folder_id')) k
      from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) l
     where coalesce(l ->> 'folder_id', '') <> ''
    union
    select 'pur_stock:' || lower(btrim(l ->> 'item_name'))
      from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) l
     where (l ->> 'in_inventory') = 'true' and coalesce(btrim(l ->> 'item_name'), '') <> ''
    union
    select 'pr_line:' || coalesce(pur_uuid(l ->> 'request_line_id')::text, btrim(l ->> 'request_line_id'))
      from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) l
     where coalesce(l ->> 'request_line_id', '') <> ''
  ) x
$$;

create or replace function pur_stored_keys(p_purchase uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct k), '{}') from (
    select 'pur_folder:' || l.folder_id k from purchase_lines l where l.purchase_id = p_purchase and l.folder_id is not null
    union
    select 'pr_line:' || l.request_line_id from purchase_lines l where l.purchase_id = p_purchase and l.request_line_id is not null
  ) x
$$;

-- Who bought, from a body: the given buyer, else (Purchasing tab / phone)
-- the caller, else p_current (a correction keeps the stored one). Only the
-- owner records a purchase for someone else, and only for an account that
-- may buy in this company.
create or replace function pur_bought_by(p_owner uuid, p_body jsonb, p_current uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := pur_uuid(p_body ->> 'bought_by');
begin
  if coalesce(btrim(p_body ->> 'bought_by'), '') <> '' and v is null then
    raise exception 'BAD_BUYER' using errcode = 'P0001';
  end if;
  if v is null then
    return coalesce(p_current, case when coalesce(p_body ->> 'source', 'expenses_form') in ('purchasing', 'workmate') then auth.uid() end);
  end if;
  if v is distinct from p_current then
    if v <> auth.uid() and not coalesce(is_owner(), false) then
      raise exception 'BAD_BUYER' using errcode = 'P0001';
    end if;
    if not pur_can_buy(v, p_owner) then
      raise exception 'BAD_BUYER' using errcode = 'P0001';
    end if;
  end if;
  return v;
end;
$$;

-- The supplier picked from the list (this company's), or null.
create or replace function pur_supplier_of(p_owner uuid, p_body jsonb) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := pur_uuid(p_body ->> 'supplier_id');
begin
  if coalesce(btrim(p_body ->> 'supplier_id'), '') = '' then
    return null;
  end if;
  if v is null or not exists (select 1 from suppliers s where s.id = v and s.owner_id = p_owner) then
    raise exception 'BAD_SUPPLIER' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- 0096's validate-and-store, plus each line's request link: request_line_id
-- (that request's own project/work, a project line), portion_picks
-- [{portion_id, quantity}], extra_reason / extra_location, substitute /
-- substitute_reason, and — for the Purchasing tab and the phone —
-- unplanned_reason when there is no request. Coverage itself (and who may
-- link) is pur_cover_lines'.
create or replace function pur_store(p_owner uuid, p_purchase uuid, p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lines jsonb := coalesce(p_body -> 'lines', '[]'::jsonb);
  v_charges jsonb := coalesce(p_body -> 'charges', '[]'::jsonb);
  v_source text := (select pu.source from purchases pu where pu.id = p_purchase);
  v_line jsonb;
  v_charge jsonb;
  v_share jsonb;
  v_pick jsonb;
  v_picks jsonb;
  v_dest text;
  v_folder uuid;
  v_folder_name text;
  v_req uuid;
  v_req_work uuid;
  v_loc text;
  v_sub boolean;
  v_amount numeric;
  v_qty numeric;
  v_min numeric;
  v_id uuid;
  v_line_ids uuid[] := '{}';
  v_line_gross numeric[] := '{}';
  v_gross numeric := 0;
  v_fees numeric := 0;
  v_discounts numeric := 0;
  v_shares numeric[];
  v_no int;
  n int := 0;
  c int := 0;
  k int;
begin
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) not between 1 and 50 then
    raise exception 'BAD_LINES' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_charges) is distinct from 'array' or jsonb_array_length(v_charges) > 10 then
    raise exception 'BAD_CHARGES' using errcode = 'P0001';
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    n := n + 1;
    v_dest := coalesce(v_line ->> 'destination', 'project');
    v_folder := pur_uuid(v_line ->> 'folder_id');
    if coalesce(btrim(v_line ->> 'folder_id'), '') <> '' and v_folder is null then
      raise exception 'BAD_PROJECT' using errcode = 'P0001';
    end if;
    v_amount := pur_money(v_line ->> 'amount');
    v_qty := case when v_line ->> 'quantity' is null then 1 else pur_qty(v_line ->> 'quantity') end;
    v_min := case when v_line ->> 'min_stock' is null then 0 else pur_qty(v_line ->> 'min_stock') end;
    if v_amount is null then
      raise exception 'BAD_AMOUNT' using errcode = 'P0001';
    end if;
    if v_line -> 'in_inventory' is not null and jsonb_typeof(v_line -> 'in_inventory') not in ('boolean', 'null') then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    if v_qty is null or v_min is null or v_qty <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'P0001';
    end if;
    if char_length(btrim(coalesce(v_line ->> 'item_name', ''))) not between 1 and 200 then
      raise exception 'BAD_NAME' using errcode = 'P0001';
    end if;
    v_folder_name := '';
    if v_dest = 'project' then
      -- The project must belong to this company.
      select f.name into v_folder_name from folders f where f.id = v_folder and f.owner_id = p_owner;
      if v_folder is null or v_folder_name is null then
        raise exception 'BAD_PROJECT' using errcode = 'P0001';
      end if;
      -- Completion is stamped on the main project: an Additional Works job
      -- under a completed project is locked too.
      if not is_owner() and exists (select 1 from folders f
                                     left join folders par on par.id = f.parent_folder_id
                                    where f.id = v_folder
                                      and (f.completed_at is not null or par.completed_at is not null)) then
        raise exception 'COMPLETED_PROJECT' using errcode = 'P0001';
      end if;
    elsif v_dest = 'warehouse' then
      if v_folder is not null then
        raise exception 'BAD_PROJECT' using errcode = 'P0001';
      end if;
    else
      raise exception 'BAD_DESTINATION' using errcode = 'P0001';
    end if;

    -- The request this line is for: same company, same project/work.
    v_req := pur_uuid(v_line ->> 'request_line_id');
    if coalesce(btrim(v_line ->> 'request_line_id'), '') <> '' then
      select r.work_folder_id into v_req_work
        from pr_lines ln join pr_requests r on r.id = ln.request_id
       where ln.id = v_req and ln.owner_id = p_owner;
      if v_req is null or v_req_work is null or v_dest <> 'project' or v_req_work <> v_folder then
        raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
      end if;
    end if;
    v_picks := '[]'::jsonb;
    if v_line -> 'portion_picks' is not null and jsonb_typeof(v_line -> 'portion_picks') <> 'null' then
      if jsonb_typeof(v_line -> 'portion_picks') <> 'array' or (v_req is null and jsonb_array_length(v_line -> 'portion_picks') > 0) then
        raise exception 'BAD_PORTION' using errcode = 'P0001';
      end if;
      for v_pick in select value from jsonb_array_elements(v_line -> 'portion_picks') loop
        if pur_uuid(v_pick ->> 'portion_id') is null or pur_qty(v_pick ->> 'quantity') is null
           or pur_qty(v_pick ->> 'quantity') <= 0 then
          raise exception 'BAD_PORTION' using errcode = 'P0001';
        end if;
        v_picks := v_picks || jsonb_build_object('portion_id', pur_uuid(v_pick ->> 'portion_id'),
                                                 'quantity', pur_qty(v_pick ->> 'quantity'));
      end loop;
    end if;
    v_loc := nullif(btrim(coalesce(v_line ->> 'extra_location', '')), '');
    if v_loc is not null and v_loc not in ('project', 'warehouse') then
      raise exception 'BAD_EXTRA' using errcode = 'P0001';
    end if;
    if char_length(btrim(coalesce(v_line ->> 'extra_reason', ''))) > 300
       or char_length(btrim(coalesce(v_line ->> 'unplanned_reason', ''))) > 300 then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    if v_req is null and v_source in ('purchasing', 'workmate')
       and btrim(coalesce(v_line ->> 'unplanned_reason', '')) = '' then
      raise exception 'UNPLANNED_REASON_REQUIRED' using errcode = 'P0001';
    end if;
    -- A substitute (only for a request) states why; the office checks it.
    if v_line -> 'substitute' is not null and jsonb_typeof(v_line -> 'substitute') not in ('boolean', 'null') then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    v_sub := v_req is not null and coalesce((v_line ->> 'substitute')::boolean, false);
    if char_length(btrim(coalesce(v_line ->> 'substitute_reason', ''))) > 300 then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    if v_sub and btrim(coalesce(v_line ->> 'substitute_reason', '')) = '' then
      raise exception 'SUBSTITUTE_REASON_REQUIRED' using errcode = 'P0001';
    end if;

    insert into purchase_lines (owner_id, purchase_id, line_no, destination, folder_id, folder_name, item_name, category,
                                quantity, unit, gross_amount, in_inventory, min_stock,
                                request_line_id, portion_picks, extra_reason, extra_location, unplanned_reason,
                                substitute, substitute_reason)
    values (p_owner, p_purchase, n, v_dest, v_folder, coalesce(v_folder_name, ''), btrim(v_line ->> 'item_name'),
            btrim(coalesce(v_line ->> 'category', '')), v_qty, btrim(coalesce(v_line ->> 'unit', '')), v_amount,
            coalesce((v_line ->> 'in_inventory')::boolean, false), v_min,
            v_req, v_picks, btrim(coalesce(v_line ->> 'extra_reason', '')), v_loc,
            case when v_req is null then btrim(coalesce(v_line ->> 'unplanned_reason', '')) else '' end,
            v_sub, case when v_sub then btrim(v_line ->> 'substitute_reason') else '' end)
    returning id into v_id;
    v_line_ids := v_line_ids || v_id;
    v_line_gross := v_line_gross || v_amount;
    v_gross := v_gross + v_amount;
  end loop;

  for v_charge in select value from jsonb_array_elements(v_charges) loop
    c := c + 1;
    v_amount := pur_money(v_charge ->> 'amount');
    if v_amount is null or v_amount = 0 then
      raise exception 'BAD_AMOUNT' using errcode = 'P0001';
    end if;
    if coalesce(v_charge ->> 'kind', '') not in ('delivery_fee', 'discount') then
      raise exception 'BAD_CHARGES' using errcode = 'P0001';
    end if;
    insert into purchase_charges (owner_id, purchase_id, charge_no, kind, amount)
    values (p_owner, p_purchase, c, v_charge ->> 'kind', v_amount)
    returning id into v_id;
    if v_charge ->> 'kind' = 'delivery_fee' then
      v_fees := v_fees + v_amount;
    else
      v_discounts := v_discounts + v_amount;
    end if;

    -- Shares: given by line number, or by default in proportion to the
    -- lines' item amounts (Q4). They must add up to the charge exactly.
    if jsonb_typeof(v_charge -> 'shares') = 'array' and jsonb_array_length(v_charge -> 'shares') > 0 then
      v_shares := array_fill(0::numeric, array[n]);
      for v_share in select value from jsonb_array_elements(v_charge -> 'shares') loop
        v_no := case when (v_share ->> 'line') ~ '^\d{1,3}$' then (v_share ->> 'line')::int end;
        if v_no is null or v_no not between 1 and n or pur_money(v_share ->> 'amount') is null then
          raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
        end if;
        v_shares[v_no] := v_shares[v_no] + pur_money(v_share ->> 'amount');
      end loop;
    else
      v_shares := pur_prorate(v_amount, v_line_gross);
    end if;
    if (select sum(x) from unnest(v_shares) x) is distinct from v_amount
       or exists (select 1 from unnest(v_shares) x where x < 0) then
      raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
    end if;
    for k in 1 .. n loop
      if v_shares[k] > 0 then
        insert into purchase_charge_shares (charge_id, line_id, amount) values (v_id, v_line_ids[k], v_shares[k]);
      end if;
    end loop;
    -- What was stored must equal the charge (never more, never less).
    if (select coalesce(sum(s.amount), 0) from purchase_charge_shares s where s.charge_id = v_id) <> v_amount then
      raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
    end if;
  end loop;

  -- A line's discounts can never exceed its item amount (no negative rows).
  if exists (select 1
               from purchase_lines l
               join purchase_charge_shares s on s.line_id = l.id
               join purchase_charges ch on ch.id = s.charge_id and ch.kind = 'discount'
              where l.purchase_id = p_purchase
              group by l.id, l.gross_amount
             having sum(s.amount) > l.gross_amount) then
    raise exception 'DISCOUNT_TOO_LARGE' using errcode = 'P0001';
  end if;

  -- Lines + fees − discounts must equal the receipt total.
  if v_gross + v_fees - v_discounts <> (select pu.receipt_total from purchases pu where pu.id = p_purchase) then
    raise exception 'TOTAL_MISMATCH' using errcode = 'P0001';
  end if;
end;
$$;

-- What a purchase's request lines covered, as it stands — kept before a
-- correction, replacement or unit check, and authoritative afterwards:
-- [{line_no, request_line_id, picks, target, covers: [{portion_id, quantity}]}].
-- target = what the line counted toward its request: its quantity when it
-- counts directly, what the office check said, else 0.
create or replace function pur_cover_history(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'line_no', l.line_no, 'request_line_id', l.request_line_id, 'picks', l.portion_picks,
           'target', case when l.unit_check = 'confirmed' then coalesce(l.unit_covers, 0)
                          when l.unit_check = 'none' then l.quantity else 0 end,
           'covers', (select coalesce(jsonb_agg(jsonb_build_object('portion_id', c.portion_id, 'quantity', c.quantity) order by c.id), '[]'::jsonb)
                        from purchase_line_covers c where c.line_id = l.id and c.portion_id is not null))
         order by l.line_no), '[]'::jsonb)
    from purchase_lines l where l.purchase_id = p_purchase and l.request_line_id is not null
$$;

-- Rebuild what a purchase covers, from its stored lines. Called after the
-- lines are (re)stored, and after a unit check; the caller holds the
-- purchase's 'pr_line:' locks. p_history = pur_cover_history taken BEFORE
-- the change ('[]' for a new purchase; null = take it now). For each line
-- linked to a request:
--   who            → a request link, or portion picks, that the history does
--                    not already have are a buying decision: only someone who
--                    may buy (pur_buyer) makes it, whatever the source. Only
--                    someone who may buy hands an unassigned portion to the
--                    purchase's buyer, and only if that buyer may buy;
--   counts         → same unit and not a substitute: up to its quantity;
--                    otherwise nothing until the office confirms how much
--                    (unit_check 'confirmed', unit_covers), then that much;
--   picked         → portions picked on the form are AUTHORITATIVE: the line
--                    covers those, at most the picked quantity each, and no
--                    other portion — the rest is extra;
--   history        → otherwise the portions this line covered before come
--                    first, in their old order; other portions are covered
--                    only for what the line's target ROSE by, so a price fix,
--                    a reduced request or a check on another line never moves
--                    coverage to another week;
--   automatically  → a new link: the buyer's own portions, then unassigned
--                    ones (the buyer now holds them), then — the owner only —
--                    other buyers' portions; within each, the earliest batch
--                    first. Each portion takes at most its Still to buy, so
--                    Still to buy never goes negative;
--   extra          → (counts directly) the quantity it could not cover; needs
--                    a reason and a location — except when the line's target
--                    did not rise since its history: then the request shrank
--                    after buying, and the line says so.
-- A voided purchase covers nothing (its rows stay as history).
create or replace function pur_cover_lines(p_purchase uuid, p_actor uuid, p_history jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hist jsonb := coalesce(p_history, pur_cover_history(p_purchase));
  pu purchases;
  v_buyer uuid;
  v_owner_caller boolean := coalesce(is_owner(), false);
  v_may_buy boolean := pur_buyer();
  v_may_assign boolean;
  v_line record;
  v_req record;
  v_h jsonb;
  v_pick jsonb;
  v_p record;
  v_direct boolean;
  v_picked boolean;
  v_target numeric;
  v_left numeric;
  v_auto numeric;
  v_cap numeric;
  v_take numeric;
  v_extra numeric;
  v_out jsonb := '[]'::jsonb;
begin
  select * into pu from purchases where id = p_purchase;
  v_buyer := coalesce(pu.bought_by, pu.recorded_by);
  v_may_assign := v_may_buy and pur_can_buy(v_buyer, pu.owner_id);
  delete from purchase_line_covers c using purchase_lines l where l.id = c.line_id and l.purchase_id = p_purchase;
  if pu.status <> 'recorded' then
    return v_out;
  end if;

  for v_line in select * from purchase_lines where purchase_id = p_purchase and request_line_id is not null order by line_no loop
    select ln.id, ln.unit, ln.request_id, ln.owner_id into v_req
      from pr_lines ln where ln.id = v_line.request_line_id for update;
    -- This line's history: the same line number, still for the same request.
    v_h := (select h from jsonb_array_elements(v_hist) h
             where (h ->> 'line_no')::int = v_line.line_no and h ->> 'request_line_id' = v_line.request_line_id::text);
    if not v_may_buy and (v_h is null or v_line.portion_picks is distinct from v_h -> 'picks') then
      raise exception 'BUYER_REQUIRED' using errcode = 'P0001',
        hint = 'Line ' || v_line.line_no || ': linking a purchase to a request needs the Buyer switch.';
    end if;
    v_direct := lower(btrim(v_line.unit)) = lower(btrim(v_req.unit)) and not v_line.substitute;
    v_picked := jsonb_array_length(v_line.portion_picks) > 0;
    v_target := case when v_direct then v_line.quantity
                     when v_line.unit_check = 'confirmed' then coalesce(v_line.unit_covers, 0)
                     else 0 end;
    v_left := v_target;
    v_auto := case when v_picked then 0
                   when v_h is null then v_target
                   else greatest(0, v_target - (v_h ->> 'target')::numeric) end;

    if v_picked then
      -- The portions picked on the form, in the order given — and only those.
      for v_pick in select value from jsonb_array_elements(v_line.portion_picks) loop
        exit when v_left <= 0;
        select * into v_p from pr_line_portions
         where id = (v_pick ->> 'portion_id')::uuid and line_id = v_line.request_line_id for update;
        if v_p.id is null then
          continue when v_h is not null;   -- a portion removed since: nothing to cover there
          raise exception 'BAD_PORTION' using errcode = 'P0001';
        end if;
        if v_h is null and not v_owner_caller and v_p.buyer_id is not null and v_p.buyer_id <> v_buyer then
          raise exception 'ASSIGNED_TO_OTHER' using errcode = 'P0001';
        end if;
        v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
        v_take := least(v_left, (v_pick ->> 'quantity')::numeric, v_cap);
        continue when v_take <= 0;
        insert into purchase_line_covers (owner_id, line_id, request_line_id, portion_id, buyer_id, quantity)
        values (v_line.owner_id, v_line.id, v_line.request_line_id, v_p.id, v_buyer, v_take);
        v_left := v_left - v_take;
        if v_p.buyer_id is null and v_may_assign then
          update pr_line_portions set buyer_id = v_buyer, assigned_by = p_actor, assigned_at = now() where id = v_p.id;
          insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
          values (v_req.owner_id, v_req.request_id, v_req.id, p_actor, 'portion_claimed',
                  jsonb_build_object('portion_id', v_p.id, 'quantity', v_p.quantity, 'to_buyer', pur_person_name(v_buyer),
                                     'by_purchase', p_purchase));
        end if;
      end loop;
    elsif v_h is not null then
      -- The portions this line covered before, in their old order. Nothing
      -- is taken over: they were this purchase's already.
      for v_pick in select value from jsonb_array_elements(v_h -> 'covers') loop
        exit when v_left <= 0;
        select * into v_p from pr_line_portions
         where id = (v_pick ->> 'portion_id')::uuid and line_id = v_line.request_line_id for update;
        continue when v_p.id is null;
        v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
        v_take := least(v_left, v_cap);
        continue when v_take <= 0;
        insert into purchase_line_covers (owner_id, line_id, request_line_id, portion_id, buyer_id, quantity)
        values (v_line.owner_id, v_line.id, v_line.request_line_id, v_p.id, v_buyer, v_take);
        v_left := v_left - v_take;
      end loop;
    end if;

    -- Then automatically, up to v_auto: own, unassigned, (owner only) others'.
    if v_left > 0 and v_auto > 0 then
      for v_p in
        select p.* from pr_line_portions p join pr_batches b on b.id = p.batch_id
         where p.line_id = v_line.request_line_id
           and (p.buyer_id = v_buyer
                or (p.buyer_id is null and v_may_assign)
                or (p.buyer_id is not null and v_owner_caller))
         order by case when p.buyer_id = v_buyer then 0 when p.buyer_id is null then 1 else 2 end,
                  b.cutoff_at, p.created_at, p.id
         for update of p
      loop
        exit when v_left <= 0 or v_auto <= 0;
        v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
        v_take := least(v_left, v_auto, v_cap);
        continue when v_take <= 0;
        insert into purchase_line_covers (owner_id, line_id, request_line_id, portion_id, buyer_id, quantity)
        values (v_line.owner_id, v_line.id, v_line.request_line_id, v_p.id, v_buyer, v_take);
        v_left := v_left - v_take;
        v_auto := v_auto - v_take;
        if v_p.buyer_id is null then
          update pr_line_portions set buyer_id = v_buyer, assigned_by = p_actor, assigned_at = now() where id = v_p.id;
          insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
          values (v_req.owner_id, v_req.request_id, v_req.id, p_actor, 'portion_claimed',
                  jsonb_build_object('portion_id', v_p.id, 'quantity', v_p.quantity, 'to_buyer', pur_person_name(v_buyer),
                                     'by_purchase', p_purchase));
        end if;
      end loop;
    end if;

    v_extra := case when v_direct then v_line.quantity - (v_target - v_left) else 0 end;
    -- The line's target did not rise since its history: the extra comes from
    -- the request shrinking after buying — say so, never ask the person
    -- fixing a price for a buying reason they never had.
    if v_extra > 0 and v_h is not null and v_target <= (v_h ->> 'target')::numeric and btrim(v_line.extra_reason) = '' then
      update purchase_lines set extra_reason = 'The request was reduced after this was bought',
                                extra_location = coalesce(extra_location, 'project')
       where id = v_line.id
      returning * into v_line;
    end if;
    if v_extra > 0 and (btrim(v_line.extra_reason) = '' or v_line.extra_location is null) then
      raise exception 'EXTRA_REASON_REQUIRED' using errcode = 'P0001',
        hint = 'Line ' || v_line.line_no || ': ' || v_extra || ' more than ' || case when v_picked then 'the portions picked' else 'Still to buy' end || '.';
    end if;
    update purchase_lines
       set covered_qty = v_target - v_left,
           extra_qty = v_extra,
           unit_check = case when v_direct then 'none' when unit_check = 'confirmed' then 'confirmed' else 'pending' end
     where id = v_line.id;
    v_out := v_out || jsonb_build_object('line', v_line.line_no, 'covered', v_target - v_left, 'extra', v_extra,
                                         'unit_check', case when v_direct then 'none' when v_line.unit_check = 'confirmed' then 'confirmed' else 'pending' end);
  end loop;
  return v_out;
end;
$$;

-- Office checks already made, so a correction or replacement that keeps a
-- line's request, item, unit, quantity and substitute mark keeps its check
-- (a renamed or re-marked line is checked again).
create or replace function pur_keep_checks(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('request_line_id', l.request_line_id, 'unit', lower(btrim(l.unit)),
                                               'item', lower(btrim(l.item_name)), 'substitute', l.substitute,
                                               'quantity', l.quantity, 'covers', l.unit_covers, 'by', l.unit_checked_by,
                                               'at', l.unit_checked_at, 'note', l.unit_note) order by l.line_no), '[]'::jsonb)
    from purchase_lines l where l.purchase_id = p_purchase and l.unit_check = 'confirmed'
$$;

create or replace function pur_apply_checks(p_purchase uuid, p_keep jsonb) returns void
language sql security definer set search_path = public as $$
  update purchase_lines l
     set unit_check = 'confirmed', unit_covers = k.covers, unit_checked_by = k.by_id, unit_checked_at = k.at, unit_note = k.note
    from (select (e.v ->> 'request_line_id')::uuid as request_line_id, e.v ->> 'unit' as unit, e.v ->> 'item' as item,
                 (e.v ->> 'substitute')::boolean as substitute,
                 (e.v ->> 'quantity')::numeric as quantity, (e.v ->> 'covers')::numeric as covers,
                 (e.v ->> 'by')::uuid as by_id, (e.v ->> 'at')::timestamptz as at, coalesce(e.v ->> 'note', '') as note,
                 row_number() over (partition by e.v ->> 'request_line_id', e.v ->> 'unit', e.v ->> 'item', e.v ->> 'substitute',
                                                 (e.v ->> 'quantity')::numeric
                                    order by e.i) as rn
            from jsonb_array_elements(coalesce(p_keep, '[]'::jsonb)) with ordinality e(v, i)) k,
         (select y.id, y.request_line_id, lower(btrim(y.unit)) as unit, lower(btrim(y.item_name)) as item, y.substitute, y.quantity,
                 row_number() over (partition by y.request_line_id, lower(btrim(y.unit)), lower(btrim(y.item_name)), y.substitute,
                                                 y.quantity order by y.line_no) rn
            from purchase_lines y where y.purchase_id = p_purchase and y.request_line_id is not null) n
   where l.id = n.id and n.request_line_id = k.request_line_id and n.unit = k.unit and n.item = k.item
     and n.substitute = k.substitute and n.quantity = k.quantity and n.rn = k.rn
$$;

-- A correction body may leave out what Project Control's form does not know
-- (the request link and its reasons, who bought, the supplier picked): each
-- line keeps the stored line's values, matched by line number.
create or replace function pur_inherit(p_purchase uuid, p_body jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_i int := 0;
  s record;
  pu purchases;
  v_body jsonb := p_body;
begin
  select * into pu from purchases where id = p_purchase;
  if jsonb_typeof(p_body -> 'lines') = 'array' then
    for v_line in select value from jsonb_array_elements(p_body -> 'lines') loop
      v_i := v_i + 1;
      select * into s from purchase_lines where purchase_id = p_purchase and line_no = v_i;
      if s.id is not null and not (v_line ? 'request_line_id') then
        v_line := v_line || jsonb_build_object('request_line_id', s.request_line_id, 'portion_picks', s.portion_picks,
                                               'extra_reason', s.extra_reason, 'extra_location', s.extra_location,
                                               'unplanned_reason', s.unplanned_reason,
                                               'substitute', s.substitute, 'substitute_reason', s.substitute_reason);
      end if;
      v_lines := v_lines || jsonb_build_array(v_line);
    end loop;
    v_body := jsonb_set(v_body, '{lines}', v_lines);
  end if;
  if not (v_body ? 'supplier_id') and pu.supplier_id is not null then
    v_body := v_body || jsonb_build_object('supplier_id', pu.supplier_id);
  end if;
  return v_body;
end;
$$;

-- 0096's insert, plus who bought, the supplier picked, kept unit checks
-- (p_keep) and the request covers — all in the same transaction as the
-- expense rows. p_history: what a replaced purchase covered (none for a new
-- one). Replaces the 4-argument 0096 version.
drop function if exists pur_insert(uuid, uuid, jsonb, jsonb);
create or replace function pur_insert(p_owner uuid, p_actor uuid, p_body jsonb, p_carry jsonb, p_keep jsonb default null,
                                      p_history jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_supplier uuid := pur_supplier_of(p_owner, p_body);
  v_covers jsonb;
  v_result jsonb;
begin
  insert into purchases (owner_id, source, purchase_date, date_time, supplier, receipt_total, notes, payment_method, docs,
                         recorded_by, bought_by, supplier_id)
  values (p_owner, coalesce(p_body ->> 'source', 'expenses_form'), (p_body ->> 'purchase_date')::date,
          coalesce(nullif(p_body ->> 'date_time', ''), p_body ->> 'purchase_date'),
          coalesce(nullif(btrim(coalesce(p_body ->> 'supplier', '')), ''),
                   (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end from suppliers s where s.id = v_supplier), ''),
          pur_money(p_body ->> 'receipt_total'), btrim(coalesce(p_body ->> 'notes', '')),
          btrim(coalesce(p_body ->> 'payment_method', '')),
          coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
                     where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                       and jsonb_typeof(v) = 'string'), '{}'::jsonb),
          p_actor, pur_bought_by(p_owner, p_body, null), v_supplier)
  returning id into v_id;

  perform pur_store(p_owner, v_id, p_body);
  -- Carried-over stock: the first new "track in inventory" line of the same
  -- item takes the old move over (no stock change). Nothing is ever moved twice.
  insert into purchase_stock_moves (line_id, inventory_id, quantity)
  select l.id, c.inventory_id, c.quantity
    from (select k.*, row_number() over (partition by lower(k.item_name) order by k.line_no) rn
            from jsonb_to_recordset(coalesce(p_carry, '[]'::jsonb)) as k(line_no int, item_name text, inventory_id uuid, quantity numeric)) c
    join (select x.*, row_number() over (partition by lower(x.item_name) order by x.line_no) rn
            from purchase_lines x where x.purchase_id = v_id and x.in_inventory) l
      on lower(l.item_name) = lower(c.item_name) and l.rn = c.rn
  on conflict (line_id) do nothing;
  perform pur_apply_checks(v_id, p_keep);
  v_covers := pur_cover_lines(v_id, p_actor, coalesce(p_history, '[]'::jsonb));
  v_result := pur_charge_rows(v_id) || jsonb_build_object('stock_moves', pur_move_stock(v_id, p_actor), 'covers', v_covers);
  insert into purchase_history (owner_id, purchase_id, kind, after, actor_id)
  values (p_owner, v_id, 'recorded', pur_doc(v_id), p_actor);
  return v_result;
end;
$$;

-- 0096's correction, plus: lines the body leaves unlinked keep their stored
-- request link (pur_inherit); who bought and the supplier can change (who
-- bought — the owner only); office checks are kept when the line's request,
-- item, unit and quantity stay; the covers are rebuilt in the same
-- transaction, on the same portions as before (pur_cover_history).
create or replace function pur_correct(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  pu purchases;
  v_body jsonb;
  v_before jsonb;
  v_old_folders uuid[];
  v_moves jsonb;
  v_keep jsonb;
  v_hist jsonb;
  v_covers jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_header_ok(p_body);
  -- This purchase first, then its CURRENT projects and requests and the new ones together.
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase) || pur_body_keys(p_body));
  pu := pur_open(v_owner, p_purchase);
  if jsonb_array_length(coalesce(p_body -> 'lines', '[]'::jsonb))
     <> (select count(*) from purchase_lines where purchase_id = p_purchase) then
    raise exception 'LINES_CHANGED' using errcode = 'P0001';
  end if;
  select array_agg(l.folder_id order by l.line_no)
    into v_old_folders from purchase_lines l where l.purchase_id = p_purchase;
  if not is_owner() and exists (select 1
                                  from jsonb_array_elements(p_body -> 'lines') with ordinality n(v, i)
                                 where pur_uuid(n.v ->> 'folder_id') is distinct from v_old_folders[n.i]) then
    raise exception 'OWNER_APPROVAL_NEEDED' using errcode = 'P0001';
  end if;
  v_body := pur_inherit(p_purchase, p_body);

  v_before := pur_doc(p_purchase);
  v_keep := pur_keep_checks(p_purchase);
  v_hist := pur_cover_history(p_purchase);
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  -- Stock already moved stays moved: the new lines take over the move records.
  select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'inventory_id', m.inventory_id,
                                               'quantity', m.quantity, 'moved_at', m.moved_at)), '[]'::jsonb)
    into v_moves
    from purchase_stock_moves m join purchase_lines l on l.id = m.line_id where l.purchase_id = p_purchase;
  delete from purchase_stock_moves m using purchase_lines l where l.id = m.line_id and l.purchase_id = p_purchase;
  delete from purchase_charge_shares s using purchase_charges c where c.id = s.charge_id and c.purchase_id = p_purchase;
  delete from purchase_charges where purchase_id = p_purchase;
  delete from purchase_lines where purchase_id = p_purchase;

  update purchases set
    purchase_date = (v_body ->> 'purchase_date')::date,
    date_time = coalesce(nullif(v_body ->> 'date_time', ''), v_body ->> 'purchase_date'),
    supplier = coalesce(nullif(btrim(coalesce(v_body ->> 'supplier', '')), ''),
                        (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                           from suppliers s where s.id = pur_supplier_of(v_owner, v_body)), ''),
    supplier_id = pur_supplier_of(v_owner, v_body),
    bought_by = pur_bought_by(v_owner, v_body, pu.bought_by),
    receipt_total = pur_money(v_body ->> 'receipt_total'),
    notes = btrim(coalesce(v_body ->> 'notes', '')),
    payment_method = btrim(coalesce(v_body ->> 'payment_method', '')),
    docs = docs || coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(v_body -> 'docs', '{}'::jsonb)) d(k, v)
                              where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                                and jsonb_typeof(v) = 'string'), '{}'::jsonb),
    updated_at = now()
  where id = p_purchase;

  perform pur_store(v_owner, p_purchase, v_body);
  insert into purchase_stock_moves (line_id, inventory_id, quantity, moved_at)
  select l.id, k.inventory_id, k.quantity, k.moved_at
    from jsonb_to_recordset(v_moves) as k(line_no int, inventory_id uuid, quantity numeric, moved_at timestamptz)
    join purchase_lines l on l.purchase_id = p_purchase and l.line_no = k.line_no;
  perform pur_apply_checks(p_purchase, v_keep);
  v_covers := pur_cover_lines(p_purchase, v_uid, v_hist);
  v_result := pur_charge_rows(p_purchase) || jsonb_build_object('covers', v_covers);
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'corrected', btrim(p_reason), v_before, pur_doc(p_purchase), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'correct', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- 0096's replacement, with the old purchase voided BEFORE the new one is
-- recorded — so the new one can cover the request portions the old one
-- covered, and does (its lines' history, matched by line number and
-- request) — and with matching office checks kept.
create or replace function pur_replace(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_carry jsonb;
  v_keep jsonb;
  v_hist jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_header_ok(p_body);
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase) || pur_body_keys(p_body));
  pu := pur_open(v_owner, p_purchase);
  if not is_owner() and exists (
      select 1 from jsonb_array_elements(p_body -> 'lines') n(v)
       where not exists (select 1 from purchase_lines l
                          where l.purchase_id = p_purchase
                            and l.destination = coalesce(n.v ->> 'destination', 'project')
                            and l.folder_id is not distinct from pur_uuid(n.v ->> 'folder_id'))) then
    raise exception 'OWNER_APPROVAL_NEEDED' using errcode = 'P0001';
  end if;

  v_before := pur_doc(p_purchase);
  v_keep := pur_keep_checks(p_purchase);
  v_hist := pur_cover_history(p_purchase);
  select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_name', l.item_name, 'inventory_id', m.inventory_id, 'quantity', m.quantity)), '[]'::jsonb)
    into v_carry
    from purchase_stock_moves m join purchase_lines l on l.id = m.line_id where l.purchase_id = p_purchase;
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  delete from purchase_stock_moves m using purchase_lines l where l.id = m.line_id and l.purchase_id = p_purchase;
  update purchases set status = 'void', updated_at = now() where id = p_purchase;
  v_result := pur_insert(v_owner, v_uid, p_body, v_carry, v_keep, v_hist);
  update purchases set replaced_by = (v_result ->> 'purchase_id')::uuid where id = p_purchase;
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'replaced', btrim(p_reason), v_before, jsonb_build_object('replaced_by', v_result ->> 'purchase_id'), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'replace', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- 0096's header check, accepting the Purchasing tab's source.
create or replace function pur_header_ok(p_body jsonb) returns void
language plpgsql immutable as $$
begin
  if coalesce(p_body ->> 'purchase_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  begin
    perform (p_body ->> 'purchase_date')::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if coalesce(p_body ->> 'date_time', '') <> '' and left(p_body ->> 'date_time', 10) <> p_body ->> 'purchase_date' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  if pur_money(p_body ->> 'receipt_total') is null then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if coalesce(p_body ->> 'source', 'expenses_form') not in ('expenses_form', 'workmate', 'purchasing') then
    raise exception 'BAD_SOURCE' using errcode = 'P0001';
  end if;
end;
$$;

-- 0096's document, plus who bought, the supplier picked and each line's
-- request link, covers and unit check.
create or replace function pur_doc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
    'date_time', pu.date_time, 'supplier', pu.supplier, 'supplier_id', pu.supplier_id,
    'bought_by', pu.bought_by, 'receipt_total', pu.receipt_total, 'notes', pu.notes,
    'payment_method', pu.payment_method, 'docs', pu.docs,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'line', l.line_no, 'destination', l.destination, 'folder_id', l.folder_id, 'folder_name', l.folder_name,
                'item_name', l.item_name, 'category', l.category, 'quantity', l.quantity, 'unit', l.unit,
                'amount', l.gross_amount, 'in_inventory', l.in_inventory, 'min_stock', l.min_stock,
                'needs_funding_review', l.needs_funding_review,
                'request_line_id', l.request_line_id, 'portion_picks', l.portion_picks,
                'covered', l.covered_qty, 'extra', l.extra_qty, 'extra_reason', l.extra_reason,
                'extra_location', l.extra_location, 'unit_check', l.unit_check, 'unit_covers', l.unit_covers,
                'unplanned_reason', l.unplanned_reason, 'substitute', l.substitute,
                'substitute_reason', l.substitute_reason) order by l.line_no), '[]'::jsonb)
                from purchase_lines l where l.purchase_id = pu.id),
    'charges', (select coalesce(jsonb_agg(jsonb_build_object(
                  'kind', c.kind, 'amount', c.amount,
                  'shares', (select coalesce(jsonb_agg(jsonb_build_object('line', l.line_no, 'amount', s.amount) order by l.line_no), '[]'::jsonb)
                               from purchase_charge_shares s join purchase_lines l on l.id = s.line_id where s.charge_id = c.id))
                  order by c.charge_no), '[]'::jsonb)
                  from purchase_charges c where c.purchase_id = pu.id))
  from purchases pu where pu.id = p_purchase
$$;

-- The office confirms how much a different-unit or substitute purchase line
-- covers, in the REQUEST's unit (e.g. a box bought for a request in pcs
-- covers 12; a substitute that does the job covers what it replaces).
-- Audited (purchase_history 'unit_checked'). The owner, or a buyer who
-- neither recorded nor bought the purchase — never the buyer themself. The
-- purchase counts as changed (a change request waiting on it goes stale);
-- its other lines keep exactly the portions they covered.
create or replace function pur_check_unit(p_op uuid, p_purchase uuid, p_line_no int, p_covers numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner('purchasing');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_line purchase_lines;
  v_hist jsonb;
  v_covers jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 1 and 300 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_covers is null or p_covers < 0 or p_covers > 1000000 or p_covers <> round(p_covers, 3) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase));
  pu := pur_open(v_owner, p_purchase);
  if not is_owner() and v_uid in (pu.recorded_by, coalesce(pu.bought_by, pu.recorded_by)) then
    raise exception 'OWN_PURCHASE' using errcode = 'P0001';
  end if;
  select * into v_line from purchase_lines where purchase_id = p_purchase and line_no = p_line_no;
  if v_line.id is null or v_line.request_line_id is null or v_line.unit_check = 'none' then
    raise exception 'NO_UNIT_CHECK' using errcode = 'P0001';
  end if;
  v_before := pur_doc(p_purchase);
  v_hist := pur_cover_history(p_purchase);
  update purchase_lines
     set unit_check = 'confirmed', unit_covers = p_covers, unit_checked_by = v_uid, unit_checked_at = now(), unit_note = btrim(p_note)
   where id = v_line.id;
  update purchases set updated_at = now() where id = p_purchase;
  v_covers := pur_cover_lines(p_purchase, v_uid, v_hist);
  if (select covered_qty from purchase_lines where id = v_line.id) < p_covers then
    raise exception 'MORE_THAN_NEEDED' using errcode = 'P0001';
  end if;
  v_result := jsonb_build_object('purchase_id', p_purchase, 'covers', v_covers);
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'unit_checked', btrim(p_note), v_before, pur_doc(p_purchase), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'unit_check', v_result);
  return v_result;
end;
$$;

-- ════ 6. Owner approval of staff changes (Q13 = B) ═══════════════════

-- Does this change body link a line to a request, or pick portions,
-- differently from the stored purchase (same line number)? Lines the body
-- leaves unlinked keep their stored link (pur_inherit), so Project
-- Control's form never does. Picks compare as pur_store stores them.
create or replace function pur_links_changed(p_purchase uuid, p_body jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from jsonb_array_elements(pur_inherit(p_purchase, p_body) -> 'lines') with ordinality n(v, i)
      left join purchase_lines l on l.purchase_id = p_purchase and l.line_no = n.i
     where coalesce(btrim(n.v ->> 'request_line_id'), '') <> ''
       and (l.id is null
            or pur_uuid(n.v ->> 'request_line_id') is distinct from l.request_line_id
            or (select coalesce(jsonb_agg(jsonb_build_object('portion_id', pur_uuid(p.v ->> 'portion_id'),
                                                             'quantity', pur_qty(p.v ->> 'quantity')) order by p.k), '[]'::jsonb)
                  from jsonb_array_elements(case when jsonb_typeof(n.v -> 'portion_picks') = 'array'
                                                 then n.v -> 'portion_picks' else '[]'::jsonb end) with ordinality p(v, k))
               is distinct from l.portion_picks))
$$;

-- Staff send a change the server reserves for the owner — moving a cost to
-- another project, or touching a completed project — as a request. It
-- stores exactly what the owner will apply, and the purchase exactly as the
-- requester saw it (base_doc). A staff member without the Buyer switch may
-- not ask for a new request link or new picks (the owner would apply them
-- unseen as a buying decision). One pending request per purchase; a retry
-- with the same operation id returns the same request.
create or replace function pur_request_change(p_op uuid, p_purchase uuid, p_kind text, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(case when p_kind = 'void' then 'expenses_form' else coalesce(p_body ->> 'source', 'expenses_form') end);
  v_id uuid;
  pu purchases;
begin
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pur_cr_op:' || v_uid || ':' || p_op, 0));
  select r.id into v_id from purchase_change_requests r where r.requested_by = v_uid and r.op_id = p_op;
  if v_id is not null then
    return (select jsonb_build_object('request_id', r.id, 'status', r.status, 'replayed', true)
              from purchase_change_requests r where r.id = v_id);
  end if;
  if coalesce(is_owner(), false) then
    raise exception 'OWNER_CAN_DO_IT' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('correct', 'replace', 'void') then
    raise exception 'BAD_KIND' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_kind = 'void' then
    if p_body is not null and jsonb_typeof(p_body) <> 'null' then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
  else
    perform pur_header_ok(p_body);
    if jsonb_typeof(p_body -> 'lines') is distinct from 'array' or jsonb_array_length(p_body -> 'lines') not between 1 and 50 then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
  end if;
  perform pur_purchase_lock(p_purchase);
  select * into pu from purchases where id = p_purchase and owner_id = v_owner;
  if pu.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if pu.status <> 'recorded' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if p_kind = 'correct' and jsonb_array_length(p_body -> 'lines') <> (select count(*) from purchase_lines where purchase_id = p_purchase) then
    raise exception 'LINES_CHANGED' using errcode = 'P0001';
  end if;
  if p_kind <> 'void' and not pur_buyer() and pur_links_changed(p_purchase, p_body) then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  begin
    insert into purchase_change_requests (owner_id, purchase_id, kind, body, reason, base_updated_at, base_doc, requested_by, op_id)
    values (v_owner, p_purchase, p_kind, case when p_kind = 'void' then null else p_body end, btrim(p_reason),
            pu.updated_at, pur_doc(p_purchase), v_uid, p_op)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ALREADY_PENDING' using errcode = 'P0001';
  end;
  return jsonb_build_object('request_id', v_id, 'status', 'pending');
end;
$$;

-- The requester takes back a request the owner has not decided.
create or replace function pur_withdraw_change(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  update purchase_change_requests set status = 'withdrawn', decided_by = v_uid, decided_at = now()
   where id = p_request and requested_by = v_uid and status = 'pending';
  if not found then
    raise exception 'NOT_PENDING' using errcode = 'P0001';
  end if;
  return jsonb_build_object('request_id', p_request, 'status', 'withdrawn');
end;
$$;

-- The owner approves or rejects. Approving re-checks that the purchase
-- still reads exactly as the requester saw it — every header field, line,
-- cover, office check, receipt and fee split (pur_doc = base_doc), and its
-- updated_at — else the request is marked 'stale' and nothing is applied;
-- then runs the very same correct / replace / void as the owner — every
-- money, coverage and stock rule applies unchanged. A rejection needs a
-- note. Retry-safe like the other operations.
create or replace function pur_decide_change(p_op uuid, p_request uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_owner uuid;
  r purchase_change_requests;
  pu purchases;
  v_apply uuid;
  v_reason text;
  v_applied jsonb;
  v_result jsonb;
begin
  if v_uid is null or not coalesce(is_owner(), false) then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  v_owner := pur_actor_owner('expenses_form');
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if p_approve is null then
    raise exception 'BAD_DECISION' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) > 500 or (not p_approve and btrim(coalesce(p_note, '')) = '') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select * into r from purchase_change_requests where id = p_request and owner_id = v_owner for update;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'NOT_PENDING' using errcode = 'P0001';
  end if;

  if not p_approve then
    update purchase_change_requests set status = 'rejected', decided_by = v_uid, decided_at = now(),
                                        decision_note = btrim(p_note)
     where id = r.id;
    v_result := jsonb_build_object('request_id', r.id, 'status', 'rejected');
  else
    perform pur_purchase_lock(r.purchase_id);
    select * into pu from purchases where id = r.purchase_id;
    if pu.status <> 'recorded' or pu.updated_at <> r.base_updated_at or pur_doc(pu.id) is distinct from r.base_doc then
      update purchase_change_requests set status = 'stale', decided_by = v_uid, decided_at = now(),
                                          decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                                                                   'The purchase changed after this request — ask for a new one')
       where id = r.id;
      v_result := jsonb_build_object('request_id', r.id, 'status', 'stale');
    else
      v_apply := md5(p_op::text || ':apply')::uuid;
      v_reason := r.reason || ' (requested by ' || pur_person_name(r.requested_by) || ', approved by the owner)';
      v_applied := case r.kind
                     when 'correct' then pur_correct(v_apply, r.purchase_id, r.body, v_reason)
                     when 'replace' then pur_replace(v_apply, r.purchase_id, r.body, v_reason)
                     else pur_void(v_apply, r.purchase_id, v_reason)
                   end;
      update purchase_change_requests set status = 'approved', decided_by = v_uid, decided_at = now(),
                                          decision_note = btrim(coalesce(p_note, '')), result = v_applied
       where id = r.id;
      v_result := jsonb_build_object('request_id', r.id, 'status', 'approved', 'result', v_applied);
    end if;
  end if;
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'decide', v_result);
  return v_result;
end;
$$;

-- A purchase document (pur_doc) or a change body, in the words the owner
-- reviews: every header field (date and time, supplier, who bought, total,
-- payment, notes, which receipt photos), every line (item, quantity, unit,
-- amount, project and work, request, picked portions with their weekly
-- cutoff, extra, substitute, Unplanned reason) and every fee or discount
-- with its split per line — the automatic split (pur_prorate) when the body
-- gives none. Names only where the document has ids; this company's only.
create or replace function pur_review_doc(p_owner uuid, p_doc jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_charges jsonb := '[]'::jsonb;
  v_weights numeric[] := '{}';
  v_shares numeric[];
  v_l jsonb;
  v_c jsonb;
  v_n int := 0;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    return null;
  end if;
  for v_l in select value from jsonb_array_elements(case when jsonb_typeof(p_doc -> 'lines') = 'array' then p_doc -> 'lines' else '[]'::jsonb end) loop
    v_n := v_n + 1;
    v_lines := v_lines || jsonb_build_object(
      'line', v_n,
      'item_name', btrim(coalesce(v_l ->> 'item_name', '')),
      'category', btrim(coalesce(v_l ->> 'category', '')),
      'quantity', case when v_l ->> 'quantity' is null then 1 else pur_qty(v_l ->> 'quantity') end,
      'unit', btrim(coalesce(v_l ->> 'unit', '')),
      'amount', pur_money(v_l ->> 'amount'),
      'in_inventory', (v_l ->> 'in_inventory') = 'true',
      'where', case when coalesce(v_l ->> 'destination', 'project') = 'warehouse' then 'Warehouse'
                    else (select case when f.parent_folder_id is null then f.name || ' · Main Contract' else par.name || ' · ' || f.name end
                            from folders f left join folders par on par.id = f.parent_folder_id
                           where f.id = pur_uuid(v_l ->> 'folder_id') and f.owner_id = p_owner) end,
      'request', (select rl.description || case when rl.spec <> '' then ' ' || rl.spec else '' end || ' (' || rl.unit || ')'
                    from pr_lines rl where rl.id = pur_uuid(v_l ->> 'request_line_id') and rl.owner_id = p_owner),
      'picks', (select coalesce(jsonb_agg(jsonb_build_object('quantity', pur_qty(p.v ->> 'quantity'), 'cutoff_at', b.cutoff_at) order by p.k), '[]'::jsonb)
                  from jsonb_array_elements(case when jsonb_typeof(v_l -> 'portion_picks') = 'array' then v_l -> 'portion_picks' else '[]'::jsonb end)
                       with ordinality p(v, k)
                  left join pr_line_portions po on po.id = pur_uuid(p.v ->> 'portion_id') and po.owner_id = p_owner
                  left join pr_batches b on b.id = po.batch_id),
      'extra_reason', btrim(coalesce(v_l ->> 'extra_reason', '')),
      'extra_location', v_l ->> 'extra_location',
      'substitute', (v_l ->> 'substitute') = 'true',
      'substitute_reason', btrim(coalesce(v_l ->> 'substitute_reason', '')),
      'unplanned_reason', btrim(coalesce(v_l ->> 'unplanned_reason', '')));
    v_weights := v_weights || coalesce(pur_money(v_l ->> 'amount'), 0);
  end loop;
  for v_c in select value from jsonb_array_elements(case when jsonb_typeof(p_doc -> 'charges') = 'array' then p_doc -> 'charges' else '[]'::jsonb end) loop
    if jsonb_typeof(v_c -> 'shares') = 'array' and jsonb_array_length(v_c -> 'shares') > 0 then
      select coalesce(array_agg(coalesce((select sum(pur_money(s ->> 'amount')) from jsonb_array_elements(v_c -> 'shares') s
                                           where s ->> 'line' = k::text), 0) order by k), '{}')
        into v_shares from generate_series(1, v_n) k;
    else
      v_shares := pur_prorate(coalesce(pur_money(v_c ->> 'amount'), 0), v_weights);
    end if;
    v_charges := v_charges || jsonb_build_object('kind', v_c ->> 'kind', 'amount', pur_money(v_c ->> 'amount'),
                                                 'shares', to_jsonb(coalesce(v_shares, '{}'::numeric[])));
  end loop;
  return jsonb_build_object(
    'purchase_date', p_doc ->> 'purchase_date',
    'date_time', coalesce(nullif(p_doc ->> 'date_time', ''), p_doc ->> 'purchase_date'),
    'supplier', coalesce(nullif(btrim(coalesce(p_doc ->> 'supplier', '')), ''),
                         (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                            from suppliers s where s.id = pur_uuid(p_doc ->> 'supplier_id') and s.owner_id = p_owner), ''),
    'bought_by', case when pur_uuid(p_doc ->> 'bought_by') is null then null else pur_person_name(pur_uuid(p_doc ->> 'bought_by')) end,
    'receipt_total', pur_money(p_doc ->> 'receipt_total'),
    'payment_method', btrim(coalesce(p_doc ->> 'payment_method', '')),
    'notes', btrim(coalesce(p_doc ->> 'notes', '')),
    -- Which receipt photos, and a short fingerprint of each, so a replaced photo shows as a change.
    'receipts', (select coalesce(jsonb_object_agg(d.k, left(md5(d.v), 8)), '{}'::jsonb)
                   from jsonb_each_text(case when jsonb_typeof(p_doc -> 'docs') = 'object' then p_doc -> 'docs' else '{}'::jsonb end) d(k, v)
                  where coalesce(d.v, '') <> ''),
    'lines', v_lines,
    'charges', v_charges);
end;
$$;

-- Change requests: the owner sees the company's; staff see their own. Each
-- carries the purchase as the requester saw it ('base'), as it is now
-- ('current') and as asked for ('proposed' — a correction as the server
-- will apply it: unlinked lines keep their link, receipts merge), all in
-- pur_review_doc's words; 'changed_since' = approving now would go stale.
create or replace function pur_change_requests(p_scope text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  v_owner := pur_actor_owner('expenses_form');
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'purchase_id', r.purchase_id, 'kind', r.kind, 'reason', r.reason, 'status', r.status,
            'requested_by', r.requested_by, 'requested_by_name', pur_person_name(r.requested_by),
            'requested_at', r.requested_at, 'decided_by_name', case when r.decided_by is null then null else pur_person_name(r.decided_by) end,
            'decided_at', r.decided_at, 'decision_note', r.decision_note,
            'changed_since', r.status = 'pending' and (pu.status <> 'recorded' or pu.updated_at <> r.base_updated_at
                                                       or pur_doc(pu.id) is distinct from r.base_doc),
            'base', pur_review_doc(r.owner_id, r.base_doc),
            'current', pur_review_doc(r.owner_id, pur_doc(r.purchase_id)),
            'proposed', case when r.body is null then null
                             when r.kind = 'correct' then pur_review_doc(r.owner_id,
                               jsonb_set(pur_inherit(r.purchase_id, r.body), '{docs}',
                                         coalesce(r.base_doc -> 'docs', '{}'::jsonb) || coalesce(r.body -> 'docs', '{}'::jsonb)))
                             else pur_review_doc(r.owner_id, r.body) end)
          order by r.requested_at desc), '[]'::jsonb)
            from purchase_change_requests r
            join purchases pu on pu.id = r.purchase_id
           where r.owner_id = v_owner
             and (coalesce(is_owner(), false) or r.requested_by = auth.uid())
             and (coalesce(p_scope, 'pending') = 'all' or r.status = 'pending'));
end;
$$;

-- ════ 7. What the Purchasing tab reads ═══════════════════════════════

-- The shopping list: every open request line with something still to buy
-- (or a different-unit purchase waiting for its check), one entry per
-- line with its portions. p_batch = only that batch's portions; p_folder =
-- that project (and its Additional Works). Quantities and names only.
-- Changed = the quantity changed after a portion was assigned.
create or replace function pur_shopping_list(p_batch uuid default null, p_folder uuid default null, p_scope text default 'open')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (
    select coalesce(jsonb_agg(x.doc order by x.urgent desc, x.needed_by nulls last, x.first_cutoff nulls last, x.project_name, x.received_at, x.position), '[]'::jsonb)
      from (
        select l.urgent, l.needed_by, l.position, r.received_at, f.name as project_name,
               (select min(b.cutoff_at) from pr_line_portions p join pr_batches b on b.id = p.batch_id
                 where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch)) as first_cutoff,
               jsonb_build_object(
                 'line_id', l.id, 'request_id', r.id, 'kind', l.kind,
                 'description', l.description, 'spec', l.spec, 'unit', l.unit, 'category', l.category,
                 'catalog_item_id', l.catalog_item_id, 'catalog_name', c.name,
                 'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
                 'project_id', r.folder_id, 'project_name', f.name, 'work_id', r.work_folder_id,
                 'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
                 'requester_name', pr_person_name(r.requester_id),
                 'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
                 'bought', pr_line_bought(l.id),
                 'from_stock', 0,
                 'still_to_buy', (select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0)
                                    from pr_line_portions p where p.line_id = l.id),
                 'extra', (select coalesce(sum(pl.extra_qty), 0) from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                            where pl.request_line_id = l.id and pu.status = 'recorded'),
                 'unit_checks', (select count(*) from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                                  where pl.request_line_id = l.id and pu.status = 'recorded' and pl.unit_check = 'pending'),
                 'portions', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'id', p.id, 'batch_id', p.batch_id, 'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on,
                            'delivery_on', b.delivery_on, 'quantity', p.quantity, 'pending_reduction', p.pending_reduction,
                            'bought', pr_portion_bought(p.id),
                            'still_to_buy', greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id)),
                            'arranged', p.arranged_at is not null,
                            'buyer_id', p.buyer_id, 'buyer_name', case when p.buyer_id is null then null else pur_person_name(p.buyer_id) end,
                            'mine', p.buyer_id = auth.uid(), 'assigned_at', p.assigned_at,
                            'changed', p.assigned_at is not null and exists (
                               select 1 from pr_events e
                                where e.line_id = l.id and e.created_at > p.assigned_at
                                  and e.kind in ('quantity_changed', 'office_quantity_changed', 'conflict_resolved',
                                                 'line_cancelled', 'office_line_cancelled', 'reduction_resolved')))
                          order by b.cutoff_at, p.created_at), '[]'::jsonb)
                     from pr_line_portions p join pr_batches b on b.id = p.batch_id
                    where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch))
               ) as doc
          from pr_lines l
          join pr_requests r on r.id = l.request_id
          join folders f on f.id = r.folder_id
          join folders w on w.id = r.work_folder_id
          left join pr_catalog_items c on c.id = l.catalog_item_id
         where l.owner_id = v_owner
           and (p_folder is null or r.folder_id = p_folder)
           and (p_batch is null or exists (select 1 from pr_line_portions p where p.line_id = l.id and p.batch_id = p_batch))
           and (coalesce(p_scope, 'open') = 'all'
                or (l.status = 'open' and r.status = 'submitted'
                    and exists (select 1 from pr_line_portions p
                                 where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch)
                                   and p.quantity - p.pending_reduction - pr_portion_bought(p.id) > 0))
                or exists (select 1 from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                            where pl.request_line_id = l.id and pu.status = 'recorded' and pl.unit_check = 'pending'))
         limit 500
      ) x);
end;
$$;

-- One purchase as the Purchasing tab shows it: the document, who recorded
-- and who bought, each line's request and covers, the history and any
-- change requests.
create or replace function pur_purchase_view(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select pur_doc(pu.id) || jsonb_build_object(
    'recorded_by_name', pur_person_name(pu.recorded_by),
    'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
    'created_at', pu.created_at, 'updated_at', pu.updated_at, 'replaced_by', pu.replaced_by,
    'covers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'line', l.line_no, 'request_line_id', c.request_line_id, 'portion_id', c.portion_id,
                 'quantity', c.quantity, 'buyer_name', pur_person_name(c.buyer_id),
                 'request_description', rl.description, 'request_unit', rl.unit,
                 'cutoff_at', (select b.cutoff_at from pr_line_portions p join pr_batches b on b.id = p.batch_id where p.id = c.portion_id))
               order by l.line_no, c.id), '[]'::jsonb)
                 from purchase_line_covers c join purchase_lines l on l.id = c.line_id
                 join pr_lines rl on rl.id = c.request_line_id
                where l.purchase_id = pu.id),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('line', l.line_no, 'request_line_id', l.request_line_id,
                   'description', rl.description, 'spec', rl.spec, 'unit', rl.unit,
                   'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = rl.id),
                   'bought', pr_line_bought(rl.id)) order by l.line_no), '[]'::jsonb)
                   from purchase_lines l join pr_lines rl on rl.id = l.request_line_id where l.purchase_id = pu.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'reason', h.reason, 'at', h.at,
                  'actor_name', pur_person_name(h.actor_id)) order by h.id), '[]'::jsonb)
                  from purchase_history h where h.purchase_id = pu.id),
    'change_requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status,
                          'reason', r.reason, 'requested_by_name', pur_person_name(r.requested_by), 'requested_at', r.requested_at,
                          'decision_note', r.decision_note) order by r.requested_at desc), '[]'::jsonb)
                          from purchase_change_requests r where r.purchase_id = pu.id))
  from purchases pu where pu.id = p_purchase
$$;

-- The purchases list (newest first, at most 300): every purchase of the
-- company in the date range, optionally one project's. Buyers only.
create or replace function pur_purchases(p_from date default null, p_to date default null, p_folder uuid default null,
                                         p_status text default 'recorded') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(x.doc order by x.purchase_date desc, x.created_at desc), '[]'::jsonb)
            from (select pu.purchase_date, pu.created_at,
                         jsonb_build_object(
                           'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
                           'supplier', pu.supplier, 'receipt_total', pu.receipt_total,
                           'recorded_by_name', pur_person_name(pu.recorded_by),
                           'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
                           'projects', (select coalesce(jsonb_agg(distinct l.folder_name), '[]'::jsonb) from purchase_lines l
                                         where l.purchase_id = pu.id and l.destination = 'project'),
                           'warehouse', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.destination = 'warehouse'),
                           'lines', (select count(*) from purchase_lines l where l.purchase_id = pu.id),
                           'linked', (select count(*) from purchase_lines l where l.purchase_id = pu.id and l.request_line_id is not null),
                           'unplanned', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unplanned_reason <> ''),
                           'extra', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.extra_qty > 0),
                           'unit_check', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unit_check = 'pending'),
                           'needs_review', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.needs_funding_review),
                           'pending_change', exists (select 1 from purchase_change_requests r where r.purchase_id = pu.id and r.status = 'pending')
                         ) as doc
                    from purchases pu
                   where pu.owner_id = v_owner
                     and (p_from is null or pu.purchase_date >= p_from)
                     and (p_to is null or pu.purchase_date <= p_to)
                     and (coalesce(p_status, 'recorded') = 'all' or pu.status = coalesce(p_status, 'recorded'))
                     and (p_folder is null or exists (select 1 from purchase_lines l
                                                        left join folders f on f.id = l.folder_id
                                                       where l.purchase_id = pu.id
                                                         and (l.folder_id = p_folder or f.parent_folder_id = p_folder)))
                   order by pu.purchase_date desc, pu.created_at desc
                   limit 300) x);
end;
$$;

-- One purchase, for buyers (and for the owner deciding a change request).
create or replace function pur_purchase(p_purchase uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from purchases pu where pu.id = p_purchase and pu.owner_id = data_owner_id()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return pur_purchase_view(p_purchase);
end;
$$;

-- Project Control's data entry (owner decision 2026-10-15) for every account
-- that may record — including staff without the Buyer switch, who no longer
-- read purchase tables (R3): the ONE purchase line behind an expense row
-- (p_line), or the purchase behind a fee/discount row (p_charge), with its
-- header and how many lines and charges it has (only a one-line purchase
-- without fees is edited there). Nothing else: no other line, cover,
-- request, buyer, history or change request.
create or replace function pur_entry_row(p_line uuid, p_charge uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_actor_owner('expenses_form');
  v_purchase uuid;
  l purchase_lines;
begin
  if p_line is not null then
    select * into l from purchase_lines where id = p_line and owner_id = v_owner;
    v_purchase := l.purchase_id;
  elsif p_charge is not null then
    select c.purchase_id into v_purchase from purchase_charges c where c.id = p_charge and c.owner_id = v_owner;
  end if;
  if v_purchase is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return (select jsonb_build_object(
            'purchase', jsonb_build_object('id', pu.id, 'status', pu.status, 'purchase_date', pu.purchase_date,
                                           'date_time', pu.date_time, 'supplier', pu.supplier, 'receipt_total', pu.receipt_total,
                                           'notes', pu.notes, 'payment_method', pu.payment_method, 'docs', pu.docs),
            'line', case when l.id is null then null else jsonb_build_object(
                       'id', l.id, 'purchase_id', l.purchase_id, 'line_no', l.line_no, 'folder_id', l.folder_id,
                       'item_name', l.item_name, 'category', l.category, 'quantity', l.quantity, 'unit', l.unit,
                       'gross_amount', l.gross_amount, 'in_inventory', l.in_inventory, 'min_stock', l.min_stock) end,
            'line_count', (select count(*) from purchase_lines x where x.purchase_id = pu.id),
            'charge_count', (select count(*) from purchase_charges x where x.purchase_id = pu.id))
            from purchases pu where pu.id = v_purchase);
end;
$$;

-- The "Office review" mark in Expenses and Project Control: ids of the lines
-- the server charged to Cover for want of a billing period (0096) — ids only.
create or replace function pur_review_lines() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  return (select coalesce(jsonb_agg(l.id), '[]'::jsonb) from purchase_lines l
           where l.owner_id = v_owner and l.needs_funding_review);
end;
$$;

-- ════ 8. Purchase receipt photos (Q14 / Q17) ═════════════════════════

-- 0089's rules plus one folder: purchases/<company>/<yyyy-mm>/<uuid>.jpg —
-- read and written only by accounts that may BUY in that company (owner,
-- full admin accounts, Buyer staff). Clients, partners, workers, team
-- leaders and non-Buyer staff never. Checked before the generic owner/staff
-- rule, like the 0089 receipt folders.
create or replace function public.uploads_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_pid    uuid := dacs_try_uuid(split_part(p_name, '/', 2));
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only (not even the uploader once the switch is off).
  if v_folder = 'purchases' then
    return pur_buyer() and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- The uploader can always read back their own file.
  if p_owner_id is not null and p_owner_id = v_uid::text then return true; end if;

  -- Owner-only modules (quotations 0045, reimbursements 0041).
  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- Owner and staff: everything else (staff encode receipts from here).
  if is_owner() or is_staff() then return true; end if;

  -- Construction client / partner: files filed under THEIR project. Same
  -- test as the weekly_bills _client_read / _partner_read policies.
  if v_folder in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms') then
    return v_pid is not null
       and (cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid));
  end if;

  -- Employee agreement PDF: every non-owner admin role (staff, worker,
  -- teamLeader) signs it at first login in admin.html (js/admin.js).
  if v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false); end if;

  -- Agreement templates shown at the client/partner signing gates.
  -- coalesce: a profile with a NULL role must not be denied (NOT NULL = NULL).
  if v_folder = 'agreementDocs' then return not coalesce(is_worker(), false); end if;

  return false;
end $$;

create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only.
  if v_folder = 'purchases' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  if is_owner() or is_staff() then return true; end if;
  -- Signatures. Clients/partners (js/client-management-app.js):
  --   signatures/<uid>_<ts>.png  and  signatures/proj_<project>_<uid>_<ts>.png
  -- Workers/team leaders (employee agreement gate, js/admin.js):
  --   signatures/employee_<uid>_<ts>.png  only
  if v_folder = 'signatures' then
    if coalesce(is_worker(), false) then
      return p_name ~ ('^signatures/employee_' || v_uid::text || '_[0-9]+\.png$');
    end if;
    return p_name ~ ('^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\.png$');
  end if;
  --   signed-terms/<uid>/<ts>_<name>.pdf   (dacsSnapshotPdf, every signing gate)
  if v_folder = 'signed-terms'  then return v_seg2 = v_uid::text; end if;

  -- Workers and team leaders upload nothing else.
  if coalesce(is_worker(), false) then return false; end if;
  --   procurementReceipts/<project>/…  (client "bought by client" receipt; clients only,
  --   partners are read-only, same as the procurement_client_update table policy)
  if v_folder = 'procurementReceipts' then
    return dacs_try_uuid(v_seg2) is not null and cproj_client_can_read(dacs_try_uuid(v_seg2));
  end if;

  return false;
end $$;

revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- 0089's overwrite policy, with the purchases folder locked the same way.
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end);

-- The upload ledger (0089) learns the purchase kind.
alter table public.receipt_uploads drop constraint if exists receipt_uploads_path_check;
alter table public.receipt_uploads add constraint receipt_uploads_path_check
  check (path ~ '^(expenseReceipts|payrollReceipts|purchases)/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$');
alter table public.receipt_uploads drop constraint if exists receipt_uploads_kind_check;
alter table public.receipt_uploads add constraint receipt_uploads_kind_check check (kind in ('expense', 'payroll', 'purchase'));
drop policy if exists receipt_uploads_insert on public.receipt_uploads;
create policy receipt_uploads_insert on public.receipt_uploads
  for insert to authenticated
  with check ((is_owner() or is_staff())
              and owner_id = data_owner_id()
              and uploaded_by = auth.uid()
              and state = 'pending'
              and split_part(path, '/', 2) = owner_id::text
              and (kind <> 'purchase' or pur_buyer())
              and split_part(path, '/', 1) = case kind when 'expense' then 'expenseReceipts'
                                                       when 'payroll' then 'payrollReceipts'
                                                       else 'purchases' end);

-- A purchase's own receipt marks its upload attached — a warehouse-only
-- purchase writes no expense row to do it.
create or replace function public.receipt_mark_attached() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_vals text[];
begin
  if tg_table_name = 'expenses' then
    v_vals := array[new.po_image_url, new.delivery_receipt_url, new.supplier_invoice_url, new.payment_receipt_url];
  elsif tg_table_name = 'purchases' then
    select coalesce(array_agg(x), '{}') into v_vals
      from jsonb_each_text(case when jsonb_typeof(new.docs) = 'object' then new.docs else '{}'::jsonb end) d(k, x);
  else
    select coalesce(array_agg(x), '{}') into v_vals
      from jsonb_array_elements_text(case when jsonb_typeof(new.receipt_images) = 'array'
                                          then new.receipt_images else '[]'::jsonb end) x;
  end if;
  update receipt_uploads
     set state = 'attached', attached_at = now()
   where state = 'pending' and owner_id = new.owner_id and path = any (receipt_paths_of(v_vals));
  return null;
end $$;
revoke all on function public.receipt_mark_attached() from public, anon;
drop trigger if exists purchases_receipt_attach on public.purchases;
create trigger purchases_receipt_attach
  after insert or update of docs on public.purchases for each row execute function public.receipt_mark_attached();

-- ════ 9. Permissions ═════════════════════════════════════════════════

-- Called by Dacs Web (each checks the caller itself).
revoke all on function pur_me() from public, anon;
grant execute on function pur_me() to authenticated;
revoke all on function pur_office_buyers() from public, anon;
grant execute on function pur_office_buyers() to authenticated;
revoke all on function pur_set_buyer(uuid, boolean) from public, anon;
grant execute on function pur_set_buyer(uuid, boolean) to authenticated;
revoke all on function pur_buyer_options() from public, anon;
grant execute on function pur_buyer_options() to authenticated;
revoke all on function pur_suppliers() from public, anon;
grant execute on function pur_suppliers() to authenticated;
revoke all on function pur_save_supplier(uuid, text, text, text, boolean) from public, anon;
grant execute on function pur_save_supplier(uuid, text, text, text, boolean) to authenticated;
revoke all on function pur_assign_portion(uuid, uuid, numeric, text) from public, anon;
grant execute on function pur_assign_portion(uuid, uuid, numeric, text) to authenticated;
revoke all on function pur_check_unit(uuid, uuid, int, numeric, text) from public, anon;
grant execute on function pur_check_unit(uuid, uuid, int, numeric, text) to authenticated;
revoke all on function pur_request_change(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function pur_request_change(uuid, uuid, text, jsonb, text) to authenticated;
revoke all on function pur_withdraw_change(uuid) from public, anon;
grant execute on function pur_withdraw_change(uuid) to authenticated;
revoke all on function pur_decide_change(uuid, uuid, boolean, text) from public, anon;
grant execute on function pur_decide_change(uuid, uuid, boolean, text) to authenticated;
revoke all on function pur_change_requests(text) from public, anon;
grant execute on function pur_change_requests(text) to authenticated;
revoke all on function pur_shopping_list(uuid, uuid, text) from public, anon;
grant execute on function pur_shopping_list(uuid, uuid, text) to authenticated;
revoke all on function pur_purchases(date, date, uuid, text) from public, anon;
grant execute on function pur_purchases(date, date, uuid, text) to authenticated;
revoke all on function pur_purchase(uuid) from public, anon;
grant execute on function pur_purchase(uuid) to authenticated;
revoke all on function pur_entry_row(uuid, uuid) from public, anon;
grant execute on function pur_entry_row(uuid, uuid) to authenticated;
revoke all on function pur_review_lines() from public, anon;
grant execute on function pur_review_lines() to authenticated;
-- Replaced in this file; CREATE OR REPLACE keeps 0096's grants, restated here.
revoke all on function pur_correct(uuid, uuid, jsonb, text) from public, anon;
grant execute on function pur_correct(uuid, uuid, jsonb, text) to authenticated;
revoke all on function pur_replace(uuid, uuid, jsonb, text) from public, anon;
grant execute on function pur_replace(uuid, uuid, jsonb, text) to authenticated;
-- Booleans about the caller only: the read and storage policies call them.
revoke all on function pur_buyer() from public, anon;
grant execute on function pur_buyer() to authenticated;
revoke all on function pur_reader() from public, anon;
grant execute on function pur_reader() to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function pur_can_buy(uuid, uuid) from public, anon, authenticated;
revoke all on function pur_person_name(uuid) from public, anon, authenticated;
revoke all on function pur_actor_owner(text) from public, anon, authenticated;
revoke all on function pr_portion_bought(uuid) from public, anon, authenticated;
revoke all on function pr_line_bought(uuid) from public, anon, authenticated;
revoke all on function pr_portion_still(uuid) from public, anon, authenticated;
revoke all on function pr_split_portion(uuid, numeric) from public, anon, authenticated;
revoke all on function pr_apply_quantity(uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function pur_body_keys(jsonb) from public, anon, authenticated;
revoke all on function pur_stored_keys(uuid) from public, anon, authenticated;
revoke all on function pur_bought_by(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function pur_supplier_of(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_store(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_cover_history(uuid) from public, anon, authenticated;
revoke all on function pur_cover_lines(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_links_changed(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_review_doc(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_keep_checks(uuid) from public, anon, authenticated;
revoke all on function pur_apply_checks(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_inherit(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_insert(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function pur_header_ok(jsonb) from public, anon, authenticated;
revoke all on function pur_doc(uuid) from public, anon, authenticated;
revoke all on function pur_purchase_view(uuid) from public, anon, authenticated;
````

Create `supabase/tests/2a2_acceptance.sql`:

````sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-2 acceptance — migration 0097 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists — not the Buyer
-- switch, not the test projects, requests or purchases. Builds its own
-- "ZZ 2a2" projects and one request line. Editor-safe (set_config 'v2a2.*',
-- no temp objects). Needs one active owner with an active staff account
-- allowed Expenses, and one active worker of that owner.
-- Success ends with the row '2a2 acceptance: all checks passed'.
--   A. the Buyer switch (owner only)        E. Project Control's correction keeps the link
--   B. claim; buy 6 of 10 → 4 stay assigned F. void returns the quantity
--   C. extra needs a reason; Still ≥ 0      G. owner approval of a staff change
--   D. a different unit waits for a check   H. workers / non-buyers refused; receipts buyer-only
-- Review fixes (16 Oct):
--   R1. no source links a request without the switch
--   R2. picked portions are the only ones covered (next week untouched)
--   R3. the owner sees the whole change; a unit check makes it stale
--   R4. non-buyer staff read no purchase row — only Project Control's line
--   R5. a substitute needs a reason and waits for an office check
-- Bought is read as a buyer reads it (pur_shopping_list): the counting
-- helpers are internal and signed-in users cannot call them.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_a uuid; v_b uuid; v_req uuid; v_line uuid; v_line2 uuid; v_portion uuid; v_batch uuid;
  v_line3 uuid; v_line4 uuid; v_p3a uuid; v_p3b uuid;
begin
  select p.id, s.id into v_owner, v_staff
    from profiles p join profiles s on s.owner_id = p.id and s.role = 'staff' and coalesce(s.status, 'active') = 'active'
         and (jsonb_typeof(s.allowed_modules) is distinct from 'array' or jsonb_array_length(s.allowed_modules) = 0
              or s.allowed_modules ? 'expenses')
   where p.role = 'owner' and p.owner_id is null and coalesce(p.status, 'active') = 'active'
   order by p.created_at, s.created_at limit 1;
  select w.id into v_worker from profiles w
   where w.owner_id = v_owner and w.role in ('worker', 'teamLeader') and coalesce(w.status, 'active') = 'active'
   order by w.created_at limit 1;
  assert v_owner is not null and v_staff is not null and v_worker is not null,
    'need an active owner with an active staff account allowed Expenses and an active worker';
  assert not exists (select 1 from pur_buyers where user_id = v_staff and is_buyer),
    'A0 run this before switching Buyer on for the test staff account';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a2 project A') returning id into v_a;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a2 project B') returning id into v_b;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_a, 'October', 2026, 'progress', 1);
  insert into project_budgets (project_id, owner_id, monthly_budget)
    select id, v_owner, 1000000 from projects where folder_id = v_a;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_b, 'October', 2026, 'progress', 1);
  insert into project_budgets (project_id, owner_id, monthly_budget)
    select id, v_owner, 1000000 from projects where folder_id = v_b;
  v_batch := pr_batch_for(v_owner, now());
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_worker, v_a, v_a, gen_random_uuid()) returning id into v_req;
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_req, 0, 'material', 'ZZ 2a2 cement', 'bag') returning id into v_line;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line, v_batch, 10) returning id into v_portion;
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_req, 1, 'material', 'ZZ 2a2 hinge', 'pcs') returning id into v_line2;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line2, v_batch, 24);
  -- R2: one line needed this week (4) and next week (6).
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_req, 2, 'material', 'ZZ 2a2 sand', 'bag') returning id into v_line3;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line3, v_batch, 4) returning id into v_p3a;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity)
  values (v_owner, v_line3, pr_batch_for(v_owner, now() + interval '8 days'), 6) returning id into v_p3b;
  -- R5: a line a substitute is bought for.
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_req, 3, 'material', 'ZZ 2a2 Boysen paint', 'gal') returning id into v_line4;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line4, v_batch, 2);

  perform set_config('v2a2.line3', v_line3::text, true);
  perform set_config('v2a2.line4', v_line4::text, true);
  perform set_config('v2a2.p3a', v_p3a::text, true);
  perform set_config('v2a2.p3b', v_p3b::text, true);
  perform set_config('v2a2.owner', v_owner::text, true);
  perform set_config('v2a2.staff', v_staff::text, true);
  perform set_config('v2a2.worker', v_worker::text, true);
  perform set_config('v2a2.a', v_a::text, true);
  perform set_config('v2a2.b', v_b::text, true);
  perform set_config('v2a2.line', v_line::text, true);
  perform set_config('v2a2.line2', v_line2::text, true);
  perform set_config('v2a2.portion', v_portion::text, true);
end $$;

set local role authenticated;

-- ═══ A. The Buyer switch ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not pur_buyer(), 'A1 staff without the switch cannot buy';
  begin
    perform pur_set_buyer(current_setting('v2a2.staff')::uuid, true);
    raise exception 'A2 staff set the switch';
  exception when others then
    assert sqlerrm like '%OWNER_ONLY%', 'A2 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_shopping_list();
    raise exception 'H1 a non-buyer read the shopping list';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'H1 wrong error: ' || sqlerrm;
  end;
  -- R1. The Expenses form is still open to them, but not for linking a request.
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'expenses_form', 'purchase_date', '2026-10-14', 'receipt_total', 100,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                                                    'quantity', 1, 'unit', 'bag', 'amount', 100, 'request_line_id', current_setting('v2a2.line')))));
    raise exception 'R1 a non-buyer linked a request through the Expenses form';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'R1 wrong error: ' || sqlerrm;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  perform pur_set_buyer(current_setting('v2a2.staff')::uuid, true);
end $$;

-- ═══ B–F as the Buyer ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_list jsonb; v_l jsonb; v_pid uuid; v_pid2 uuid; v_id uuid;
begin
  assert pur_buyer(), 'A3 the switch lets staff buy';
  -- B. claim, buy 6 of 10
  perform pur_assign_portion(current_setting('v2a2.portion')::uuid, current_setting('v2a2.staff')::uuid, null, null);
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1500,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                                                       'quantity', 6, 'unit', 'bag', 'amount', 1500, 'request_line_id', current_setting('v2a2.line')))));
  v_pid := (r ->> 'purchase_id')::uuid;
  v_list := pur_shopping_list(null, current_setting('v2a2.a')::uuid, 'all');
  select x into v_l from jsonb_array_elements(v_list) x where x ->> 'line_id' = current_setting('v2a2.line');
  assert (v_l ->> 'needed')::numeric = 10 and (v_l ->> 'bought')::numeric = 6 and (v_l ->> 'still_to_buy')::numeric = 4,
    'B1 Needed 10 · Bought 6 · Still 4: ' || v_l::text;
  assert (v_l -> 'portions' -> 0 ->> 'buyer_id') = current_setting('v2a2.staff'), 'B2 the 4 stay assigned';
  assert v_list::text !~* '"(amount|price|receipt_total|gross_amount)"', 'H2 the shopping list carries no money';

  -- C. 6 more for the last 4: a reason is needed; then Still is 0, not −2
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1500,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                                                    'quantity', 6, 'unit', 'bag', 'amount', 1500, 'request_line_id', current_setting('v2a2.line')))));
    raise exception 'C1 an extra without a reason was recorded';
  exception when others then
    assert sqlerrm like '%EXTRA_REASON_REQUIRED%', 'C1 wrong error: ' || sqlerrm;
  end;
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1500,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                    'quantity', 6, 'unit', 'bag', 'amount', 1500, 'request_line_id', current_setting('v2a2.line'),
                    'extra_reason', 'sold in sixes', 'extra_location', 'warehouse'))));
  v_pid2 := (r ->> 'purchase_id')::uuid;
  assert (r -> 'covers' -> 0 ->> 'covered')::numeric = 4 and (r -> 'covers' -> 0 ->> 'extra')::numeric = 2, 'C2 covers 4, extra 2: ' || r::text;
  select x into v_l from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line');
  assert (v_l ->> 'still_to_buy')::numeric = 0 and (v_l ->> 'extra')::numeric = 2, 'C3 Still 0 (never negative), Extra 2';

  -- D. a box for a request in pcs: covers nothing until someone else checks it
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 900,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 hinge',
                    'quantity', 2, 'unit', 'box', 'amount', 900, 'request_line_id', current_setting('v2a2.line2')))));
  assert (r -> 'covers' -> 0 ->> 'unit_check') = 'pending' and (r -> 'covers' -> 0 ->> 'covered')::numeric = 0, 'D1 pending, nothing covered';
  perform set_config('v2a2.boxp', r ->> 'purchase_id', true);
  begin
    perform pur_check_unit(gen_random_uuid(), (r ->> 'purchase_id')::uuid, 1, 24, 'own check');
    raise exception 'D2 the buyer checked their own purchase';
  exception when others then
    assert sqlerrm like '%OWN_PURCHASE%', 'D2 wrong error: ' || sqlerrm;
  end;
  -- R3 (set-up). A change request on this purchase, made BEFORE the owner's unit check below.
  r := pur_request_change(gen_random_uuid(), current_setting('v2a2.boxp')::uuid, 'void', null, 'ZZ 2a2 bought twice');
  perform set_config('v2a2.cr_stale', r ->> 'request_id', true);

  -- R2. 4 picked from this week's 4, 6 bought: the other 2 are extra — next week's 6 untouched.
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 600,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 sand', 'quantity', 6,
                 'unit', 'bag', 'amount', 600, 'request_line_id', current_setting('v2a2.line3'),
                 'portion_picks', jsonb_build_array(jsonb_build_object('portion_id', current_setting('v2a2.p3a'), 'quantity', 4))))));
    raise exception 'R2a the 2 beyond the pick were covered from another week';
  exception when others then
    assert sqlerrm like '%EXTRA_REASON_REQUIRED%', 'R2a wrong error: ' || sqlerrm;
  end;
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 600,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 sand', 'quantity', 6,
                    'unit', 'bag', 'amount', 600, 'request_line_id', current_setting('v2a2.line3'),
                    'extra_reason', 'sold in sixes', 'extra_location', 'project',
                    'portion_picks', jsonb_build_array(jsonb_build_object('portion_id', current_setting('v2a2.p3a'), 'quantity', 4))))));
  assert (r -> 'covers' -> 0 ->> 'covered')::numeric = 4 and (r -> 'covers' -> 0 ->> 'extra')::numeric = 2, 'R2b covers the pick only: ' || r::text;
  select x into v_l from jsonb_array_elements(pur_shopping_list(null, current_setting('v2a2.a')::uuid, 'all')) x
   where x ->> 'line_id' = current_setting('v2a2.line3');
  assert (select (p ->> 'bought')::numeric from jsonb_array_elements(v_l -> 'portions') p where p ->> 'id' = current_setting('v2a2.p3b')) = 0,
    'R2c next week untouched: ' || v_l::text;

  -- R5. A substitute: a reason first; then it covers nothing until the office checks it.
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1800,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 Davies paint', 'quantity', 2,
                 'unit', 'gal', 'amount', 1800, 'request_line_id', current_setting('v2a2.line4'), 'substitute', true))));
    raise exception 'R5a a substitute without a reason was recorded';
  exception when others then
    assert sqlerrm like '%SUBSTITUTE_REASON_REQUIRED%', 'R5a wrong error: ' || sqlerrm;
  end;
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1800,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 Davies paint', 'quantity', 2,
                    'unit', 'gal', 'amount', 1800, 'request_line_id', current_setting('v2a2.line4'), 'substitute', true,
                    'substitute_reason', 'Boysen out of stock; foreman agreed'))));
  assert (r -> 'covers' -> 0 ->> 'unit_check') = 'pending' and (r -> 'covers' -> 0 ->> 'covered')::numeric = 0, 'R5b waits for a check: ' || r::text;

  -- E. Project Control's form (no source, no link) keeps the request link
  perform pur_correct(gen_random_uuid(), v_pid, jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 1560,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                                                  'quantity', 6, 'unit', 'bag', 'amount', 1560))), 'receipt said 1,560');
  assert (select request_line_id from purchase_lines where purchase_id = v_pid) = current_setting('v2a2.line')::uuid, 'E1 link kept';
  assert (select (x ->> 'bought')::numeric from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line')) = 10, 'E2 Bought still 6 + 4, covers rebuilt once';

  -- F. void returns the quantity; the assignment stays
  perform pur_void(gen_random_uuid(), v_pid2, 'test');
  assert (select (x ->> 'bought')::numeric from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line')) = 6, 'F1 Bought back to 6';

  -- G. a staff change for the owner: move the purchase to project B
  begin
    perform pur_correct(gen_random_uuid(), v_pid, jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 1560,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.b'), 'item_name', 'ZZ 2a2 cement',
                                                    'quantity', 6, 'unit', 'bag', 'amount', 1560, 'request_line_id', null,
                                                    'unplanned_reason', 'wrong site'))), 'wrong site');
    raise exception 'G1 staff moved a cost to another project';
  exception when others then
    assert sqlerrm like '%OWNER_APPROVAL_NEEDED%', 'G1 wrong error: ' || sqlerrm;
  end;
  r := pur_request_change(gen_random_uuid(), v_pid, 'correct', jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 1560,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.b'), 'item_name', 'ZZ 2a2 cement',
                                                       'quantity', 6, 'unit', 'bag', 'amount', 1560, 'request_line_id', null,
                                                       'unplanned_reason', 'wrong site'))), 'wrong site');
  perform set_config('v2a2.cr', r ->> 'request_id', true);
  perform set_config('v2a2.pid', v_pid::text, true);
  assert exists (select 1 from jsonb_array_elements(pur_change_requests('pending')) x where x ->> 'id' = current_setting('v2a2.cr')),
    'G2 the requester sees it';
end $$;

-- ═══ D / G as the owner ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_cr jsonb;
begin
  -- R3. The owner sees the whole change: quantity, unit, date, project, total, before and after.
  select x into v_cr from jsonb_array_elements(pur_change_requests('pending')) x where x ->> 'id' = current_setting('v2a2.cr');
  assert (v_cr -> 'proposed' -> 'lines' -> 0 ->> 'quantity')::numeric = 6 and v_cr -> 'proposed' -> 'lines' -> 0 ->> 'unit' = 'bag'
     and v_cr -> 'proposed' ->> 'purchase_date' = '2026-10-14' and v_cr -> 'proposed' -> 'lines' -> 0 ->> 'where' like 'ZZ 2a2 project B%'
     and v_cr -> 'base' -> 'lines' -> 0 ->> 'where' like 'ZZ 2a2 project A%' and (v_cr -> 'proposed' ->> 'receipt_total')::numeric = 1560,
    'R3a the full change: ' || v_cr::text;
  select x into v_cr from jsonb_array_elements(pur_change_requests('pending')) x where x ->> 'id' = current_setting('v2a2.cr_stale');
  assert not (v_cr ->> 'changed_since')::boolean, 'R3b not changed yet';
  perform pur_check_unit(gen_random_uuid(), current_setting('v2a2.boxp')::uuid, 1, 24, '2 boxes of 12');
  select x into v_cr from jsonb_array_elements(pur_change_requests('pending')) x where x ->> 'id' = current_setting('v2a2.cr_stale');
  assert (v_cr ->> 'changed_since')::boolean, 'R3c the owner is warned: the unit check changed the purchase';
  r := pur_decide_change(gen_random_uuid(), current_setting('v2a2.cr_stale')::uuid, true, null);
  assert r ->> 'status' = 'stale', 'R3d approval refused after the unit check: ' || r::text;
  assert (select (x ->> 'bought')::numeric from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line2')) = 24, 'D3 covered after the owner''s check';
  assert (select kind from purchase_history where purchase_id = current_setting('v2a2.boxp')::uuid order by id desc limit 1) = 'unit_checked', 'D4 audited';
  r := pur_decide_change(gen_random_uuid(), current_setting('v2a2.cr')::uuid, true, null);
  assert r ->> 'status' = 'approved', 'G3 approved: ' || r::text;
  assert (select folder_id from purchase_lines where purchase_id = current_setting('v2a2.pid')::uuid) = current_setting('v2a2.b')::uuid, 'G4 moved to B';
  assert (select (x ->> 'bought')::numeric from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line')) = 0, 'G5 no longer covers the request';
  assert (select reason from purchase_history where purchase_id = current_setting('v2a2.pid')::uuid order by id desc limit 1) like '%requested by%', 'G6 history names the requester';
  perform set_config('v2a2.pline', (select id::text from purchase_lines where purchase_id = current_setting('v2a2.pid')::uuid), true);
  perform pur_set_buyer(current_setting('v2a2.staff')::uuid, false);
end $$;

-- ═══ H. Isolation ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  assert not pur_buyer(), 'H3 switched off';
  assert not uploads_can_read('purchases/' || current_setting('v2a2.owner') || '/2026-10/00000000-0000-0000-0000-000000000001.jpg', null),
    'H4 a non-buyer cannot read purchase receipts';
  -- 2A-1 unchanged: staff still record from the Expenses / Project Control form
  perform pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 10,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 nails', 'amount', 10))));
  -- R4. … but read no purchase row — Project Control gets only the line it edits.
  assert not exists (select 1 from purchases) and not exists (select 1 from purchase_lines)
     and not exists (select 1 from purchase_history) and not exists (select 1 from purchase_change_requests),
    'R4a a non-buyer read purchase rows';
  r := pur_entry_row(current_setting('v2a2.pline')::uuid, null);
  assert r -> 'line' ->> 'item_name' = 'ZZ 2a2 cement' and (r ->> 'line_count')::int = 1
     and not (r ? 'covers') and not (r -> 'purchase' ? 'bought_by'), 'R4b the edit form''s line, nothing more: ' || r::text;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_shopping_list();
    raise exception 'H5 a worker read the shopping list';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'H5 wrong error: ' || sqlerrm;
  end;
  assert not exists (select 1 from purchase_line_covers), 'H6 a worker reads no covers';
  assert not exists (select 1 from suppliers), 'H7 a worker reads no suppliers';
end $$;

reset role;
select '2a2 acceptance: all checks passed' as result;
rollback;
````

Patch `supabase/tests/2a1_acceptance.sql` (review R3: 0097 makes purchase rows readable by buyers only, and this script reads them as its staff account to check its own results — so where 0097 is applied that account gets the Buyer switch inside the rolled-back transaction, switched off around the phone-purchasing check. Unchanged, it fails at A5 after 0097):

````diff
diff --git a/supabase/tests/2a1_acceptance.sql b/supabase/tests/2a1_acceptance.sql
index df36487..9c650cb 100644
--- a/supabase/tests/2a1_acceptance.sql
+++ b/supabase/tests/2a1_acceptance.sql
@@ -68,6 +68,19 @@ begin
   perform set_config('v2a1.paw', v_paw::text, true);
 end $$;
 
+-- 0097 (2A-2, review R3) lets only those who may BUY read purchase rows.
+-- This script reads them to check its own results, so where 0097 is applied
+-- its staff account gets the Buyer switch for this rolled-back transaction.
+-- Recording from the Expenses form works the same either way (0096).
+do $$
+begin
+  if to_regclass('public.pur_buyers') is not null then
+    execute 'insert into pur_buyers (user_id, owner_id, is_buyer, updated_by) values ($1, $2, true, $2)
+             on conflict (user_id) do update set is_buyer = true'
+      using current_setting('v2a1.staff')::uuid, current_setting('v2a1.owner')::uuid;
+  end if;
+end $$;
+
 set local role authenticated;
 
 -- ═══ A. The §3.3 example, recorded by STAFF (B: budgets they cannot read) ═══
@@ -210,6 +223,15 @@ begin
 end $$;
 
 -- ═══ I. Phone purchasing needs the Buyer switch (2A-2) ═══
+-- (with 0097: the switch given above is off for this check, then back on)
+reset role;
+do $$
+begin
+  if to_regclass('public.pur_buyers') is not null then
+    execute 'update pur_buyers set is_buyer = false where user_id = $1' using current_setting('v2a1.staff')::uuid;
+  end if;
+end $$;
+set local role authenticated;
 do $$
 begin
   begin
@@ -220,6 +242,14 @@ begin
     assert sqlerrm like '%BUYER_REQUIRED%', 'I1 wrong error: ' || sqlerrm;
   end;
 end $$;
+reset role;
+do $$
+begin
+  if to_regclass('public.pur_buyers') is not null then
+    execute 'update pur_buyers set is_buyer = true where user_id = $1' using current_setting('v2a1.staff')::uuid;
+  end if;
+end $$;
+set local role authenticated;
 
 -- ═══ J. Stock: added inside the purchase, once — a retry adds nothing ═══
 do $$
````

Patch `supabase/migrations/README.md`:

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
index 9a200b1..748eaa9 100644
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0097** — highest on disk is
-  `0096_purchase_recording.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0098** — highest on disk is
+  `0097_purchasing_office.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -178,6 +178,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0096 (WorkMate Stage 2A-1 — one purchase recording operation)** adds `purchases` (one receipt: actual `purchase_date`, `receipt_total`, docs, `recorded`/`void`), `purchase_lines` (project or AW folder — kept as history with `folder_name`, no foreign key, so a project whose purchases are all voided can be deleted — or warehouse), `purchase_charges` + `purchase_charge_shares` (delivery fee / discount, split by line to the centavo, largest remainder), `purchase_history` (recorded / corrected / refunded / voided / replaced, before and after), `pur_ops` (first answer per operation id) and `purchase_stock_moves` (one stock move per line, ever); `expenses.purchase_line_id` / `purchase_charge_id` / `folder_id`. `pur_record`, `pur_correct`, `pur_refund`, `pur_void`, `pur_replace` (void + record in one transaction, stock carried over) — active owner/staff accounts allowed the **Expenses** section only, for recording AND reading (module-focused accounts refused; source `workmate` refused until the 2A-2 Buyer switch) — write ORDINARY `expenses` rows funded by the ACTUAL purchase month: earliest billing number first, each period up to budget − expenses − payroll, shortage to Cover (`cover_expense`) on the project's Cover period, else a client period of **that month only** (never another month's — it would use up that month's client money), no eligible period that month → all Cover + `needs_funding_review`; no Cover period and no billing period in the purchase month → a Cover row tied to the project (`folder_id`, no `project_id`), flagged — no period is ever invented; Additional Works in full on their own period. Quantities and minimum stock take **at most 3 decimals** (more is refused, `BAD_QUANTITY`; Dacs Web rounds first). Every call locks its operation, then (for a change to an existing purchase) that purchase, then every project and stock item it touches, in one fixed order, before writing. The "track in inventory" stock update runs inside the recording, once per line, matched within the company. Trigger `expenses_purchase_guard` refuses any other write to a purchase-made or project-level row; triggers `folders_purchase_delete_guard` / `projects_purchase_delete_guard` refuse deleting a project or period with a live purchase BEFORE anything is removed (a fully discounted purchase counts), and Dacs Web asks `pur_live_purchases()` first — it counts the project's Additional Works jobs too, since they cascade-delete with it. Dacs Web Expenses → Add expense records through `pur_record` from this migration on: **apply 0096 before deploying the web change.** Prove with `npm run test:sql` (PGlite + two sessions on a throwaway real PostgreSQL; CI runs it too); live: `supabase/tests/2a1_acceptance.sql` (self-wrapped, rolls back). **Live history:** on 15 Oct 2026 a pre-final draft of this file was first run by hand (SQL editor); the same day, after a rolled-back live run of the acceptance checks, the five function bodies the final review changed (`pur_cover_period`, `pur_fund`, `pur_store`, `pur_op_begin`, `pur_open`) were applied via MCP migration `0096_purchase_recording_final_functions`. No purchase existed in between. Live now matches this file (all 31 `pur_` function bodies verified by checksum).
 
+**0097 (WorkMate Stage 2A-2 — the office Purchasing tab and the Buyer switch)** adds `pur_buyers` + `pur_buyer_events` (the per-staff **Buyer** switch, set by the main owner only: `pur_set_buyer`, listed by `pur_office_buyers`), `suppliers` (`pur_suppliers`, `pur_save_supplier`), `pr_line_portions.buyer_id` / `assigned_by` / `assigned_at` (who is buying a portion — `pur_assign_portion`: the owner assigns or reassigns anything, a buyer claims an unassigned portion, gives an unassigned one to another buyer, or releases their own; part of a portion is split off; a partly bought portion keeps its bought part with whoever bought it), `purchases.bought_by` / `supplier_id` and the `purchasing` source, `purchase_lines.request_line_id` + covering columns (`portion_picks`, `covered_qty`, `extra_qty` / `extra_reason` / `extra_location`, `unit_check` / `unit_covers`, `unplanned_reason`), `purchase_line_covers` (which portions a line covers — rebuilt from the stored lines by `pur_cover_lines` every time a purchase is recorded, corrected, replaced or voided, in the same transaction as its expense rows; only RECORDED purchases count, so Bought is never doubled and Still to buy never negative), `purchase_change_requests` (staff changes the owner must approve — `pur_request_change`, `pur_decide_change` runs the very same `pur_correct` / `pur_replace` / `pur_void`, `pur_withdraw_change`, `pur_change_requests`; stale if the purchase changed) and `pur_check_unit` (an audited office check of what a different-unit line covers; never by its own buyer; history kind `unit_checked`). Who may BUY (`pur_buyer()` / `pur_can_buy`): an active owner account or that owner's staff with the switch on, allowed the **Expenses** section, inside its own company — sources `purchasing` and `workmate` need it; `expenses_form` keeps 0096's rule. Redefines `pur_actor_owner`, `pur_header_ok`, `pur_body_keys` / `pur_stored_keys` (adding `pr_line:` locks), `pur_store`, `pur_insert` (now 5 arguments; the 4-argument version is dropped), `pur_correct` (lines a body leaves unlinked keep their stored request link — `pur_inherit`), `pur_replace` (voids the old purchase BEFORE recording the new), `pur_doc`; and 0085/0086's `pr_apply_quantity` (bought quantity is protected like arranged quantity: reduced only by flagging) and `pr_office_move_portion` (a bought portion stays in its batch, `BOUGHT`). Purchase receipt photos: `purchases/<company>/<yyyy-mm>/<uuid>.jpg`, readable and writable only by `pur_buyer()` of that company (`uploads_can_read` / `uploads_can_write` / the overwrite policy redefined from 0089; `receipt_uploads` accepts kind `purchase`; a purchase's own docs mark its upload attached). Reading: `pur_shopping_list` (quantities and names only), `pur_purchases`, `pur_purchase`, `pur_buyer_options`, `pur_me`. Spent is computed exactly as in 0096. Dacs Web Requests → Purchasing (js/purchasing-admin-*.js) and the Buyer switch (Users → Navigator) need it: **apply 0097 before deploying the web change.** Prove with `npm run test:sql` (2A-2 behaviour on PGlite, two-session races on a throwaway PostgreSQL, and the 2A-1 suite re-run with 0097 on top); live: `supabase/tests/2a2_acceptance.sql` (self-wrapped, rolls back).
+
 Get the truth before relying on this line:
 
 ```sql
````

Patch `js/receipt-storage.js` (the `purchase` receipt kind → the `purchases/` folder; the storage test's scan needs it):

````diff
diff --git a/js/receipt-storage.js b/js/receipt-storage.js
index 8a4056c..8f57d85 100644
--- a/js/receipt-storage.js
+++ b/js/receipt-storage.js
@@ -4,11 +4,13 @@
 // 2026-10-08-receipt-photos-storage-design.md). The row stores the public-
 // FORMAT URL; supabase-config.js §11b signs it wherever the page shows it.
 // Separate print windows don't run §11b, so their HTML goes through signHtml.
-// Access (migration 0089): owner/staff of the company in path segment 2 only.
+// Access (migration 0089): owner/staff of the company in path segment 2 only;
+// purchases/ (0097): only those who may buy in that company.
 // ════════════════════════════════════════════════════════════════════
 (function (root) {
   'use strict';
-  const FOLDER = { expense: 'expenseReceipts', payroll: 'payrollReceipts' };
+  // 'purchase' (0097): one receipt for a whole purchase — buyers of the company only.
+  const FOLDER = { expense: 'expenseReceipts', payroll: 'payrollReceipts', purchase: 'purchases' };
   const PUB_RE = /\/storage\/v1\/object\/public\/uploads\/([^?#"'\s<>)]+)/;
   const PUB_RE_G = /https?:\/\/[^"'\s<>)]*\/storage\/v1\/object\/public\/uploads\/[^"'\s<>)]+/g;
 
````

Patch `package.json` (part 1 — the server suites):

````diff
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,10 +1,10 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-server.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
````

- [ ] **Step 4: Run everything**

Run: `npm test` → Expected: exit 0 (every suite `… passed, 0 failed`; `purchasing-server` 20 passed, `storage-access` 19 passed).
Run: `npm run test:sql` → Expected, in order: `45 passed` (2A-1), `10 passed` (2A-1 races), `45 passed` (2A-1 with 0097), `34 passed` (2A-2), `5 passed` (2A-2 races); exit 0.

- [ ] **Step 5: Commit (the user)** — files above; suggested message: `2A-2 server: migration 0097 (Buyer switch, portions, request covers, approvals, buyer-only receipts) + tests`.

---

### Task 2: Dacs Web — the Purchasing tab, the Buyer switch, "Send to the owner"

**Files:**
- Create: `tests/purchasing-admin.test.js`, `js/purchasing-admin-core.js`, `js/purchasing-admin-list.js`, `js/purchasing-admin-record.js`, `js/purchasing-admin-purchases.js`, `css/purchasing-admin.css`
- Modify: `package.json`, `js/admin.js`, `admin.html`, `js/user-navigator.js`, `js/expenses-module.js`, `js/supabase-config.js`

**Interfaces:**
- Consumes: Task 1's RPCs (Project Control: `pur_entry_row`, `pur_review_lines`); `window.RequestsAdmin` (`esc`, `rpc`, `modal`, `head`, `fail`, `icons`, `views`, `formatDay`, `cutoffLabel`, `formatManila`); `window.DacsReceipts` (`newId`, `compressToBlob`, `uploadReceipt('purchase', …)`); `window.dacsMaybeSignUrl`.
- Produces: `window.PurchasingAdmin` (pure: `peso`, `qty`, `parseMoney`, `parseQty`, `sameUnit`, `portionActions`, `buyerLabel`, `filterList`, `listSummary`, `coverPreview`, `pickedStill`, `lineStill`, `countsDirectly`, `docUploads`, `prorate`, `receiptTotal`, `buildBody`, `formProblems`, `purchaseFlags`, `needsOwner`, `changeRows`, `errorMessage`, `ERRORS`, `HISTORY_LABEL`, `REQUEST_STATUS`; browser: `me()`, `openPurchase(id)`, `openRecord(ctx)`, `notice(err, title)`, `pill`, `ui`); views `reqPurchasing`, `reqPurchase`; `window.currentCanBuy`; `window.unToggleBuyer(uid, on)`.

- [ ] **Step 1: Write the test first**

Create `tests/purchasing-admin.test.js`:

````js
// ════════════════════════════════════════════════════════════════════
// PURCHASING TAB TESTS: run with  node tests/purchasing-admin.test.js
//
// Zero dependencies. Loads the REAL js/purchasing-admin-core.js (it exports
// its pure half under Node) and reads the screens' source:
//   1. Previews agree with the server: the charge split (pur_prorate), what
//      a line covers and what is extra, what the form must refuse.
//   2. The body sent to pur_record keeps the request link, Unplanned lines
//      their reason, and adds up to the receipt total.
//   3. Which portion buttons show (claim / assign / release).
//   4. Wiring: the tab is in the nav for buyers only, its drill-down is
//      allowed for module-focused accounts, admin.html loads it, and the
//      screens call only the purchasing RPCs — never a table write.
//   5. Project Control's staff path sends owner-only changes for approval.
//   6. The review fixes (16 Oct): picked portions and substitutes in the
//      form, receipt photos that survive redraws and replacements, the
//      owner's field-by-field approval view, Purchasing for accounts
//      focused on Expenses, buyer-only receipt delivery, and Project
//      Control's one-line read.
// ════════════════════════════════════════════════════════════════════
'use strict';
const pa = require('../js/purchasing-admin-core.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

let passed = 0, failed = 0;
const failures = [];
// A test may return a promise; the summary waits for all of them.
const pending = [];
function test(name, fn) {
  const pass = () => { passed++; console.log('  ok  ' + name); };
  const fail = (e) => { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(pass, fail)); else pass();
  } catch (e) { fail(e); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((label || '') + ' expected ' + y + ', got ' + x);
}

console.log('\npurchasing-admin: previews agree with the server');

test('the default charge split is pur_prorate: ₱200 over ₱3,000 / ₱1,000 → ₱150 / ₱50 (spec example)', () => {
  eq(pa.prorate(200, [3000, 1000]), [150, 50]);
});
test('left-over centavos go to the biggest remainders, the earliest line on a tie; always adds up', () => {
  eq(pa.prorate(100, [1, 1, 1]), [33.34, 33.33, 33.33]);
  eq(pa.prorate(0.03, [1, 1, 1, 1, 1]), [0.01, 0.01, 0.01, 0, 0]);
  eq(pa.prorate(10, [0, 0]), [5, 5], 'no weights → equal');
  const s = pa.prorate(1234.57, [17.5, 3, 900.01]);
  eq(Math.round(s.reduce((a, b) => a + b, 0) * 100), 123457, 'adds up to the centavo');
});
test('a line covers up to Still to buy; the rest is extra; a different unit waits for a check', () => {
  eq(pa.coverPreview(10, 12, true), { covers: 10, extra: 2, unitCheck: false });
  eq(pa.coverPreview(10, 6, true), { covers: 6, extra: 0, unitCheck: false });
  eq(pa.coverPreview(-3, 2, true), { covers: 0, extra: 2, unitCheck: false }, 'never negative');
  eq(pa.coverPreview(24, 2, false), { covers: 0, extra: 0, unitCheck: true });
  ok(pa.sameUnit(' Bag ', 'bag') && !pa.sameUnit('box', 'pcs'), 'units compare trimmed, any case');
});
test('the receipt total is lines + fees − discounts', () => {
  eq(pa.receiptTotal([{ amount: 1000 }, { amount: 2000.5 }], [{ kind: 'delivery_fee', amount: 200 }, { kind: 'discount', amount: 100.25 }]), 3100.25);
});
test('money and quantities parse like the server (pur_money / pur_qty)', () => {
  eq([pa.parseMoney('1,500.50'), pa.parseMoney('1.234'), pa.parseMoney('-1'), pa.parseMoney('abc')], [1500.5, null, null, null]);
  eq([pa.parseQty('2.125'), pa.parseQty('0'), pa.parseQty('1.2345'), pa.parseQty('1e3')], [2.125, null, null, null]);
});

console.log('\npurchasing-admin: the form and its body');

const linked = { requestLineId: 'L1', requestUnit: 'bag', still: 10, folderId: 'F1', itemName: 'Cement', quantity: 12, unit: 'bag', amount: 3000 };
test('the form refuses an extra without a reason and location, and Unplanned without a reason', () => {
  const st = { purchaseDate: '2026-10-14', lines: [linked, { folderId: 'F1', itemName: 'Tape', quantity: 1, amount: 10 }], charges: [] };
  eq(pa.formProblems(st).map(p => p.code + ':' + p.line), ['EXTRA_REASON_REQUIRED:1', 'UNPLANNED_REASON_REQUIRED:2']);
  const fixed = { ...st, lines: [{ ...linked, extraReason: 'pack of 12', extraLocation: 'warehouse' },
                                 { folderId: 'F1', itemName: 'Tape', quantity: 1, amount: 10, unplannedReason: 'leak' }] };
  eq(pa.formProblems(fixed), []);
});
test('the form refuses a split that does not add up, a missing date and a missing project', () => {
  const st = { purchaseDate: '', lines: [{ ...linked, quantity: 2, folderId: '' }],
               charges: [{ kind: 'delivery_fee', amount: 100, shares: [60, 30] }] };
  eq(pa.formProblems(st).map(p => p.code), ['BAD_DATE', 'BAD_PROJECT', 'SPLIT_MISMATCH']);
});
test('the body keeps the request link and the extra; an Unplanned line sends its reason and no link', () => {
  const b = pa.buildBody({ purchaseDate: '2026-10-14', supplierId: 'S1', paymentMethod: 'Cash', boughtBy: 'U2',
    lines: [{ ...linked, extraReason: ' pack ', extraLocation: 'warehouse', portionPicks: [{ portionId: 'P1', quantity: 4 }] },
            { destination: 'warehouse', itemName: 'Bolts', quantity: 6, unit: 'pcs', amount: 60, unplannedReason: 'stock' }],
    charges: [{ kind: 'delivery_fee', amount: 200 }] });
  eq(b.source, 'purchasing');
  eq(b.receipt_total, 3260);
  eq([b.lines[0].request_line_id, b.lines[0].extra_reason, b.lines[0].portion_picks], ['L1', 'pack', [{ portion_id: 'P1', quantity: 4 }]]);
  eq([b.lines[1].request_line_id, b.lines[1].folder_id, b.lines[1].unplanned_reason], [null, null, 'stock']);
  eq(b.bought_by, 'U2');
  ok(!('shares' in b.charges[0]), 'no shares unless adjusted → the server splits');
});

console.log('\npurchasing-admin: portion buttons');

const me = { userId: 'me', isOwner: false };
test('unassigned: "I\'ll buy this" and Assign; mine: Release; someone else\'s: nothing for staff', () => {
  eq(pa.portionActions({ buyer_id: null, still_to_buy: 3 }, me), { claim: true, release: false, assign: true });
  eq(pa.portionActions({ buyer_id: 'me', still_to_buy: 3 }, me), { claim: false, release: true, assign: false });
  eq(pa.portionActions({ buyer_id: 'x', still_to_buy: 3 }, me), { claim: false, release: false, assign: false });
  eq(pa.portionActions({ buyer_id: 'x', still_to_buy: 3 }, { userId: 'o', isOwner: true }), { claim: false, release: true, assign: true });
  eq(pa.portionActions({ buyer_id: null, still_to_buy: 0 }, me), { claim: false, release: false, assign: false }, 'nothing left');
  eq([pa.buyerLabel({ buyer_id: null }, me), pa.buyerLabel({ buyer_id: 'me' }, me), pa.buyerLabel({ buyer_id: 'x', buyer_name: 'Pedro' }, me)],
     ['Unassigned', 'You', 'Pedro']);
});
test('server codes become sentences; an unknown error keeps its text', () => {
  ok(pa.errorMessage({ message: 'EXTRA_REASON_REQUIRED', hint: 'Line 1: 2 more' }).includes('Line 1: 2 more'), 'hint shown');
  ok(pa.errorMessage({ code: 'PGRST202' }).includes('0097'), 'not applied yet');
  ok(pa.errorMessage(new Error('boom')).startsWith('Something went wrong: boom'), 'fallback');
  ok(pa.needsOwner({ message: 'COMPLETED_PROJECT' }) && !pa.needsOwner({ message: 'BAD_DATE' }), 'owner-only codes');
});

console.log('\npurchasing-admin: wiring');

test('the nav has Purchasing and its drill-down, hidden unless the server says this account may buy', () => {
  const src = read('js/admin.js');
  ok(/view: 'reqPurchasing'/.test(src) && /view: 'reqPurchase',[^}]*hidden: true/.test(src), 'modules');
  ok(/requests: \['reqDetail', 'reqPurchase'\]/.test(src), '_FOCUS_SUBVIEWS');
  ok(/p\.id === 'requests' && !window\.currentCanBuy[\s\S]{0,400}'reqPurchasing', 'reqPurchase'/.test(src), '_visibleNav gate');
  ok(/rpc\('pur_me'\)[\s\S]{0,120}currentCanBuy = !!\(purMe && purMe\.can_buy\)/.test(src), 'loaded from the server at sign-in');
});
test('admin.html loads the purchasing files after Requests, with their views', () => {
  const html = read('admin.html');
  for (const f of ['purchasing-admin-core', 'purchasing-admin-list', 'purchasing-admin-record', 'purchasing-admin-purchases']) {
    ok(html.indexOf('js/' + f + '.js') > html.indexOf('js/requests-admin-core.js'), f);
  }
  ok(/id="reqPurchasingView"/.test(html) && /id="reqPurchaseView"/.test(html), 'views');
  ok(/REQ_VIEWS\s*=\s*\[[^\]]*'reqPurchasing','reqPurchase'\]/.test(html), 'REQ_VIEWS');
  ok(html.indexOf('css/purchasing-admin.css') > 0, 'styles');
  // Files this stage changes must reach an already-open browser (a stale admin.js hides the tab).
  for (const f of ['supabase-config', 'admin', 'receipt-storage', 'expenses-module']) {
    const m = html.match(new RegExp('js/' + f + '\\.js\\?v=(\\d{8})'));
    ok(m && Number(m[1]) >= 20261016, f + '.js cache-buster not bumped for 2A-2');
  }
});
test('the screens call only purchasing RPCs and write no table directly', () => {
  const allowed = new Set(['pur_me', 'pur_shopping_list', 'pur_assign_portion', 'pr_office_set_arranged', 'pr_office_batches',
    'pur_buyer_options', 'pur_suppliers', 'pur_save_supplier', 'pur_record', 'pur_correct', 'pur_replace', 'pur_void',
    'pur_purchases', 'pur_purchase', 'pur_check_unit', 'pur_request_change', 'pur_change_requests', 'pur_decide_change',
    'pur_withdraw_change']);
  for (const f of ['purchasing-admin-core', 'purchasing-admin-list', 'purchasing-admin-record', 'purchasing-admin-purchases']) {
    const src = read('js/' + f + '.js');
    for (const m of src.matchAll(/rpc\('([a-z_]+)'/g)) ok(allowed.has(m[1]), f + ' calls ' + m[1]);
    ok(!/\.(insert|update|upsert|delete)\(/.test(src.replace(/\.update\(\)/g, '')), f + ' writes a table directly');
  }
});
test('purchase receipts go to their own buyers-only folder', () => {
  ok(/purchase: 'purchases'/.test(read('js/receipt-storage.js')), 'receipt-storage FOLDER');
  ok(/uploadReceipt\('purchase'/.test(read('js/purchasing-admin-record.js')), 'the record form uploads there');
});
test('the Buyer switch is the owner\'s, in Users → Navigator, through the server', () => {
  const src = read('js/user-navigator.js');
  ok(/currentUserRole === 'owner'[\s\S]{0,120}rpc\('pur_office_buyers'\)/.test(src), 'listed for the owner only');
  ok(/rpc\('pur_set_buyer', \{ p_user: uid, p_on: !!on \}\)/.test(src), 'set through pur_set_buyer');
  ok(/user\.role === 'staff' \? _buyers\[user\.uid\]/.test(src), 'staff rows only');
});
test('Project Control: staff send an owner-only correction or void for approval, never retry it themselves', () => {
  const src = read('js/expenses-module.js');
  ok(/function _purNeedsOwner\(err\)\s*\{\s*return window\.currentUserRole === 'staff' && \/OWNER_APPROVAL_NEEDED\|COMPLETED_PROJECT\//.test(src), 'staff + owner-only codes');
  ok(/_purSendToOwner\(pur\.purchase\.id, 'void', null, reason\)/.test(src), 'void');
  ok(/_purSendToOwner\(pur\.purchase\.id, 'correct', _purLastBody, reason\)/.test(src), 'correction');
  ok(/rpc\('pur_request_change'/.test(src), 'through pur_request_change');
});

console.log('\npurchasing-admin: review fixes (16 Oct)');

test('review 2: picked portions are the only ones a line covers — the preview and the form agree with the server', () => {
  const portions = [{ id: 'P1', still_to_buy: 4 }, { id: 'P2', still_to_buy: 6 }];
  eq(pa.pickedStill(portions, [{ portionId: 'P1', quantity: 4 }]), 4);
  eq(pa.pickedStill(portions, [{ portionId: 'P1', quantity: 9 }, { portionId: 'P9', quantity: 2 }]), 4, 'a pick is capped by its portion; unknown portions add nothing');
  const l = { requestLineId: 'L1', requestUnit: 'bag', unit: 'bag', still: 10, portions, folderId: 'F1', itemName: 'Cement', amount: 1500,
              quantity: 6, portionPicks: [{ portionId: 'P1', quantity: 4 }] };
  eq(pa.lineStill(l), 4, 'with picks: only the picks');
  eq(pa.lineStill({ ...l, portionPicks: [] }), 10, 'without picks: everything this buyer may cover');
  eq(pa.formProblems({ purchaseDate: '2026-10-14', lines: [l], charges: [] }).map(p => p.code), ['EXTRA_REASON_REQUIRED'], '6 bought, 4 picked: 2 extra');
  const b = pa.buildBody({ purchaseDate: '2026-10-14', lines: [{ ...l, portionPicks: [{ portionId: 'P1', quantity: 4 }, { portionId: 'P2', quantity: 0 }] }], charges: [] });
  eq(b.lines[0].portion_picks, [{ portion_id: 'P1', quantity: 4 }], 'empty picks are not sent');
});
test('R14: a renamed item must say whether it is a substitute; a substitute needs a reason and waits for a check', () => {
  const l = { requestLineId: 'L1', requestUnit: 'gal', requestName: 'Boysen paint white', unit: 'gal', still: 10, folderId: 'F1',
              itemName: 'Davies paint white', quantity: 10, amount: 5000 };
  const st = (x) => ({ purchaseDate: '2026-10-14', lines: [x], charges: [] });
  eq(pa.formProblems(st(l)).map(p => p.code), ['NAME_DIFFERS']);
  eq(pa.formProblems(st({ ...l, itemName: '  boysen   PAINT white ' })), [], 'case and spacing are not a different name');
  eq(pa.formProblems(st({ ...l, match: 'wording' })), [], 'same item, other words');
  eq(pa.formProblems(st({ ...l, match: 'substitute' })).map(p => p.code), ['SUBSTITUTE_REASON_REQUIRED']);
  const sub = { ...l, match: 'substitute', substituteReason: 'out of stock' };
  eq(pa.formProblems(st(sub)), []);
  ok(!pa.countsDirectly(sub) && pa.countsDirectly({ ...l, match: 'wording' }), 'a substitute does not count until checked');
  const b = pa.buildBody(st(sub));
  eq([b.lines[0].substitute, b.lines[0].substitute_reason], [true, 'out of stock']);
  eq(pa.buildBody(st({ ...l, match: 'wording', substituteReason: 'x' })).lines[0].substitute_reason, '', 'no reason sent unless a substitute');
  const rec = read('js/purchasing-admin-record.js');
  ok(/\['substitute', 'Substitute — an important specification differs'\]/.test(rec), 'the form offers the choice');
});
test('review 5: a replacement photo uploads even after an earlier upload; a redraw keeps unsaved choices', () => {
  const a = { name: 'a.jpg' }, b2 = { name: 'b.jpg' };
  eq(pa.docUploads({ dr: a }, {}), ['dr'], 'first choice');
  eq(pa.docUploads({ dr: a }, { dr: { file: a, url: 'u1' } }), [], 'already uploaded as that file');
  eq(pa.docUploads({ dr: b2 }, { dr: { file: a, url: 'u1' } }), ['dr'], 'a replacement goes up');
  const src = read('js/purchasing-admin-record.js');
  ok(!/!st\.docs\[field\]/.test(src), 'no "already has a URL" skip');
  ok(/for \(const key of PA\.docUploads\(st\.files, st\.uploaded\)\)/.test(src), 'uploads what docUploads says');
  ok(/if \(file\) st\.files\[el\.dataset\.doc\] = file;/.test(src), 'a chosen photo is kept in the form state');
  ok(/const chosen = st\.files\[key\];[\s\S]{0,200}esc\(chosen\.name/.test(src), 'a redraw shows the chosen photo again');
  ok(/st\.uploaded\[key\] = \{ file, url: st\.docs\[field\] \}/.test(src), 'remembers which file each upload was');
});
test('review 3: the owner sees every field — quantities, units, dates, supplier, receipts and fee splits', () => {
  const base = { purchase_date: '2026-10-14', date_time: '2026-10-14T09:30', supplier: 'Wilcon', bought_by: 'Juan', receipt_total: 1100,
    payment_method: 'Cash', notes: '', receipts: { delivery_receipt_url: 'aaaa1111' },
    lines: [{ item_name: 'Hinge', quantity: 2, unit: 'box', amount: 900, where: 'Barlin · Main Contract', request: 'Hinge (pcs)', picks: [] },
            { item_name: 'Tape', quantity: 1, unit: 'roll', amount: 100, where: 'Barlin · Main Contract', unplanned_reason: 'r' }],
    charges: [{ kind: 'delivery_fee', amount: 100, shares: [90, 10] }] };
  const proposed = { ...base, date_time: '2026-10-13T08:00', supplier: 'Wilcon · Cubao', bought_by: null, receipt_total: 1150,
    receipts: { delivery_receipt_url: 'bbbb2222' },
    lines: [base.lines[0], { ...base.lines[1], quantity: 3, amount: 150, where: 'Prado · Main Contract' }],
    charges: [{ kind: 'delivery_fee', amount: 100, shares: [40, 60] }] };
  const rows = pa.changeRows(base, proposed);
  const changed = rows.filter(r => r.changed).map(r => r.group + ' / ' + r.label);
  eq(changed, ['Receipt / Date and time bought', 'Receipt / Supplier', 'Receipt / Receipt total', 'Receipt / Receipt photos',
               'Line 2 / Quantity', 'Line 2 / Amount', 'Line 2 / Project / warehouse', 'Fees and discounts / Fee / discount 1']);
  const q = rows.find(r => r.group === 'Line 2' && r.label === 'Quantity');
  eq([q.before, q.after], ['1 roll', '3 roll']);
  ok(rows.find(r => r.label === 'Fee / discount 1').after.includes('line 1: ₱40.00, line 2: ₱60.00'), 'the split asked for');
  ok(!rows.find(r => r.label === 'Bought by').changed, 'a body without "bought by" keeps the buyer');
  ok(rows.length > changed.length, 'unchanged fields are listed too');
  const two = pa.changeRows(base, { ...base, lines: [base.lines[0]] });
  ok(two.some(r => r.group === 'Line 2' && r.after === '(removed)' && r.changed), 'a removed line shows');
});
test('review 3: the approval screen shows the comparison and will not approve a request the purchase has outrun', () => {
  const src = read('js/purchasing-admin-purchases.js');
  ok(/PA\.changeRows\(r\.base, r\.proposed, RA\.cutoffLabel\)/.test(src), 'field-by-field comparison');
  ok(/r\.changed_since \? ' disabled/.test(src), 'Approve disabled when the purchase changed');
  ok(!/function summarize\(/.test(src), 'the old one-line summary is gone');
});
test('review 4: an account focused on Expenses that may buy gets Requests → Purchasing — and nothing else of Requests', () => {
  const src = read('js/admin.js');
  const slice = src.slice(src.indexOf('const PRIMARY_NAV = ['), src.indexOf('function findPrimaryForView('));
  const nav = (role, modules, canBuy) => {
    const sb = { window: { currentCanBuy: canBuy }, currentUserRole: role, currentAllowedModules: modules };
    vm.createContext(sb);
    vm.runInContext(slice + '\nthis.__nav = _visibleNav(); this.__views = window.focusAllowedViews();', sb);
    return { nav: sb.__nav, views: sb.__views };
  };
  const r = nav('owner', ['expenses'], true);
  const req = r.nav.find(p => p.id === 'requests');
  ok(req, 'a Requests tab');
  eq([req.defaultView, req.modules.map(m => m.view)], ['reqPurchasing', ['reqPurchasing', 'reqPurchase']], 'Purchasing only');
  ok(r.views.includes('reqPurchasing') && r.views.includes('reqPurchase') && !r.views.includes('reqQueue'), 'the view guard lets it in, not the queue');
  ok(!nav('owner', ['expenses'], false).nav.some(p => p.id === 'requests'), 'not when the server says it may not buy');
  ok(!nav('owner', ['pm'], false).nav.some(p => p.id === 'requests'), 'a PM-only account: no Requests');
  const full = nav('staff', null, true).nav.find(p => p.id === 'requests');
  ok(full.modules.some(m => m.view === 'reqQueue') && full.modules.some(m => m.view === 'reqPurchasing'), 'unfocused buyers keep all of Requests');
  ok(!nav('staff', null, false).nav.find(p => p.id === 'requests').modules.some(m => m.view === 'reqPurchasing'), 'non-buyers never see Purchasing');
  ok(/const primary = nav\.find\(p => p\.id === id\) \|\| PRIMARY_NAV\.find/.test(src), 'the tab lands on the visible section\'s default view');
});
test('R13: purchase receipts are downloaded with the viewer\'s session — never a signed link, never cached', async () => {
  const src = read('js/supabase-config.js');
  const fn = src.slice(src.indexOf('window.dacsSignedUrl = async function'), src.indexOf('const _dacsIsPubUpload'));
  const calls = [];
  const sb = { storage: { from: () => ({
    download: async (p) => { calls.push('download ' + p); return { data: { blob: p }, error: null }; },
    createSignedUrl: async (p, s) => { calls.push('sign ' + p + ' ' + s); return { data: { signedUrl: 'https://signed/' + p }, error: null }; },
  }) } };
  const ctx = { window: {}, sb, URL: { createObjectURL: (b) => 'blob:local/' + b.blob }, Date, decodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext('const DACS_PUB_UPLOADS_RE = /\\/storage\\/v1\\/object\\/public\\/uploads\\/([^?#]+)/; const _dacsSignCache = new Map();\n' + fn, ctx);
  const pub = (p) => 'https://x.supabase.co/storage/v1/object/public/uploads/' + p;
  const p1 = 'purchases/c0/2026-10/r1.jpg';
  eq(await ctx.window.dacsSignedUrl(pub(p1)), 'blob:local/' + p1);
  eq(await ctx.window.dacsSignedUrl(pub(p1)), 'blob:local/' + p1);
  eq(calls, ['download ' + p1, 'download ' + p1], 'checked by Storage on every view; no signed URL');
  eq(await ctx.window.dacsSignedUrl(pub('expenseReceipts/c0/2026-10/e.jpg')), 'https://signed/expenseReceipts/c0/2026-10/e.jpg', 'other receipts unchanged');
  ok(!/dacsMaybeSignUrl/.test(read('js/purchasing-admin-purchases.js')), 'the purchase screen opens receipts through the shim, not a signed link');
});
test('R3: Project Control reads the purchase behind a row through pur_entry_row — no purchase table', () => {
  const src = read('js/expenses-module.js');
  ok(/rpc\('pur_entry_row', \{/.test(src) && /rpc\('pur_review_lines'\)/.test(src), 'server reads');
  ok(!/from\('purchase(s|_lines|_charges|_charge_shares|_history)'\)/.test(src), 'no direct read of a purchase table');
});

Promise.all(pending).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
});
````

Patch `package.json` (part 2):

````diff
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-server.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
````

- [ ] **Step 2: Run it — it must fail**

Run: `node tests/purchasing-admin.test.js` → Expected: `Error: Cannot find module '../js/purchasing-admin-core.js'`.

- [ ] **Step 3: Write the screens and the wiring**

Create `js/purchasing-admin-core.js`:

````js
// ════════════════════════════════════════════════════════════════════
// Purchasing (WorkMate Stage 2A-2, migration 0097) — shared core for the
// office Purchasing tab inside Requests:
//   js/purchasing-admin-list.js      — the shopping list: who is buying what
//   js/purchasing-admin-record.js    — record a purchase (one receipt, many lines)
//   js/purchasing-admin-purchases.js — purchases, one purchase, owner approvals
//
// Unlike the rest of Requests this tab shows PESO amounts — only to those
// the server lets buy (owner, admin accounts allowed Expenses, staff with
// the Buyer switch: CLAUDE.md "Purchasing — staff exception"). Every rule
// is the server's (0096/0097); this file only previews and explains.
//
// Works in a browser (window.PurchasingAdmin) and in Node for
// tests/purchasing-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    // ── Numbers ─────────────────────────────────────────────────────

    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

    function peso(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return '₱' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function qty(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }

    // Same rules as the server's pur_money / pur_qty: plain decimals,
    // pesos to the centavo, quantities to 3 decimals. Commas are allowed
    // while typing. Null = refused.
    function parseMoney(text) {
        const s = String(text === null || text === undefined ? '' : text).replace(/,/g, '').trim();
        return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : null;
    }
    function parseQty(text) {
        const s = String(text === null || text === undefined ? '' : text).replace(/,/g, '').trim();
        if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
        const x = Number(s);
        return x > 0 && x <= 1000000 ? x : null;
    }

    // ── The shopping list ───────────────────────────────────────────

    function sameUnit(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    // Which buttons a portion offers. The server decides again; this only
    // avoids offering what it would refuse. me = { userId, isOwner }.
    function portionActions(p, me) {
        const still = Number(p.still_to_buy) > 0;
        const mine = !!p.buyer_id && p.buyer_id === me.userId;
        return {
            claim: still && !p.buyer_id,
            release: still && !!p.buyer_id && (mine || me.isOwner),
            assign: still && (!p.buyer_id || me.isOwner),
        };
    }

    function buyerLabel(p, me) {
        if (!p.buyer_id) return 'Unassigned';
        return p.buyer_id === me.userId ? 'You' : (p.buyer_name || 'Buyer');
    }

    // Text filter, "mine only", "urgent only". Order stays the server's.
    function filterList(lines, opts) {
        const o = opts || {};
        const t = String(o.text || '').trim().toLowerCase();
        return (lines || []).filter(l => {
            if (o.urgentOnly && !l.urgent) return false;
            if (o.mineOnly && !(l.portions || []).some(p => p.buyer_id && p.buyer_id === o.userId)) return false;
            if (o.unassignedOnly && !(l.portions || []).some(p => !p.buyer_id && Number(p.still_to_buy) > 0)) return false;
            if (!t) return true;
            return [l.description, l.spec, l.catalog_name, l.project_name, l.work_name, l.requester_name, l.category]
                .join(' ').toLowerCase().includes(t);
        });
    }

    // The one-line picture of a list.
    function listSummary(lines, userId) {
        const s = { lines: 0, urgent: 0, unassigned: 0, mine: 0, changed: 0, unitChecks: 0 };
        (lines || []).forEach(l => {
            s.lines++;
            if (l.urgent) s.urgent++;
            if (Number(l.unit_checks) > 0) s.unitChecks++;
            const ps = l.portions || [];
            if (ps.some(p => !p.buyer_id && Number(p.still_to_buy) > 0)) s.unassigned++;
            if (ps.some(p => p.buyer_id === userId && Number(p.still_to_buy) > 0)) s.mine++;
            if (ps.some(p => p.changed)) s.changed++;
        });
        return s;
    }

    // ── Recording a purchase ────────────────────────────────────────

    // What a line will cover — a preview of pur_cover_lines for a line
    // linked to a request with `still` left to buy (for this buyer).
    // countsDirectly = same unit as the request and not a substitute;
    // otherwise it waits for an office check.
    function coverPreview(still, quantity, countsDirectly) {
        const q = Number(quantity) || 0;
        const s = Math.max(0, Number(still) || 0);
        if (!countsDirectly) return { covers: 0, extra: 0, unitCheck: true };
        return { covers: round3(Math.min(q, s)), extra: round3(Math.max(0, q - s)), unitCheck: false };
    }

    // Picked portions are the ONLY ones a line covers (0097, review 16 Oct):
    // what they can still take — each pick up to its portion's Still to buy.
    function pickedStill(portions, picks) {
        const byId = {};
        (portions || []).forEach(p => { byId[p.id] = p; });
        return round3((picks || []).reduce((s, k) => {
            const p = byId[k.portionId];
            return s + (p ? Math.min(Math.max(0, Number(k.quantity) || 0), Math.max(0, Number(p.still_to_buy) || 0)) : 0);
        }, 0));
    }

    // The Still to buy a line's preview uses: its picks when it has any
    // (and the portions are known), otherwise everything this buyer may cover.
    function lineStill(l) {
        const picks = (l.portionPicks || []).filter(k => Number(k.quantity) > 0);
        return picks.length && l.portions ? pickedStill(l.portions, picks) : (Number(l.still) || 0);
    }

    // A request line's own words, to tell a renamed item from the request.
    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

    // Same unit and not marked a substitute: the line counts toward Bought at once.
    function countsDirectly(l) {
        return sameUnit(l.unit, l.requestUnit) && l.match !== 'substitute';
    }

    // Receipt photos to upload on save: every selected file not yet uploaded
    // AS THAT FILE — a replacement chosen after an earlier upload goes up too
    // (it used to be skipped because a URL was already there).
    function docUploads(files, uploaded) {
        return Object.keys(files || {}).filter(k => files[k] && !(uploaded && uploaded[k] && uploaded[k].file === files[k]));
    }

    // The server's default charge split (pur_prorate): each share rounded
    // DOWN to the centavo, then the left-over centavos one each to the
    // biggest remainders, the earliest line on a tie. Always adds up.
    function prorate(total, weights) {
        const n = (weights || []).length;
        if (!n) return [];
        const ws = weights.map(w => Math.max(Number(w) || 0, 0));
        let sum = ws.reduce((a, b) => a + b, 0);
        if (sum <= 0) return prorate(total, ws.map(() => 1));
        const cents = Math.round(total * 100);
        const exact = ws.map(w => cents * w / sum);
        const out = exact.map(x => Math.floor(x + 1e-9));
        let left = cents - out.reduce((a, b) => a + b, 0);
        const order = exact.map((x, i) => ({ i, r: x - Math.floor(x + 1e-9) })).sort((a, b) => (b.r - a.r) || (a.i - b.i));
        for (let k = 0; k < order.length && left > 0; k++, left--) out[order[k].i] += 1;
        return out.map(c => c / 100);
    }

    function receiptTotal(lines, charges) {
        const items = (lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
        const fees = (charges || []).filter(c => c.kind === 'delivery_fee').reduce((s, c) => s + (Number(c.amount) || 0), 0);
        const disc = (charges || []).filter(c => c.kind === 'discount').reduce((s, c) => s + (Number(c.amount) || 0), 0);
        return round2(items + fees - disc);
    }

    // The pur_record / pur_correct / pur_replace body from the form state.
    function buildBody(st) {
        const lines = (st.lines || []).map(l => {
            const out = {
                destination: l.destination || 'project',
                folder_id: l.destination === 'warehouse' ? null : l.folderId,
                item_name: String(l.itemName || '').trim(),
                category: l.category || '',
                quantity: round3(l.quantity),
                unit: String(l.unit || '').trim(),
                amount: round2(l.amount),
                in_inventory: !!l.inInventory,
                min_stock: 0,
            };
            if (l.requestLineId) {
                out.request_line_id = l.requestLineId;
                out.portion_picks = (l.portionPicks || []).filter(p => Number(p.quantity) > 0)
                    .map(p => ({ portion_id: p.portionId, quantity: round3(p.quantity) }));
                out.extra_reason = String(l.extraReason || '').trim();
                out.extra_location = l.extraLocation || null;
                out.substitute = l.match === 'substitute';
                out.substitute_reason = out.substitute ? String(l.substituteReason || '').trim() : '';
            } else {
                out.request_line_id = null;
                out.unplanned_reason = String(l.unplannedReason || '').trim();
            }
            return out;
        });
        const charges = (st.charges || []).map(c => {
            const ch = { kind: c.kind, amount: round2(c.amount) };
            if (c.shares && c.shares.length) ch.shares = c.shares.map((a, i) => ({ line: i + 1, amount: round2(a) }));
            return ch;
        });
        const body = {
            source: 'purchasing',
            purchase_date: st.purchaseDate,
            date_time: st.purchaseDate,
            supplier: String(st.supplier || '').trim(),
            supplier_id: st.supplierId || null,
            payment_method: String(st.paymentMethod || '').trim(),
            notes: String(st.notes || '').trim(),
            docs: st.docs || {},
            receipt_total: receiptTotal(lines, charges),
            lines,
            charges,
        };
        if (st.boughtBy) body.bought_by = st.boughtBy;
        return body;
    }

    // What the server would refuse, said before sending. [{ code, line }].
    // still[i] = Still to buy for line i (linked lines only).
    function formProblems(st) {
        const out = [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.purchaseDate || ''))) out.push({ code: 'BAD_DATE' });
        const lines = st.lines || [];
        if (!lines.length || lines.length > 50) out.push({ code: 'BAD_LINES' });
        lines.forEach((l, i) => {
            const line = i + 1;
            if (!String(l.itemName || '').trim()) out.push({ code: 'BAD_NAME', line });
            if (!(Number(l.quantity) > 0)) out.push({ code: 'BAD_QUANTITY', line });
            if (!(Number(l.amount) >= 0) || l.amount === null || l.amount === '') out.push({ code: 'BAD_AMOUNT', line });
            if (l.destination !== 'warehouse' && !l.folderId) out.push({ code: 'BAD_PROJECT', line });
            if (l.requestLineId) {
                const pv = coverPreview(lineStill(l), l.quantity, countsDirectly(l));
                if (pv.extra > 0 && (!String(l.extraReason || '').trim() || !l.extraLocation)) out.push({ code: 'EXTRA_REASON_REQUIRED', line });
                // An item named differently from its request is either the same
                // thing in other words or a substitute — the buyer says which.
                if ((l.match || 'same') === 'same' && l.requestName && norm(l.itemName) !== norm(l.requestName)) out.push({ code: 'NAME_DIFFERS', line });
                if (l.match === 'substitute' && !String(l.substituteReason || '').trim()) out.push({ code: 'SUBSTITUTE_REASON_REQUIRED', line });
            } else if (!String(l.unplannedReason || '').trim()) {
                out.push({ code: 'UNPLANNED_REASON_REQUIRED', line });
            }
        });
        (st.charges || []).forEach((c, i) => {
            if (!(Number(c.amount) > 0)) out.push({ code: 'BAD_AMOUNT', charge: i + 1 });
            if (c.shares && c.shares.length && round2(c.shares.reduce((a, b) => a + (Number(b) || 0), 0)) !== round2(c.amount)) {
                out.push({ code: 'SPLIT_MISMATCH', charge: i + 1 });
            }
        });
        return out;
    }

    // ── Purchases ───────────────────────────────────────────────────

    const HISTORY_LABEL = {
        recorded: 'Recorded', corrected: 'Corrected', refunded: 'Billing periods re-checked',
        voided: 'Voided', replaced: 'Replaced by a new version', unit_checked: 'Office check (different unit or substitute)',
    };
    const REQUEST_STATUS = {
        pending: 'Waiting for the owner', approved: 'Approved', rejected: 'Rejected',
        withdrawn: 'Withdrawn', stale: 'Out of date — the purchase changed',
    };

    function purchaseFlags(p) {
        const f = [];
        if (p.status === 'void') f.push({ text: 'Void', tone: 'hidden' });
        if (p.pending_change) f.push({ text: 'Owner approval pending', tone: 'working' });
        if (p.unit_check) f.push({ text: 'Unit check', tone: 'abandoned' });
        if (p.needs_review) f.push({ text: 'Office review', tone: 'working' });
        if (p.extra) f.push({ text: 'Extra', tone: 'pc' });
        if (p.unplanned) f.push({ text: 'Unplanned', tone: 'pc' });
        return f;
    }

    // Changes the server keeps for the owner (staff then get "send to the owner").
    function needsOwner(error) {
        return /OWNER_APPROVAL_NEEDED|COMPLETED_PROJECT/.test(String((error && (error.message || error)) || ''));
    }

    // ── Owner approvals: the whole change, field by field ──────────
    //
    // base / proposed are pur_review_doc documents (0097): the purchase as
    // the staff member saw it, and as it would be after approval. One row
    // per header field, per line field and per fee or discount (amount and
    // split) — every field, changed or not, so nothing the owner approves is
    // hidden. fmtCutoff turns a weekly cutoff into words (the browser passes
    // RequestsAdmin.cutoffLabel).
    function changeRows(base, proposed, fmtCutoff) {
        const day = fmtCutoff || (x => String(x || '').slice(0, 10));
        const b = base || {}, p = proposed || {};
        const rows = [];
        const add = (group, label, x, y) => rows.push({ group, label, before: x, after: y, changed: x !== y });
        const receipts = d => Object.keys(d.receipts || {}).sort().map(k => k.replace(/_url$/, '').replace(/_/g, ' ') + ' #' + d.receipts[k]).join(', ') || 'none';
        add('Receipt', 'Date and time bought', String(b.date_time || b.purchase_date || ''), String(p.date_time || p.purchase_date || ''));
        add('Receipt', 'Supplier', b.supplier || '—', p.supplier || '—');
        // A body that leaves "bought by" out keeps the purchase's buyer.
        add('Receipt', 'Bought by', b.bought_by || '—', p.bought_by || b.bought_by || '—');
        add('Receipt', 'Paid by', b.payment_method || '—', p.payment_method || '—');
        add('Receipt', 'Notes', b.notes || '—', p.notes || '—');
        add('Receipt', 'Receipt total', peso(b.receipt_total), peso(p.receipt_total));
        add('Receipt', 'Receipt photos', receipts(b), receipts(p));
        const line = (l) => {
            if (!l) return null;
            const picks = (l.picks || []).map(k => qty(k.quantity) + ' from ' + (k.cutoff_at ? 'the ' + day(k.cutoff_at) + ' batch' : 'a portion no longer there')).join(', ');
            return {
                Item: l.item_name || '—',
                Quantity: qty(l.quantity) + ' ' + (l.unit || ''),
                Amount: peso(l.amount),
                'Project / warehouse': l.where || '—',
                Request: l.request ? l.request + (picks ? ' — picked: ' + picks : '') : (l.unplanned_reason ? 'Unplanned: ' + l.unplanned_reason : 'none'),
                Extra: l.extra_reason ? l.extra_reason + ' (' + (l.extra_location === 'warehouse' ? 'warehouse' : 'same project') + ')' : '—',
                Substitute: l.substitute ? 'Yes — ' + (l.substitute_reason || '') : 'No',
                Category: l.category || '—',
            };
        };
        const n = Math.max((b.lines || []).length, (p.lines || []).length);
        for (let i = 0; i < n; i++) {
            const x = line((b.lines || [])[i]), y = line((p.lines || [])[i]);
            Object.keys(x || y).forEach(k => add('Line ' + (i + 1), k, x ? x[k] : '(no line)', y ? y[k] : '(removed)'));
        }
        const charge = (c) => c ? (c.kind === 'discount' ? 'Discount ' : 'Delivery fee ') + peso(c.amount) + ' — split ' +
            (c.shares || []).map((s, k) => 'line ' + (k + 1) + ': ' + peso(s)).join(', ') : '(none)';
        const m = Math.max((b.charges || []).length, (p.charges || []).length);
        for (let i = 0; i < m; i++) add('Fees and discounts', 'Fee / discount ' + (i + 1), charge((b.charges || [])[i]), charge((p.charges || [])[i]));
        return rows;
    }

    // ── Server error codes → sentences ─────────────────────────────

    const ERRORS = {
        BUYER_REQUIRED: 'This needs an account that may buy: the owner, or staff with the Buyer switch on. Linking a purchase to a request or picking its portions always does.',
        NAME_DIFFERS: 'The item name differs from the request. Choose "Same item, other words", or "Substitute" if an important specification changed.',
        SUBSTITUTE_REASON_REQUIRED: 'A substitute needs a reason (what changed and who agreed). It counts toward Bought after an office check.',
        OWNER_ONLY: 'Only the owner can do this.',
        NOT_STAFF: 'The Buyer switch is for your own staff accounts only.',
        BAD_SWITCH: 'Choose on or off.',
        BAD_BUYER: 'Pick someone who may buy (the owner or a staff member with the Buyer switch). Only the owner records a purchase for someone else.',
        ASSIGNED_TO_OTHER: 'Another buyer is handling this. Ask the owner to reassign it.',
        NOT_YOUR_PORTION: 'You can only release what you are buying yourself.',
        NOTHING_TO_BUY: 'Nothing is left to buy here.',
        BAD_QUANTITY: 'Enter a quantity above 0 (at most 3 decimals) and no more than what is left.',
        BAD_NOTE: 'Keep the note to 300 characters.',
        LINE_CLOSED: 'This item was cancelled. Reload the list.',
        REDUCTION_PENDING: 'A reduction is waiting on this quantity. Resolve it in the request first.',
        BOUGHT: 'Something was already bought for this quantity, so it stays in its weekly batch.',
        BAD_REQUEST_LINK: 'A purchase line must go to the same project and work (Main Contract or Additional Works) as its request.',
        BAD_PORTION: 'That part of the request is no longer available. Reload the list.',
        EXTRA_REASON_REQUIRED: 'You bought more than is still needed. Say why (pack size, spare, cheaper in bulk) and where the extra goes.',
        BAD_EXTRA: 'The extra goes to the same project or to the warehouse.',
        UNPLANNED_REASON_REQUIRED: 'A purchase with no request needs a reason.',
        BAD_SUPPLIER: 'Give the supplier a name (branch and contact are optional).',
        DUPLICATE_SUPPLIER: 'This supplier and branch are already on the list.',
        OWN_PURCHASE: 'Someone else must check a purchase you bought or recorded yourself.',
        NO_UNIT_CHECK: 'This line has nothing to check. Reload the purchase.',
        MORE_THAN_NEEDED: 'That is more than the request still needs. Enter what this purchase really covers.',
        OWNER_APPROVAL_NEEDED: 'Moving a cost to another project needs the owner. You can send it for approval.',
        COMPLETED_PROJECT: 'This project is marked completed — only the owner can change its costs. You can send it for approval.',
        OWNER_CAN_DO_IT: 'You are the owner — make the change directly.',
        ALREADY_PENDING: 'A change to this purchase is already waiting for the owner.',
        NOT_PENDING: 'This request was already decided. Reload the page.',
        BAD_KIND: 'Choose correct, replace or void.',
        BAD_DECISION: 'Choose approve or reject.',
        LINES_CHANGED: 'A correction keeps the same number of lines. To add or remove a line, use Replace.',
        TOTAL_MISMATCH: 'The lines, fees and discounts do not add up to the receipt total.',
        SPLIT_MISMATCH: 'A fee or discount split must add up to the fee or discount exactly.',
        DISCOUNT_TOO_LARGE: 'A discount cannot be larger than the line it applies to.',
        BAD_DATE: 'Enter the date the goods were actually bought.',
        BAD_AMOUNT: 'Check the amounts (pesos and centavos only).',
        BAD_NAME: 'Give every line an item name.',
        BAD_LINES: 'A purchase has 1 to 50 lines. Check the reasons (300 characters at most).',
        BAD_CHARGES: 'Check the fees and discounts.',
        BAD_PROJECT: 'Pick a project and its work, or the warehouse.',
        BAD_DESTINATION: 'Pick a project and its work, or the warehouse.',
        AW_NO_PERIOD: 'This Additional Works job has no billing period yet.',
        REASON_REQUIRED: 'Write a short reason. It is kept in the history.',
        NOT_FOUND: 'This record no longer exists or belongs to another company. Reload the page.',
        BAD_STATE: 'This purchase was already voided or replaced. Reload the page.',
        NOT_OFFICE: 'Only office accounts can do this.',
        NOT_ALLOWED: 'This account is not set up for Expenses.',
        PGRST202: 'The server is not updated for the Purchasing tab yet (migration 0097). Nothing was changed.',
    };

    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) {
                return ERRORS[code] + (code === 'EXTRA_REASON_REQUIRED' && error && error.hint ? ' (' + error.hint + ')' : '');
            }
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    const pure = { round2, round3, peso, qty, parseMoney, parseQty, sameUnit, portionActions, buyerLabel, filterList,
                   listSummary, coverPreview, pickedStill, lineStill, countsDirectly, docUploads, prorate, receiptTotal,
                   buildBody, formProblems, HISTORY_LABEL, REQUEST_STATUS, purchaseFlags, needsOwner, changeRows, ERRORS,
                   errorMessage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser helpers (Requests' own: esc, rpc, modal, head …) ────

    const RA = root.RequestsAdmin;
    const state = { me: null, purchaseId: null };

    async function me() {
        if (!state.me) {
            const data = await RA.rpc('pur_me');
            state.me = { userId: data && data.user_id, isOwner: !!(data && data.is_owner), canBuy: !!(data && data.can_buy) };
        }
        return state.me;
    }

    function openPurchase(id) {
        state.purchaseId = id;
        root.switchView('reqPurchase');
    }

    // A refusal from the server, in words, in a one-button box.
    function notice(error, title) {
        const plain = typeof error === 'string' && !/^[A-Z][A-Z_]+$/.test(error);
        RA.modal({ title: title || 'Not done', body: '<p>' + RA.esc(plain ? error : errorMessage(error)) + '</p>', submitLabel: 'OK', onSubmit: () => {} });
    }

    function pill(text, tone) {
        return '<span class="att-pill att-pill--' + tone + '">' + RA.esc(text) + '</span>';
    }

    root.PurchasingAdmin = Object.assign({}, pure, { me, openPurchase, pill, notice, state });
})(typeof window !== 'undefined' ? window : globalThis);
````

Create `js/purchasing-admin-list.js`:

````js
// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing (0097). Buyers only (the nav hides it otherwise;
// the server refuses everyone else).
//
// One view with three tabs:
//   Shopping list    — this file: every open request line with something
//                      still to buy, its portions and who is buying each;
//   Purchases        — js/purchasing-admin-purchases.js;
//   Owner approvals  — js/purchasing-admin-purchases.js.
// "Record purchase" (js/purchasing-admin-record.js) opens from the list
// with the ticked lines.
//
// Wording (spec): Needed · Bought · Still to buy; "Unassigned / You /
// <name>"; assigning is NOT "arranged" — that stays its own button.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    // Survives navigation within the session, not a reload.
    const ui = { tab: 'list', batchId: null, folderId: '', text: '', mine: false, unassigned: false, urgent: false, picked: {} };
    PA.ui = ui;

    function tabs() {
        const t = (id, label) => '<button type="button" class="att-seg-btn' + (ui.tab === id ? ' is-on' : '') + '" data-tab="' + id + '">' + label + '</button>';
        return '<div class="att-seg" role="tablist" aria-label="Purchasing">' +
            t('list', 'Shopping list') + t('purchases', 'Purchases') + t('approvals', 'Owner approvals') + '</div>';
    }

    function figures(l) {
        const parts = ['Needed <strong>' + esc(PA.qty(l.needed)) + '</strong>'];
        if (Number(l.from_stock) > 0) parts.push('From stock <strong>' + esc(PA.qty(l.from_stock)) + '</strong>');
        parts.push('Bought <strong>' + esc(PA.qty(l.bought)) + '</strong>');
        parts.push('Still to buy <strong>' + esc(PA.qty(l.still_to_buy)) + '</strong>');
        if (Number(l.extra) > 0) parts.push('Extra <strong>' + esc(PA.qty(l.extra)) + '</strong>');
        return '<div class="pur-figures">' + parts.join(' · ') + ' <span class="req-muted">' + esc(l.unit) + '</span></div>';
    }

    function portionRow(p, me) {
        const a = PA.portionActions(p, me);
        const who = PA.buyerLabel(p, me);
        const btn = (act, label, extra) => '<button type="button" class="att-btn att-btn--sm' + (extra || '') + '" data-act="' + act +
            '" data-portion="' + esc(p.id) + '">' + label + '</button>';
        return '<div class="pur-portion' + (p.changed ? ' is-changed' : '') + '">' +
            '<span class="pur-portion-batch">' + esc('Cutoff ' + RA.cutoffLabel(p.cutoff_at)) + '</span>' +
            '<span class="pur-portion-qty">' + esc(PA.qty(p.quantity - p.pending_reduction)) + ' needed · ' +
              esc(PA.qty(p.bought)) + ' bought · <strong>' + esc(PA.qty(p.still_to_buy)) + ' still to buy</strong></span>' +
            '<span class="pur-portion-who' + (p.buyer_id ? '' : ' is-open') + '">' + esc(who) + '</span>' +
            (p.arranged ? PA.pill('Arranged', 'done') : '') +
            (p.changed ? PA.pill('Quantity changed', 'abandoned') : '') +
            '<span class="pur-portion-acts">' +
              (a.claim ? btn('claim', 'I\'ll buy this', ' att-btn--primary') : '') +
              (a.assign ? btn('assign', p.buyer_id ? 'Reassign…' : 'Assign…') : '') +
              (a.release ? btn('release', 'Release') : '') +
              btn(p.arranged ? 'unarrange' : 'arrange', p.arranged ? 'Undo arranged' : 'Mark arranged') +
            '</span></div>';
    }

    function lineCard(l, me) {
        const urgent = l.urgent ? '<span class="req-urgent">URGENT' + (l.needed_by ? ' · by ' + esc(RA.formatDay(l.needed_by)) : '') + '</span>' : '';
        const canBuy = Number(l.still_to_buy) > 0;
        return '<div class="att-card pur-line' + (l.urgent ? ' is-urgent' : '') + '" data-line="' + esc(l.line_id) + '">' +
            '<div class="att-card-body">' +
              '<div class="pur-line-head">' +
                '<label class="pur-pick">' + (canBuy
                  ? '<input type="checkbox" data-pick="' + esc(l.line_id) + '"' + (ui.picked[l.line_id] ? ' checked' : '') + ' aria-label="Add to the purchase">'
                  : '') + '</label>' +
                '<div class="pur-line-main">' +
                  '<div><strong>' + esc(l.description) + '</strong>' + (l.spec ? ' <span class="req-muted">' + esc(l.spec) + '</span>' : '') +
                    (l.catalog_name ? ' <span class="req-muted">· ' + esc(l.catalog_name) + '</span>' : '') + ' ' + urgent +
                    (Number(l.unit_checks) > 0 ? ' ' + PA.pill('Office check waiting', 'abandoned') : '') + '</div>' +
                  '<div class="req-muted">' + esc(l.project_name) + ' · ' + esc(l.work_name) + ' · requested by ' + esc(l.requester_name) + '</div>' +
                  figures(l) +
                '</div>' +
              '</div>' +
              '<div class="pur-portions">' + (l.portions || []).map(p => portionRow(p, me)).join('') + '</div>' +
            '</div></div>';
    }

    function summaryHtml(lines, me) {
        const s = PA.listSummary(lines, me.userId);
        const chip = (n, text, tone) => n ? '<span class="req-sum req-sum--' + tone + '"><strong>' + n + '</strong> ' + text + '</span>' : '';
        return '<div class="req-summary">' +
            '<span class="req-sum req-sum--plain"><strong>' + s.lines + '</strong> item' + (s.lines === 1 ? '' : 's') + ' to buy</span>' +
            chip(s.urgent, 'urgent', 'red') + chip(s.changed, 'quantity changed', 'red') + chip(s.unitChecks, 'unit check', 'gold') +
            chip(s.unassigned, 'unassigned', 'gold') + chip(s.mine, 'yours', 'green') + '</div>';
    }

    async function renderList(host, me) {
        let batches, lines;
        try {
            batches = await RA.rpc('pr_office_batches');
            batches = batches || [];
            if (ui.batchId === null) {
                const now = Date.now();
                const current = batches.find(b => Date.parse(b.cutoff_at) > now);
                ui.batchId = current ? current.id : '';
            }
            if (ui.batchId && !batches.some(b => b.id === ui.batchId)) ui.batchId = '';
            lines = await RA.rpc('pur_shopping_list', { p_batch: ui.batchId || null, p_folder: ui.folderId || null, p_scope: 'open' });
        } catch (e) { RA.fail(host, e); return; }
        lines = lines || [];
        const projects = [];
        lines.forEach(l => { if (!projects.some(p => p.id === l.project_id)) projects.push({ id: l.project_id, name: l.project_name }); });
        const shown = PA.filterList(lines, { text: ui.text, mineOnly: ui.mine, unassignedOnly: ui.unassigned, urgentOnly: ui.urgent, userId: me.userId });
        const pickedCount = Object.keys(ui.picked).filter(k => ui.picked[k] && lines.some(l => l.line_id === k)).length;

        host.querySelector('[data-body]').innerHTML =
            summaryHtml(lines, me) +
            '<div class="att-toolbar">' +
              '<select class="att-filter" data-batch aria-label="Weekly batch">' +
                '<option value="">All weekly batches</option>' +
                batches.map(b => '<option value="' + esc(b.id) + '"' + (b.id === ui.batchId ? ' selected' : '') + '>' +
                  esc('Cutoff ' + RA.cutoffLabel(b.cutoff_at) + ' · Buy ' + RA.formatDay(b.purchase_on)) + '</option>').join('') +
              '</select>' +
              '<select class="att-filter" data-folder aria-label="Project">' +
                '<option value="">All projects</option>' +
                projects.map(p => '<option value="' + esc(p.id) + '"' + (p.id === ui.folderId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
              '</select>' +
              '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                '<input class="att-search" type="search" data-text aria-label="Search" placeholder="Search item, project, worker…" value="' + esc(ui.text) + '"></div>' +
              '<label class="req-toggle"><input type="checkbox" data-mine' + (ui.mine ? ' checked' : '') + '> Mine</label>' +
              '<label class="req-toggle"><input type="checkbox" data-unassigned' + (ui.unassigned ? ' checked' : '') + '> Unassigned</label>' +
              '<label class="req-toggle"><input type="checkbox" data-urgent' + (ui.urgent ? ' checked' : '') + '> Urgent</label>' +
              '<button type="button" class="att-btn att-btn--primary" data-record' + (pickedCount ? '' : ' disabled') + '>' +
                '<i data-lucide="shopping-cart"></i> Record purchase' + (pickedCount ? ' (' + pickedCount + ')' : '') + '</button>' +
              '<button type="button" class="att-btn" data-unplanned><i data-lucide="plus"></i> Purchase with no request</button>' +
            '</div>' +
            (shown.length
              ? shown.map(l => lineCard(l, me)).join('')
              : '<div class="att-empty">' + (lines.length ? 'Nothing matches these filters.' : 'Nothing left to buy in this batch.') + '</div>');

        const body = host.querySelector('[data-body]');
        const reload = () => renderList(host, me);
        body.querySelector('[data-batch]').addEventListener('change', e => { ui.batchId = e.target.value; ui.picked = {}; reload(); });
        body.querySelector('[data-folder]').addEventListener('change', e => { ui.folderId = e.target.value; reload(); });
        body.querySelector('[data-text]').addEventListener('change', e => { ui.text = e.target.value; reload(); });
        body.querySelector('[data-mine]').addEventListener('change', e => { ui.mine = e.target.checked; reload(); });
        body.querySelector('[data-unassigned]').addEventListener('change', e => { ui.unassigned = e.target.checked; reload(); });
        body.querySelector('[data-urgent]').addEventListener('change', e => { ui.urgent = e.target.checked; reload(); });
        body.querySelectorAll('[data-pick]').forEach(c => c.addEventListener('change', () => { ui.picked[c.dataset.pick] = c.checked; reload(); }));
        body.querySelector('[data-record]').addEventListener('click', () => {
            const picked = lines.filter(l => ui.picked[l.line_id]);
            if (picked.length) PA.openRecord({ requestLines: picked, onDone: () => { ui.picked = {}; } });
        });
        body.querySelector('[data-unplanned]').addEventListener('click', () => PA.openRecord({ requestLines: [] }));
        body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act, b.dataset.portion, lines, me, reload)));
        RA.icons();
    }

    async function act(kind, portionId, lines, me, reload) {
        const line = lines.find(l => (l.portions || []).some(p => p.id === portionId));
        const p = line && line.portions.find(x => x.id === portionId);
        if (!p) return;
        const run = async (name, args) => {
            try { await RA.rpc(name, args); reload(); }
            catch (e) { PA.notice(e); }
        };
        if (kind === 'claim') return run('pur_assign_portion', { p_portion: p.id, p_buyer: me.userId, p_quantity: null, p_note: null });
        if (kind === 'release') return run('pur_assign_portion', { p_portion: p.id, p_buyer: null, p_quantity: null, p_note: null });
        if (kind === 'arrange' || kind === 'unarrange') return run('pr_office_set_arranged', { p_portion: p.id, p_arranged: kind === 'arrange' });
        if (kind === 'assign') {
            let options;
            try { options = await RA.rpc('pur_buyer_options'); } catch (e) { return PA.notice(e); }
            RA.modal({
                title: (p.buyer_id ? 'Reassign' : 'Assign') + ' — ' + line.description,
                sub: 'Still to buy: ' + PA.qty(p.still_to_buy) + ' ' + line.unit + '. What was already bought stays with whoever bought it.',
                body:
                    '<label class="att-label">Buyer<select class="att-input" name="buyer">' +
                      (options || []).map(o => '<option value="' + esc(o.user_id) + '"' + (o.user_id === p.buyer_id ? ' selected' : '') + '>' +
                        esc(o.is_me ? 'You (' + o.name + ')' : o.name) + '</option>').join('') +
                    '</select></label>' +
                    '<label class="att-label">Quantity<input class="att-input" name="qty" inputmode="decimal" value="' + esc(PA.qty(p.still_to_buy)) + '"></label>' +
                    '<p class="req-muted">Less than all of it splits that part off for this buyer; the rest stays as it is.</p>' +
                    '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>',
                submitLabel: 'Assign',
                errorMessage: PA.errorMessage,
                onSubmit: async (form) => {
                    const q = PA.parseQty(form.qty.value);
                    if (q === null) throw new Error('BAD_QUANTITY');
                    await RA.rpc('pur_assign_portion', { p_portion: p.id, p_buyer: form.buyer.value,
                        p_quantity: q === Number(p.still_to_buy) ? null : q, p_note: form.note.value.trim() || null });
                },
                onDone: reload,
            });
        }
    }

    async function renderPurchasing(host) {
        host.innerHTML = '<div class="att-stack pur-tab"><div class="att-empty">Loading…</div></div>';
        let me;
        try { me = await PA.me(); } catch (e) { RA.fail(host, e); return; }
        if (!me.canBuy) {
            host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' +
                esc(PA.ERRORS.BUYER_REQUIRED) + '</div></div></div>';
            RA.icons();
            return;
        }
        host.innerHTML =
            '<div class="att-stack pur-tab">' +
              RA.head('Purchasing', 'Who is buying what, what was bought, and what is still to buy. Prices show here only.', tabs()) +
              '<div data-body><div class="att-empty">Loading…</div></div>' +
            '</div>';
        host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            if (ui.tab === b.dataset.tab) return;
            ui.tab = b.dataset.tab;
            renderPurchasing(host);
        }));
        if (ui.tab === 'purchases') return PA.renderPurchases(host.querySelector('[data-body]'), me);
        if (ui.tab === 'approvals') return PA.renderApprovals(host.querySelector('[data-body]'), me);
        if (ui.tab === 'record') return PA.renderRecord(host.querySelector('[data-body]'), me);
        return renderList(host, me);
    }

    PA.renderPurchasing = renderPurchasing;
    RA.views.reqPurchasing = renderPurchasing;
})(typeof window !== 'undefined' ? window : globalThis);
````

Create `js/purchasing-admin-record.js`:

````js
// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Record purchase (0097). One receipt, many lines,
// several projects. Opens from the shopping list with the ticked request
// lines, empty ("Purchase with no request"), or from a purchase to correct
// it. Saves through the SAME server operations as everything else:
//   new            → pur_record   (source 'purchasing')
//   same lines     → pur_correct  (reason required)
//   lines added or removed → pur_replace (reason required)
// The server decides Spent, the billing periods and what each line covers;
// the preview here only says what it will do. A change the server keeps
// for the owner is offered to staff as "Send to the owner" (pur_request_change).
//
// Picked weekly portions are the ONLY portions a line covers; without picks
// the server covers this buyer's own portions, then unassigned ones. A
// correction keeps the portions a line already covered. Unsaved receipt
// photos live in the form state, so a redraw never drops them and a
// replacement photo is uploaded even after an earlier one was.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    let ctx = null;   // { requestLines, purchase, onDone }
    let st = null;    // the form

    const DOCS = [['po', 'po_image_url', 'Purchase order'], ['dr', 'delivery_receipt_url', 'Delivery receipt'],
                  ['si', 'supplier_invoice_url', 'Supplier invoice'], ['pr', 'payment_receipt_url', 'Payment receipt']];

    // "YYYY-MM-DD" from LOCAL date parts (PH is UTC+8 — never toISOString).
    function todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // What this buyer may still cover on a request line: their own and the
    // unassigned portions (the owner: every portion).
    function mayCover(p, me) {
        return me.isOwner || !p.buyer_id || p.buyer_id === me.userId;
    }
    function stillFor(l, me) {
        return (l.portions || []).reduce((s, p) => s + (mayCover(p, me) ? Number(p.still_to_buy) || 0 : 0), 0);
    }

    function newLine() {
        return { requestLineId: null, requestUnit: '', requestName: '', still: 0, portions: null, portionPicks: [],
                 destination: 'project', folderId: '', folderLabel: '',
                 itemName: '', category: 'Materials', quantity: 1, unit: '', amount: '', extraReason: '', extraLocation: '',
                 match: 'same', substituteReason: '', unplannedReason: '', inInventory: false };
    }

    function fromRequest(l, me) {
        const still = stillFor(l, me);
        const name = l.description + (l.spec ? ' ' + l.spec : '');
        return Object.assign(newLine(), {
            requestLineId: l.line_id, requestUnit: l.unit, requestName: name, still,
            // The portions this buyer may pick (own, unassigned; the owner: all).
            portions: (l.portions || []).filter(p => mayCover(p, me) && Number(p.still_to_buy) > 0),
            folderId: l.work_id, folderLabel: l.project_name + ' · ' + l.work_name, itemName: name,
            category: l.category || 'Materials', quantity: still || 1, unit: l.unit,
        });
    }

    function fromPurchase(doc) {
        const reqs = {};
        (doc.requests || []).forEach(r => { reqs[r.line] = r; });
        return {
            opId: root.DacsReceipts.newId(), editId: doc.id, editLines: (doc.lines || []).length, reason: '',
            purchaseDate: doc.purchase_date, supplierId: doc.supplier_id || '', supplier: doc.supplier_id ? '' : (doc.supplier || ''),
            paymentMethod: doc.payment_method || '', notes: doc.notes || '', boughtBy: doc.bought_by || '',
            docs: {}, files: {}, uploaded: {}, onFile: Object.keys(doc.docs || {}).filter(k => (doc.docs || {})[k]),
            lines: (doc.lines || []).map(l => {
                const r = reqs[l.line];
                const name = r ? r.description + (r.spec ? ' ' + r.spec : '') : '';
                return Object.assign(newLine(), {
                    requestLineId: l.request_line_id || null, requestUnit: r ? r.unit : '', requestName: name,
                    // This purchase's own cover is released when it is corrected.
                    still: r ? Math.max(0, Number(r.needed) - Number(r.bought) + Number(l.covered || 0)) : 0,
                    destination: l.destination, folderId: l.folder_id || '', folderLabel: l.folder_name || '',
                    itemName: l.item_name, category: l.category || '', quantity: Number(l.quantity), unit: l.unit || '',
                    amount: String(l.amount), extraReason: l.extra_reason || '', extraLocation: l.extra_location || '',
                    match: l.substitute ? 'substitute' : 'wording', substituteReason: l.substitute_reason || '',
                    unplannedReason: l.unplanned_reason || '', inInventory: !!l.in_inventory,
                    // Kept as they are: a correction never re-picks (the server keeps the portions covered).
                    portionPicks: (l.portion_picks || []).map(p => ({ portionId: p.portion_id, quantity: p.quantity })),
                });
            }),
            // A split the office adjusted stays adjusted: a correction never
            // quietly resets it to the automatic one.
            charges: (doc.charges || []).map(c => {
                const given = (doc.lines || []).map(l => {
                    const sh = (c.shares || []).find(x => x.line === l.line);
                    return sh ? Number(sh.amount) : 0;
                });
                const auto = PA.prorate(Number(c.amount), (doc.lines || []).map(l => Number(l.amount)));
                const custom = given.some((g, i) => PA.round2(g) !== PA.round2(auto[i]));
                return { kind: c.kind, amount: String(c.amount), adjust: custom, shares: custom ? given.map(String) : null };
            }),
        };
    }

    // The line with its typed quantity, for the pure previews.
    function parsed(l) {
        return Object.assign({}, l, { quantity: PA.parseQty(l.quantity) || 0 });
    }

    function previewText(l) {
        if (!l.requestLineId) return l.destination === 'warehouse' ? 'Warehouse — company stock, outside every project\'s Spent' : 'Unplanned — no request';
        if (l.match === 'substitute') return 'Substitute — counts toward Bought after an office check';
        if (!PA.sameUnit(l.unit, l.requestUnit)) return 'Different unit from the request (' + l.requestUnit + ') — counts toward Bought after an office check';
        const p = parsed(l);
        const still = PA.lineStill(p);
        const pv = PA.coverPreview(still, p.quantity, true);
        const picked = (l.portionPicks || []).some(k => Number(k.quantity) > 0);
        return 'Covers ' + PA.qty(pv.covers) + ' of ' + PA.qty(still) + (picked ? ' in the portions picked' : ' still to buy') +
            (pv.extra > 0 ? ' · Extra ' + PA.qty(pv.extra) : '');
    }

    function extraNeeded(l) {
        if (!l.requestLineId) return false;
        const p = parsed(l);
        return PA.coverPreview(PA.lineStill(p), p.quantity, PA.countsDirectly(p)).extra > 0;
    }

    // Optional: which weekly portions this line is for. Picked = the only
    // ones it covers; none picked = the server's automatic order.
    function picksHtml(l, i) {
        if (!l.requestLineId) return '';
        if (!l.portions) {
            const kept = (l.portionPicks || []).filter(k => Number(k.quantity) > 0);
            return kept.length ? '<div class="req-muted">Picked portions are kept: ' + esc(kept.map(k => PA.qty(k.quantity)).join(' + ')) + '</div>'
                               : '<div class="req-muted">Keeps the weekly portions it covered; quantity you add follows the usual order.</div>';
        }
        if (!l.portions.length) return '';
        const pick = (id) => (l.portionPicks || []).find(k => k.portionId === id);
        const any = (l.portionPicks || []).some(k => Number(k.quantity) > 0);
        return '<details class="pur-picks"' + (any ? ' open' : '') + '><summary>Weekly portions (optional — leave empty for your own, then unassigned, earliest first)</summary>' +
            '<div class="pur-rec-row">' + l.portions.map(p =>
                '<label class="att-label">' + esc('Cutoff ' + RA.cutoffLabel(p.cutoff_at) + ' · ' + (p.buyer_id ? (p.mine ? 'yours' : p.buyer_name) : 'unassigned') +
                    ' · ' + PA.qty(p.still_to_buy) + ' to buy') +
                '<input class="att-input" data-pickq="' + i + ':' + esc(p.id) + '" inputmode="decimal" placeholder="0" value="' +
                    esc(pick(p.id) ? pick(p.id).quantity : '') + '"></label>').join('') +
            '</div><div class="req-muted">Only the portions you fill in are covered; anything more is extra.</div></details>';
    }

    // Matches the request, other words for the same item, or a substitute.
    function matchHtml(l, i) {
        if (!l.requestLineId) return '';
        return '<div class="pur-rec-row">' +
            '<label class="att-label">Compared with the request<select class="att-input" data-f="match" data-i="' + i + '">' +
              [['same', 'Same as requested'], ['wording', 'Same item, other words'], ['substitute', 'Substitute — an important specification differs']]
                .map(o => '<option value="' + o[0] + '"' + (l.match === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
            '</select></label>' +
            '<label class="att-label pur-w2" data-subreason="' + i + '"' + (l.match === 'substitute' ? '' : ' hidden') + '>What changed, and who agreed' +
              '<input class="att-input" data-f="substituteReason" data-i="' + i + '" maxlength="300" placeholder="e.g. Boysen out of stock; Davies agreed by the foreman" value="' + esc(l.substituteReason) + '"></label>' +
            '<span class="req-muted">Requested: ' + esc(l.requestName + ' (' + l.requestUnit + ')') + '</span>' +
            '</div>';
    }

    function lineHtml(l, i, folders) {
        const linked = !!l.requestLineId;
        const where = linked
            ? '<div class="req-muted">' + esc(l.folderLabel) + '</div>'
            : '<select class="att-input" data-f="where" data-i="' + i + '" aria-label="Project or warehouse">' +
                '<option value="">Choose…</option>' +
                '<option value="warehouse"' + (l.destination === 'warehouse' ? ' selected' : '') + '>Warehouse (company stock)</option>' +
                folders.map(f => '<option value="' + esc(f.id) + '"' + (l.destination !== 'warehouse' && f.id === l.folderId ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') +
              '</select>';
        return '<div class="att-card pur-rec-line"><div class="att-card-body">' +
            '<div class="pur-rec-row">' +
              '<label class="att-label pur-w2">Item<input class="att-input" data-f="itemName" data-i="' + i + '" maxlength="200" value="' + esc(l.itemName) + '"></label>' +
              '<label class="att-label">Quantity<input class="att-input" data-f="quantity" data-i="' + i + '" inputmode="decimal" value="' + esc(l.quantity) + '"></label>' +
              '<label class="att-label">Unit<input class="att-input" data-f="unit" data-i="' + i + '" maxlength="30" value="' + esc(l.unit) + '"></label>' +
              '<label class="att-label">Amount (₱)<input class="att-input" data-f="amount" data-i="' + i + '" inputmode="decimal" value="' + esc(l.amount) + '"></label>' +
              '<label class="att-label">Category<input class="att-input" data-f="category" data-i="' + i + '" maxlength="100" value="' + esc(l.category) + '"></label>' +
              '<button type="button" class="att-btn att-btn--sm" data-remove="' + i + '" aria-label="Remove line">&times;</button>' +
            '</div>' +
            '<div class="pur-rec-row">' + where +
              '<span class="pur-preview" data-preview="' + i + '">' + esc(previewText(l)) + '</span></div>' +
            matchHtml(l, i) +
            picksHtml(l, i) +
            '<div class="pur-rec-row" data-extra="' + i + '"' + (extraNeeded(l) ? '' : ' hidden') + '>' +
              '<label class="att-label pur-w2">Why more than needed?<input class="att-input" data-f="extraReason" data-i="' + i + '" maxlength="300" placeholder="Pack size, spare for breakage, cheaper in bulk…" value="' + esc(l.extraReason) + '"></label>' +
              '<label class="att-label">Extra goes to<select class="att-input" data-f="extraLocation" data-i="' + i + '">' +
                '<option value="">Choose…</option>' +
                '<option value="project"' + (l.extraLocation === 'project' ? ' selected' : '') + '>Same project</option>' +
                '<option value="warehouse"' + (l.extraLocation === 'warehouse' ? ' selected' : '') + '>Warehouse (cost stays on the project)</option>' +
              '</select></label>' +
            '</div>' +
            (linked ? '' :
              '<div class="pur-rec-row"><label class="att-label pur-w2">Reason (no request)<input class="att-input" data-f="unplannedReason" data-i="' + i + '" maxlength="300" placeholder="What it was for and why it was not requested" value="' + esc(l.unplannedReason) + '"></label></div>') +
            '</div></div>';
    }

    function chargeHtml(c, i) {
        const shares = c.adjust ? (c.shares || PA.prorate(PA.parseMoney(c.amount) || 0, st.lines.map(l => PA.parseMoney(l.amount) || 0))) : null;
        return '<div class="pur-rec-row">' +
            '<select class="att-input" data-cf="kind" data-c="' + i + '"><option value="delivery_fee"' + (c.kind === 'delivery_fee' ? ' selected' : '') + '>Delivery fee</option>' +
              '<option value="discount"' + (c.kind === 'discount' ? ' selected' : '') + '>Discount</option></select>' +
            '<input class="att-input" data-cf="amount" data-c="' + i + '" inputmode="decimal" aria-label="Amount" value="' + esc(c.amount) + '">' +
            '<label class="req-toggle"><input type="checkbox" data-cf="adjust" data-c="' + i + '"' + (c.adjust ? ' checked' : '') + '> Adjust the split</label>' +
            '<span class="pur-preview" data-cpreview="' + i + '"></span>' +
            '<button type="button" class="att-btn att-btn--sm" data-cremove="' + i + '" aria-label="Remove">&times;</button>' +
            (shares ? '<div class="pur-shares">' + st.lines.map((l, k) =>
                '<label class="att-label">' + esc('Line ' + (k + 1)) + '<input class="att-input" data-share="' + i + ':' + k + '" inputmode="decimal" value="' + esc(shares[k]) + '"></label>').join('') + '</div>' : '') +
            '</div>';
    }

    // One receipt photo slot. The chosen file is kept in st.files, so a
    // redraw shows it again (a file input cannot be refilled) and Save
    // uploads it — a newer choice replaces an earlier upload.
    function docHtml(d) {
        const [key, field, label] = d;
        const chosen = st.files[key];
        const status = chosen
            ? 'Chosen: ' + esc(chosen.name || 'photo') + (st.uploaded[key] && st.uploaded[key].file === chosen ? ' (uploaded)' : ' (uploads when you save)') +
              ' <button type="button" class="att-btn att-btn--sm" data-doc-clear="' + key + '">Remove</button>'
            : (st.onFile || []).includes(field) ? 'On file — choose a photo to replace it' : '';
        return '<label class="att-label">' + label + '<input class="att-input" type="file" accept="image/*" data-doc="' + key + '">' +
            (status ? '<span class="req-muted" data-doc-status="' + key + '">' + status + '</span>' : '') + '</label>';
    }

    function refresh(host) {
        st.lines.forEach((l, i) => {
            const pv = host.querySelector('[data-preview="' + i + '"]');
            if (pv) pv.textContent = previewText(l);
            const ex = host.querySelector('[data-extra="' + i + '"]');
            if (ex) ex.hidden = !extraNeeded(l);
            const sr = host.querySelector('[data-subreason="' + i + '"]');
            if (sr) sr.hidden = l.match !== 'substitute';
        });
        st.charges.forEach((c, i) => {
            const el = host.querySelector('[data-cpreview="' + i + '"]');
            if (!el || c.adjust) { if (el) el.textContent = ''; return; }
            const split = PA.prorate(PA.parseMoney(c.amount) || 0, st.lines.map(l => PA.parseMoney(l.amount) || 0));
            el.textContent = 'Split by line amount: ' + split.map(PA.peso).join(' · ');
        });
        const total = PA.receiptTotal(st.lines.map(l => ({ amount: PA.parseMoney(l.amount) || 0 })),
                                      st.charges.map(c => ({ kind: c.kind, amount: PA.parseMoney(c.amount) || 0 })));
        const t = host.querySelector('[data-total]');
        if (t) t.textContent = PA.peso(total);
    }

    // The form, as the server will read it.
    function formState() {
        return {
            purchaseDate: st.purchaseDate, supplierId: st.supplierId || null, supplier: st.supplier, paymentMethod: st.paymentMethod,
            notes: st.notes, docs: st.docs, boughtBy: st.boughtBy || null,
            lines: st.lines.map(l => Object.assign({}, l, { quantity: PA.parseQty(l.quantity), amount: PA.parseMoney(l.amount),
                portionPicks: (l.portionPicks || []).map(k => ({ portionId: k.portionId, quantity: PA.parseQty(k.quantity) || 0 })) })),
            charges: st.charges.map(c => ({ kind: c.kind, amount: PA.parseMoney(c.amount),
                shares: c.adjust ? (c.shares || []).map(x => PA.parseMoney(x)) : null })),
        };
    }

    async function uploadDocs() {
        for (const key of PA.docUploads(st.files, st.uploaded)) {
            const file = st.files[key];
            const field = DOCS.find(d => d[0] === key)[1];
            const blob = await root.DacsReceipts.compressToBlob(file);
            st.docs[field] = await root.DacsReceipts.uploadReceipt('purchase', blob, root.currentDataUserId);
            st.uploaded[key] = { file, url: st.docs[field] };
        }
    }

    async function save(host, me) {
        const box = host.querySelector('[data-problems]');
        const fs = formState();
        const problems = PA.formProblems(fs);
        if (st.editId && !String(st.reason || '').trim()) problems.unshift({ code: 'REASON_REQUIRED' });
        if (problems.length) {
            box.innerHTML = '<ul>' + problems.map(p => '<li>' + esc((p.line ? 'Line ' + p.line + ': ' : p.charge ? 'Fee/discount ' + p.charge + ': ' : '') +
                PA.ERRORS[p.code]) + '</li>').join('') + '</ul>';
            box.hidden = false;
            return;
        }
        box.hidden = true;
        const btn = host.querySelector('[data-save]');
        btn.disabled = true;
        let body;
        try {
            await uploadDocs();
            body = PA.buildBody(formState());
            let res;
            if (!st.editId) {
                res = await RA.rpc('pur_record', { p_op: st.opId, p_body: body });
            } else if (body.lines.length === st.editLines) {
                res = await RA.rpc('pur_correct', { p_op: st.opId, p_purchase: st.editId, p_body: body, p_reason: st.reason.trim() });
            } else {
                res = await RA.rpc('pur_replace', { p_op: st.opId, p_purchase: st.editId, p_body: body, p_reason: st.reason.trim() });
            }
            const done = ctx && ctx.onDone;
            const goTo = st.editId ? (res && res.purchase_id) || st.editId : null;
            ctx = null; st = null;
            if (done) done();
            if (res && res.replayed) {
                PA.notice('This purchase was already saved by an earlier press — check it; changes made since were NOT applied.', 'Already saved');
            }
            PA.ui.tab = goTo ? 'purchases' : 'list';
            if (goTo) PA.openPurchase(goTo); else root.switchView('reqPurchasing');
        } catch (e) {
            btn.disabled = false;
            if (st) refreshDocs(host);
            if (st && st.editId && !me.isOwner && PA.needsOwner(e)) return offerOwner(host, body);
            box.innerHTML = esc(PA.errorMessage(e));
            box.hidden = false;
        }
    }

    // After an upload, say so beside each photo without redrawing the form.
    function refreshDocs(host) {
        DOCS.forEach(d => {
            const el = host.querySelector('[data-doc-status="' + d[0] + '"]');
            if (el && st.files[d[0]] && st.uploaded[d[0]] && st.uploaded[d[0]].file === st.files[d[0]]) {
                el.firstChild.textContent = 'Chosen: ' + (st.files[d[0]].name || 'photo') + ' (uploaded) ';
            }
        });
    }

    // Staff: the server keeps this change for the owner. Send it as a request.
    function offerOwner(host, body) {
        const kind = body.lines.length === st.editLines ? 'correct' : 'replace';
        const editId = st.editId, reason = st.reason.trim();
        RA.modal({
            title: 'Send to the owner?',
            sub: 'Only the owner can make this change (another project, or a completed project). The owner sees every field of this version and approves or rejects it.',
            body: '<p class="req-muted">Reason: ' + esc(reason) + '</p>',
            submitLabel: 'Send for approval',
            errorMessage: PA.errorMessage,
            onSubmit: async () => {
                await RA.rpc('pur_request_change', { p_op: root.DacsReceipts.newId(), p_purchase: editId, p_kind: kind, p_body: body, p_reason: reason });
            },
            onDone: () => { ctx = null; st = null; PA.ui.tab = 'purchases'; PA.openPurchase(editId); },
        });
    }

    async function renderRecord(host, me) {
        if (!ctx) { PA.ui.tab = 'list'; return PA.renderPurchasing(host.closest('.content-view') || host.parentNode); }
        let suppliers, buyers, folders;
        try {
            const [s, b, f] = await Promise.all([
                RA.rpc('pur_suppliers'),
                me.isOwner ? RA.rpc('pur_buyer_options') : Promise.resolve([]),
                root.sbClient.from('folders').select('id, name, parent_folder_id, completed_at').order('name'),
            ]);
            if (f.error) throw f.error;
            suppliers = s || []; buyers = b || [];
            const all = f.data || [];
            folders = [];
            all.filter(x => !x.parent_folder_id && (me.isOwner || !x.completed_at)).forEach(p => {
                folders.push({ id: p.id, label: p.name + ' · Main Contract' });
                all.filter(c => c.parent_folder_id === p.id).forEach(c => folders.push({ id: c.id, label: p.name + ' · ' + c.name }));
            });
        } catch (e) { RA.fail(host, e); return; }
        if (!st) {
            st = ctx.purchase ? fromPurchase(ctx.purchase) : {
                opId: root.DacsReceipts.newId(), editId: null, editLines: 0, reason: '',
                purchaseDate: todayKey(), supplierId: '', supplier: '', paymentMethod: 'Cash', notes: '', boughtBy: me.userId,
                docs: {}, files: {}, uploaded: {}, onFile: [],
                lines: ctx.requestLines.length ? ctx.requestLines.map(l => fromRequest(l, me)) : [newLine()],
                charges: [],
            };
        }

        host.innerHTML =
            '<div class="att-card"><div class="att-card-body">' +
              '<h3 class="pur-h3">' + (st.editId ? 'Correct this purchase' : 'Record a purchase') + '</h3>' +
              '<div class="pur-rec-row">' +
                '<label class="att-label">Date bought<input class="att-input" type="date" data-h="purchaseDate" value="' + esc(st.purchaseDate) + '"></label>' +
                '<label class="att-label pur-w2">Supplier<select class="att-input" data-h="supplierId">' +
                  '<option value="">' + (st.supplier ? esc(st.supplier) + ' (typed)' : 'Choose…') + '</option>' +
                  suppliers.filter(s => s.active || s.id === st.supplierId).map(s => '<option value="' + esc(s.id) + '"' + (s.id === st.supplierId ? ' selected' : '') + '>' +
                    esc(s.name + (s.branch ? ' · ' + s.branch : '')) + '</option>').join('') +
                '</select></label>' +
                '<button type="button" class="att-btn att-btn--sm" data-new-supplier>+ New supplier</button>' +
                '<label class="att-label">Paid by<select class="att-input" data-h="paymentMethod">' +
                  ['Cash', 'GCash', 'Bank transfer', 'Check', 'On account', ''].map(m => '<option value="' + esc(m) + '"' + (m === st.paymentMethod ? ' selected' : '') + '>' + esc(m || 'Not yet paid / not known') + '</option>').join('') +
                '</select></label>' +
                (me.isOwner && buyers.length ? '<label class="att-label">Bought by<select class="att-input" data-h="boughtBy">' +
                  buyers.map(b => '<option value="' + esc(b.user_id) + '"' + (b.user_id === st.boughtBy ? ' selected' : '') + '>' + esc(b.is_me ? 'You (' + b.name + ')' : b.name) + '</option>').join('') +
                '</select></label>' : '') +
              '</div>' +
              '<label class="att-label">Notes<input class="att-input" data-h="notes" maxlength="2000" value="' + esc(st.notes) + '"></label>' +
            '</div></div>' +
            '<div data-lines>' + st.lines.map((l, i) => lineHtml(l, i, folders)).join('') + '</div>' +
            '<button type="button" class="att-btn" data-add-line>+ Add a line with no request</button>' +
            '<div class="att-card"><div class="att-card-body">' +
              '<h3 class="pur-h3">Delivery fees and discounts</h3>' +
              '<p class="req-muted">Shared across the lines by line amount unless you adjust it. Never charged to one project automatically.</p>' +
              st.charges.map((c, i) => chargeHtml(c, i)).join('') +
              '<button type="button" class="att-btn att-btn--sm" data-add-charge="delivery_fee">+ Delivery fee</button> ' +
              '<button type="button" class="att-btn att-btn--sm" data-add-charge="discount">+ Discount</button>' +
            '</div></div>' +
            '<div class="att-card"><div class="att-card-body">' +
              '<h3 class="pur-h3">Receipt photos (optional)</h3>' +
              '<p class="req-muted">Kept once for the whole receipt, office buyers only — never shown to clients, partners or workers.</p>' +
              '<div class="pur-rec-row">' + DOCS.map(docHtml).join('') + '</div></div></div>' +
            (st.editId ? '<label class="att-label">Reason for the change (kept in the history)<input class="att-input" data-h="reason" maxlength="500" value="' + esc(st.reason) + '"></label>' : '') +
            '<div class="att-info att-info--warn" data-problems hidden></div>' +
            '<div class="pur-rec-foot"><span>Receipt total <strong data-total></strong></span>' +
              '<button type="button" class="att-btn" data-cancel>Cancel</button>' +
              '<button type="button" class="att-btn att-btn--primary" data-save>' + (st.editId ? 'Save correction' : 'Save purchase') + '</button></div>';

        const rerender = () => renderRecord(host, me);
        host.querySelectorAll('[data-h]').forEach(el => el.addEventListener('input', () => { st[el.dataset.h] = el.value; refresh(host); }));
        host.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
            const l = st.lines[Number(el.dataset.i)];
            if (el.dataset.f === 'where') {
                l.destination = el.value === 'warehouse' ? 'warehouse' : 'project';
                l.folderId = el.value === 'warehouse' ? '' : el.value;
            } else {
                l[el.dataset.f] = el.value;
            }
            refresh(host);
        }));
        host.querySelectorAll('[data-pickq]').forEach(el => el.addEventListener('input', () => {
            const [i, id] = el.dataset.pickq.split(':');
            const l = st.lines[Number(i)];
            l.portionPicks = (l.portionPicks || []).filter(k => k.portionId !== id);
            if (String(el.value).trim()) l.portionPicks.push({ portionId: id, quantity: el.value });
            // Keep the picks in the portions' own order (the server covers them in this order).
            l.portionPicks.sort((a, b) => l.portions.findIndex(p => p.id === a.portionId) - l.portions.findIndex(p => p.id === b.portionId));
            refresh(host);
        }));
        host.querySelectorAll('[data-doc]').forEach(el => el.addEventListener('change', () => {
            const file = el.files && el.files[0];
            if (file) st.files[el.dataset.doc] = file; else delete st.files[el.dataset.doc];
            rerender();
        }));
        host.querySelectorAll('[data-doc-clear]').forEach(b => b.addEventListener('click', (e) => {
            e.preventDefault();
            const key = b.dataset.docClear;
            const field = DOCS.find(d => d[0] === key)[1];
            delete st.files[key];
            // An upload made for this choice is not sent (the stored receipt stays as it was).
            if (st.uploaded[key]) { delete st.uploaded[key]; delete st.docs[field]; }
            rerender();
        }));
        host.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
            st.lines.splice(Number(b.dataset.remove), 1);
            st.charges.forEach(c => { c.shares = null; });
            rerender();
        }));
        host.querySelector('[data-add-line]').addEventListener('click', () => { st.lines.push(newLine()); st.charges.forEach(c => { c.shares = null; }); rerender(); });
        host.querySelectorAll('[data-add-charge]').forEach(b => b.addEventListener('click', () => {
            st.charges.push({ kind: b.dataset.addCharge, amount: '', adjust: false, shares: null }); rerender();
        }));
        host.querySelectorAll('[data-cf]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
            const c = st.charges[Number(el.dataset.c)];
            if (el.dataset.cf === 'adjust') { c.adjust = el.checked; c.shares = null; return rerender(); }
            c[el.dataset.cf] = el.value;
            refresh(host);
        }));
        host.querySelectorAll('[data-share]').forEach(el => el.addEventListener('input', () => {
            const [ci, li] = el.dataset.share.split(':').map(Number);
            const c = st.charges[ci];
            if (!c.shares) c.shares = PA.prorate(PA.parseMoney(c.amount) || 0, st.lines.map(l => PA.parseMoney(l.amount) || 0)).map(String);
            c.shares[li] = el.value;
        }));
        host.querySelectorAll('[data-cremove]').forEach(b => b.addEventListener('click', () => { st.charges.splice(Number(b.dataset.cremove), 1); rerender(); }));
        host.querySelector('[data-new-supplier]').addEventListener('click', () => RA.modal({
            title: 'New supplier',
            body: '<label class="att-label">Name<input class="att-input" name="name" maxlength="120" required></label>' +
                  '<label class="att-label">Branch (optional)<input class="att-input" name="branch" maxlength="120"></label>' +
                  '<label class="att-label">Contact (optional)<input class="att-input" name="contact" maxlength="200"></label>',
            submitLabel: 'Add supplier',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const s = await RA.rpc('pur_save_supplier', { p_id: null, p_name: form.name.value, p_branch: form.branch.value,
                                                             p_contact: form.contact.value, p_active: true });
                st.supplierId = s.id;
            },
            onDone: rerender,
        }));
        host.querySelector('[data-cancel]').addEventListener('click', () => {
            const back = st.editId;
            ctx = null; st = null;
            PA.ui.tab = back ? 'purchases' : 'list';
            if (back) PA.openPurchase(back); else root.switchView('reqPurchasing');
        });
        host.querySelector('[data-save]').addEventListener('click', () => save(host, me));
        refresh(host);
        RA.icons();
    }

    PA.openRecord = function (c) {
        ctx = c; st = null;
        PA.ui.tab = 'record';
        root.switchView('reqPurchasing');
    };
    PA.renderRecord = renderRecord;
})(typeof window !== 'undefined' ? window : globalThis);
````

Create `js/purchasing-admin-purchases.js`:

````js
// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Purchases, one purchase (reqPurchase) and Owner
// approvals (0097). Buyers only.
//
//   Purchases        — newest first, a date range and a project.
//   One purchase     — its lines, what each covered on its request, extras,
//                      unit checks, receipt photos, history; Correct (the
//                      record form), Void, Check a different unit.
//   Owner approvals  — staff changes the server keeps for the owner. The
//                      owner approves (the server runs the very same
//                      correct / replace / void) or rejects with a note;
//                      staff see their own and can withdraw.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    function monthStart() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
    }
    function todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    const ui = { from: null, to: null, status: 'recorded' };

    async function renderPurchases(body, me) {
        if (ui.from === null) { ui.from = monthStart(); ui.to = todayKey(); }
        let rows;
        try {
            rows = await RA.rpc('pur_purchases', { p_from: ui.from || null, p_to: ui.to || null, p_folder: null, p_status: ui.status });
        } catch (e) { RA.fail(body, e); return; }
        rows = rows || [];
        body.innerHTML =
            '<div class="att-toolbar">' +
              '<label class="att-label">From<input class="att-input" type="date" data-from value="' + esc(ui.from) + '"></label>' +
              '<label class="att-label">To<input class="att-input" type="date" data-to value="' + esc(ui.to) + '"></label>' +
              '<select class="att-filter" data-status aria-label="Status">' +
                [['recorded', 'Recorded'], ['void', 'Voided'], ['all', 'All']].map(s => '<option value="' + s[0] + '"' + (s[0] === ui.status ? ' selected' : '') + '>' + s[1] + '</option>').join('') +
              '</select>' +
              (rows.length >= 300 ? '<span class="req-muted">Showing the newest 300 — narrow the dates.</span>' : '') +
            '</div>' +
            (rows.length
              ? '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
                  '<thead><tr><th>Date</th><th>Supplier</th><th>For</th><th>Total</th><th>Bought by</th><th>Status</th></tr></thead><tbody>' +
                  rows.map(p => '<tr class="req-row" tabindex="0" data-id="' + esc(p.id) + '">' +
                    '<td>' + esc(RA.formatDay(p.purchase_date)) + '</td>' +
                    '<td>' + esc(p.supplier || '—') + '</td>' +
                    '<td>' + esc((p.projects || []).join(', ') + (p.warehouse ? ((p.projects || []).length ? ' · ' : '') + 'Warehouse' : '')) +
                      '<div class="req-muted">' + esc(p.lines + (p.lines === 1 ? ' line' : ' lines') + (p.linked ? ' · ' + p.linked + ' from requests' : '')) + '</div></td>' +
                    '<td><strong>' + esc(PA.peso(p.receipt_total)) + '</strong></td>' +
                    '<td>' + esc(p.bought_by_name) + (p.bought_by_name !== p.recorded_by_name ? '<div class="req-muted">recorded by ' + esc(p.recorded_by_name) + '</div>' : '') + '</td>' +
                    '<td>' + PA.purchaseFlags(p).map(f => PA.pill(f.text, f.tone)).join(' ') + '</td>' +
                  '</tr>').join('') +
                '</tbody></table></div></div></div>'
              : '<div class="att-empty">No purchases in these dates.</div>');
        const reload = () => renderPurchases(body, me);
        body.querySelector('[data-from]').addEventListener('change', e => { ui.from = e.target.value; reload(); });
        body.querySelector('[data-to]').addEventListener('change', e => { ui.to = e.target.value; reload(); });
        body.querySelector('[data-status]').addEventListener('change', e => { ui.status = e.target.value; reload(); });
        body.querySelectorAll('tr[data-id]').forEach(tr => {
            tr.addEventListener('click', () => PA.openPurchase(tr.dataset.id));
            tr.addEventListener('keydown', e => { if (e.key === 'Enter') PA.openPurchase(tr.dataset.id); });
        });
        RA.icons();
    }

    function lineRow(l, doc) {
        const covers = (doc.covers || []).filter(c => c.line === l.line);
        const req = (doc.requests || []).find(r => r.line === l.line);
        let what;
        if (req) {
            what = 'For request: ' + esc(req.description) + ' · covered ' + esc(PA.qty(l.covered) + ' ' + req.unit);
            if (Number(l.extra) > 0) what += ' · <strong>extra ' + esc(PA.qty(l.extra)) + '</strong> (' + esc(l.extra_reason) + '; ' + (l.extra_location === 'warehouse' ? 'warehouse' : 'same project') + ')';
            if (l.substitute) what += '<div>' + PA.pill('Substitute', 'pc') + ' for ' + esc(req.description + (req.spec ? ' ' + req.spec : '')) + ': ' + esc(l.substitute_reason) + '</div>';
            if (l.unit_check === 'pending') what += ' · ' + PA.pill((l.substitute ? 'Substitute' : 'Different unit') + ' — office check needed', 'abandoned');
            if (l.unit_check === 'confirmed') what += ' · ' + PA.pill('Checked: covers ' + PA.qty(l.unit_covers) + ' ' + req.unit, 'done');
            if (covers.length) what += '<div class="req-muted">' + covers.map(c => esc(PA.qty(c.quantity) + ' for ' + (c.cutoff_at ? 'Cutoff ' + RA.cutoffLabel(c.cutoff_at) : 'a removed portion') + ' · bought by ' + c.buyer_name)).join('<br>') + '</div>';
        } else {
            what = l.destination === 'warehouse' ? 'Warehouse — company stock' : 'Unplanned';
            if (l.unplanned_reason) what += ': ' + esc(l.unplanned_reason);
        }
        return '<tr><td>' + esc(l.line) + '</td><td><strong>' + esc(l.item_name) + '</strong><div class="req-muted">' +
            esc(l.destination === 'warehouse' ? 'Warehouse' : l.folder_name) + '</div></td>' +
            '<td>' + esc(PA.qty(l.quantity) + ' ' + (l.unit || '')) + '</td><td>' + esc(PA.peso(l.amount)) + '</td>' +
            '<td>' + what + (l.needs_funding_review ? ' ' + PA.pill('Office review', 'working') : '') + '</td>' +
            '<td>' + (l.unit_check === 'pending' ? '<button type="button" class="att-btn att-btn--sm" data-check="' + esc(l.line) + '">' +
              (l.substitute ? 'Check substitute…' : 'Check unit…') + '</button>' : '') + '</td></tr>';
    }

    async function renderPurchase(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading…</div></div>';
        let me, doc;
        try {
            me = await PA.me();
            if (!PA.state.purchaseId) { root.switchView('reqPurchasing'); return; }
            doc = await RA.rpc('pur_purchase', { p_purchase: PA.state.purchaseId });
        } catch (e) { RA.fail(host, e); return; }
        const open = doc.status === 'recorded';
        const pending = (doc.change_requests || []).find(r => r.status === 'pending');
        const docs = Object.entries(doc.docs || {}).filter(([, v]) => v);
        host.innerHTML =
            '<div class="att-stack pur-tab">' +
              RA.head('Purchase · ' + RA.formatDay(doc.purchase_date), (doc.supplier || 'No supplier') + ' · ' + PA.peso(doc.receipt_total) +
                ' · bought by ' + doc.bought_by_name + (doc.bought_by_name !== doc.recorded_by_name ? ', recorded by ' + doc.recorded_by_name : ''),
                '<button type="button" class="att-btn" data-back>← Purchases</button>' +
                (open && !pending ? '<button type="button" class="att-btn" data-correct>Correct…</button><button type="button" class="att-btn att-btn--warn" data-void>Void…</button>' : '')) +
              (doc.status === 'void' ? '<div class="att-info att-info--warn"><i data-lucide="ban"></i><div>Voided — it counts for nothing in Spent or Bought. ' +
                  (doc.replaced_by ? 'It was replaced by a newer version.' : 'Its receipt and history are kept.') + '</div></div>' : '') +
              (pending ? '<div class="att-info"><i data-lucide="hourglass"></i><div>A change is waiting for the owner (' + esc(pending.kind) + ', by ' +
                  esc(pending.requested_by_name) + '): ' + esc(pending.reason) + '</div></div>' : '') +
              '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
                '<thead><tr><th>#</th><th>Item</th><th>Quantity</th><th>Amount</th><th>Request</th><th></th></tr></thead><tbody>' +
                (doc.lines || []).map(l => lineRow(l, doc)).join('') +
                (doc.charges || []).map(c => '<tr><td></td><td>' + esc(c.kind === 'discount' ? 'Discount' : 'Delivery fee') + '</td><td></td><td>' +
                  esc((c.kind === 'discount' ? '−' : '') + PA.peso(c.amount)) + '</td><td class="req-muted">' +
                  esc((c.shares || []).map(s => 'line ' + s.line + ': ' + PA.peso(s.amount)).join(' · ')) + '</td><td></td></tr>').join('') +
              '</tbody></table></div></div></div>' +
              (docs.length ? '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">Receipt photos</h3><div class="pur-docs">' +
                  docs.map(([k, v]) => '<a class="att-link" href="#" data-doc-url="' + esc(v) + '">' + esc(k.replace(/_url$/, '').replace(/_/g, ' ')) + '</a>').join(' · ') +
                '</div></div></div>' : '') +
              '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">History</h3><ul class="pur-history">' +
                (doc.history || []).map(h => '<li>' + esc(RA.formatManila(h.at)) + ' — <strong>' + esc(PA.HISTORY_LABEL[h.kind] || h.kind) + '</strong> by ' +
                  esc(h.actor_name) + (h.reason ? ': ' + esc(h.reason) : '') + '</li>').join('') +
                (doc.change_requests || []).map(r => '<li>' + esc(RA.formatManila(r.requested_at)) + ' — owner approval asked by ' + esc(r.requested_by_name) +
                  ' (' + esc(r.kind) + '): ' + esc(r.reason) + ' — <strong>' + esc(PA.REQUEST_STATUS[r.status] || r.status) + '</strong>' +
                  (r.decision_note ? ': ' + esc(r.decision_note) : '') + '</li>').join('') +
              '</ul></div></div>' +
            '</div>';

        const reload = () => renderPurchase(host);
        host.querySelector('[data-back]').addEventListener('click', () => { PA.ui.tab = 'purchases'; root.switchView('reqPurchasing'); });
        // Purchase receipts are never given a signed link: window.open (the
        // shim in supabase-config.js §11b) downloads the photo with this
        // account's session — Storage checks the Buyer rule on every
        // download — and shows a copy that lives only in the new tab.
        host.querySelectorAll('[data-doc-url]').forEach(a => a.addEventListener('click', (e) => {
            e.preventDefault();
            root.open(a.dataset.docUrl, '_blank');
        }));
        const corr = host.querySelector('[data-correct]');
        if (corr) corr.addEventListener('click', () => PA.openRecord({ purchase: doc }));
        const vd = host.querySelector('[data-void]');
        if (vd) vd.addEventListener('click', () => RA.modal({
            title: 'Void this purchase?',
            sub: 'It leaves Spent and Bought — all ' + (doc.lines || []).length + ' line(s). The receipt and history are kept; it does not say goods were returned or money refunded.',
            body: '<label class="att-label">Reason (kept in the history)<input class="att-input" name="reason" maxlength="500" required></label>',
            submitLabel: 'Void purchase', warn: true,
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const reason = form.reason.value.trim();
                if (!reason) throw new Error('REASON_REQUIRED');
                try {
                    await RA.rpc('pur_void', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_reason: reason });
                } catch (e) {
                    if (me.isOwner || !PA.needsOwner(e)) throw e;
                    await RA.rpc('pur_request_change', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_kind: 'void', p_body: null, p_reason: reason });
                    PA.notice('Only the owner can void this one (completed project). It was sent to the owner for approval.', 'Sent to the owner');
                }
            },
            onDone: reload,
        }));
        host.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => {
            const l = doc.lines.find(x => String(x.line) === b.dataset.check);
            const req = (doc.requests || []).find(r => r.line === l.line);
            RA.modal({
                title: l.substitute ? 'Check a substitute' : 'Check a different unit',
                sub: (l.substitute
                        ? 'Bought ' + PA.qty(l.quantity) + ' ' + l.unit + ' of ' + l.item_name + ' instead of ' + req.description + (req.spec ? ' ' + req.spec : '') +
                          ' (' + l.substitute_reason + '). If it does the job, how many ' + req.unit + ' of the request does it cover (0 if it does not)? '
                        : 'Bought ' + PA.qty(l.quantity) + ' ' + l.unit + '; the request is in ' + req.unit + '. How many ' + req.unit + ' does this cover? ') +
                     'Someone other than the buyer checks it; it is kept in the history.',
                body: '<label class="att-label">Covers (' + esc(req.unit) + ')<input class="att-input" name="covers" inputmode="decimal" required></label>' +
                      '<label class="att-label">How you know<input class="att-input" name="note" maxlength="300" required placeholder="e.g. 2 boxes of 12"></label>',
                submitLabel: 'Confirm',
                errorMessage: PA.errorMessage,
                onSubmit: async (form) => {
                    // 0 allowed (it covers none of the request); at most 3 decimals.
                    const v = form.covers.value.replace(/,/g, '').trim();
                    if (!/^\d+(\.\d{1,3})?$/.test(v)) throw new Error('BAD_QUANTITY');
                    const covers = Number(v);
                    await RA.rpc('pur_check_unit', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_line_no: l.line,
                                                     p_covers: covers, p_note: form.note.value.trim() });
                },
                onDone: reload,
            });
        }));
        RA.icons();
    }

    // Every field of the purchase as the staff member saw it, beside what
    // they asked for — changed rows marked. A void lists the whole purchase.
    function changeTable(r) {
        if (r.kind === 'void') {
            const rows = PA.changeRows(r.base, r.base, RA.cutoffLabel);
            return '<p><strong>Void the whole purchase</strong> — it leaves Spent and Bought:</p>' +
                '<div class="req-table-wrap"><table class="att-table req-table pur-change"><tbody>' +
                rows.map(x => '<tr><td class="req-muted">' + esc(x.group) + '</td><td>' + esc(x.label) + '</td><td>' + esc(x.before) + '</td></tr>').join('') +
                '</tbody></table></div>';
        }
        const rows = PA.changeRows(r.base, r.proposed, RA.cutoffLabel);
        const n = rows.filter(x => x.changed).length;
        return '<p><strong>' + n + (n === 1 ? ' change' : ' changes') + '</strong> — every field is listed; changed ones are marked.</p>' +
            '<div class="req-table-wrap"><table class="att-table req-table pur-change"><thead><tr><th></th><th></th><th>When asked</th><th>Asked for</th></tr></thead><tbody>' +
            rows.map(x => '<tr' + (x.changed ? ' class="pur-changed"' : '') + '><td class="req-muted">' + esc(x.group) + '</td><td>' + esc(x.label) +
                (x.changed ? ' ' + PA.pill('changed', 'working') : '') + '</td><td>' + esc(x.before) + '</td><td>' + esc(x.after) + '</td></tr>').join('') +
            '</tbody></table></div>';
    }

    async function renderApprovals(body, me) {
        let list;
        try { list = await RA.rpc('pur_change_requests', { p_scope: 'all' }); } catch (e) { RA.fail(body, e); return; }
        list = list || [];
        const pending = list.filter(r => r.status === 'pending');
        const decided = list.filter(r => r.status !== 'pending').slice(0, 30);
        const card = (r) => '<div class="att-card"><div class="att-card-body">' +
            '<div><strong>' + esc(r.kind === 'void' ? 'Void' : r.kind === 'replace' ? 'Replace' : 'Correct') + '</strong> — asked by ' +
              esc(r.requested_by_name) + ', ' + esc(RA.formatManila(r.requested_at)) + ' · ' + PA.pill(PA.REQUEST_STATUS[r.status] || r.status,
              r.status === 'pending' ? 'working' : r.status === 'approved' ? 'done' : 'hidden') + '</div>' +
            '<div>Reason: ' + esc(r.reason) + '</div>' +
            (r.changed_since ? '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>The purchase changed after this was asked ' +
                '(a correction, an office check or a receipt). It cannot be approved — ask for a new request.</div></div>' : '') +
            (r.status === 'pending' ? changeTable(r) : '') +
            (r.decision_note ? '<div class="req-muted">Note: ' + esc(r.decision_note) + '</div>' : '') +
            '<div class="pur-rec-row">' +
              '<button type="button" class="att-btn att-btn--sm" data-open="' + esc(r.purchase_id) + '">Open purchase</button>' +
              (r.status === 'pending' && me.isOwner ? '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-approve="' + esc(r.id) + '"' +
                  (r.changed_since ? ' disabled title="The purchase changed after this was asked"' : '') + '>Approve</button>' +
                '<button type="button" class="att-btn att-btn--sm att-btn--warn" data-reject="' + esc(r.id) + '">Reject…</button>' : '') +
              (r.status === 'pending' && !me.isOwner && r.requested_by === me.userId ? '<button type="button" class="att-btn att-btn--sm" data-withdraw="' + esc(r.id) + '">Withdraw</button>' : '') +
            '</div></div></div>';
        body.innerHTML =
            '<p class="req-muted">' + (me.isOwner
                ? 'Changes your staff asked for that only you can make. Approving applies exactly the "Asked for" column, through the normal correction — and only while the purchase still reads as it did when they asked.'
                : 'Changes you sent to the owner.') + '</p>' +
            (pending.length ? pending.map(card).join('') : '<div class="att-empty">Nothing is waiting.</div>') +
            (decided.length ? '<h3 class="pur-h3">Decided</h3>' + decided.map(card).join('') : '');
        const reload = () => renderApprovals(body, me);
        body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => PA.openPurchase(b.dataset.open)));
        body.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try {
                const res = await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: b.dataset.approve, p_approve: true, p_note: null });
                if (res && res.status === 'stale') PA.notice('The purchase changed after this was asked, so nothing was applied. Ask for a new request.', 'Out of date');
            } catch (e) { PA.notice(e); }
            reload();
        }));
        body.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => RA.modal({
            title: 'Reject this change?',
            body: '<label class="att-label">Why (the requester sees this)<input class="att-input" name="note" maxlength="500" required></label>',
            submitLabel: 'Reject', warn: true, errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: b.dataset.reject, p_approve: false, p_note: form.note.value.trim() });
            },
            onDone: reload,
        })));
        body.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
            try { await RA.rpc('pur_withdraw_change', { p_request: b.dataset.withdraw }); } catch (e) { PA.notice(e); }
            reload();
        }));
        RA.icons();
    }

    PA.renderPurchases = renderPurchases;
    PA.renderApprovals = renderApprovals;
    RA.views.reqPurchase = renderPurchase;
})(typeof window !== 'undefined' ? window : globalThis);
````

Create `css/purchasing-admin.css`:

````css
/* ════════════════════════════════════════════════════════════════════
   PURCHASING (WorkMate Stage 2A-2) — extra styles for
   js/purchasing-admin-*.js. Everything else reuses the Attendance att-*
   and Requests req-* classes and tokens, so the tab looks like Requests.
   ════════════════════════════════════════════════════════════════════ */

.pur-tab .att-card { margin-bottom: 12px; }
.pur-h3 { margin: 0 0 8px; font-size: 15px; font-weight: 700; }

/* Shopping list */
.pur-line.is-urgent { border-left: 3px solid var(--att-red); }
.pur-line-head { display: flex; gap: 12px; align-items: flex-start; }
.pur-pick { padding-top: 3px; min-width: 18px; }
.pur-line-main { flex: 1; min-width: 0; display: grid; gap: 4px; }
.pur-figures { font-size: 13px; }
.pur-figures strong { font-variant-numeric: tabular-nums; }
.pur-portions { display: grid; gap: 6px; margin-top: 10px; padding-left: 30px; }
.pur-portion {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
    padding: 8px 10px; border: 1px solid var(--att-line); border-radius: 10px; background: var(--att-field);
}
.pur-portion.is-changed { border-color: var(--att-red); }
.pur-portion-batch { font-size: 12px; color: var(--att-muted); min-width: 150px; }
.pur-portion-qty { font-size: 13px; font-variant-numeric: tabular-nums; }
.pur-portion-who { font-weight: 700; font-size: 13px; }
.pur-portion-who.is-open { color: var(--att-muted); font-weight: 600; }
.pur-portion-acts { margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px; }

/* Record purchase */
.pur-rec-line .att-card-body { display: grid; gap: 8px; }
.pur-rec-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 10px; }
.pur-rec-row .att-label { flex: 1 1 120px; min-width: 0; }
.pur-rec-row .att-label.pur-w2 { flex: 2 1 220px; }
.pur-rec-row[hidden] { display: none; }
.pur-preview { font-size: 12.5px; color: var(--att-muted); }
.pur-shares { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
.pur-shares .att-label { flex: 0 1 110px; }
.pur-picks summary { cursor: pointer; font-size: 12.5px; color: var(--att-muted); }
.pur-picks[open] summary { margin-bottom: 6px; }
.pur-rec-foot {
    position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; justify-content: flex-end;
    padding: 12px 0; background: var(--att-bg, #fff); border-top: 1px solid var(--att-line);
}
.pur-rec-foot span { margin-right: auto; font-size: 15px; }

/* One purchase */
.pur-change td { vertical-align: top; font-size: 13px; }
.pur-change tr.pur-changed td { background: var(--att-field); font-weight: 600; }
.pur-history { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; }
.pur-docs { display: flex; flex-wrap: wrap; gap: 8px; text-transform: capitalize; }

@media (max-width: 640px) {
    .pur-portions { padding-left: 0; }
    .pur-portion-acts { margin-left: 0; }
}
````

Patch `js/admin.js` (sign-in asks the server whether this account may buy; the tab, its drill-down, the focus sub-view and the nav gate):

````diff
diff --git a/js/admin.js b/js/admin.js
index 1e29469..88e64d6 100644
--- a/js/admin.js
+++ b/js/admin.js
@@ -77,6 +77,16 @@ function checkAuthState() {
                 // every screen (desktop + mobile). Empty/missing = full access.
                 currentAllowedModules = Array.isArray(data.allowedModules) ? data.allowedModules : null;
                 window.currentAllowedModules = currentAllowedModules;
+
+                // Purchasing (0097): the SERVER decides who may buy — the owner,
+                // admin accounts allowed Expenses, staff with the Buyer switch.
+                // The Requests → Purchasing tab follows it. Before 0097 is applied
+                // the call fails and the tab simply stays hidden.
+                window.currentCanBuy = false;
+                try {
+                    const { data: purMe } = await window.sbClient.rpc('pur_me');
+                    window.currentCanBuy = !!(purMe && purMe.can_buy);
+                } catch (_) { /* tab stays hidden */ }
             } catch (e) {
                 console.warn('Could not fetch user role:', e);
                 await auth.signOut();
@@ -2259,10 +2269,12 @@ const PRIMARY_NAV = [
     },
     // WorkMate Requests (0085/0086): workers and team leaders request
     // materials and tools in DAC'S WorkMate; the office processes them here.
-    // Owner + staff. Quantities only — no price, amount or cost anywhere.
+    // Owner + staff. Quantities only — no price, amount or cost anywhere —
+    // EXCEPT Purchasing (0097): buyers only (window.currentCanBuy), with prices.
     { id: 'requests', label: 'Requests', sub: 'Materials & Tools', defaultView: 'reqQueue',
       modules: [
         { view: 'reqQueue',    label: 'Queue',          icon: 'inbox' },
+        { view: 'reqPurchasing', label: 'Purchasing',   icon: 'shopping-cart' },
         { view: 'reqBatches',  label: 'Weekly batches', icon: 'calendar-days' },
         { view: 'reqTeams',    label: 'Teams',          icon: 'users' },
         { view: 'reqCatalog',  label: 'Catalogue',      icon: 'package-search' },
@@ -2271,6 +2283,8 @@ const PRIMARY_NAV = [
         // One request's detail: routable, highlighted under Requests, but
         // not a button in the secondary row (like Appointments' dashboard).
         { view: 'reqDetail',   label: 'Request',        icon: 'file-text', hidden: true },
+        // One purchase, opened from Purchasing (buyers only, like its tab).
+        { view: 'reqPurchase', label: 'Purchase',       icon: 'receipt', hidden: true },
       ]
     },
     // WorkMate My Work (0093/0094, Stage 1c): the office turns meeting notes
@@ -2339,11 +2353,20 @@ const _FOCUS_SUBVIEWS = {
     // Drill-down from the today list into one worker's day. Without this
     // an allowed_modules account can open the section but not any row.
     attendance: ['attWorker'],
-    // Drill-down from the queue into one request (also a hidden module).
-    requests: ['reqDetail'],
+    // Drill-downs: the queue into one request, Purchasing into one purchase
+    // (both also hidden modules).
+    requests: ['reqDetail', 'reqPurchase'],
     // Drill-downs from the Board / Meetings into one meeting or task.
     workplan: ['wpMeeting', 'wpTask'],
 };
+// Q3 = B (0097): an account focused on other sections may still BUY when it
+// has the Expenses section — the server (pur_me) says so. Without Requests
+// in its focus it gets Requests → Purchasing alone (and one purchase).
+const _PURCHASING_VIEWS = ['reqPurchasing', 'reqPurchase'];
+function _purchasingOnly() {
+    const focus = _activeFocus();
+    return !!(window.currentCanBuy && focus && !focus.includes('requests'));
+}
 // All views reachable inside the focused module(s) — used by the switchView guard.
 window.focusAllowedViews = function () {
     if (!Array.isArray(currentAllowedModules) || !currentAllowedModules.length) return [];
@@ -2353,6 +2376,7 @@ window.focusAllowedViews = function () {
         p.modules.forEach(m => views.push(m.view));
         (_FOCUS_SUBVIEWS[p.id] || []).forEach(v => views.push(v));
     });
+    if (_purchasingOnly()) _PURCHASING_VIEWS.forEach(v => views.push(v));
     return views;
 };
 // Landing view for the first focused module (e.g. 'pm' → 'pmProjects').
@@ -2390,6 +2414,13 @@ function _visibleNav() {
                 // older phone. The RPCs refuse staff too; this hides the tab.
                 return { ...p, modules: p.modules.filter(m => m.view !== 'attAppUpdates') };
             }
+            if (p.id === 'requests' && !window.currentCanBuy) {
+                // Purchasing shows prices and needs an account that may buy
+                // (0097: owner / admin with Expenses / staff with the Buyer
+                // switch). The server refuses everyone else; this hides it.
+                const hidden = ['reqPurchasing', 'reqPurchase'];
+                return { ...p, modules: p.modules.filter(m => !hidden.includes(m.view)) };
+            }
             if (role === 'staff' && p.id === 'pm') {
                 // Warranty Fund is peso amounts end to end and owner-only by
                 // RLS (0043) — same reasoning as Reimbursement above.
@@ -2402,9 +2433,17 @@ function _visibleNav() {
     // Module-focus: an account flagged with allowed_modules sees ONLY those
     // sections, on every screen size. Falls back to the full nav if the focus
     // list matches nothing (avoids an empty menu).
+    // An account allowed to buy whose focus lacks Requests keeps a Requests
+    // tab holding Purchasing only (Q3 = B; the server checks every call).
     const focus = _activeFocus();
     if (focus) {
-        const narrowed = nav.filter(p => focus.includes(p.id));
+        const buyOnly = _purchasingOnly();
+        const narrowed = nav
+            .filter(p => focus.includes(p.id) || (buyOnly && p.id === 'requests'))
+            .map(p => (buyOnly && p.id === 'requests')
+                ? { ...p, sub: 'Purchasing', defaultView: 'reqPurchasing',
+                    modules: p.modules.filter(m => _PURCHASING_VIEWS.includes(m.view)) }
+                : p);
         if (narrowed.length) nav = narrowed;
     }
     return nav;
@@ -2482,7 +2521,9 @@ function _buildTabsBar(activePrimaryId) {
         tabs.querySelectorAll('.portal-ptab').forEach(btn => {
             btn.addEventListener('click', () => {
                 const id = btn.dataset.primary;
-                const primary = PRIMARY_NAV.find(p => p.id === id);
+                // The visible section's landing view (a Purchasing-only Requests
+                // tab lands on Purchasing, not on the queue it cannot open).
+                const primary = nav.find(p => p.id === id) || PRIMARY_NAV.find(p => p.id === id);
                 if (primary) switchView(primary.defaultView);
             });
         });
````

Patch `admin.html` (stylesheet, views, scripts, `REQ_VIEWS`, titles; the receipt helper's cache-buster):

````diff
diff --git a/admin.html b/admin.html
index 488600a..dc48863 100644
--- a/admin.html
+++ b/admin.html
@@ -22,6 +22,7 @@
     <link rel="stylesheet" href="css/reimbursement-module.css">
     <link rel="stylesheet" href="css/attendance-admin.css">
     <link rel="stylesheet" href="css/requests-admin.css?v=20261012a">
+    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261016a">
     <link rel="stylesheet" href="css/workplan-admin.css?v=20261013a">
     <!-- Warranty Retention Register + Fund Styles -->
     <link rel="stylesheet" href="css/warranty-fund.css?v=20260803f">
@@ -2633,6 +2634,10 @@
         <div id="reqCatalogView"    class="content-view" style="display: none;"></div>
         <div id="reqHistoryView"     class="content-view" style="display: none;"></div>
         <div id="reqProjectsView"   class="content-view" style="display: none;"></div>
+        <!-- Purchasing (WorkMate Stage 2A-2, 0097) — js/purchasing-admin-*.js.
+             Buyers only; reqPurchase is one purchase, opened from Purchasing. -->
+        <div id="reqPurchasingView" class="content-view" style="display: none;"></div>
+        <div id="reqPurchaseView"   class="content-view" style="display: none;"></div>
         <!-- Work Plan (WorkMate My Work, 0093/0094) — rendered by js/workplan-admin-*.js.
              wpMeeting and wpTask are drill-downs from the Board and Meetings. -->
         <div id="wpBoardView" class="content-view" style="display: none;"></div>
@@ -5380,17 +5385,17 @@
 <!-- ══════════ SCRIPTS ══════════ -->
 <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
 <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
-<script src="js/supabase-config.js"></script>
+<script src="js/supabase-config.js?v=20261016a"></script>
 <script src="js/billing-allocation.js"></script>
 <script src="js/booking.js"></script>
 <!-- ?v= is a cache-buster, same convention as expenses-module.js below. Bump
      it whenever a change to this file must reach an already-open browser —
      admin.js carries PRIMARY_NAV, so a stale copy silently hides new tabs. -->
-<script src="js/admin.js?v=20261013a"></script>
+<script src="js/admin.js?v=20261016a"></script>
 <script src="js/print-utils.js"></script>
-<script src="js/receipt-storage.js?v=20261008a"></script>
+<script src="js/receipt-storage.js?v=20261016a"></script>
 <script src="js/expense-split-rows.js?v=20261015a"></script>
-<script src="js/expenses-module.js?v=20261015a"></script>
+<script src="js/expenses-module.js?v=20261016a"></script>
 <script src="js/overhead-module.js"></script>
 <script src="js/reimbursement-module.js"></script>
 <script src="js/construction-module.js"></script>
@@ -5404,6 +5409,10 @@
 <script src="js/requests-admin-setup.js?v=20261012a"></script>
 <script src="js/requests-admin-history.js?v=20261012a"></script>
 <script src="js/requests-admin-gallery.js?v=20261012a"></script>
+<script src="js/purchasing-admin-core.js?v=20261016a"></script>
+<script src="js/purchasing-admin-list.js?v=20261016a"></script>
+<script src="js/purchasing-admin-record.js?v=20261016a"></script>
+<script src="js/purchasing-admin-purchases.js?v=20261016a"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261013a"></script>
 <script src="js/workplan-admin-board.js?v=20261013a"></script>
@@ -6245,7 +6254,7 @@
     const PM_VIEWS   = ['pmProjects','pmWorkspace'];
     const QUOTE_VIEWS = ['quoteList','quoteEditor','quoteRevision'];
     const ATT_VIEWS   = ['attToday','attWorkers','attWorker','attProjects','attReports','attRewards'];
-    const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqHistory','reqProjects'];
+    const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqHistory','reqProjects','reqPurchasing','reqPurchase'];
     const WP_VIEWS    = ['wpBoard','wpMeetings','wpMeeting','wpTask'];
     const TITLES = {
         dashboard:        'Dashboard',
@@ -6289,6 +6298,8 @@
         reqCatalog:       'Item catalogue',
         reqHistory:       'Item history',
         reqProjects:      'Projects open to requests',
+        reqPurchasing:    'Purchasing',
+        reqPurchase:      'Purchase',
         wpBoard:          'Work Plan',
         wpMeetings:       'Meetings',
         wpMeeting:        'Meeting',
````

Patch `js/user-navigator.js` (the Buyer switch on staff rows, owner only):

````diff
diff --git a/js/user-navigator.js b/js/user-navigator.js
index fc66982..40b95c7 100644
--- a/js/user-navigator.js
+++ b/js/user-navigator.js
@@ -25,6 +25,9 @@
         return dup ? full + ' · ID ' + String(p.id).slice(0, 8) : full;
     }
     let _boqProjects     = [];
+    // Purchasing (0097): user_id → { is_buyer, can_buy, expenses_ok } for staff.
+    // Owner only — the server (pur_office_buyers / pur_set_buyer) refuses others.
+    let _buyers          = {};
     let _loading         = false;
     let _activeTab       = 'all';
 
@@ -94,6 +97,18 @@
             console.warn('UserNavigator: could not load employee users —', e.message);
         }
 
+        _buyers = {};
+        if (window.currentUserRole === 'owner' && window.sbClient) {
+            try {
+                const { data, error } = await window.sbClient.rpc('pur_office_buyers');
+                if (error) throw error;
+                (data || []).forEach(b => { _buyers[b.user_id] = b; });
+            } catch (e) {
+                // Before migration 0097 the switch simply does not show.
+                console.warn('UserNavigator: Buyer switch unavailable —', e.message || e);
+            }
+        }
+
         _loading = false;
         _showLoading(false);
 
@@ -140,6 +155,15 @@
             : `<button class="un-btn-toggle un-btn-activate"   onclick="unToggleStatus('${user.uid}','inactive')">Activate</button>`;
         // Owners sign no agreement, so the column says so instead of staying blank.
         const agreement = _empAgreementBadge(user) || '<span class="un-muted">—</span>';
+        // The Buyer switch (0097): staff with it on may buy in Requests →
+        // Purchasing and see purchase prices there. Owner only.
+        const b = user.role === 'staff' ? _buyers[user.uid] : null;
+        const buyerBtn = b
+            ? `<button class="un-btn-toggle ${b.is_buyer ? 'un-btn-activate' : 'un-btn-deactivate'}" title="${b.is_buyer
+                  ? (b.expenses_ok ? 'May buy in Requests → Purchasing. Click to turn off.' : 'Switch is on, but this account is not allowed the Expenses section, so it cannot buy.')
+                  : 'Click to let this staff member buy and see purchase prices in Requests → Purchasing.'}"
+                  onclick="unToggleBuyer('${user.uid}', ${b.is_buyer ? 'false' : 'true'})">Buyer: ${b.is_buyer ? 'On' : 'Off'}</button>`
+            : '';
 
         return `<tr data-uid="${user.uid}">
             <td><div class="un-user-cell">
@@ -160,11 +184,25 @@
                 <button class="un-btn-view" onclick="unOpenEditModal('${user.uid}','admin')">
                     <i data-lucide="pencil" style="width:13px;height:13px;"></i> Edit
                 </button>
+                ${buyerBtn}
                 ${toggleBtn}
             </div></td>
         </tr>`;
     }
 
+    // Turn a staff member's Buyer switch on or off (0097, owner only).
+    window.unToggleBuyer = async function (uid, on) {
+        try {
+            const { error } = await window.sbClient.rpc('pur_set_buyer', { p_user: uid, p_on: !!on });
+            if (error) throw error;
+            if (_buyers[uid]) _buyers[uid].is_buyer = !!on;
+            // Redraw with the current search/status filters kept.
+            if (typeof window.unFilterUsers === 'function') window.unFilterUsers(); else _renderTable(_allUsers);
+        } catch (e) {
+            alert('Could not change the Buyer switch: ' + ((e && e.message) || e));
+        }
+    };
+
     // The status chips set the (hidden) status select and refilter.
     window.unSetStatus = function (value) {
         const sel = document.getElementById('unStatusFilter');
````

Patch `js/expenses-module.js` (Project Control: staff send an owner-only correction or void to the owner; new error texts):

````diff
diff --git a/js/expenses-module.js b/js/expenses-module.js
index 73dc884..22e5e11 100644
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -2817,7 +2817,10 @@ function _purErrorText(err) {
         OWNER_APPROVAL_NEEDED: 'Moving a cost to another project needs the owner.',
         NOT_OFFICE:            'Only office accounts can record expenses.',
         NOT_ALLOWED:           'This account is not set up for Expenses.',
-        BUYER_REQUIRED:        'Phone purchasing needs the Buyer switch (not available yet).',
+        BUYER_REQUIRED:        'This needs an account that may buy (the owner, or staff with the Buyer switch).',
+        EXTRA_REASON_REQUIRED: 'This purchase covers a request and would now be more than the request needs — correct it in Requests → Purchasing, where you can give the reason.',
+        BAD_REQUEST_LINK:      'This purchase is linked to a request for another project — correct it in Requests → Purchasing.',
+        ALREADY_PENDING:       'A change to this purchase is already waiting for the owner.',
         PURCHASES_LIVE:        'It has purchases — void them first.',
         REASON_REQUIRED:       'Please give a reason.',
         BAD_STATE:             'This purchase was already voided.',
@@ -2869,31 +2872,54 @@ function _purAskReason(title, sub, okLabel) {
     });
 }
 
+// Staff: a change the server keeps for the owner (a completed project, or a
+// cost moved to another project) can be SENT to the owner instead (0097).
+function _purNeedsOwner(err) {
+    return window.currentUserRole === 'staff' && /OWNER_APPROVAL_NEEDED|COMPLETED_PROJECT/.test(String((err && (err.message || err)) || ''));
+}
+function _purConfirm(title, sub, okLabel) {
+    return new Promise(resolve => {
+        const ov = document.createElement('div');
+        ov.className = 'lcm-ov';
+        ov.innerHTML = `
+            <div class="lcm-card" style="max-width:420px;">
+              <div class="lcm-head"><div><h3 class="lcm-title">${_mvpEsc(title)}</h3><div class="lcm-sub">${_mvpEsc(sub)}</div></div>
+                <button type="button" class="lcm-x" data-pc-close aria-label="Close">&times;</button></div>
+              <div class="lcm-foot"><button type="button" class="lcm-btn" data-pc-close>Cancel</button>
+                <button type="button" class="lcm-btn primary" data-pc-ok>${_mvpEsc(okLabel)}</button></div>
+            </div>`;
+        const done = (v) => { ov.remove(); resolve(v); };
+        ov.onclick = e => { if (e.target === ov) done(false); };
+        ov.querySelectorAll('[data-pc-close]').forEach(b => b.onclick = () => done(false));
+        ov.querySelector('[data-pc-ok]').onclick = () => done(true);
+        document.body.appendChild(ov);
+    });
+}
+async function _purSendToOwner(purchaseId, kind, body, reason) {
+    const ok = await _purConfirm('Send to the owner?',
+        'Only the owner can make this change. The owner sees exactly this version and approves or rejects it in Requests → Purchasing → Owner approvals.',
+        'Send for approval');
+    if (!ok) return false;
+    const { error } = await window.sbClient.rpc('pur_request_change', { p_op: DacsReceipts.newId(), p_purchase: purchaseId,
+        p_kind: kind, p_body: body, p_reason: reason });
+    if (error) throw error;
+    showExpNotif('Sent to the owner for approval.', 'success');
+    return true;
+}
+
 // The purchase behind a purchase-made expense row, with its one line.
 // Null when the row is not from a purchase. `simple` = one line, no charges:
-// the only shape the Expenses form can correct.
+// the only shape the Expenses form can correct. Read through pur_entry_row
+// (0097): purchase tables are readable by buyers only, and this is all the
+// edit form needs — staff without the Buyer switch read nothing more.
 async function _purForRow(e) {
     if (!e || (!e.purchaseLineId && !e.purchaseChargeId)) return null;
-    const sb = window.sbClient;
-    let purchaseId = null, line = null;
-    if (e.purchaseLineId) {
-        const r = await sb.from('purchase_lines')
-            .select('id, purchase_id, line_no, folder_id, item_name, category, quantity, unit, gross_amount, in_inventory, min_stock')
-            .eq('id', e.purchaseLineId).single();
-        if (r.error) throw r.error;
-        line = r.data; purchaseId = line.purchase_id;
-    } else {
-        const r = await sb.from('purchase_charges').select('purchase_id').eq('id', e.purchaseChargeId).single();
-        if (r.error) throw r.error;
-        purchaseId = r.data.purchase_id;
-    }
-    const [p, lines, charges] = await Promise.all([
-        sb.from('purchases').select('id, status, purchase_date, date_time, supplier, receipt_total, notes, payment_method, docs').eq('id', purchaseId).single(),
-        sb.from('purchase_lines').select('id', { count: 'exact', head: true }).eq('purchase_id', purchaseId),
-        sb.from('purchase_charges').select('id', { count: 'exact', head: true }).eq('purchase_id', purchaseId),
-    ]);
-    if (p.error) throw p.error;
-    return { purchase: p.data, line, lineCount: lines.count || 0, simple: !!line && lines.count === 1 && (charges.count || 0) === 0 };
+    const { data, error } = await window.sbClient.rpc('pur_entry_row', {
+        p_line: e.purchaseLineId || null, p_charge: e.purchaseLineId ? null : e.purchaseChargeId });
+    if (error) throw error;
+    const lineCount = Number(data.line_count) || 0;
+    return { purchase: data.purchase, line: data.line, lineCount,
+             simple: !!data.line && lineCount === 1 && (Number(data.charge_count) || 0) === 0 };
 }
 
 // A purchase on a project with NO billing period (0096) is tied to the project
@@ -2914,9 +2940,10 @@ function _expNoPeriodSpent(folderId) {
 let _purReviewLines = new Set();
 async function _purLoadReviewFlags() {
     try {
-        const { data, error } = await window.sbClient.from('purchase_lines').select('id').eq('needs_funding_review', true);
+        // Ids only, through the server (0097: purchase tables are buyers-only).
+        const { data, error } = await window.sbClient.rpc('pur_review_lines');
         if (error) throw error;
-        _purReviewLines = new Set((data || []).map(r => r.id));
+        _purReviewLines = new Set(data || []);
         window.dispatchEvent(new Event('dacs:pur-review-flags'));
     } catch (err) { console.warn('purchase review flags:', err); }
 }
@@ -2925,6 +2952,8 @@ window.expPurNeedsReview = id => !!id && _purReviewLines.has(id);
 // Set while the Edit Expense modal is correcting a purchase (else null).
 let _editingPurchase = null;
 let _purEditOpId = null;
+// The correction last sent, so staff can forward it to the owner (0097).
+let _purLastBody = null;
 
 // All rows in ONE insert (all-or-nothing). If this submission already landed
 // (a retry after the response was lost), the unique index answers 23505 —
@@ -3056,7 +3085,14 @@ async function deleteExpense(id) {
             showExpNotif('Purchase voided.', 'success');
             refreshOvAllData();
             _purLoadReviewFlags();
-        } catch (err) { showExpNotif('Error: ' + _purErrorText(err), 'error'); }
+        } catch (err) {
+            if (_purNeedsOwner(err)) {
+                try { await _purSendToOwner(pur.purchase.id, 'void', null, reason); }
+                catch (e2) { showExpNotif('Error: ' + _purErrorText(e2), 'error'); }
+                return;
+            }
+            showExpNotif('Error: ' + _purErrorText(err), 'error');
+        }
         return;
     }
     if (!await showDeleteConfirm('Delete this expense?')) return;
@@ -4470,6 +4506,7 @@ async function _purSaveCorrection() {
                       min_stock: Number(pur.line.min_stock) || 0 }],
             charges: [],
         };
+        _purLastBody = body;
         const { data, error } = await window.sbClient.rpc('pur_correct', { p_op: _purEditOpId, p_purchase: pur.purchase.id, p_body: body, p_reason: reason });
         if (error) throw error;
         _purEditOpId = null;
@@ -4481,7 +4518,18 @@ async function _purSaveCorrection() {
         refreshOvAllData();
         _purLoadReviewFlags();
         closeExpModal('editExpenseModal');
-    } catch (err) { showExpNotif('Error: ' + _purErrorText(err), 'error'); console.error(err); }
+    } catch (err) {
+        if (_purNeedsOwner(err) && _purLastBody) {
+            try {
+                if (await _purSendToOwner(pur.purchase.id, 'correct', _purLastBody, reason)) {
+                    _purEditOpId = null; _editingPurchase = null; _editingExpenseId = null;
+                    closeExpModal('editExpenseModal');
+                }
+            } catch (e2) { showExpNotif('Error: ' + _purErrorText(e2), 'error'); }
+            return;
+        }
+        showExpNotif('Error: ' + _purErrorText(err), 'error'); console.error(err);
+    }
     finally { showExpLoading('editExpenseBtn', false); }
 }
 
````

Patch `js/supabase-config.js` (review R13: a `purchases/` receipt is never given a signed link — it is downloaded with the viewer's own session, so Storage checks the Buyer rule on every view; every other folder keeps its signed links):

````diff
diff --git a/js/supabase-config.js b/js/supabase-config.js
index 2343bdf..66c3d1f 100644
--- a/js/supabase-config.js
+++ b/js/supabase-config.js
@@ -773,6 +773,16 @@ window.dacsSignedUrl = async function (urlOrPath, expiresIn = 3600) {
   let path = String(urlOrPath || '');
   const m = path.match(DACS_PUB_UPLOADS_RE);
   if (m) path = decodeURIComponent(m[1]);
+  // Purchase receipts (0097, buyers only) never get a signed link: a signed
+  // URL stays valid until it expires even after the Buyer switch is turned
+  // off. Download with this account's own session instead — Storage checks
+  // uploads_can_read on EVERY download — and hand back a blob: copy that
+  // lives only in this page (and the tab it opens). Never cached.
+  if (path.startsWith('purchases/')) {
+    const { data, error } = await sb.storage.from('uploads').download(path);
+    if (error) throw error;
+    return URL.createObjectURL(data);
+  }
   const hit = _dacsSignCache.get(path);
   if (hit && hit.exp > Date.now()) return hit.url;
   const { data, error } = await sb.storage.from('uploads').createSignedUrl(path, expiresIn);
````

- [ ] **Step 4: Run everything**

Run: `for f in js/purchasing-admin-*.js js/admin.js js/user-navigator.js js/expenses-module.js js/supabase-config.js; do node --check "$f"; done` → Expected: no output.
Run: `npm test` → Expected: exit 0; `purchasing-admin` 24 passed.

- [ ] **Step 5: Commit (the user)** — suggested message: `2A-2 web: Requests → Purchasing (shopping list, record, purchases, owner approvals), Buyer switch, send-to-owner in Project Control`.

---

### Task 3: Documentation

**Files:** Modify `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `.github/workflows/ci.yml`, `docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md`. `docs/DATABASE_SCHEMA.md` is stored with CRLF line endings: apply its hunk with the Edit tool (keep CRLF), not `git apply`.

- [ ] **Step 1: Apply the patches**

````diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
index 7c98f2d..d3e57f7 100644
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -1052,4 +1052,27 @@ One recording operation for every purchase, shared by Dacs Web (Expenses → Add
 | `pur_replace(p_op, p_purchase, p_body, p_reason)` | A new version with a different number of lines: the old purchase is voided (`replaced_by`) and the new one recorded in ONE transaction; stock the old one moved is carried over to the new lines of the same item, never added twice. Same owner-only rules as a correction |
 | `pur_live_purchases(p_folder, p_period)` | How many live purchases touch this project or any of its Additional Works jobs (any line, even discounted to zero) or this period — asked by Dacs Web before deleting anything |
 | `folders_purchase_delete_guard`, `projects_purchase_delete_guard` (triggers) | Refuse deleting a project or period with a live purchase, BEFORE its cascade removes anything (`PURCHASES_LIVE`) |
-| `pur_reader()` | The read rule of every purchase table: an active owner/staff account allowed the Expenses section (the same as recording) |
+| `pur_reader()` | The read rule of every purchase table: an active owner/staff account allowed the Expenses section (the same as recording). **Narrowed by 0097** to those who may buy — see below |
+
+## Purchasing tab and Buyer switch (0097) — WorkMate Stage 2A-2
+
+The office side of buying: who may buy, who is buying which part of a request, and what each purchase covered. Spec `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md`; answers `docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md`; plan `docs/superpowers/plans/2026-10-16-workmate-stage2a2-purchasing-office.md`. Nothing here changes how a purchase becomes Spent (0096). RLS: SELECT policies only; every write is a function.
+
+| Object | Purpose |
+|---|---|
+| `pur_buyers` (`user_id` PK, `owner_id`, `is_buyer`, `updated_by`, `updated_at`) + `pur_buyer_events` | The per-staff **Buyer** switch and its history. Set only by the main owner (`pur_set_buyer`), for their own staff |
+| `pur_buyer()` / `pur_can_buy(user, owner)` | Who may BUY: an active owner account, or that owner's active staff with the switch on — in both cases allowed the **Expenses** section (an account focused elsewhere, e.g. `admin-pm@`, cannot), inside its own company. Linking a purchase line to a request, picking portions or taking a portion over needs it **whatever the source** — the Expenses form included |
+| `pur_reader()` (0096, narrowed) | Now `= pur_buyer()`: purchase rows (`purchases`, lines, charges, shares, history, covers) are read only by those who may buy. Staff without the switch read none — Project Control's entry reads its one line through `pur_entry_row` |
+| `suppliers` (`owner_id`, `name`, `branch`, `contact`, `active`; unique per company by name + branch) | The supplier list. Buyers read and add (`pur_suppliers`, `pur_save_supplier`). Old purchases keep their typed supplier text |
+| `pr_line_portions.buyer_id` / `assigned_by` / `assigned_at` | Who is buying a portion (null = unassigned). `pur_assign_portion(portion, buyer, quantity, note)`: the owner assigns or reassigns anything; a buyer claims an unassigned portion ("I'll buy this"), gives one to another buyer, or releases their own. Part of a portion is split off; a partly bought portion keeps its bought part with whoever bought it. Logged in `pr_events` (`portion_claimed` / `portion_assigned` / `portion_released`) |
+| `purchases.bought_by` / `supplier_id`; `source` adds `purchasing` | Who actually bought (the encoder stays `recorded_by`; only the owner records for someone else) and the supplier picked from the list |
+| `purchase_lines.request_line_id`, `portion_picks`, `covered_qty`, `extra_qty` / `extra_reason` / `extra_location`, `unit_check` (`none`/`pending`/`confirmed`) / `unit_covers` / `unit_checked_by` / `unit_checked_at` / `unit_note`, `unplanned_reason`, `substitute` / `substitute_reason` | A line's request (same project and work), what it covered, the extra beyond Still to buy (reason and location required; the location — same project or warehouse — never moves the cost), a different unit or a **substitute** (an important specification differs; reason required) waiting for an office check, or the reason for a purchase with no request |
+| `purchase_line_covers` (`line_id` → cascade, `request_line_id`, `portion_id` → set null, `buyer_id`, `quantity`) | Which portions a line covers. Rebuilt from the stored lines by `pur_cover_lines` whenever the purchase is recorded, corrected, replaced, voided or unit-checked — in the same transaction as its expense rows. **Picked portions are authoritative** (only they are covered; the rest is extra). Otherwise a line's earlier covers (`pur_cover_history`) come first and other portions are covered only for quantity a change ADDS — a price fix never moves coverage to another week. Only RECORDED purchases count (`pr_portion_bought`, `pr_line_bought`), so Bought is never doubled and Still to buy never negative |
+| `pur_check_unit(op, purchase, line_no, covers, note)` | The office confirms how much a different-unit or substitute line covers, in the request's unit. Never by its own buyer or recorder; history kind `unit_checked`; counts as a change to the purchase (`updated_at`) |
+| `purchase_change_requests` (`purchase_id`, `kind` `correct`/`replace`/`void`, `body`, `reason`, `base_updated_at`, `base_doc`, `requested_by`, `status` `pending`/`approved`/`rejected`/`withdrawn`/`stale`, `decided_by`, `decision_note`, `result`) | A staff change only the owner may make (another project, a completed project). One pending per purchase. `base_doc` = the purchase (`pur_doc`) as the requester saw it; `pur_decide_change` applies only while the purchase still reads exactly the same (any correction, unit check or receipt → `stale`) and runs the very same `pur_correct` / `pur_replace` / `pur_void` as the owner. Staff without the switch cannot ask for a new request link (`pur_links_changed`) |
+| `pur_change_requests(scope)` | Each request with `base`, `current` and `proposed` in `pur_review_doc`'s words (every header field, line, pick, receipt and fee split — the automatic split when none is given) and `changed_since` |
+| `pur_shopping_list(batch, folder, scope)` | Open request lines with something still to buy, with their portions and who is buying each. Quantities and names only |
+| `pur_purchases(...)`, `pur_purchase(id)`, `pur_buyer_options()`, `pur_me()`, `pur_office_buyers()`, `pur_withdraw_change(id)` | What the Purchasing tab and the Buyer switch read |
+| `pur_entry_row(line, charge)`, `pur_review_lines()` | Project Control's data entry for every account that may record: the ONE purchase line behind an expense row with its purchase header and line / charge counts; the ids of lines flagged for office review. Nothing else |
+| Storage `uploads/purchases/<company>/<yyyy-mm>/<uuid>.jpg` | One receipt per purchase, read and written only by `pur_buyer()` of that company — not by non-buyer staff, workers, clients or partners. Dacs Web never signs a link for this folder: it downloads with the viewer's session, so Storage checks the rule on every view (`supabase-config.js` §11b). `receipt_uploads` accepts kind `purchase` |
+| Changed 0085/0086/0096 functions | `pr_apply_quantity` (bought quantity is protected like arranged: reduced only by flagging), `pr_office_move_portion` (`BOUGHT`), `pur_reader` (buyers only), `pur_actor_owner` (sources `purchasing`/`workmate` need the switch), `pur_store`, `pur_insert` (6 arguments), `pur_correct` (keeps a line's request link when the body leaves it out — Project Control's form — and its covers' portions), `pur_replace` (voids first, keeps covers' portions), `pur_doc`, `pur_header_ok`, `pur_body_keys` / `pur_stored_keys` (`pr_line:` locks) |
````

````diff
diff --git a/docs/ARCHITECTURE.md b/docs/ARCHITECTURE.md
index af4baef..022975e 100644
--- a/docs/ARCHITECTURE.md
+++ b/docs/ARCHITECTURE.md
@@ -130,6 +130,7 @@ Also note: **`projects` means billing period**, not project. Read it that way ev
 | AI | `ai-summary.js`, `ai-assistant.js` | Folder briefings, health check. Every request carries the user's session and passes the `ai_authorize` gate (`0095`): owner/staff only, with per-feature size and rate limits |
 | Attendance | `attendance-admin.js` | Construction worker Time In / Time Out (`0050`). **The worker client is a separate native Android app** (Kotlin + Compose, repo `Documents/Dacs Attendance`), **not** the Bubblewrap TWA in `android/` — that one wraps the *client portal* and is untouched. This module is the admin half only. Today's attendance (a LEFT JOIN against active workers, so a worker with no row shows as `No record` rather than vanishing), worker detail with both photos, **worker management** (`attWorkers` — the roster including **deactivated** workers, which Today deliberately hides; deactivating blocks sign-in via `attendance-signin` and is the only route back, so that screen must never filter them out. Shows `email`, which Today does not select, because two workers can share a display name and the email is the only thing that tells them apart), **creating a worker** (the `attOpenNewWorker` modal on that same screen — mints the auth account through the shared `adminCreateUser` helper and the `admin-create-user` Edge Function, never from the browser; `kind` is always `admin` and the role list is **worker / teamLeader only**, because staff, engineer and owner accounts belong to Users → Navigator and a second, less-guarded route to a privileged account is exactly what this must not become. `worker_no` is left out of the payload on purpose — `profiles_worker_no_trg` (0050) assigns it from `worker_no_seq`; `position` is written by a follow-up update because the Edge Function builds its profile row from a fixed whitelist. Terms are **not** pre-signed here: the worker accepts them in the Android app), the projects picker list (**deactivate, never delete** — records reference the project id), and reports with CSV export. The report roll-up and CSV escaping are pure functions guarded by `tests/attendance.test.js`, which extracts them from the live source. **Hours here are never a pay figure** and no rate column exists — do not add one. **Deliberately isolated** like Reimbursement, Warranty Fund and Quotations: no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Attendance hours are **not** the basis of pay — labour is pakyaw, capped by `labor_contracts.agreed_amount`. **One peso column exists** since 0066 — `attendance_weekly_rewards.amount`, a reported figure that creates no accounting entry and must never be made to; this line previously said there was none, and that the staff amount-hiding rule therefore did not apply. Whether staff should see that amount is undecided; it is currently visible to them, and the payroll CSV they work from depends on it. Workers write only through the `attendance_time_in` / `attendance_time_out` RPCs; they hold no insert or update policy. **Closing a forgotten Time Out** (`0061`) is the one admin write: `attendance_abandon()` sets status `abandoned` plus a `abandoned_by`/`abandoned_at`/`abandoned_note` trail, and **invents no hours** — `timeout_at` and `total_minutes` stay null, so the day still reports `—`. It goes through an RPC even though owner/staff already hold an update policy, because `abandoned_at` must be the server's `now()` and `abandoned_by` must be `auth.uid()`; a browser-supplied trail is one the caller chose. Guarded against closing a `complete` record, closing twice, and closing **today's** date (that worker is probably on site, and `attendance_time_out` only closes rows on `working`). Surfaced in A2 and in A6's **open-records panel** — the only place a record stuck since August becomes visible, because A1 shows one day at a time |
 | Requests | `requests-admin-core.js`, `requests-admin-queue.js`, `requests-admin-detail.js`, `requests-admin-setup.js`, `requests-admin-history.js`, `requests-admin-gallery.js` | The office half of **DAC'S WorkMate Requests** (`0085` tables, `0086` office RPCs). Workers and team leaders request materials and tools in the phone app; owner and staff process them here: the **queue** (urgent first, then by weekly batch — Saturday 12:00 noon Manila cutoff), one request's **detail** (mark portions arranged, move an unarranged portion to another batch, resolve a worker's reduction of arranged quantity as *order reduced* or *kept as surplus*, change or cancel an item with a reason, resolve an offline-edit conflict, match an unlisted item to the catalogue, private photos via signed URLs, full history), **weekly batches** (only purchasing/delivery dates change), **teams** (a leader needs the Team Leader role *and* the assignment), the **catalogue** (deactivate, never delete; since `0092` an item used in any request keeps its **kind and unit** — the form locks both and the server refuses `ITEM_IN_USE`) and **projects** (*Allow requests*). Since `0090` (Stage 1b, Find Previous Item): catalogue **aliases** and **brand** (search aids, not identity), a per-project **Item history** switch (separate from *Allow requests*, survives completion), and the **Item history** view — search items with their dated history, add or retire a **historical reference** (creates no expense, stock or purchase), and manage reviewed **product photos** in the private `item-gallery` bucket (`<company>/<item>/<uuid>.jpg`, re-encoded in the browser, three-tick checklist, cover, retire — never deleted); **Photos to review** publishes a COPY of a worker's private request photo or keeps it private. A request line shows the Request Again source (`ref_label`). **Every write is an RPC** — the browser holds no write policy. **No money anywhere**: quantities only, so staff see all of it. A project or Additional Works job with requests **cannot be deleted** (`deleteFolder` / `deleteChild` ask `pr_folder_request_count` first) — complete it instead. Pure helpers are guarded by `tests/requests-admin.test.js`; the migration by `tests/workmate-requests-office.test.js`. Workers and team leaders can no longer sign in to this portal (`ADMIN_ROLES`) |
+| Purchasing | `purchasing-admin-core.js`, `purchasing-admin-list.js`, `purchasing-admin-record.js`, `purchasing-admin-purchases.js`, `css/purchasing-admin.css` | WorkMate Stage 2A-2 (`0097`): **Requests → Purchasing**, for accounts the server lets buy (owner, admin accounts allowed Expenses, staff with the **Buyer** switch — set by the owner in Users → Navigator). An account focused on Expenses but not Requests still gets a Requests tab holding Purchasing alone (`_purchasingOnly` in `admin.js`). The **shopping list** (Needed · Bought · Still to buy per weekly-batch portion, who is buying each — "I'll buy this", assign, release, mark arranged), **Record purchase** (one receipt, many lines and projects, linked to their request portions — optionally picked per weekly portion, and then only those are covered — extras with a reason, substitutes with a reason and an office check, Unplanned lines, delivery fees / discounts, receipt photos in the buyer-only `purchases/` folder, kept in the form state so a redraw keeps them and a replacement is uploaded), **Purchases** (one purchase: covers, unit / substitute check, correct, void, history; receipts open through an authenticated download, never a signed link) and **Owner approvals** (staff changes only the owner may make, shown field by field — as asked vs asked for — and not approvable once the purchase changed). Shows prices — the one Requests screen that does. Every write is a `pur_*` RPC through the same recording operation as Expenses / Project Control (0096). Project Control's edit and void send owner-only staff changes for approval, and read the purchase behind a row through `pur_entry_row` (`expenses-module.js`) — purchase tables are buyers-only. Pure helpers: `tests/purchasing-admin.test.js`; migration: `tests/purchasing-server.test.js` + `npm run test:sql` |
 | Work Plan | `workplan-admin-core.js`, `workplan-admin-form.js`, `workplan-admin-board.js`, `workplan-admin-task.js`, `workplan-admin-meetings.js` | The office half of **DAC'S WorkMate My Work** (`0093`, `0094`; plan `docs/superpowers/plans/2026-10-13-workmate-stage1c2-work-plan-office.md`). Owner and staff turn **meeting notes** into tasks — **AI drafts** through the `dacs-ai` worker (gated by `ai_authorize`, `0095`) or by hand — and review each in the **task form**: an AI name is filled in only on one exact match, otherwise the field reads *Needs your choice* and Save refuses. **Publish** sends tasks and shared notes to chosen people (default: everyone assigned in that meeting). The **Board** groups tasks under the office lists (check, blocked, not acknowledged 24 h, overdue, live, drafts/proposals, completed). One **task** shows who read which version, problems (cleared by the office with a note), photos (private `task-photos`), history, and approve / send back / reopen / cancel-decline. On a published task the **server raises the version** for any people, team or date change, and for wording unless marked a minor spelling correction (`0094`). Edits keep links and helpers the office did not remove, including links to tasks completed long ago. Unsaved meeting notes, shared notes and recipients survive redraws. **No money** — staff see all of it. Tests: `tests/workplan-admin.test.js`, `tests/workmate-office-server.test.js`, `tests/ai-worker.test.js`; live: `supabase/tests/1c2_acceptance.sql`, `1c2_ai_gate.sql` |
 
 **Project Control is compiled React.** See the build trap in §8.
````

````diff
diff --git a/CLAUDE.md b/CLAUDE.md
index a8ee494..eedb55c 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -103,6 +103,19 @@ Profit   = Earned − Spent
   projects or from warehouse stock is **main owner only**. Workers and team leaders never see
   prices, receipts or payments. (Approved 2026-10-14; spec
   `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md`.)
+- **Buying a request (0097).** The Buyer switch is `pur_buyers`, set by the main owner only;
+  who may buy is the server's `pur_buyer()` (owner / admin allowed Expenses / Buyer staff, own
+  company). **Bought is never a counter**: `purchase_line_covers` is rebuilt from the stored
+  purchase lines by `pur_cover_lines` on every record / correct / replace / void, and only
+  recorded purchases count — so Still to buy is never negative. Actual quantity, quantity
+  covering the request and extras stay separate; a different unit counts only after an
+  audited office check (`pur_check_unit`). An extra's location (project / warehouse) never
+  moves its cost — cost moves are 2C, main owner only. Purchase receipts live in the
+  buyer-only `purchases/` storage folder and are never given a signed link.
+  Linking a purchase to a request needs the Buyer switch **whatever the source**; picked
+  portions are the only ones covered, and a correction keeps the portions a line covered.
+  Purchase rows are readable by buyers only — Project Control reads its one line through
+  `pur_entry_row`; never add a direct purchase-table read for staff.
 - **Petty cash, personal advances, supplier refunds and supplier credits stay outside Spent,
   Earned and Profit.** Issuing, returning or repaying that money never creates an expense.
   Project purchase costs enter Material/Spent once, after server acceptance through the shared
````

````diff
diff --git a/AGENTS.md b/AGENTS.md
index 7717471..23793de 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -83,6 +83,19 @@ Profit   = Earned − Spent
   projects or from warehouse stock is **main owner only**. Workers and team leaders never see
   prices, receipts or payments. (Approved 2026-10-14; spec
   `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md`.)
+- **Buying a request (0097).** The Buyer switch is `pur_buyers`, set by the main owner only;
+  who may buy is the server's `pur_buyer()` (owner / admin allowed Expenses / Buyer staff, own
+  company). **Bought is never a counter**: `purchase_line_covers` is rebuilt from the stored
+  purchase lines by `pur_cover_lines` on every record / correct / replace / void, and only
+  recorded purchases count — so Still to buy is never negative. Actual quantity, quantity
+  covering the request and extras stay separate; a different unit counts only after an
+  audited office check (`pur_check_unit`). An extra's location (project / warehouse) never
+  moves its cost — cost moves are 2C, main owner only. Purchase receipts live in the
+  buyer-only `purchases/` storage folder and are never given a signed link.
+  Linking a purchase to a request needs the Buyer switch **whatever the source**; picked
+  portions are the only ones covered, and a correction keeps the portions a line covered.
+  Purchase rows are readable by buyers only — Project Control reads its one line through
+  `pur_entry_row`; never add a direct purchase-table read for staff.
 - **Petty cash, personal advances, supplier refunds and supplier credits stay outside Spent,
   Earned and Profit.** Issuing, returning or repaying that money never creates an expense.
   Project purchase costs enter Material/Spent once, after server acceptance through the shared
````

````diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index e38633e..42f20d2 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -16,8 +16,10 @@
 #
 #   3. sql    — `npm run test:sql`: migration 0096's money rules on PostgreSQL
 #               in memory (PGlite), then two sessions at once on a throwaway
-#               real PostgreSQL (embedded-postgres). It installs those test
-#               tools into supabase/tests only — never into the app.
+#               real PostgreSQL (embedded-postgres); the same 0096 tests with
+#               0097 on top; then 0097's purchasing rules and races. It
+#               installs those test tools into supabase/tests only — never
+#               into the app.
 #
 # Until 2026-09-27 this ran only 3 of the 9 suites by name, so a new suite
 # added to package.json never reached CI. Running `npm test` keeps the two
````

````diff
diff --git a/docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md b/docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md
index 481b6ff..0103d93 100644
--- a/docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md
+++ b/docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md
@@ -2,7 +2,7 @@
 
 Date: 16 October 2026
 
-Status: **Open — for the owner to answer.** Nothing here is built. The implementation plan is written after these answers.
+Status: **Answered 16 October 2026** — all recommended (A) except **Q3 = B, Q7 = B and Q13 = B**, plus six rules (below). Implementation plan: [2A-2 plan](../plans/2026-10-16-workmate-stage2a2-purchasing-office.md).
 
 Related: [Mobile Purchasing spec](2026-09-30-workmate-mobile-purchasing-design.md) · [Stage 2 questions (all answered 12 Oct)](2026-10-12-workmate-stage2-questions.md) · [2A-1 plan, as built](../plans/2026-10-14-workmate-stage2a1-purchase-recording.md)
 
@@ -128,3 +128,22 @@ Answer:
 
 1. I write the 2A-2 implementation plan (server migration + Purchasing tab + tests), with every answer above built in.
 2. You review the plan, then the build runs task by task with reviews, like 2A-1.
+
+---
+
+## Answers (16 October 2026)
+
+All recommended except:
+
+- **Q3 = B** — an admin account focused on other sections may buy **if it also has the Expenses section** (inside its own account scope).
+- **Q7 = B** — link each purchase line to the **exact portion**.
+- **Q13 = B** — build the **approval queue now** (staff submit → the owner approves in a list).
+
+Rules to include in the plan (the owner's words):
+
+1. Q2's "no prices" applies to Purchasing. Preserve the approved Project Control data-entry and Materials/Labor list exceptions for staff.
+2. Link purchases to their exact assigned portions automatically where possible. Buying 6 of 10 leaves the remaining 4 assigned until explicitly released. Reassignment must preserve who bought earlier quantities.
+3. Keep actual purchased quantity, quantity covering the request, and extras separate. "Still to buy" cannot become negative. Different-unit purchases count toward coverage only after an audited office confirmation.
+4. A warehouse destination for project-owned extras records their location; it must not silently remove their cost from the original project. Cost moves follow the owner-approved 2C rules.
+5. Recording, correcting, replacing or voiding a purchase must update its request coverage and expense rows together, without duplication.
+6. Buyer permissions and receipt access must be enforced on the server within the correct company and account scope. Workers and team leaders receive quantity information only.
````

- [ ] **Step 2: Run** `npm test` → Expected: exit 0.

- [ ] **Step 3: Commit (the user)** — suggested message: `2A-2 docs: schema, architecture, Bought rule in CLAUDE/AGENTS, answers`.

---

### Task 4: Live — apply, verify, browser checks (with the user)

The Supabase connector must be authorized. **Ask before every production call.** Never edit live data by SQL; the office acts in Dacs Web. Never print the DB password or connection string.

- [ ] **Step 1: Dry run on live, rolled back.** MCP `execute_sql`, in **one** call: `begin;` + the full `0097_purchasing_office.sql` + the body of `2a2_acceptance.sql` without its own `begin;` / `rollback;` + `rollback;`. Expected: `2a2 acceptance: all checks passed`. Then `select to_regclass('public.pur_buyers')` → `null`.
- [ ] **Step 2: Apply.** With the user's go-ahead, MCP `apply_migration` name `0097_purchasing_office`. Verify:
  - `select count(*) from pg_proc where proname in ('pur_me','pur_buyer','pur_can_buy','pur_set_buyer','pur_assign_portion','pur_cover_lines','pur_check_unit','pur_request_change','pur_decide_change','pur_shopping_list','pur_purchases','pur_purchase','pur_cover_history','pur_links_changed','pur_review_doc','pur_entry_row','pur_review_lines')` → 17;
  - `select count(*) from pg_proc where proname = 'pur_insert'` → 1 (the 4-argument version is gone);
  - `select to_regclass('public.purchase_line_covers'), to_regclass('public.purchase_change_requests'), to_regclass('public.suppliers')` → three names;
  - `select has_function_privilege('anon', 'pur_shopping_list(uuid,uuid,text)', 'execute')` → false;
  - `select prosrc like '%return pur_buyer();%' from pg_proc where proname = 'pur_reader'` → true (purchase rows buyers-only, R3);
  - `select has_function_privilege('authenticated', 'pur_entry_row(uuid,uuid)', 'execute'), has_function_privilege('authenticated', 'pur_cover_lines(uuid,uuid,jsonb)', 'execute')` → true, false.
- [ ] **Step 3: Live acceptance.** Run `supabase/tests/2a2_acceptance.sql` through MCP `execute_sql` → `2a2 acceptance: all checks passed`; then `supabase/tests/2a1_acceptance.sql` → `2a1 acceptance: all checks passed` (2A-1 unchanged).
- [ ] **Step 4: Push the web change** (the user). Only after Step 2 (R15).
- [ ] **Step 5: Browser checks** on `dacs-company.vercel.app/admin.html` (Ctrl+Shift+R first). Test project **"ZZ 2a2 browser"** with an October billing period, and a request for it made from the test phone (W-0007) with four lines: **ZZ cement 10 bag**, **ZZ hinge 24 pcs**, **ZZ sand 10 bag** and **ZZ Boysen paint 2 gal**.

| # | Who | Action | Expected |
|---|---|---|---|
| C1 | Staff (switch off) | Look at Requests | No **Purchasing** tab. Users → Navigator is not theirs. |
| C2 | Owner | Users → Navigator: **Buyer: Off → On** on the staff row | Button reads **Buyer: On**. |
| C3 | Staff | Reload; Requests → **Purchasing** | The tab shows; the two ZZ lines show Needed 10 / 24, Still to buy 10 / 24, **Unassigned**. |
| C4 | Staff | **I'll buy this** on ZZ cement | Buyer reads **You**. |
| C5 | Owner | Same portion: **Reassign…** to staff, quantity **4** | Two portions: 6 Unassigned, 4 the staff member's. |
| C6 | Staff | Tick ZZ cement → **Record purchase**: quantity 6, ₱1,500, supplier **+ New supplier** "ZZ Hardware", a receipt photo | Saved. List: **Bought 6 · Still to buy 4**; the 4 stay with the staff member. Project Control → ZZ 2a2 browser Materials ₱1,500. |
| C7 | Staff | Record ZZ cement again: quantity 6, ₱1,500 — leave the reason empty, then fill "sold in sixes", Extra goes to **Warehouse** | First refused with the extra message; then saved. **Still to buy 0**, **Extra 2**. Materials ₱3,000 (the extra's cost stays on the project). |
| C8 | Staff | ZZ hinge: quantity **2**, unit **box**, ₱900 | Preview says different unit; saved; list shows **Unit check waiting**, Still to buy 24. |
| C9 | Staff | Purchases → that purchase → **Check unit…** | Refused: someone else must check. |
| C10 | Owner | Same: Covers **24**, "2 boxes of 12" | ZZ hinge **Bought 24 · Still 0**; history "Different unit checked". |
| C11 | Staff | Project Control → ZZ 2a2 browser → Materials → Edit the ₱1,500 cement row → ₱1,560, reason | Saved; Purchasing still shows the cement line Bought 10 (link kept). |
| C12 | Owner | Mark ZZ 2a2 browser **completed** | — |
| C13 | Staff | Project Control → Void a ZZ row | "Send to the owner?" → sent. Purchasing → **Owner approvals** shows it. |
| C14 | Owner | Owner approvals → **Approve** | The purchase is void; Still to buy goes back up; the request shows "approved". |
| C15 | Owner | Users → Navigator: **Buyer: On → Off**; staff reloads | Tab gone. A receipt tab the staff member opened at C6 shows nothing once reloaded, and there is no link to reopen (R13). |
| C16 | Owner | **Buyer: Off → On** again; un-mark ZZ 2a2 browser completed | — |
| C17 | Staff | Tick **ZZ sand** → Record purchase: quantity **6**, open **Weekly portions**, enter **4** in this week's portion | Preview: "Covers 4 of 4 in the portions picked · Extra 2". Save asks why; with "sold in sixes" it saves. List: **Bought 4 · Still to buy 6**, Extra 2 (review 2). |
| C18 | Staff | Tick **ZZ Boysen paint** → change the item to **ZZ Davies paint**, Save; then choose **Substitute** and Save; then give the reason "Boysen out of stock; foreman agreed" and Save | First refused ("The item name differs from the request…"), then refused for the reason, then saved. List: **Office check waiting**, Still to buy 2 (R14). |
| C19 | Owner | Purchases → that purchase → **Check substitute…**: covers **2**, "same coverage per gallon" | ZZ Boysen paint **Bought 2 · Still 0**; history "Office check (different unit or substitute)". |
| C20 | Staff | Record purchase (Unplanned line "ZZ tape" on ZZ 2a2 browser): choose a **Delivery receipt** photo, then **+ Add a line** (the form redraws), remove that line, then choose a **different** photo and Save | After the redraw the first photo is still listed as chosen; the second choice replaces it; the saved purchase opens the **second** photo (review 5). |
| C21 | Staff → Owner | Staff: correct the ZZ tape purchase — quantity **3** and the line moved to another project → **Send to the owner**. Owner: Owner approvals | Every field listed "When asked / Asked for"; **Quantity** and **Project / warehouse** marked changed; Approve applies it (review 3). |
| C22 | — | Only if an admin account focused on Expenses (not Requests) exists: sign in as it | A Requests tab with **Purchasing only**; it opens (review 4). Skip if no such account exists — do not change a live account's sections for this. |
| C23 | Owner → Staff | Owner: **Buyer: On → Off**. Staff: Project Control → ZZ 2a2 browser → Materials → Edit a purchase-made row → change the price, reason | The form opens with the row's values and saves (Project Control reads its one line through `pur_entry_row`; R3). |

- [ ] **Step 6: Errors.** `select at, page, kind, message from client_errors where at > now() - interval '2 hours' order by at desc limit 50;` → nothing from `pur_` or Purchasing / Project Control / Users.
- [ ] **Step 7: Clean-up (the user, in Dacs Web).** Un-complete (if still completed) and void the remaining ZZ purchases; cancel the ZZ request on the phone; delete "ZZ 2a2 browser"; deactivate supplier "ZZ Hardware" (edit → inactive — suppliers are never deleted).
- [ ] **Step 8: Close-out.** Append `## Execution notes`; update memory `workmate-stage2-decisions.md` (2A-2 done; next 2A-3 phone).

---

## Self-review against the spec and the answers

- **Buyer assignment:** per-person capability, server-enforced (`pur_buyer` on every Purchasing RPC, storage, ledger); admin/owner within scope (R2); "I'll buy this"; who is handling each portion shown; claims and reassignments online, refused when someone else holds it (concurrency 1); explicit recorded reassignment (`pr_events`); arranged ≠ assigned (Q6); releasing never cancels an arrangement or erases a purchase.
- **Shopping list:** urgent first, needed-by, batch and project filters, buyer label, Needed · From stock (0 until 2B) · Bought · Still to buy, quantity-changed highlight.
- **Partial buying:** Still to buy wording; 6 of 10 keeps 4 assigned; release never rewrites Needed (2a2 §B); extra with reason and location; stock-covered quantities are 2B.
- **One receipt across projects:** lines for several projects, each linked to its request; fees / discounts split by line amount (adjustable), totals checked by 0096.
- **Office side:** Buyer switch by the owner; Purchasing inside Requests; extras visible, not blocked; corrections through the same operation with the owner-approval queue; voids; "From purchase" rows change only through the purchase (0096 guard).
- **Money:** nothing in Spent changes (static fence + the 2A-1 suite re-run with 0097: 45/45).
- **Review (rev 2):** the switch cannot be bypassed from any source; picks and earlier covers are authoritative; the owner approves exactly what is shown, never a purchase that has changed since; Expenses-focused buyers reach Purchasing; receipt replacements and unsaved choices survive; purchase rows are buyers-only with Project Control's one-line read; receipts are never signed links; substitutes are an explicit, checked exception.
- **Not built (R14):** payments, petty cash, badge, phone, offline drafts (and the requester / team-leader substitute confirmation that comes with them), supplier grouping, stock coverage.

## Execution evidence (16 Oct 2026, scratch build — revision 2)

Built and tested in a scratch copy of the 16 Oct working tree (it includes the uncommitted Project Control fixes of that morning; this plan touches none of those files). Totals below are without the WorkMate APK folder next door — the repo runs 2 more checks with it. Revision 1 is kept in the scratch build as its own commit, so every new test was also run against it.

- **Every fix has a test that fails on revision 1.** 2A-2 behaviour suite: **34** tests — the 27 of revision 1 (all still pass) plus 7 new; on revision 1's migration the 7 new fail and the 27 pass. Static checks on 0097: **20** (5 new, all failing on revision 1). Screen / wiring checks: **24** (8 new, all failing on revision 1's screens). Live acceptance: the new checks R1–R5; on revision 1 it stops at R1.
- **Mutation checks for the new rules** — each fix broken alone, the 2A-2 suite run: **10 / 10 caught** (any source links a request; a change request smuggles a link; anyone hands an unassigned portion over; picks not authoritative; history ignored; a unit check taking its history after the change; approval blind to anything but `updated_at`; every Expenses account reading purchase rows; a substitute counting at once; a substitute without a reason). The first run missed "anyone hands an unassigned portion over" — the test *a correction by someone who may not buy never hands a portion over* was added for it. Revision 1's 14 mutations were not re-run as a set; the rules they fenced are unchanged and their tests still pass.
- **A flaky test from revision 1 fixed:** *the shopping list is quantities and names only* looked for `777` in a JSON that also holds random ids, which contain `777` a few percent of the time. It now looks for the amount itself, `777.77`.
- **Full runs on the build:** `npm test` exit 0 (**1,041** ok); `npm run test:sql` suites **45 / 10 / 45 / 34 / 5** (2A-1, 2A-1 races, 2A-1 with 0097, 2A-2, 2A-2 races), exit 0.
- **Live acceptance scripts**, dry-run on PGlite as role `authenticated` with a JWT-claims `auth.uid()` and RLS on: `2a2 acceptance: all checks passed`; `2a1 acceptance: all checks passed` with 0097 **and** without it. Unchanged, the 2A-1 script fails after 0097 (at A5 — its staff account can no longer read purchase rows, R3), which is why it gets the Buyer switch inside its own rolled-back run. Revision 1's 2A-2 script could not pass at all (`permission denied for function pr_line_bought`); fixed.
- **Rehearsal from this plan's text**, task by task: Task 1 Step 2 fails as stated (ENOENT on 0097 twice; storage test: `purchase receipts are buyer-locked` and `the scan still finds the known upload sites`); Task 2 Step 2 fails as stated (`Cannot find module '../js/purchasing-admin-core.js'`). All **29** files byte-identical to the tested build — on a fresh LF checkout, and on a clone of the real repository's HEAD (06d69bd, `core.autocrlf=false`) where `docs/DATABASE_SCHEMA.md` and `supabase/migrations/README.md` keep their CRLF endings when their hunks are applied CRLF-preserving.
