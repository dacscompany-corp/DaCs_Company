# Payroll read fresh: statements, receipts, Overhead and a photo-free shared copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 1 needs the user's approval first. Tasks 2 and 3 are the user's own.**

**Goal:** A worker or vendor statement, a payroll receipt and the Overhead tab never show or print old payroll as current. Statements and receipts refuse to print without current figures; Overhead keeps its operating costs and hides everything built on payroll. The copy of expenses and payroll each admin page keeps stops carrying 14.5 MB of photos.

**Architecture:** One function, `_ovReadPayroll()`, reads payroll without photos, replaces the page's shared copy, and rejects if the read fails. The statement and the Overhead tab call it; the receipt reads its one row. Print windows open on the click, before any read, because a real browser blocks them afterwards. On Overhead, the single function every section reads rows from leaves payroll out while it isn't current, so no section can miss the rule. No database change, no money logic change, no phone change.

**Tech stack:** Plain JS, no build step. The Firestore-style shim's existing `.omit()`, which Project Control already uses in production for these same two tables.

**Spec:** the user's decisions of 4 Nov 2026. Option A, with its conditions: check every consumer before dropping photos; statements and receipts fetch fresh and stop with a clear message on failure; Overhead refreshes when opened; test add, edit and delete from another tab plus printing immediately after a save; verify money rules and staff restrictions; leave out Budget Overview and the 1,000-row question; send the tested plan for review first. And on revision 1: *"keep live operating costs visible if payroll refresh fails, but hide payroll-derived figures and combined totals. Show clearly that payroll is unavailable; don't present stale figures as current."* Staff Overhead visibility and duplicate invoice numbers stay separate.

**Repo:** **Dacs Web** only. The base is `main` at `1812be0` plus the Reports fix that is still uncommitted in the real tree.

**Status (4 Nov 2026):** Revision 2, **approved by the user for this patch only; Task 1 applied to the working tree, not committed or pushed.** Tasks 2 to 4 are open, and the live ZZ check has not started.

**What changed from revision 1:** Overhead no longer shows possibly old figures under a warning. R128 and R129 are rewritten, and R132 and R133 are new. The statement, receipt and shared-copy parts are unchanged.

## Global constraints

- `npm run build` is never run. No new data field, no migration.
- Spent / Earned / Profit stay untouched: no change to `_projSpent`, `_projEarned`, `_projMargin`, `_recognisedProfit`, or to the Labor / Overhead / Cover rules.
- Staff see no more than they see today. Staff Overhead access and invoice numbering are not changed here.
- The user commits and pushes. No delete on live through tools; test rows are removed through the screens by the user.
- Budget Overview's code and the shim's lack of paging are out of scope and stay as they are.

---

## The problem

`_ovAllExpenses` and `_ovAllPayroll` are read when an admin page loads and after a save in that tab. Other accounts, tabs and devices change those rows without telling the page. Project Control's lists are live, so the list can be right while a document printed from it is wrong, and a wrong statement looks exactly like a right one.

| Screen | What it does today when payroll changed elsewhere |
|---|---|
| Worker / Vendor statement | Misses a new payment, shows an edited one at its old amount, still lists a deleted one. Paid and Still to pay can be wrong. |
| Payroll Receipt / Invoice | Says "Payroll entry not found" for a row visible in the list; prints an edited row's old amount. |
| Overhead tab | Indirect labor can be missing or old, in its totals, charts, reports and CSV. |

The copy also costs **15.1 MB at every admin page load and again after every expense or payroll save**. Measured on live: without the photo columns it is **0.59 MB** (expenses 8.2 MB → 402 KB, payroll 6.9 MB → 189 KB).

## Every consumer of the shared data

Found by searching all of `js/` and `admin.html`. `tests/payroll-fresh-read.test.js` holds this list, so a new reader fails the suite until someone checks it.

| Reader | Used today? | Needs photos? | After this change |
|---|---|---|---|
| `printWorkerLaborSOA` (invoice-module) | **Yes:** Project Control, owner accounts | No | **Reads payroll just before printing** |
| `printSinglePayrollInvoice` (invoice-module) | **Yes:** Project Control, owner accounts | No | **Reads its one row just before printing** |
| `_ovhdIndirectRows` (overhead-module) | **Yes:** Overhead tab | No | **Copy is re-read when the tab opens; left out entirely until that lands** |
| `loadRptData` (Reports) | Only before Reports' own read lands | No | Unchanged: Reports reads for itself |
| `_pcReportModel` default source | Only Budget Overview and its prints; Reports passes its own rows | No | Unchanged, photo-free |
| `_updateSpent`, `_expNoPeriodRows` | Draw hidden panels only | No | Unchanged, photo-free |
| `mvpRenderFolderGrid` | Legacy Expenses view, no way in (its only link is the hidden sidebar; `mvpOpenFolderInExpenses` has no caller) | No | Unchanged, photo-free |
| `_mergePayrollPools` → `openWorkerSummaryModal`, `printWorkerReceiptSummary` | Legacy tables only | **Yes** | Already handles photo-free rows: `_fillLazyPayroll` fetches a row's photos, `_payFullCache` keeps them. Tested. |
| `mvpPayRenderFolderGrid`, `…ProjectGrid`, `…Table` | No: their elements are not in `admin.html`, so they stop at once | Table only, never reached | Unchanged |
| `printPayrollInvoice` (invoice-module) | No caller | No | Unchanged |
| `_rptAllTimeGroups` | No caller | No | Unchanged |

**Photos on the money screens:** neither print uses a photo, and Overhead does not. **Writes:** no reader saves a row from this copy. Edits load their own full row (`openEditPayrollModal`), so the "never save a `_lazy` doc" rule holds.

## What Overhead shows while payroll is not current

This applies while the read is on its way ("Loading…") and after it fails ("Unavailable").

| Part of the page | Shows |
|---|---|
| **Company Overhead** card | **Its amount.** It holds no payroll, because every payroll row is project-scope |
| **Project Overhead** card | **The word only,** because it is a combined total. A line beneath reads *"Operating costs only: ₱…"*, so the live figure stays visible and can't be mistaken for Project Overhead |
| **Overall Overhead** card | **The word only** |
| Project trend (the ↑ / ↓ %) | **Hidden:** it compares combined months |
| The three charts | **Hidden and not drawn:** they are built on the combined rows |
| **By Category** | Operating costs only, reading *"% of operating costs"*, never *"of total"* |
| **Expense Records** | Operating costs only. **No indirect worker's name or pay** |
| Reports and CSV | **Refused,** each with a message |
| Amber note | *"Payroll is unavailable, so indirect labor, the Project and Overall totals and the charts are hidden. Company overhead and the operating costs below still show. Check your connection, then open Overhead again."* |

Opening the tab again retries. When the read lands, everything returns.

## Decisions

| # | Decision |
|---|---|
| R122 | **The shared copy holds no photos.** `subscribeOvAllData` reads with `.omit`, using the same field lists as Project Control. Every other column still comes through, including one added later: the shim learns the column list at run time. |
| R123 | **A statement reads all this account's payroll just before printing**, and those rows become the shared copy. It never falls back to the old copy. Contract figures still come from Project Control's live copy (`lcSyncFromPortal`), so only payroll is re-read. |
| R124 | **A receipt reads its one row** (`.doc(id).get()`). That row includes its photos (the largest payroll row is about 121 KB), which are not printed. A row that no longer exists stops with its own message. |
| R125 | **The window opens first, on the click, showing "Preparing…".** Measured in real Chrome with the popup blocker on: a window opened after an 8-second read is **blocked**; one opened first survives. The final page replaces "Preparing…" through `document.open()`, the pattern `printTransactionReceipt` already uses. |
| R126 | **If it can't be printed from current figures, the window closes, nothing prints, and a message says why.** Read failed: *"Could not load the latest payroll, so nothing was printed. Check your connection and try again."* Row gone: *"This payroll entry no longer exists, so nothing was printed. It may have been deleted from another tab or account."* Pop-ups blocked: the existing message, and no read happens. |
| R127 | **Only the newest read may replace the copy, and an overtaken read waits for the newer one.** So printing right after a save can't be handed older rows, and a slow answer can't put them back. If an overtaken read itself fails, its caller stops even though the newer read might succeed. That is the safe direction. |
| R128 | **Overhead reads payroll each time the tab opens, before anything draws,** so the older copy doesn't show even for the moment of the read. `_ovhdRows()`, which every card, chart, table and report reads, leaves payroll out until the read has landed. |
| R129 | **While payroll is not current, operating costs stay and everything built on payroll is hidden** (your decision, replacing revision 1's warning over old figures). See the table above. |
| R130 | **A tab left open does not update itself.** Overhead refreshes when opened, as asked. A live listener is not added: every payroll change would re-read for every open tab. |
| R131 | **Reports keeps its own copy** (the fix awaiting commit), now sharing the field list. It could reuse the shared copy now that it is light, but that would rework code that is tested and waiting for your check. A later clean-up can merge them. |
| R132 | **No false zero, and no false claim that costs still show.** Opened fully offline, the operating costs fail too: all three cards read "Unavailable", the note says *"Payroll and operating costs are unavailable"*, and an unloaded list never reads as "no expenses". Reports and CSV refuse. Opening the tab again re-reads the costs as well. If only the costs fail, the note says that and nothing sticks on "Loading…". |
| R133 | **A category filter on a payroll role stays selected** while its rows are hidden, rather than the dropdown silently resetting while the filter still applies. It works again when payroll returns. |

## Found and not changed

These are separate, as you asked, each with its own short proposal:

- **Staff and Overhead pesos:** `proposal_staff_overhead.md`. Your rule needs more than hiding the tab.
- **Duplicate invoice numbers:** `proposal_invoice_numbers.md`. 5 of your 9 saved invoices already share numbers.

Two smaller notes:
- **Receipt window width:** the 720 px window is narrower than its page on screen, so the right edge is cut off until printed or resized. This was already so; the size is unchanged.
- **Operating costs after they have loaded once:** if their live connection later drops, the page keeps the last rows it received and can't tell. This was already so, and it is why the note says these costs "still show" rather than "live".

## Files

| File | Change |
|---|---|
| `js/expenses-module.js` | Photo-free reads; `_ovReadPayroll()`; newest read wins; field list shared with Reports |
| `js/invoice-module.js` | Window first; the statement and receipt read fresh and stop on failure |
| `js/overhead-module.js` | Reads payroll on open; `_ovhdRows()` leaves payroll out while it isn't current; hidden cards and charts; the note; Reports and CSV refuse; costs that never loaded are retried |
| `admin.html` | The note; a block around the three charts; `?v=20261104b` on the three scripts |
| `tests/payroll-fresh-read.test.js` | **New:** 43 tests |
| `tests/billing-allocation.test.js` | Read counts updated; its Overhead tests now mark the costs as landed, as the real page does |
| `tests/purchase-screens.test.js` | Its fake database learns `.omit` |
| `package.json` | Adds the new suite to `npm test` |
| `docs/ARCHITECTURE.md` | Rule 4: the shared copy holds no photos and can be old |

No print-utils, portal, migration or `DATABASE_SCHEMA.md` change. The portal's buttons are untouched, and `Client Management.html` / `Dacs Partnership.html` do not load these scripts.

---

## Task 1: Apply to the real tree (needs your approval)

**Files:** all of the above, through the patch in Appendix A. Also this plan, saved as `docs/superpowers/plans/2026-11-04-payroll-fresh-read.md`.

- [x] **Step 1: Check the tree is as expected**

Run: `git status --short`
Expected: the Reports fix files, or nothing if it has been committed. `admin.html` carries your one-space edit either way.

- [x] **Step 2: Check the patch applies**

Run: `git apply --check ovp.patch`
Expected: no output. (Rehearsed on an exact replica of the real tree, one-space edit included: clean.)

- [x] **Step 3: Apply it, and save this plan**

Run: `git apply ovp.patch`

- [x] **Step 4: Run the checks**

Run: `npm test`, then `node --check` on the three changed scripts.
Expected: 48 suites pass, exit 0. `tests/payroll-fresh-read.test.js` reports `43 passed, 0 failed`; `tests/money-math.test.js` reports `257 passed, 0 failed`. `npm run test:sql` is not needed: no SQL changed.

- [x] **Step 5: Stop for your review.** No commit, no push.

## Task 2: Commit and push (yours)

- [ ] **Step 1:** Do your browser check of the Reports fix, and commit it first if it is still uncommitted.
- [ ] **Step 2:** Commit this patch. In `admin.html`, stage the note, the chart block and the version lines and **leave out your one-space edit** (from a copy with that line restored, as last time).
- [ ] **Step 3:** Push. I check that the live site serves the changed files byte-identical. Rollback is a `git revert`: there is no database change.

## Task 3: Live checks with a ZZ project (yours, after the push)

Real records are not touched: every test row is under a ZZ project and you remove it through the screens. I take read-only totals before and after and tell you if anything else moved. Use two tabs signed in as admin@: **A** (where you print) and **B** ("another tab"). Hard-refresh both.

| # | Do | Expect |
|---|---|---|
| P0 | Project Control: new project **ZZ payroll check** with a November billing period. Add a pakyaw contract for **ZZ Worker**, ₱1,000 | Ready |
| P1 | Tab A, DevTools Network: reload the page, find the `expenses` and `payroll` reads | Their column lists name no photo column, and far less is transferred than before |
| P2 | Tab B: add a ZZ Worker payment of ₱300 on the contract. In Tab A, on the ZZ project's Labor list, press **Worker statement** | It appears in the list; the statement shows ₱300, Paid ₱300, Still to pay ₱700 |
| P3 | Tab B: add a second payment of ₱200. Tab A: statement again | Total ₱500, Still to pay ₱500 |
| P4 | Tab B: edit ₱200 to ₱225. Tab A: statement, then the row's **Receipt** | Both show the new amount; total ₱525 |
| P5 | Tab B: delete the ₱225 payment. Tab A: statement | Gone; total ₱300 |
| P6 | Tab A: add a ₱150 payment, and as soon as the form closes press **Worker statement** | The ₱150 is on it; total ₱450 |
| P7 | Tab A, DevTools: **Offline**. Press **Worker statement**, then a row's **Receipt**. Back online | Each: the window opens and closes, the message says nothing was printed, no document stays open. Online again: both print |
| P8 | Tab B: add an **indirect** payment, ZZ Coordinator ₱90. Tab A: Overhead, November | Project Overhead up by ₱90; the row is listed |
| P9 | Tab B: edit it to ₱95, then later delete it. Tab A: leave and re-open Overhead after each | ₱95, then gone. Add it back at ₱90 for P11 |
| P10 | Tab B: add a **direct** ₱60 payment. Tab A: re-open Overhead | Overhead unchanged: direct labor is not Overhead |
| P11 | Tab A: leave Overhead, go **Offline**, re-open Overhead | Company and the operating costs show. Project and Overall read "Unavailable", with *"Operating costs only: ₱…"* under Project. No ZZ Coordinator anywhere, no charts, By Category reads "of operating costs". Reports and CSV refuse and say why |
| P12 | Tab A: back online, re-open Overhead | Everything back: figures, charts, the ZZ Coordinator row |
| P13 | Tab A: reload the page online and stay on Project Control. Go **Offline**, then open Overhead for the first time. Back online and re-open | Offline: all three cards "Unavailable", and the note says payroll and operating costs are unavailable. No ₱0.00. Online: all back |
| P14 | staff@, in Project Control | No Receipt button, no Worker statement, Reports blocked, as today. The Add Payroll form still opens (cancel it; save nothing) |
| P15 | **Clean up:** delete every ZZ payment, the contract and the ZZ project through the screens | Gone |
| P16 | I re-take the read-only totals | Payroll, expenses and folders match the before figures |

## Task 4: Notes

- [ ] Record the pilot's results in this plan's execution notes, and mark Stage 4's finding as closed.

---

## What was tested in scratch

| Check | Result |
|---|---|
| New suite: add, edit, delete from another tab; printing right after a save; failed reads; overtaken reads; everything Overhead hides and keeps; staff | **43 / 43** |
| `npm test`, all suites, on the rehearsal replica of the real tree | **48 suites pass**, exit 0 (money suite 257 / 257) |
| Deliberate breaks of the fix, one at a time | **55 / 55 caught** |
| Real Chrome, popup blocker on, real clicks, real scripts, a fake server | **27 / 27** |
| Read-then-open in real Chrome with an 8-second read | **Blocked**, which is why the window opens first |
| Patch taken from this plan's own text, on a replica of the real tree with your one-space edit and the Reports fix | Applies clean; suites and Chrome pass on it |

**Chrome also confirmed:** "Preparing…" is replaced by the real document, the shared print style survives `document.open()`, and each document asks to print exactly once. On the real `admin.html` page with the real scripts drawing it, the failed, offline-from-the-start, loading and current states of Overhead all showed as described. The statement, the receipt and the Overhead states were checked by eye in screenshots.

**How the tests were made honest:** they were written first and failed for the expected reasons. Each round of deliberate breaks exposed gaps: revision 1's first run caught 31 of 33, and revision 2's caught 50 of 55. Four of revision 2's five misses were real holes in the tests (such as the costs failing while payroll succeeds), now covered. The fifth was a break nobody could see on screen, replaced with a realistic one. All 55 are caught now.

**Not tested, and why Task 3 exists:**
- A real sign-in or the real database. The Chrome and suite checks use a fake server.
- The real shim on these exact reads. It is covered by `tests/shim-omit.test.js`, and Project Control runs the same two reads in production.
- Staff on the real screens: code and existing tests only.

## Execution notes

- **4 Nov, order the user set:** the Reports browser check first, then apply, run the checks, and stop for review.
- **The Reports check passed:** see the 4 Nov notes in `2026-10-30-workmate-stage4-reconciliation.md`.
- **Task 1, 4 Nov 13:06:** the patch applied clean. The changed scripts and tests are byte-identical to the tested build, the user's one-space `admin.html` edit is intact, all 48 suites pass (this suite 43 of 43, money suite 257 of 257).
- **A separate small change, after this patch:** the user asked for the Reports scope label to name the chosen folder during a read and after a failed one. It is not part of Appendix A. `_rptScopePeriods()` and `_rptShowScope()` in `js/expenses-module.js`, `testReportLabelNamesTheChosenFolder` in `tests/billing-allocation.test.js`, `expenses-module.js?v=20261104c`. The test was written first and failed on the bug; all 8 deliberate breaks of the fix are caught.
- **Left out on purpose:** staff access to indirect-pay rows and any override of the 15 Oct decision await the user's explicit decision. Invoice numbering awaits the accountant's requirements, and issued invoices are not renumbered. Budget Overview and the 1,000-row question are untouched.

## Self-review against your conditions

| Your condition | Where |
|---|---|
| Check every consumer before dropping photos | *Every consumer* table; test "every reader of the shared copy is known" |
| Statements and receipts fetch fresh before printing | R123, R124; tests; P2–P5 |
| A failed fetch stops with a clear message | R126; tests; Chrome; P7 |
| Refresh Overhead when opened | R128; tests; P8–P9 |
| Keep live operating costs visible if payroll fails | R129; tests; Chrome; P11 |
| Hide payroll-derived figures and combined totals | R128, R129; tests; Chrome; P11. Enforced in `_ovhdRows()`, plus the cards and charts |
| Show clearly that payroll is unavailable | The note and the card wording; tests; Chrome screenshots; P11 |
| Don't present stale figures as current | R128 (not even for the moment of the read), R132; tests; P11, P13 |
| Add, edit, delete from another tab | Tests for statement, receipt and Overhead; P2–P5, P8–P9 |
| Printing immediately after a save | R127; tests; P6 |
| Money rules hold | No money code changed; money suite 257 / 257; tests for Cover, indirect counted once, direct out of Overhead; P10 |
| Staff restrictions hold | Tests; `tests/project-control-staff.test.js`; P14. Overhead's existing exposure is unchanged and has its own proposal |
| Staff Overhead and invoice numbers stay separate | Neither is touched by this patch; each has a proposal |
| Budget Overview and the 1,000-row question left out | Neither touched: R131 and *Global constraints* |
| Tested plan sent before applying | This document; nothing applied |

---

## Appendix A: the patch (`ovp.patch`)

Base: `1812be0` + the Reports fix. Contains the complete new test file.

```diff
diff --git a/admin.html b/admin.html
index 72c2d28..feae4db 100644
--- a/admin.html
+++ b/admin.html
@@ -1196,6 +1196,9 @@
                 </div>
             </div>
 
+            <!-- Says when payroll is loading or unavailable, and what is hidden meanwhile (_ovhdShowPayNote). -->
+            <div id="ovhdPayrollNote" role="status" style="display:none;margin:0 0 12px;padding:10px 14px;border-radius:8px;border:1px solid #fcd34d;background:#fffbeb;color:#92400e;font-size:13px;"></div>
+
             <!-- Overhead Guide Modal -->
             <div id="ovhdGuideModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;padding:16px;" onclick="if(event.target===this)this.style.display='none'">
                 <div style="background:#fff;border-radius:16px;width:100%;max-width:500px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden;">
@@ -1285,7 +1288,8 @@
                 </div>
             </div>
 
-            <!-- Charts -->
+            <!-- Charts: built on the combined rows, so hidden while payroll is not current. -->
+            <div id="ovhdChartsBlock">
             <div class="section-card" style="margin-top:1rem;">
                 <div class="card-header"><div><h2 style="margin:0;">Expense Distribution</h2><p class="card-subtitle">Company vs. Project</p></div></div>
                 <div class="chart-wrapper" style="height:240px"><canvas id="ovhdScopeChart"></canvas></div>
@@ -1298,6 +1302,7 @@
                 <div class="card-header"><div><h2 style="margin:0;">Overhead Trend</h2><p class="card-subtitle">Month-over-month comparison</p></div></div>
                 <div class="chart-wrapper" style="height:220px"><canvas id="ovhdTrendChart"></canvas></div>
             </div>
+            </div><!-- /ovhdChartsBlock -->
 
             <div class="ovhd-cols" style="margin-top:1rem;">
               <!-- Category Breakdown -->
@@ -5535,8 +5540,8 @@
 <script src="js/receipt-storage.js?v=20261031a"></script>
 <script src="js/expense-split-rows.js?v=20261028a"></script>
 <script src="js/expense-pending-save.js?v=20261031a"></script>
-<script src="js/expenses-module.js?v=20261104a"></script>
-<script src="js/overhead-module.js"></script>
+<script src="js/expenses-module.js?v=20261104b"></script>
+<script src="js/overhead-module.js?v=20261104b"></script>
 <script src="js/reimbursement-module.js"></script>
 <script src="js/construction-module.js"></script>
 <script src="js/boq-module.js"></script>
@@ -5568,7 +5573,7 @@
 <script src="js/user-navigator.js?v=20261016a"></script>
 <script src="js/client-accounts.js"></script>
 <script src="js/payment-requests.js"></script>
-<script src="js/invoice-module.js"></script>
+<script src="js/invoice-module.js?v=20261104b"></script>
 <script src="js/labor-invoice-module.js"></script>
 <script src="js/pm-sharing.js?v=20261031a"></script>
 <script src="js/pm-admin.js?v=20261031a"></script>
diff --git a/docs/ARCHITECTURE.md b/docs/ARCHITECTURE.md
index 492b888..f41e855 100644
--- a/docs/ARCHITECTURE.md
+++ b/docs/ARCHITECTURE.md
@@ -75,6 +75,13 @@ db.collection('payroll').where('userId', '==', uid).onSnapshot(...)
 3. **Never save a `_lazy` doc.** Project Control's payroll list reaches `expenses-module.js`
    through `lcSyncFromPortal`, so `expPayroll` can hold partial copies — anything there that
    reads or writes `receiptImages` must refetch first (see `openEditPayrollModal`).
+4. **`_ovAllExpenses` / `_ovAllPayroll` hold no photos and can be old.** They are read when the
+   page loads and after a save in that tab; other accounts, tabs and devices change those rows
+   without telling the page. Anything that prints or totals money reads fresh first
+   (`_ovReadPayroll`, as the worker statement and the Overhead tab do) and never falls back to
+   the copy if that read fails: a statement or receipt prints nothing, and Overhead keeps its
+   operating costs but hides everything built on payroll. `tests/payroll-fresh-read.test.js`
+   lists every reader.
 
 ---
 
diff --git a/js/expenses-module.js b/js/expenses-module.js
index e450567..f1d7b58 100644
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -390,6 +390,12 @@ function fmtBudgetInput(el) {
 // ── Overview: global all-expenses/payroll cache (keeps folder grid live) ──
 let _ovAllExpenses  = [];
 let _ovAllPayroll   = [];
+// The shared copy never holds photos: nothing that reads it shows one (the worker
+// receipt summary fetches a row's photos itself, _fillLazyPayroll), and they are
+// 14.5 MB of the two tables' 15 MB. It can also be old: see _ovReadPayroll.
+const _EXP_PHOTO_FIELDS = ['poImageUrl', 'deliveryReceiptUrl', 'supplierInvoiceUrl', 'paymentReceiptUrl'];
+let _ovExpRead = 0, _ovPayRead = 0;   // only the newest read of a table may replace the copy
+let _ovPayLatest = null;
 let _ovExpUnsub     = null;
 let _ovPayUnsub     = null;
 
@@ -757,23 +763,39 @@ function subscribeOvAllData() {
     }
 
     // Single fetch — no live listener
+    var expRead = ++_ovExpRead;
     db.collection('expenses')
         .where('userId', '==', _uid())
+        .omit(_EXP_PHOTO_FIELDS)
         .get()
         .then(function(snap) {
+            if (expRead !== _ovExpRead) return;
             _ovAllExpenses = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
             _updateSpent();
         })
         .catch(function(err) { console.error('ov expenses fetch:', err); });
 
-    db.collection('payroll')
+    _ovReadPayroll()
+        .then(function() { _updateSpent(); })
+        .catch(function(err) { console.error('ov payroll fetch:', err); });
+}
+
+// Read payroll now, for whoever must not use an old copy: other accounts, tabs and
+// devices change it without telling this page. Resolves with the rows, which become
+// the shared copy; rejects if the read fails, so the caller stops instead of falling
+// back. A read overtaken by a newer one waits for it and hands over the newer rows.
+function _ovReadPayroll() {
+    const run = ++_ovPayRead;
+    _ovPayLatest = db.collection('payroll')
         .where('userId', '==', _uid())
+        .omit('receiptImages')
         .get()
-        .then(function(snap) {
-            _ovAllPayroll = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
-            _updateSpent();
-        })
-        .catch(function(err) { console.error('ov payroll fetch:', err); });
+        .then(snap => {
+            if (run !== _ovPayRead) return _ovPayLatest;
+            _ovAllPayroll = snap.docs.map(d => ({ id: d.id, ...d.data() }));
+            return _ovAllPayroll;
+        });
+    return _ovPayLatest;
 }
 
 // Call this after any expense/payroll write to keep folder grid totals fresh.
@@ -5519,10 +5541,8 @@ function _rptUpdateAxisHint(period) {
 // Reports reads expenses and payroll itself when it is opened or its folder or
 // year changes. _ovAllExpenses is a copy from page load that Stock, Purchasing,
 // the phone and other accounts never refresh, so it can still hold a row that is
-// gone. Only the figures are read: photos are 14.5 MB of the two tables' 15 MB
-// and nothing in Reports shows one. The cost-move note ("changed after the month
-// ended") is read with them, so it can't be newer than the figures above it.
-const _RPT_PHOTO_FIELDS = ['poImageUrl', 'deliveryReceiptUrl', 'supplierInvoiceUrl', 'paymentReceiptUrl'];
+// gone. The cost-move note ("changed after the month ended") is read with the
+// figures, so it can't be newer than they are.
 let _rptFresh = null;     // { expenses, payroll } from the latest read
 let _rptFreshRun = 0;     // only the newest read may land
 function _rptLoadFresh() {
@@ -5535,7 +5555,7 @@ function _rptLoadFresh() {
     _rptShowLoading();
     const rowsOf = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
     Promise.all([
-        db.collection('expenses').where('userId', '==', _uid()).omit(_RPT_PHOTO_FIELDS).get(),
+        db.collection('expenses').where('userId', '==', _uid()).omit(_EXP_PHOTO_FIELDS).get(),
         db.collection('payroll').where('userId', '==', _uid()).omit('receiptImages').get()
     ]).then(([expenses, payroll]) => {
         if (run !== _rptFreshRun) return;
diff --git a/js/invoice-module.js b/js/invoice-module.js
index 7377685..6067934 100644
--- a/js/invoice-module.js
+++ b/js/invoice-module.js
@@ -2140,16 +2140,44 @@ ${previewOnly ? '' : '<script>window.onload=function(){window.print();};<\\/scri
     // ACKNOWLEDGE INVOICE — Single payroll entry
     // ══════════════════════════════════════════════════════
 
+    // A statement or receipt reads payroll just before printing, because Project
+    // Control's list above its button is live and the two must agree. The window
+    // opens first, on the click itself: opened after a wait it can be blocked.
+    // If it cannot be printed from current figures, the window closes and nothing
+    // is printed, never the page's older copy.
+    function _openPrintWindow(features, blockedMessage) {
+        const w = window.open('', '_blank', features);
+        if (!w) { alert(blockedMessage); return null; }
+        w.document.write('<p style="font:14px Arial,sans-serif;padding:24px;color:#555">Preparing…</p>');
+        return w;
+    }
+    function _stopPrint(w, message) {
+        w.close();
+        alert(message);
+    }
+    const _PRINT_READ_FAILED = 'Could not load the latest payroll, so nothing was printed. Check your connection and try again.';
+
     window.printSinglePayrollInvoice = async function (payrollId) {
+        const w = _openPrintWindow('width=720,height=960', 'Please allow pop-ups to print the invoice.');
+        if (!w) return;
+        try {
+            await _writeSinglePayrollInvoice(w, payrollId);
+        } catch (err) {
+            console.error('printSinglePayrollInvoice:', err);
+            _stopPrint(w, _PRINT_READ_FAILED);
+        }
+    };
+
+    async function _writeSinglePayrollInvoice(w, payrollId) {
         if (!_ownerUid) await _resolveOwnerUid();
         if (!_defaults || !Object.keys(_defaults).length) await _loadDefaults();
 
-        const _allPay = (typeof _ovAllPayroll !== 'undefined' && _ovAllPayroll.length)
-                        ? _ovAllPayroll
-                        : (typeof expPayroll !== 'undefined' ? expPayroll : []);
-
-        const p = _allPay.find(e => e.id === payrollId);
-        if (!p) { alert('Payroll entry not found.'); return; }
+        const snap = await db.collection('payroll').doc(payrollId).get();
+        if (!snap.exists) {
+            _stopPrint(w, 'This payroll entry no longer exists, so nothing was printed. It may have been deleted from another tab or account.');
+            return;
+        }
+        const p = { id: snap.id, ...snap.data() };
 
         const _projs   = (typeof expProjects !== 'undefined' ? expProjects : []);
         const _folders = (typeof expFolders  !== 'undefined' ? expFolders  : []);
@@ -2179,9 +2207,7 @@ ${previewOnly ? '' : '<script>window.onload=function(){window.print();};<\\/scri
             k === _method ? '<strong class="on">' + lbl + '</strong>' : lbl
         ).join(' <span class="sep">/</span> ') + '</div>';
 
-        const w = window.open('','_blank','width=720,height=960');
-        if (!w) { alert('Please allow pop-ups to print the invoice.'); return; }
-
+        w.document.open();
         w.document.write(`<!DOCTYPE html>
 <html lang="en">
 <head>
@@ -2272,7 +2298,7 @@ ${window.dacsStatementPrintScript()}
 </body>
 </html>`);
         w.document.close();
-    };
+    }
 
     // ══════════════════════════════════════════════════════
     // WORKER STATEMENT OF ACCOUNT — all of ONE worker's labor
@@ -2283,15 +2309,24 @@ ${window.dacsStatementPrintScript()}
     // 'labor' (default) = in-house worker; 'outsource' = outside vendor. Without
     // it a vendor sharing a worker's name would pull both kinds into one document.
     window.printWorkerLaborSOA = async function (workerName, folderId, category) {
+        const w = _openPrintWindow('width=870,height=1100', 'Please allow pop-ups to print the statement.');
+        if (!w) return;
+        try {
+            await _writeWorkerLaborSOA(w, workerName, folderId, category);
+        } catch (err) {
+            console.error('printWorkerLaborSOA:', err);
+            _stopPrint(w, _PRINT_READ_FAILED);
+        }
+    };
+
+    async function _writeWorkerLaborSOA(w, workerName, folderId, category) {
         const _soaCat    = category === 'outsource' ? 'outsource' : 'labor';
         const _soaIsVend = _soaCat === 'outsource';
         const _catOf     = c => (c && c.category === 'outsource') ? 'outsource' : 'labor';
         if (!_ownerUid) await _resolveOwnerUid();
         if (!_defaults || !Object.keys(_defaults).length) await _loadDefaults();
 
-        const _allPay  = (typeof _ovAllPayroll !== 'undefined' && _ovAllPayroll.length)
-                         ? _ovAllPayroll
-                         : (typeof expPayroll !== 'undefined' ? expPayroll : []);
+        const _allPay  = await _ovReadPayroll();
         const _projs   = (typeof expProjects !== 'undefined' ? expProjects : []);
         const _folders = (typeof expFolders  !== 'undefined' ? expFolders  : []);
 
@@ -2311,7 +2346,7 @@ ${window.dacsStatementPrintScript()}
             .filter(p => periodIds.has(p.projectId) &&
                 ((p.workerName || '') === workerName || (p.contractId && _wcIds.has(p.contractId))))
             .sort((a, b) => new Date(a.paymentDate || 0) - new Date(b.paymentDate || 0));
-        if (!entries.length) { alert('No labor entries found for ' + workerName + ' in this project.'); return; }
+        if (!entries.length) { _stopPrint(w, 'No labor entries found for ' + workerName + ' in this project.'); return; }
 
         const role    = (entries.find(e => e.role) || {}).role || '—';
         // Blank, not '—': the letterhead omits an address/TIN line it doesn't have.
@@ -2401,9 +2436,7 @@ ${window.dacsStatementPrintScript()}
             _contractType = [..._types].join(' & ');
         }
 
-        const w = window.open('','_blank','width=870,height=1100');
-        if (!w) { alert('Please allow pop-ups to print the statement.'); return; }
-
+        w.document.open();
         w.document.write(`<!DOCTYPE html>
 <html lang="en">
 <head>
diff --git a/js/overhead-module.js b/js/overhead-module.js
index ffad1d3..1c02f01 100644
--- a/js/overhead-module.js
+++ b/js/overhead-module.js
@@ -14,6 +14,8 @@ let _ovhdExpenses    = [];      // all non-deleted docs for this account
 let _ovhdUnsub       = null;
 let _ovhdMonth       = '';       // 'YYYY-MM'
 let _ovhdInitialized = false;
+let _ovhdCostsRead   = false;  // the operating costs have landed at least once
+let _ovhdCostsFailed = false;  // and if they have not, whether their read failed
 let _ovhdScope       = 'all';    // 'all' | 'company' | 'project'
 let _ovhdProjectId   = '';       // folderId filter
 let _ovhdCategory    = '';
@@ -146,10 +148,12 @@ function _ovhdIndirectRows() {
         status: 'paid'   // payroll rows are money already released
     }));
 }
+// 'loading' or 'failed': payroll isn't current, so nothing built on it may show.
+let _ovhdPayState = null;
 // Every card, chart, table and report reads THIS — never _ovhdExpenses directly —
 // so the operating costs and the indirect-labor payroll always agree.
 function _ovhdRows() {
-    return _ovhdExpenses.concat(_ovhdIndirectRows());
+    return _ovhdPayState ? _ovhdExpenses.slice() : _ovhdExpenses.concat(_ovhdIndirectRows());
 }
 
 // ── Init ─────────────────────────────────────────────────────
@@ -163,15 +167,73 @@ function initOverheadModule() {
     const picker = document.getElementById('ovhdMonthPicker');
     if (picker) picker.value = _ovhdMonth;
 
+    // Before anything draws: the page's older copy of payroll must not show, even for a moment.
+    _ovhdRefreshPayroll();
+
     _ovhdPopulateProjectSelects();
     _ovhdPopulateCategorySelect();
 
-    if (!_ovhdInitialized) {
+    // Costs that never loaded are read again, so opening the tab is the retry.
+    if (!_ovhdInitialized || !_ovhdCostsRead) {
         _ovhdInitialized = true;
         _ovhdSubscribe();
-    } else {
+    }
+    _ovhdRender();
+}
+
+// Indirect labor comes from payroll, which other accounts, tabs and devices change
+// without telling this page, so it is read each time this tab opens. Until that has
+// landed, or if it fails, the operating costs stay on screen and everything built on
+// payroll is hidden: indirect labor, the Project and Overall totals, the charts.
+// Reports and CSV refuse. Old figures are never shown as if they were current.
+let _ovhdPayRun = 0;        // only the newest read may land
+function _ovhdRefreshPayroll() {
+    const run = ++_ovhdPayRun;
+    _ovhdPayState = 'loading';
+    _ovhdShowPayNote();
+    return _ovReadPayroll().then(() => {
+        _ovhdPayState = null;
+        _ovhdShowPayNote();
+        _ovhdPopulateCategorySelect();
+        _ovhdRender();
+    }).catch(err => {
+        if (run !== _ovhdPayRun) return;
+        console.error('Overhead payroll read:', err);
+        _ovhdPayState = 'failed';
+        _ovhdShowPayNote();
         _ovhdRender();
+    });
+}
+function _ovhdPayWord() {
+    return _ovhdPayState === 'failed' || _ovhdCostsFailed ? 'Unavailable' : 'Loading…';
+}
+function _ovhdShowPayNote() {
+    const block = document.getElementById('ovhdChartsBlock');
+    if (block) block.style.display = _ovhdPayState || !_ovhdCostsRead ? 'none' : '';
+    const note = document.getElementById('ovhdPayrollNote');
+    if (!note) return;
+    const retry = ' Check your connection, then open Overhead again.';
+    let text = '';
+    if (_ovhdPayState === 'failed') {
+        text = _ovhdCostsRead
+            ? 'Payroll is unavailable, so indirect labor, the Project and Overall totals and the charts are hidden. Company overhead and the operating costs below still show.' + retry
+            : 'Payroll and operating costs are unavailable.' + retry;
+    } else if (_ovhdCostsFailed) {
+        text = 'Operating costs are unavailable.' + retry;
+    } else if (_ovhdPayState === 'loading') {
+        text = 'Loading the latest payroll. Indirect labor, the Project and Overall totals and the charts will appear when it arrives.';
     }
+    note.style.display = text ? '' : 'none';
+    note.textContent = text;
+}
+function _ovhdFiguresReady() {
+    if (!_ovhdPayState && _ovhdCostsRead) return true;
+    _ovhdToast(_ovhdPayState === 'loading'
+        ? 'Payroll is still loading. Try again in a moment.'
+        : _ovhdPayState === 'failed'
+            ? 'Payroll is unavailable, so this cannot be complete. Open Overhead again first.'
+            : 'Operating costs are unavailable. Open Overhead again first.', 'error');
+    return false;
 }
 
 function _ovhdPopulateProjectSelects() {
@@ -190,7 +252,8 @@ function _ovhdPopulateCategorySelect() {
     const sel = document.getElementById('ovhdCategorySel');
     if (!sel) return;
     const cur = sel.value;
-    const cats = Array.from(new Set(_ovhdRows().map(e => e.category).filter(Boolean))).sort();
+    // The chosen filter stays offered even while its rows are hidden.
+    const cats = Array.from(new Set(_ovhdRows().map(e => e.category).concat(_ovhdCategory).filter(Boolean))).sort();
     sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${_esc(c)}">${_esc(c)}</option>`).join('');
     if (cur && cats.includes(cur)) sel.value = cur;
     _ovhdFillCategoryDatalist();
@@ -231,28 +294,35 @@ function onOverheadSearchChange(val) { _ovhdSearch = String(val || '').trim().to
 function onOverheadMonthChange(val) { _ovhdMonth = val; _ovhdRender(); }
 
 // ── Firestore subscription ────────────────────────────────────
+function _ovhdCostsLanded(snap) {
+    _ovhdExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.deletedAt);
+    _ovhdCostsRead = true;
+    _ovhdCostsFailed = false;
+    _ovhdShowPayNote();
+    _ovhdPopulateCategorySelect();
+    _ovhdRender();
+}
 function _ovhdSubscribe() {
     if (!currentUser) return;
     if (_ovhdUnsub) { _ovhdUnsub(); _ovhdUnsub = null; }
+    _ovhdCostsFailed = false;
 
     try {
         _ovhdUnsub = db.collection('overheadExpenses')
             .where('userId', '==', _ovhdUid())
-            .onSnapshot(snap => {
-                _ovhdExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.deletedAt);
-                _ovhdPopulateCategorySelect();
-                _ovhdRender();
-            }, err => {
+            .onSnapshot(_ovhdCostsLanded, err => {
                 console.warn('Overhead onSnapshot error, falling back to .get():', err);
                 db.collection('overheadExpenses')
                     .where('userId', '==', _ovhdUid())
                     .get()
-                    .then(snap => {
-                        _ovhdExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.deletedAt);
-                        _ovhdPopulateCategorySelect();
+                    .then(_ovhdCostsLanded)
+                    .catch(e => {
+                        console.error('Overhead fallback .get() error:', e);
+                        if (_ovhdCostsRead) return;
+                        _ovhdCostsFailed = true;
+                        _ovhdShowPayNote();
                         _ovhdRender();
-                    })
-                    .catch(e => console.error('Overhead fallback .get() error:', e));
+                    });
             });
     } catch(e) {
         console.error('_ovhdSubscribe error:', e);
@@ -278,6 +348,19 @@ function _ovhdFilteredForMonth() {
 
 // ── Render ────────────────────────────────────────────────────
 function _ovhdRender() {
+    // The costs have not landed: nothing is known, so nothing is drawn as if it were
+    // (a false ₱0.00, or "no expenses" for a list that never loaded).
+    if (!_ovhdCostsRead) {
+        const word = _ovhdPayWord();
+        ['ovhdCompanyAmount', 'ovhdProjectAmount', 'ovhdOverallAmount'].forEach(id => _ovhdSet(id, word));
+        ['ovhdCompanyTrend', 'ovhdProjectTrend', 'ovhdBreakdownList', 'ovhdTableBody'].forEach(id => {
+            const el = document.getElementById(id);
+            if (el) el.innerHTML = '';
+        });
+        _ovhdRenderLargeExpenseBadge([]);
+        return;
+    }
+
     const filtered = _ovhdFilteredForMonth();
 
     // Company vs Project vs Overall — computed from the SAME filtered set
@@ -307,10 +390,20 @@ function _ovhdRender() {
     });
 
     _ovhdSet('ovhdCompanyAmount', _fmtAmt(companyTotal));
-    _ovhdSet('ovhdProjectAmount', _fmtAmt(projectTotal));
-    _ovhdSet('ovhdOverallAmount', _fmtAmt(overallTotal));
     _ovhdSetKpiTrend('ovhdCompanyTrend', companyTotal, prevCompany);
-    _ovhdSetKpiTrend('ovhdProjectTrend', projectTotal, prevProject);
+    if (_ovhdPayState) {
+        // Project and Overall include payroll. Project's operating costs still show,
+        // labelled, so they are never read as Project Overhead.
+        const word = _ovhdPayWord();
+        _ovhdSet('ovhdProjectAmount', word);
+        _ovhdSet('ovhdOverallAmount', word);
+        const trend = document.getElementById('ovhdProjectTrend');
+        if (trend) trend.innerHTML = `<div class="card-subtitle" style="margin-top:2px;">Operating costs only: ${_fmtAmt(projectTotal)}</div>`;
+    } else {
+        _ovhdSet('ovhdProjectAmount', _fmtAmt(projectTotal));
+        _ovhdSet('ovhdOverallAmount', _fmtAmt(overallTotal));
+        _ovhdSetKpiTrend('ovhdProjectTrend', projectTotal, prevProject);
+    }
 
     // Totals by category — for the By-Category panel
     const totals = {};
@@ -321,9 +414,11 @@ function _ovhdRender() {
 
     _ovhdRenderBreakdown(totals, overallTotal);
     _ovhdRenderTable(filtered);
-    _ovhdRenderScopeChart(companyTotal, projectTotal);
-    _ovhdRenderMonthlyChart();
-    _ovhdRenderTrendChart();
+    if (!_ovhdPayState) {
+        _ovhdRenderScopeChart(companyTotal, projectTotal);
+        _ovhdRenderMonthlyChart();
+        _ovhdRenderTrendChart();
+    }
     _ovhdRenderLargeExpenseBadge(filtered);
 }
 function _ovhdSet(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
@@ -394,7 +489,7 @@ function _ovhdRenderBreakdown(totals, grandTotal) {
                 <span class="ovhd-bd-amt">${_fmtAmt(amt)}</span>
             </div>
             <div class="ovhd-bd-track"><div class="ovhd-bd-fill" style="width:${pctStr}%;background:${color}"></div></div>
-            <div class="ovhd-bd-pct">${pctStr}% of total</div>
+            <div class="ovhd-bd-pct">${pctStr}% of ${_ovhdPayState ? 'operating costs' : 'total'}</div>
         </div>`;
     }).join('')}</div>`;
 }
@@ -868,6 +963,7 @@ async function deleteOverheadExpense(id) {
 
 // ── CSV export (Excel-compatible) ────────────────────────────────
 function exportOverheadCsv() {
+    if (!_ovhdFiguresReady()) return;
     const filtered = _ovhdFilteredForMonth();
     const headers = ['Date', 'Scope', 'Project', 'Billing Period', 'Category', 'Description', 'Amount', 'Status', 'Source'];
     const csvEsc = v => {
@@ -914,6 +1010,7 @@ function toggleOverheadReportMenu() {
 function printOverheadReport(kind) {
     const menu = document.getElementById('ovhdReportMenu');
     if (menu) menu.style.display = 'none';
+    if (!_ovhdFiguresReady()) return;
 
     const [cy, cm] = _ovhdMonth.split('-').map(Number);
     let rangeStart, rangeEnd, rangeLabel, scopeFilter = null;
diff --git a/package.json b/package.json
index 9eb108c..8c750a2 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/pm-sharing-items.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js && node tests/stock-cost-admin.test.js && node tests/tools-admin.test.js && node tests/reconciliation-admin.test.js && node tests/expense-pending-save.test.js && node tests/warranty-ref.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/payroll-fresh-read.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/pm-sharing-items.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js && node tests/stock-cost-admin.test.js && node tests/tools-admin.test.js && node tests/reconciliation-admin.test.js && node tests/expense-pending-save.test.js && node tests/warranty-ref.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
diff --git a/tests/billing-allocation.test.js b/tests/billing-allocation.test.js
index 23f42e6..6bbcaba 100644
--- a/tests/billing-allocation.test.js
+++ b/tests/billing-allocation.test.js
@@ -371,7 +371,7 @@ async function testOverheadAttribution() {
   eq(a.writes.at(-1).billingPeriodId, null, 'save must revalidate a period moved after the form opened');
 
   const b = overheadHarness();
-  vm.runInContext(`_ovhdExpenses = [
+  vm.runInContext(`_ovhdCostsRead = true; _ovhdExpenses = [
     { folderId:'f1', billingPeriodId:'p1', amount:100, date:'2026-09-01' },
     { folderId:'f1', billingPeriodId:null, amount:200, date:'2026-09-01' },
     { folderId:'f1', billingPeriodId:'p3', amount:300, date:'2026-09-01' }];
@@ -563,7 +563,7 @@ function testOverheadCsvFormulas() {
   const h = overheadHarness();
   h.context.expFolders[0].name = '@job';
   h.context.expProjects[0].name = '=SUM("1","2")';
-  vm.runInContext(`_ovhdExpenses = [{ folderId:'f1', billingPeriodId:'p1', amount:-123.45,
+  vm.runInContext(`_ovhdCostsRead = true; _ovhdExpenses = [{ folderId:'f1', billingPeriodId:'p1', amount:-123.45,
     date:'2026-09-01', category:'+category', expenseName:'-expense', status:'=status' }];`, h.context);
   h.context.exportOverheadCsv();
   eq(h.reports().csv.split('\n')[1], `"2026-09-01","Project","'@job","'=SUM(""1"",""2"")","'+category","'-expense","-123.45","'=status","Overhead Expense"`,
@@ -1416,28 +1416,30 @@ async function testReportsReadOnlyWhenAsked() {
   eq(reportReads(), 2, 'one open is one read of each table');
   c._pcRefreshReportViews();
   c._renderAllPanels();
-  c.subscribeOvAllData();
   await tick();
   eq(reportReads(), 2, 'a redraw reads nothing: drawing must never start another read');
+  c.subscribeOvAllData();
+  await tick();
+  eq(reportReads(), 4, 'the shared copy reads its own two tables, and starts no Reports read');
   assert.match(h.el('rptSummaryTbody').innerHTML, /251\.00/, 'and keeps the figures just read');
   c.setRptPeriod('quarterly');
   await tick();
-  eq(reportReads(), 2, 'a period tab only regroups the same rows');
+  eq(reportReads(), 4, 'a period tab only regroups the same rows');
   c.onRptFolderChange();
   await tick();
-  eq(reportReads(), 4, 'choosing a folder reads again');
+  eq(reportReads(), 6, 'choosing a folder reads again');
   c.onRptYearChange();
   await tick();
-  eq(reportReads(), 6, 'choosing a year reads again');
+  eq(reportReads(), 8, 'choosing a year reads again');
   server.expenses = server.expenses.filter(e => e.id !== 'e1');
   c.refreshOvAllData();
   await tick();
-  eq(reportReads(), 8, 'a save while Reports is on screen reads again');
+  eq(reportReads(), 12, 'a save while Reports is on screen reads again: the shared copy\'s two tables and Reports\' two');
   assert.match(h.el('rptSummaryTbody').innerHTML, /151\.00/, 'and shows on it');
   h.el('expReportsView').style.display = 'none';
   c.refreshOvAllData();
   await tick();
-  eq(reportReads(), 8, 'not when Reports is not on screen: the next opening reads');
+  eq(reportReads(), 14, 'not when Reports is not on screen: only the shared copy\'s two, the next opening reads');
 }
 
 async function testReportNoteIsReadWithTheFigures() {
diff --git a/tests/payroll-fresh-read.test.js b/tests/payroll-fresh-read.test.js
new file mode 100644
index 0000000..8499acc
--- /dev/null
+++ b/tests/payroll-fresh-read.test.js
@@ -0,0 +1,898 @@
+// ═══════════════════════════════════════════════════════════════════
+// PAYROLL READ FRESH — run with:  node tests/payroll-fresh-read.test.js
+//
+// Zero dependencies. Loads the REAL js/print-utils.js, expenses-module.js,
+// overhead-module.js and invoice-module.js into one page-like context, and
+// runs them against an in-memory server shared with "another tab".
+//
+// WHY THIS EXISTS — _ovAllPayroll is a copy taken when the page loads, and
+// other accounts, tabs and devices change payroll without telling this page.
+// Project Control's lists are live, so a worker statement or a receipt printed
+// from that copy could disagree with the list above it and look correct.
+//
+// THE RULES UNDER GUARD
+//   1. The shared copy holds no photos (0.6 MB against 15 MB).
+//   2. A statement and a receipt read payroll just before printing. If the read
+//      fails, nothing is printed and the message says so: never the old copy.
+//   3. The print window opens on the click itself: a window opened after a wait
+//      can be blocked by the browser.
+//   4. The Overhead tab reads payroll when it opens. Until that read has landed,
+//      or if it fails, operating costs stay on screen while everything built on
+//      payroll is hidden (indirect labor, Project and Overall totals, the charts),
+//      its reports refuse and the page says why. Old figures are never shown.
+//   5. An older answer arriving late never replaces a newer one.
+//   6. Money rules and staff restrictions do not move.
+//
+// If a reader of the shared copy is added, the "every reader" test fails: check
+// that it needs no photo and that an old copy is safe for it, then list it.
+// ═══════════════════════════════════════════════════════════════════
+'use strict';
+const assert = require('assert');
+const fs = require('fs');
+const path = require('path');
+const vm = require('vm');
+const A = require('../js/billing-allocation.js');
+
+const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
+const UID = 'owner-1';
+const PHOTO = 'data:image/jpeg;base64,PHOTO-BYTES';
+const EXPENSE_PHOTOS = ['poImageUrl', 'deliveryReceiptUrl', 'supplierInvoiceUrl', 'paymentReceiptUrl'];
+const SOURCES = ['js/print-utils.js', 'js/expenses-module.js', 'js/overhead-module.js', 'js/invoice-module.js']
+  .map(f => [f, read(f)]);
+
+function row(id, fields) { return { id, userId: UID, ...fields }; }
+
+function freshRows() {
+  return {
+    payroll: [
+      row('pay1', { projectId: 'p', workerName: 'Mark', role: 'Mason', laborType: 'direct', contractId: 'k1', daysWorked: 2, dailyRate: 150, totalSalary: 300, paymentDate: '2026-10-05', paymentMethod: 'cash', receiptImages: [PHOTO] }),
+      row('pay2', { projectId: 'p', workerName: 'Mark', role: 'Mason', laborType: 'direct', contractId: 'k1', daysWorked: 1, dailyRate: 200, totalSalary: 200, paymentDate: '2026-10-06', paymentMethod: 'cash', receiptImages: [] }),
+      row('ind1', { projectId: 'p', workerName: 'Cora', role: 'Coordinator Site Supervision', laborType: 'indirect', totalSalary: 400, paymentDate: '2026-10-07', receiptImages: [] }),
+      row('dir1', { projectId: 'p', workerName: 'Nena', role: 'Helper', laborType: 'direct', totalSalary: 150, paymentDate: '2026-10-07', receiptImages: [] }),
+      { id: 'other', userId: 'someone-else', projectId: 'x', workerName: 'Other', totalSalary: 9999, paymentDate: '2026-10-07', receiptImages: [] }
+    ],
+    expenses: [
+      row('e1', { projectId: 'p', expenseName: 'Cement', category: 'Materials', amount: 1000, dateTime: '2026-10-03T09:00', poImageUrl: PHOTO, deliveryReceiptUrl: PHOTO, supplierInvoiceUrl: '', paymentReceiptUrl: PHOTO }),
+      row('e2', { projectId: 'c', expenseName: 'Sand', category: 'Materials', amount: 50, dateTime: '2026-10-03T09:00', coverExpense: true, poImageUrl: '', deliveryReceiptUrl: '', supplierInvoiceUrl: '', paymentReceiptUrl: '' })
+    ],
+    overheadExpenses: [
+      row('ov1', { scope: 'project', folderId: 'f', expenseName: 'Fuel', category: 'Fuel', amount: 500, date: '2026-10-02', status: 'paid' }),
+      row('co1', { scope: 'company', expenseName: 'Rent', category: 'Office Rent', amount: 70, date: '2026-10-02', status: 'paid' })
+    ],
+    users: [], settings: [], invoices: []
+  };
+}
+
+// The server every tab talks to. A read takes its rows when it is asked and
+// answers later, like a real one: `hold` delays the answer, `fail` refuses it.
+function makeServer() {
+  const server = { tables: freshRows(), reads: [], hold: null, holdCosts: null, fail: false, failPayroll: false, failCosts: false, listeners: {}, nextId: 1 };
+  server.push = name => (server.listeners[name] || []).forEach(run => run());
+  const answer = async (log, make) => {
+    const costs = log.table === 'overheadExpenses';
+    const hold = server.hold || (costs && server.holdCosts);
+    const fail = server.fail || (server.failPayroll && log.table === 'payroll') || (server.failCosts && costs);
+    server.reads.push(log);
+    const result = make();
+    if (hold) await hold;
+    if (fail) throw new Error('network down');
+    return result;
+  };
+  const query = name => {
+    const state = { where: [], omit: [] };
+    const api = {
+      where(field, op, value) { state.where.push([field, value]); return api; },
+      orderBy() { return api; },
+      limit() { return api; },
+      omit(...fields) { state.omit = fields.flat(); return api; },
+      get() {
+        return answer({ table: name, omit: state.omit.slice() }, () => {
+          const rows = (server.tables[name] || []).filter(r => state.where.every(([f, v]) => r[f] === v));
+          const docs = rows.map(r => {
+            const copy = JSON.parse(JSON.stringify(r));
+            const lazy = {};
+            state.omit.forEach(f => {
+              const v = copy[f];
+              if (v && (!Array.isArray(v) || v.length)) lazy[f] = true;
+              delete copy[f];
+            });
+            if (state.omit.length) copy._lazy = lazy;
+            return { id: r.id, data: () => copy };
+          });
+          return { docs, empty: !docs.length, size: docs.length, forEach: fn => docs.forEach(fn) };
+        });
+      },
+      onSnapshot(next, onErr) {
+        const run = () => api.get().then(next).catch(e => onErr && onErr(e));
+        (server.listeners[name] = server.listeners[name] || []).push(run);
+        run();
+        return () => { server.listeners[name] = server.listeners[name].filter(r => r !== run); };
+      },
+      async add(data) {
+        const id = 'new' + (server.nextId++);
+        (server.tables[name] = server.tables[name] || []).push({ id, ...data });
+        return { id };
+      },
+      doc(id) {
+        return {
+          id,
+          get() {
+            return answer({ table: name, doc: id, omit: [] }, () => {
+              const found = (server.tables[name] || []).find(r => r.id === id);
+              const copy = found ? JSON.parse(JSON.stringify(found)) : undefined;
+              return { id, exists: !!found, data: () => copy };
+            });
+          },
+          async update(patch) {
+            const found = (server.tables[name] || []).find(r => r.id === id);
+            if (!found) throw new Error('no row');
+            Object.assign(found, patch);
+          },
+          async delete() { server.tables[name] = (server.tables[name] || []).filter(r => r.id !== id); }
+        };
+      }
+    };
+    return api;
+  };
+  server.db = { collection: query };
+  return server;
+}
+
+function openTab(server, role) {
+  const elements = {};
+  const el = id => elements[id] || (elements[id] = {
+    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [],
+    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null,
+    getContext() { return this; }, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
+    appendChild() {}, addEventListener() {}, removeEventListener() {}, click() {}
+  });
+  const popups = [], alerts = [], toasts = [];
+  let popupsAllowed = true;
+  const makePopup = features => {
+    const popup = { features, chunks: [], closed: false, focus() {}, print() {}, addEventListener() {},
+      close() { popup.closed = true; },
+      document: { open() { popup.chunks = []; }, write(s) { popup.chunks.push(s); }, close() {} } };
+    popup.page = () => popup.chunks.join('');
+    return popup;
+  };
+  const windowObj = {
+    currentUserRole: role || 'owner',
+    location: { href: 'https://example.test/admin.html', origin: 'https://example.test' },
+    open: (url, name, features) => {
+      if (!popupsAllowed) return null;
+      const popup = makePopup(features);
+      popups.push(popup);
+      return popup;
+    },
+    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
+  };
+  const context = vm.createContext({
+    console: { log() {}, warn() {}, error() {}, info() {} }, ...A, window: windowObj,
+    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
+      createElement: () => el('created-' + Math.random()), createTextNode: () => ({}), body: { style: {}, appendChild() {}, removeChild() {} },
+      head: { appendChild() {} }, documentElement: { style: {} } },
+    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
+    navigator: { userAgent: 'test' },
+    Chart: class { constructor(canvas, config) { this.config = config; context.__charts = (context.__charts || 0) + 1; } destroy() {} update() {} },
+    Blob: class { constructor(parts) { context.__csv = parts.join(''); } },
+    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
+    firebase: { auth: () => ({ currentUser: { uid: UID, email: 'owner@example.test' } }) },
+    alert: m => alerts.push(m), confirm: () => true,
+    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Event: class {}, CustomEvent: class {},
+    db: server.db, currentUser: { uid: UID, email: 'owner@example.test' }
+  });
+  windowObj.document = context.document;
+  for (const [file, source] of SOURCES) vm.runInContext(source, context, { filename: file });
+  vm.runInContext(`
+    expFolders = [{ id:'f', name:'ZZ Barlin', totalBudget:100000 }];
+    expProjects = [{ id:'p', folderId:'f', month:'October', year:2026, monthlyBudget:5000 },
+                   { id:'c', folderId:'f', month:'October', year:2026, fundingType:'president' }];
+    expLaborContracts = [{ id:'k1', workerName:'Mark', agreedAmount:1000, category:'labor', payType:'pakyaw' }];
+    _rptOvhdRows = [];
+    showExpNotif = () => {};
+    _ovhdMonth = '2026-10';
+    _ovhdToast = (m, t) => { __toasts.push(m); };
+  `, Object.assign(context, { __toasts: toasts }));
+  el('expReportsView').style.display = 'none';
+  const tab = { context, w: windowObj, el, popups, alerts, toasts, server,
+    run: code => vm.runInContext(code, context),
+    blockPopups() { popupsAllowed = false; },
+    // What a page does when it loads, finished.
+    async load() { context.subscribeOvAllData(); await tick(); return tab; } };
+  return tab;
+}
+
+const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
+const gate = () => { let open; const hold = new Promise(r => { open = r; }); return { hold, open }; };
+const lastPage = tab => tab.popups[tab.popups.length - 1].page();
+const reads = (server, table) => server.reads.filter(r => r.table === table);
+
+let passed = 0, failed = 0;
+const failures = [];
+async function test(name, fn) {
+  try { await fn(); passed++; console.log('  ok  ' + name); }
+  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n')[0]); }
+}
+
+(async () => {
+  console.log('\npayroll read fresh');
+
+  console.log('\n— the shared copy holds no photos');
+
+  await test('the page-load read leaves out every photo column, so no full table is downloaded', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    assert.deepStrictEqual(reads(server, 'expenses').map(r => r.omit), [EXPENSE_PHOTOS]);
+    assert.deepStrictEqual(reads(server, 'payroll').map(r => r.omit), [['receiptImages']]);
+    const copy = tab.run('JSON.stringify(_ovAllExpenses) + JSON.stringify(_ovAllPayroll)');
+    assert.ok(!copy.includes('PHOTO-BYTES'), 'no photo in the shared copy');
+    assert.strictEqual(tab.run('_ovAllPayroll.length'), 4, 'only this account\'s rows');
+  });
+
+  await test('the amounts in the shared copy are unchanged, and Cover stays inside Spent', async () => {
+    const tab = await openTab(makeServer()).load();
+    assert.strictEqual(tab.run("expProjects.find(p => p.id === 'p')._spent"), 1000 + 300 + 200 + 400 + 150);
+    assert.strictEqual(tab.run("expProjects.find(p => p.id === 'c')._spent"), 50);
+    const model = tab.run("_pcReportModel('f')");
+    assert.strictEqual(model.totals.mats, 1050);
+    assert.strictEqual(model.totals.cover, 50, 'Cover is a subset of Spent, never a fourth bucket');
+    assert.strictEqual(model.totals.totalSpent, 1050 + 650 + 400, 'Labor 650 + Materials 1050 + indirect 400, each once');
+  });
+
+  await test('the worker receipt summary still gets its photos: it fetches a photo-free row when needed', async () => {
+    const tab = await openTab(makeServer()).load();
+    const filled = await tab.context._fillLazyPayroll(tab.run("_mergePayrollPools().filter(p => p.workerName === 'Mark')"));
+    const pay1 = filled.find(p => p.id === 'pay1');
+    assert.deepStrictEqual(Array.from(pay1.receiptImages), [PHOTO], 'pay1 has a photo: fetched');
+    const after = tab.run("_mergePayrollPools().find(p => p.id === 'pay1')");
+    assert.deepStrictEqual(Array.from(after.receiptImages), [PHOTO], 'and the print that follows finds it in the full-row cache');
+  });
+
+  await test('an older answer arriving late never replaces a newer one, for either table', async () => {
+    const server = makeServer();
+    const tab = openTab(server);
+    const slow = gate();
+    server.hold = slow.hold;
+    tab.context.subscribeOvAllData();
+    await tick();
+    server.hold = null;
+    server.tables.payroll = server.tables.payroll.filter(p => p.id !== 'dir1');
+    server.tables.expenses = server.tables.expenses.filter(e => e.id !== 'e2');
+    tab.context.subscribeOvAllData();
+    await tick();
+    slow.open();
+    await tick();
+    assert.strictEqual(tab.run('_ovAllPayroll.length'), 3, 'payroll stays the newer read');
+    assert.strictEqual(tab.run('_ovAllExpenses.length'), 1, 'expenses stay the newer read');
+  });
+
+  await test('every reader of the shared copy is known: none uses a photo', () => {
+    const allowed = {
+      'js/expenses-module.js': ['_expNoPeriodRows', '_mergePayrollPools', '_ovReadPayroll', '_pcReportModel', '_rptAllTimeGroups', 'loadRptData',
+        'mvpPayRenderFolderGrid', 'mvpPayRenderProjectGrid', 'mvpPayRenderTable', 'mvpRenderFolderGrid', '_updateSpent'],
+      'js/invoice-module.js': ['printPayrollInvoice'],
+      'js/overhead-module.js': ['_ovhdIndirectRows']
+    };
+    const photo = /receiptImages|receiptURL|poImageUrl|deliveryReceiptUrl|supplierInvoiceUrl|paymentReceiptUrl/;
+    const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
+      .replace(/^let _ovAll(Expenses|Payroll).*$/gm, '').replace(/^const _EXP_PHOTO_FIELDS.*$/m, '').replace(/\.omit\('receiptImages'\)/g, '.omit()');
+    for (const file of fs.readdirSync(path.join(__dirname, '../js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)) {
+      const src = stripComments(read(file));
+      if (!/_ovAll(Expenses|Payroll)/.test(src)) continue;
+      assert.ok(allowed[file], file + ' reads the shared copy: check it needs no photo and that an old copy is safe, then list it');
+      // Split on top-level functions, whichever way the file declares them.
+      const parts = src.split(/\n(?=(?: {0,4})(?:async function [\w$]+\(|function [\w$]+\(|window\.[\w$]+ = (?:async )?function))/);
+      const names = new Set();
+      for (const part of parts) {
+        if (!/_ovAll(Expenses|Payroll)/.test(part)) continue;
+        const m = part.match(/^\s*(?:async )?(?:function ([\w$]+)|window\.([\w$]+) =)/);
+        const name = m ? (m[1] || m[2]) : '(module top)';
+        if (name === '(module top)') continue;
+        names.add(name);
+        assert.ok(!photo.test(part), name + ' in ' + file + ' reads a photo field');
+      }
+      assert.deepStrictEqual([...names].sort(), allowed[file].slice().sort(), file);
+    }
+  });
+
+  console.log('\n— a receipt reads its entry just before printing');
+
+  await test('payroll ADDED from another tab: the receipt prints it (it used to say "not found")', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const { id } = await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Lito', role: 'Painter', daysWorked: 3, dailyRate: 250, totalSalary: 750, paymentDate: '2026-10-08' });
+    await tab.w.printSinglePayrollInvoice(id);
+    assert.deepStrictEqual(tab.alerts, []);
+    assert.ok(lastPage(tab).includes('Lito') && lastPage(tab).includes('750.00'), 'the new entry');
+  });
+
+  await test('payroll EDITED from another tab: the receipt prints the new amount, not the old one', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await server.db.collection('payroll').doc('pay1').update({ totalSalary: 345 });
+    await tab.w.printSinglePayrollInvoice('pay1');
+    assert.ok(lastPage(tab).includes('345.00'), 'the new amount');
+    assert.ok(!lastPage(tab).includes('300.00'), 'not the old one');
+  });
+
+  await test('payroll DELETED from another tab: nothing printed, the window closes, the message says why', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await server.db.collection('payroll').doc('pay1').delete();
+    await tab.w.printSinglePayrollInvoice('pay1');
+    assert.ok(tab.popups[0].closed, 'the window closed');
+    assert.ok(!tab.popups[0].page().includes('300.00'), 'nothing printed from the old copy');
+    assert.strictEqual(tab.alerts.length, 1);
+    assert.match(tab.alerts[0], /no longer exists/);
+    assert.match(tab.alerts[0], /nothing was printed/);
+  });
+
+  await test('the read fails: nothing printed, the window closes, the message says so', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    server.fail = true;
+    await tab.w.printSinglePayrollInvoice('pay1');
+    assert.ok(tab.popups[0].closed);
+    assert.ok(!tab.popups[0].page().includes('300.00'), 'never the old copy');
+    assert.strictEqual(tab.alerts.length, 1);
+    assert.match(tab.alerts[0], /nothing was printed/);
+    assert.match(tab.alerts[0], /connection/);
+  });
+
+  await test('the window opens on the click itself, before the read; pop-ups blocked means no read and a message', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const slow = gate();
+    server.hold = slow.hold;
+    const pending = tab.w.printSinglePayrollInvoice('pay1');
+    assert.strictEqual(tab.popups.length, 1, 'open before anything is awaited');
+    assert.ok(!tab.popups[0].page().includes('300.00'));
+    slow.open();
+    await pending;
+    assert.ok(lastPage(tab).includes('300.00'));
+    assert.ok(!lastPage(tab).includes('Preparing'), 'the waiting text is gone from the finished page');
+
+    const blocked = await openTab(makeServer()).load();
+    blocked.blockPopups();
+    const before = blocked.server.reads.length;
+    await blocked.w.printSinglePayrollInvoice('pay1');
+    assert.strictEqual(blocked.server.reads.length, before, 'no read');
+    assert.match(blocked.alerts[0], /pop-ups/);
+  });
+
+  console.log('\n— a statement reads payroll just before printing');
+
+  await test('payroll ADDED from another tab is on the statement, in the total and in Paid', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', role: 'Mason', laborType: 'direct', contractId: 'k1', daysWorked: 1, dailyRate: 250, totalSalary: 250, paymentDate: '2026-10-08' });
+    await tab.w.printWorkerLaborSOA('Mark', 'f');
+    const page = lastPage(tab);
+    assert.deepStrictEqual(tab.alerts, []);
+    assert.ok(page.includes('250.00'), 'the new payment');
+    assert.ok(page.includes('750.00'), 'Paid and total 300 + 200 + 250');
+    assert.ok(page.includes('1,000.00'), 'agreed');
+  });
+
+  await test('payroll EDITED from another tab: the statement shows the new amount and total', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await server.db.collection('payroll').doc('pay2').update({ totalSalary: 225 });
+    await tab.w.printWorkerLaborSOA('Mark', 'f');
+    assert.ok(lastPage(tab).includes('225.00') && lastPage(tab).includes('525.00'), 'new amount and total');
+    assert.ok(!lastPage(tab).includes('500.00'), 'not the old total');
+  });
+
+  await test('payroll DELETED from another tab: gone from the statement and from the total', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await server.db.collection('payroll').doc('pay2').delete();
+    await tab.w.printWorkerLaborSOA('Mark', 'f');
+    assert.ok(!lastPage(tab).includes('200.00'), 'the deleted payment');
+    assert.ok(!lastPage(tab).includes('500.00'), 'the old total');
+    assert.ok(lastPage(tab).includes('700.00'), 'Remaining 1,000 − 300');
+  });
+
+  await test('every entry deleted: the window closes and the message says there are none', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    server.tables.payroll = server.tables.payroll.filter(p => p.workerName !== 'Mark');
+    await tab.w.printWorkerLaborSOA('Mark', 'f');
+    assert.ok(tab.popups[0].closed);
+    assert.match(tab.alerts[0], /No labor entries found for Mark/);
+  });
+
+  await test('the read fails: nothing printed, the window closes, the message says so', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    server.fail = true;
+    await tab.w.printWorkerLaborSOA('Mark', 'f');
+    assert.ok(tab.popups[0].closed);
+    assert.ok(!tab.popups[0].page().includes('500.00'), 'never the old copy');
+    assert.strictEqual(tab.alerts.length, 1);
+    assert.match(tab.alerts[0], /nothing was printed/);
+    assert.match(tab.alerts[0], /connection/);
+  });
+
+  await test('the window opens on the click itself; pop-ups blocked means no read and a message', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const slow = gate();
+    server.hold = slow.hold;
+    const pending = tab.w.printWorkerLaborSOA('Mark', 'f');
+    assert.strictEqual(tab.popups.length, 1, 'open before anything is awaited');
+    slow.open();
+    await pending;
+    assert.ok(lastPage(tab).includes('500.00'));
+    assert.ok(!lastPage(tab).includes('Preparing'), 'the waiting text is gone from the finished page');
+
+    const blocked = await openTab(makeServer()).load();
+    blocked.blockPopups();
+    const before = blocked.server.reads.length;
+    await blocked.w.printWorkerLaborSOA('Mark', 'f');
+    assert.strictEqual(blocked.server.reads.length, before, 'no read');
+    assert.match(blocked.alerts[0], /pop-ups/);
+  });
+
+  await test('a vendor statement still keeps vendors and workers apart', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    tab.run("expLaborContracts.push({ id:'v1', workerName:'Mark', agreedAmount:5000, category:'outsource' });");
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark Vendor', contractId: 'v1', totalSalary: 640, paymentDate: '2026-10-09' });
+    await tab.w.printWorkerLaborSOA('Mark', 'f', 'outsource');
+    assert.ok(lastPage(tab).includes('640.00'), 'the vendor payment, by its contract');
+    assert.ok(lastPage(tab).includes('5,000.00'), 'the vendor contract');
+    assert.ok(!lastPage(tab).includes('1,000.00'), 'not the worker contract');
+  });
+
+  console.log('\n— printing immediately after a save');
+
+  await test('a statement right after a save has the new entry, even while the page\'s own refresh is still on its way', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', contractId: 'k1', totalSalary: 275, paymentDate: '2026-10-08' });
+    const slow = gate();
+    server.hold = slow.hold;
+    tab.context.refreshOvAllData();     // what every Add/Edit Payroll save calls
+    await tick();
+    server.hold = null;
+    await tab.w.printWorkerLaborSOA('Mark', 'f');
+    assert.ok(lastPage(tab).includes('275.00') && lastPage(tab).includes('775.00'), 'the entry just saved, and the total');
+    slow.open();
+    await tick();
+    assert.strictEqual(tab.run('_ovAllPayroll.length'), 5, 'and the slower refresh changes nothing');
+  });
+
+  await test('a receipt right after a save prints the entry just saved', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const { id } = await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Lito', totalSalary: 880, paymentDate: '2026-10-08' });
+    const slow = gate();
+    server.hold = slow.hold;
+    tab.context.refreshOvAllData();
+    await tick();
+    server.hold = null;
+    await tab.w.printSinglePayrollInvoice(id);
+    assert.deepStrictEqual(tab.alerts, []);
+    assert.ok(lastPage(tab).includes('880.00'));
+    slow.open();
+    await tick();
+  });
+
+  await test('a late answer from before the save never brings the old rows back into the shared copy', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const slow = gate();
+    server.hold = slow.hold;
+    tab.context.refreshOvAllData();     // reads, and is slow
+    await tick();
+    server.hold = null;
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', contractId: 'k1', totalSalary: 275, paymentDate: '2026-10-08' });
+    await tab.w.printWorkerLaborSOA('Mark', 'f');
+    slow.open();
+    await tick();
+    assert.strictEqual(tab.run('_ovAllPayroll.length'), 5, 'the statement\'s newer read stands');
+  });
+
+  await test('a statement whose read is overtaken by a newer one prints the newer rows', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const slow = gate();
+    server.hold = slow.hold;
+    const pending = tab.w.printWorkerLaborSOA('Mark', 'f');
+    await tick();
+    server.hold = null;
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', contractId: 'k1', totalSalary: 275, paymentDate: '2026-10-08' });
+    tab.context.refreshOvAllData();
+    await tick();
+    slow.open();
+    await pending;
+    assert.ok(lastPage(tab).includes('275.00') && lastPage(tab).includes('775.00'), 'never the older answer');
+  });
+
+  await test('an overtaken read that answers first waits for the newer one: never the old copy', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const first = gate(), second = gate();
+    server.hold = first.hold;
+    const pending = tab.w.printWorkerLaborSOA('Mark', 'f');
+    await tick();
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', contractId: 'k1', totalSalary: 275, paymentDate: '2026-10-08' });
+    server.hold = second.hold;
+    tab.context.refreshOvAllData();
+    await tick();
+    first.open();
+    await tick();
+    assert.ok(!tab.popups[0].page().includes('500.00'), 'still waiting, not printed from the old copy');
+    second.open();
+    await pending;
+    assert.ok(lastPage(tab).includes('275.00') && lastPage(tab).includes('775.00'), 'the newer rows');
+  });
+
+  console.log('\n— the Overhead tab reads payroll when it opens');
+
+  const openOverhead = async tab => { tab.context.initOverheadModule(); await tick(); };
+  const amounts = tab => ({ project: tab.el('ovhdProjectAmount').textContent, company: tab.el('ovhdCompanyAmount').textContent, overall: tab.el('ovhdOverallAmount').textContent });
+  const money = s => Number(String(s).replace(/[^0-9.]/g, ''));
+
+  await test('indirect labor is in its totals once, and direct labor is not', async () => {
+    const tab = await openTab(makeServer()).load();
+    await openOverhead(tab);
+    assert.strictEqual(money(amounts(tab).project), 500 + 400, 'fuel 500 + coordinator 400, not the mason or helper');
+    assert.strictEqual(money(amounts(tab).company), 70);
+    assert.strictEqual(money(amounts(tab).overall), 970);
+  });
+
+  await test('payroll ADDED, EDITED and DELETED from another tab all show when Overhead is opened', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await openOverhead(tab);
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Dino', role: 'Coordinator', laborType: 'indirect', totalSalary: 90, paymentDate: '2026-10-09' });
+    await openOverhead(tab);
+    assert.strictEqual(money(amounts(tab).project), 990, 'added');
+    await server.db.collection('payroll').doc('ind1').update({ totalSalary: 410 });
+    await openOverhead(tab);
+    assert.strictEqual(money(amounts(tab).project), 1000, 'edited');
+    await server.db.collection('payroll').doc('ind1').delete();
+    await openOverhead(tab);
+    assert.strictEqual(money(amounts(tab).project), 590, 'deleted');
+  });
+
+  await test('direct labor added from another tab stays out of Overhead: counted once, as Labor', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mason Two', role: 'Mason', laborType: 'direct', totalSalary: 600, paymentDate: '2026-10-09' });
+    await openOverhead(tab);
+    assert.strictEqual(money(amounts(tab).project), 900);
+  });
+
+  // What must be gone while payroll is not current, wherever it would show.
+  const assertNoPayrollFigures = (tab, word) => {
+    assert.strictEqual(tab.el('ovhdProjectAmount').textContent, word, 'Project is a combined total');
+    assert.strictEqual(tab.el('ovhdOverallAmount').textContent, word, 'Overall is a combined total');
+    assert.strictEqual(tab.el('ovhdChartsBlock').style.display, 'none', 'the charts are built on the combined rows');
+    assert.ok(!tab.el('ovhdTableBody').innerHTML.includes('Cora'), 'no individual indirect pay in the table');
+    assert.ok(!tab.el('ovhdBreakdownList').innerHTML.includes('Coordinator'), 'no indirect labor in the breakdown');
+    assert.strictEqual(tab.run('_ovhdRows().some(r => r.fromPayroll)'), false, 'nor in the rows every section reads');
+    const cards = amounts(tab);
+    assert.ok(!/900|970|400/.test(cards.project + cards.overall + tab.el('ovhdProjectTrend').innerHTML), 'no old or combined figure in the cards');
+  };
+  const assertOperatingCostsShow = (tab, company = 70, project = 500) => {
+    assert.strictEqual(money(amounts(tab).company), company, 'Company overhead has no payroll in it');
+    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Fuel'), 'project operating cost listed');
+    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Rent'), 'company operating cost listed');
+    assert.ok(tab.el('ovhdBreakdownList').innerHTML.includes('Fuel'), 'and in the breakdown');
+    assert.match(tab.el('ovhdProjectTrend').innerHTML, /Operating costs only/, 'labelled, so it is not read as Project Overhead');
+    assert.ok(tab.el('ovhdProjectTrend').innerHTML.includes(project.toFixed(2)), 'with its amount');
+  };
+
+  await test('while it reads: operating costs show, payroll and combined totals do not, and reports refuse', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const slow = gate();
+    server.hold = slow.hold;
+    tab.context.initOverheadModule();
+    await tick();
+    assert.match(tab.el('ovhdPayrollNote').textContent, /Loading the latest payroll/);
+    assert.notStrictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
+    tab.context.printOverheadReport('monthly');
+    tab.context.exportOverheadCsv();
+    assert.strictEqual(tab.popups.length, 0, 'no print');
+    assert.strictEqual(tab.context.__csv, undefined, 'no CSV');
+    assert.strictEqual(tab.toasts.length, 2, 'each says why');
+    server.hold = null;
+    slow.open();
+    await tick();
+    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none', 'the note goes away');
+    assert.notStrictEqual(tab.el('ovhdChartsBlock').style.display, 'none', 'the charts come back');
+    assert.strictEqual(money(amounts(tab).project), 900);
+    tab.context.exportOverheadCsv();
+    assert.ok(tab.context.__csv.includes('Cora'), 'CSV has indirect labor');
+    tab.context.printOverheadReport('monthly');
+    assert.strictEqual(tab.popups.length, 1, 'print works');
+  });
+
+  await test('re-opening never redraws the old payroll figures, even for the moment of the read', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await openOverhead(tab);
+    assert.strictEqual(money(amounts(tab).project), 900);
+    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Cora'));
+    const slow = gate();
+    server.hold = slow.hold;
+    tab.context.initOverheadModule();     // nothing awaited: exactly what is on screen at once
+    assertNoPayrollFigures(tab, 'Loading…');
+    server.hold = null;
+    slow.open();
+    await tick();
+  });
+
+  await test('payroll fails: operating costs stay; payroll, combined totals and charts are hidden, even after a good visit', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await openOverhead(tab);
+    assert.strictEqual(money(amounts(tab).overall), 970, 'a good visit');
+    server.failPayroll = true;
+    await openOverhead(tab);
+    assertNoPayrollFigures(tab, 'Unavailable');
+    assertOperatingCostsShow(tab);
+    assert.match(tab.el('ovhdPayrollNote').textContent, /Payroll is unavailable/);
+    assert.match(tab.el('ovhdPayrollNote').textContent, /open Overhead again/);
+    assert.match(tab.el('ovhdBreakdownList').innerHTML, /of operating costs/, 'a share of what is shown, never "of total"');
+    assert.doesNotMatch(tab.el('ovhdBreakdownList').innerHTML, /of total/);
+    tab.context.printOverheadReport('monthly');
+    tab.context.exportOverheadCsv();
+    assert.strictEqual(tab.popups.length, 0);
+    assert.strictEqual(tab.context.__csv, undefined);
+    assert.ok(tab.toasts.every(t => /Payroll is unavailable/.test(t)) && tab.toasts.length === 2);
+  });
+
+  await test('payroll fails: the charts are not drawn at all, so none can hold an operating-only total', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    server.failPayroll = true;
+    await openOverhead(tab);
+    assert.strictEqual(tab.context.__charts || 0, 0, 'no chart drawn');
+  });
+
+  await test('payroll fails: operating costs stay current while the page is open, and the rest stays hidden', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    server.failPayroll = true;
+    await openOverhead(tab);
+    server.tables.overheadExpenses.push(row('co2', { scope: 'company', expenseName: 'Water', category: 'Water', amount: 30, date: '2026-10-03', status: 'paid' }));
+    server.tables.overheadExpenses.push(row('ov2', { scope: 'project', folderId: 'f', expenseName: 'Diesel', category: 'Fuel', amount: 25, date: '2026-10-03', status: 'paid' }));
+    server.push('overheadExpenses');
+    await tick();
+    assertOperatingCostsShow(tab, 100, 525);
+    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Water'), 'the new cost is listed');
+    assertNoPayrollFigures(tab, 'Unavailable');
+  });
+
+  await test('payroll fails with a category filter on a payroll role: the filter stays, the rows stay hidden, and it works again after', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await openOverhead(tab);
+    const role = 'Coordinator Site Supervision';
+    tab.el('ovhdCategorySel').value = role;
+    tab.context.onOverheadCategoryChange(role);
+    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Cora'));
+    server.failPayroll = true;
+    await openOverhead(tab);
+    assert.ok(tab.el('ovhdCategorySel').innerHTML.includes(role), 'the chosen filter is still offered, not silently dropped');
+    assert.strictEqual(tab.run('_ovhdCategory'), role);
+    assert.ok(!tab.el('ovhdTableBody').innerHTML.includes('Cora'));
+    server.failPayroll = false;
+    await openOverhead(tab);
+    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Cora'), 'back when payroll is');
+  });
+
+  await test('opening Overhead again retries, and everything comes back', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    server.failPayroll = true;
+    await openOverhead(tab);
+    server.failPayroll = false;
+    await openOverhead(tab);
+    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
+    assert.notStrictEqual(tab.el('ovhdChartsBlock').style.display, 'none');
+    assert.strictEqual(money(amounts(tab).project), 900);
+    assert.strictEqual(money(amounts(tab).overall), 970);
+    assert.doesNotMatch(tab.el('ovhdProjectTrend').innerHTML, /Operating costs only/);
+    assert.match(tab.el('ovhdBreakdownList').innerHTML, /of total/);
+    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Cora'));
+    assert.ok((tab.context.__charts || 0) > 0, 'the charts are drawn again');
+    tab.context.exportOverheadCsv();
+    assert.ok(tab.context.__csv.includes('Cora'));
+  });
+
+  await test('offline from the start: costs did not load either, so nothing claims to show them, and no false zero appears', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    server.fail = true;      // payroll and the operating costs both fail
+    await openOverhead(tab);
+    assert.strictEqual(tab.el('ovhdCompanyAmount').textContent, 'Unavailable', 'not ₱0.00');
+    assert.strictEqual(tab.el('ovhdProjectAmount').textContent, 'Unavailable');
+    assert.strictEqual(tab.el('ovhdOverallAmount').textContent, 'Unavailable');
+    assert.match(tab.el('ovhdPayrollNote').textContent, /Payroll and operating costs are unavailable/);
+    assert.doesNotMatch(tab.el('ovhdPayrollNote').textContent, /still show/);
+    assert.doesNotMatch(tab.el('ovhdTableBody').innerHTML, /No overhead expenses match/, 'an unloaded list must not read as an empty one');
+    assert.doesNotMatch(tab.el('ovhdBreakdownList').innerHTML, /No expenses match/);
+    server.fail = false;
+    await openOverhead(tab);
+    await tick();
+    assert.strictEqual(money(amounts(tab).company), 70, 'opening again re-reads the costs too');
+    assert.strictEqual(money(amounts(tab).project), 900);
+    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
+  });
+
+  await test('payroll fails first, then the costs arrive: the page moves from "both unavailable" to showing them', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const costs = gate();
+    server.holdCosts = costs.hold;
+    server.failPayroll = true;
+    await openOverhead(tab);
+    assert.match(tab.el('ovhdPayrollNote').textContent, /Payroll and operating costs are unavailable/);
+    assert.strictEqual(tab.el('ovhdCompanyAmount').textContent, 'Unavailable');
+    server.holdCosts = null;
+    costs.open();
+    await tick();
+    assert.match(tab.el('ovhdPayrollNote').textContent, /Payroll is unavailable/);
+    assert.match(tab.el('ovhdPayrollNote').textContent, /still show/);
+    assertOperatingCostsShow(tab);
+    assertNoPayrollFigures(tab, 'Unavailable');
+  });
+
+  await test('the costs fail while payroll is fine: nothing is stuck on Loading, the page says so, reports refuse, opening again retries', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const costs = gate();
+    server.holdCosts = costs.hold;
+    server.failCosts = true;
+    await openOverhead(tab);
+    assert.strictEqual(tab.el('ovhdCompanyAmount').textContent, 'Loading…', 'payroll has landed, the costs have not answered');
+    costs.open();
+    await tick();
+    assert.strictEqual(tab.el('ovhdCompanyAmount').textContent, 'Unavailable');
+    assert.strictEqual(tab.el('ovhdProjectAmount').textContent, 'Unavailable', 'payroll alone is not Project Overhead');
+    assert.strictEqual(tab.el('ovhdOverallAmount').textContent, 'Unavailable');
+    assert.match(tab.el('ovhdPayrollNote').textContent, /^Operating costs are unavailable/);
+    tab.context.exportOverheadCsv();
+    tab.context.printOverheadReport('monthly');
+    assert.strictEqual(tab.context.__csv, undefined);
+    assert.strictEqual(tab.popups.length, 0);
+    assert.ok(tab.toasts.length === 2 && tab.toasts.every(t => /Operating costs are unavailable/.test(t)));
+    server.holdCosts = null;
+    server.failCosts = false;
+    await openOverhead(tab);
+    assert.strictEqual(money(amounts(tab).overall), 970);
+    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
+  });
+
+  await test('an older Overhead read arriving late cannot put its failure or its rows back', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    const slow = gate();
+    server.hold = slow.hold;
+    server.fail = true;
+    tab.context.initOverheadModule();
+    await tick();
+    server.hold = null;
+    server.fail = false;
+    await openOverhead(tab);
+    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
+    slow.open();
+    await tick();
+    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none', 'the late failure is ignored');
+    await tick();
+    assert.strictEqual(money(amounts(tab).project), 900);
+  });
+
+  await test('an Overhead read overtaken by a newer one draws the newer rows', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await openOverhead(tab);
+    const slow = gate();
+    server.hold = slow.hold;
+    tab.context.initOverheadModule();
+    await tick();
+    server.hold = null;
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Dino', role: 'Coordinator', laborType: 'indirect', totalSalary: 90, paymentDate: '2026-10-09' });
+    tab.context.refreshOvAllData();
+    await tick();
+    slow.open();
+    await tick();
+    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
+    assert.strictEqual(money(amounts(tab).project), 990, 'the newer rows, not the page\'s old copy');
+  });
+
+  await test('an overtaken Overhead read that answers first keeps waiting: never the old copy', async () => {
+    const server = makeServer();
+    const tab = await openTab(server).load();
+    await openOverhead(tab);
+    const first = gate(), second = gate();
+    server.hold = first.hold;
+    tab.context.initOverheadModule();
+    await tick();
+    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Dino', role: 'Coordinator', laborType: 'indirect', totalSalary: 90, paymentDate: '2026-10-09' });
+    server.hold = second.hold;
+    tab.context.refreshOvAllData();
+    await tick();
+    first.open();
+    await tick();
+    assert.match(tab.el('ovhdPayrollNote').textContent, /Loading/, 'still says it is loading');
+    second.open();
+    await tick();
+    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
+    assert.strictEqual(money(amounts(tab).project), 990, 'the newer rows');
+  });
+
+  console.log('\n— staff and money rules do not move');
+
+  await test('the buttons stay hidden from staff in Project Control', () => {
+    const portal = read('js/portal-app.compiled.js');
+    assert.ok(/!_staff\(\) && rc\("button", \{ className: "lc2-rowbtn", title: "Receipt \/ Invoice"/.test(portal), 'receipt button');
+    assert.ok(/!_staff\(\) && rc\("div", \{ ref: soaRef/.test(portal), 'worker statement menu');
+  });
+
+  await test('staff read no more than before: same tables, no photos, and Reports figures stay hidden', async () => {
+    const server = makeServer();
+    const tab = await openTab(server, 'staff').load();
+    assert.deepStrictEqual(server.reads.filter(r => r.table === 'expenses' || r.table === 'payroll').map(r => r.omit.length > 0), [true, true], 'one photo-free read of each');
+    assert.ok(!server.reads.some(r => ['overheadExpenses', 'invoices', 'folderBudgets', 'projectBudgets'].includes(r.table)), 'no extra money table');
+    assert.ok(!tab.run('JSON.stringify(_ovAllPayroll)').includes('PHOTO-BYTES'));
+    const model = tab.run("_pcReportModel('f')");
+    assert.strictEqual(model.totals, null, 'no totals');
+    assert.strictEqual(JSON.stringify(model.rows).match(/1000|1050|totalSpent/), null, 'no pesos');
+  });
+
+  await test('the Overhead messages name no amount', async () => {
+    const server = makeServer();
+    const tab = await openTab(server, 'staff').load();
+    server.fail = true;
+    await openOverhead(tab);
+    assert.ok(!/₱|\d/.test(tab.el('ovhdPayrollNote').textContent), 'no peso, no figure');
+    tab.context.exportOverheadCsv();
+    assert.ok(!/₱|\d/.test(tab.toasts.join(' ')));
+    assert.ok(!/₱|\d/.test(tab.el('ovhdProjectAmount').textContent + tab.el('ovhdOverallAmount').textContent), 'the hidden cards hold only a word');
+  });
+
+  await test('no read of the shared copy feeds a save: nothing here writes', () => {
+    for (const fn of ['_ovReadPayroll', 'subscribeOvAllData']) {
+      const src = read('js/expenses-module.js');
+      const i = src.indexOf('function ' + fn + '(');
+      assert.ok(i >= 0, 'SLICE NOT FOUND: ' + fn);
+      const body = src.slice(i, src.indexOf('\n}\n', i));
+      assert.ok(!/\.(add|set|update|delete|addMany)\(/.test(body), fn + ' must only read');
+    }
+    const overhead = read('js/overhead-module.js');
+    const i = overhead.indexOf('function _ovhdRefreshPayroll(');
+    assert.ok(i >= 0, 'SLICE NOT FOUND: _ovhdRefreshPayroll');
+    assert.ok(!/\.(add|set|update|delete)\(/.test(overhead.slice(i, overhead.indexOf('\n}\n', i))), 'Overhead refresh must only read');
+  });
+
+  await test('admin.html: the Overhead note exists, and browsers are told to load the new scripts', () => {
+    const html = read('admin.html');
+    assert.strictEqual((html.match(/id="ovhdPayrollNote"/g) || []).length, 1, 'one note');
+    assert.ok(html.indexOf('id="ovhdPayrollNote"') > html.indexOf('id="expOverheadView"'), 'inside the Overhead view');
+    assert.ok(html.indexOf('id="ovhdPayrollNote"') < html.indexOf('/expOverheadView'), 'inside the Overhead view');
+    for (const f of ['expenses-module', 'overhead-module', 'invoice-module']) {
+      assert.ok(new RegExp('<script src="js/' + f + '\\.js\\?v=20261104b"></script>').test(html), f + ' version');
+    }
+    assert.ok(html.indexOf('js/expenses-module.js') < html.indexOf('js/invoice-module.js'), 'the read is defined before the prints use it');
+    assert.strictEqual((html.match(/id="ovhdChartsBlock"/g) || []).length, 1, 'one chart block');
+    const start = html.indexOf('<div id="ovhdChartsBlock">') + '<div id="ovhdChartsBlock">'.length;
+    const block = html.slice(start, html.indexOf('</div><!-- /ovhdChartsBlock -->'));
+    let depth = 0;
+    for (const tag of block.match(/<div\b|<\/div>/g) || []) {
+      depth += tag === '</div>' ? -1 : 1;
+      assert.ok(depth >= 0, 'the block must not close before its charts');
+    }
+    assert.strictEqual(depth, 0, 'its cards are balanced, so the marked end is its real end');
+    for (const id of ['ovhdScopeChart', 'ovhdMonthlyChart', 'ovhdTrendChart']) assert.ok(block.includes(id), id + ' is inside the block');
+  });
+
+  console.log('\n' + passed + ' passed, ' + failed + ' failed');
+  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exitCode = 1; }
+})();
diff --git a/tests/purchase-screens.test.js b/tests/purchase-screens.test.js
index 412462b..fa598d6 100644
--- a/tests/purchase-screens.test.js
+++ b/tests/purchase-screens.test.js
@@ -33,7 +33,7 @@ function harness({ rpc, collections }) {
   const notes = [], dbCalls = [];
   const snap = (rows) => ({ docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }), ref: { delete: async () => {} } })), size: rows.length, empty: !rows.length });
   const query = (name) => {
-    const q = { where: () => q, limit: () => q, get: async () => { dbCalls.push(name); return snap((collections || {})[name] || []); },
+    const q = { where: () => q, limit: () => q, omit: () => q, get: async () => { dbCalls.push(name); return snap((collections || {})[name] || []); },
                 onSnapshot: (next) => { next(snap((collections || {})[name] || [])); return () => {}; } };
     return q;
   };
```

## Appendix B: the real-Chrome check

Not part of the repo. Run from a scratch folder with `npm i puppeteer-core@24`, then `node check.js <path to the working tree>`.

```js
// Real Chrome, real clicks, the real scripts from the scratch copy, a fake server.
// Answers one question fake browsers cannot: does the print window survive a slow read?
const http = require('http'), fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = process.argv[2];
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const PAGE = `<!doctype html><meta charset="utf-8"><title>print check</title>
<button id="statement" onclick="printWorkerLaborSOA('Mark','f')">Statement</button>
<button id="receipt" onclick="printSinglePayrollInvoice(window.RECEIPT_ID || 'pay1')">Receipt</button>
<button id="naive" onclick="naive()">Read, then open</button>
<div id="out"></div>
<script>
  const UID = 'owner-1';
  window.READ_DELAY = 0; window.READ_FAIL = false;
  window.currentUserRole = 'owner';
  const SERVER = {
    payroll: [
      { id:'pay1', userId:UID, projectId:'p', workerName:'Mark', role:'Mason', laborType:'direct', contractId:'k1', daysWorked:2, dailyRate:150, totalSalary:300, paymentDate:'2026-10-05', paymentMethod:'cash', receiptImages:[] },
      { id:'pay2', userId:UID, projectId:'p', workerName:'Mark', role:'Mason', laborType:'direct', contractId:'k1', daysWorked:1, dailyRate:200, totalSalary:200, paymentDate:'2026-10-06', paymentMethod:'cash', receiptImages:[] }
    ],
    expenses: []
  };
  function answer(make) {
    return new Promise((resolve, reject) => setTimeout(() => window.READ_FAIL ? reject(new Error('network down')) : resolve(make()), window.READ_DELAY));
  }
  function query(name) {
    const api = { where: () => api, orderBy: () => api, limit: () => api, omit: () => api,
      get: () => answer(() => { const docs = (SERVER[name] || []).map(r => ({ id:r.id, data:() => ({ ...r }) })); return { docs, size:docs.length, forEach:f => docs.forEach(f) }; }),
      onSnapshot(next) { api.get().then(next).catch(() => {}); return () => {}; },
      doc: id => ({ get: () => answer(() => { const r = (SERVER[name] || []).find(x => x.id === id); return { id, exists:!!r, data:() => r && ({ ...r }) }; }) }) };
    return api;
  }
  window.db = { collection: query };
  window.firebase = { auth: () => ({ currentUser:{ uid:UID } }) };
  window.currentUser = { uid:UID, email:'owner@example.test' };
  window.Chart = class { constructor() {} destroy() {} };
  // The pattern this change avoids: wait for the read, then open the window.
  async function naive() {
    await db.collection('payroll').where('userId','==',UID).get();
    window.NAIVE_WINDOW = window.open('', '_blank', 'width=870,height=1100');
    window.NAIVE_DONE = true;
    if (window.NAIVE_WINDOW) window.NAIVE_WINDOW.close();
  }
</script>
<script src="/js/billing-allocation.js"></script>
<script src="/js/print-utils.js"></script>
<script src="/js/expenses-module.js"></script>
<script src="/js/overhead-module.js"></script>
<script src="/js/invoice-module.js"></script>
<script>
  expFolders = [{ id:'f', name:'ZZ Barlin', totalBudget:100000 }];
  expProjects = [{ id:'p', folderId:'f', month:'October', year:2026, monthlyBudget:5000 }];
  expLaborContracts = [{ id:'k1', workerName:'Mark', agreedAmount:1000, category:'labor', payType:'pakyaw' }];
  window.READY = true;
</script>`;

const TYPES = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.png':'image/png', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/') { res.writeHead(200, { 'content-type':'text/html' }); return res.end(PAGE); }
  const file = path.join(ROOT, decodeURIComponent(url));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type':TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  [' + detail + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    userDataDir: path.join(__dirname, 'profile'),
    // Puppeteer switches the popup blocker off by default. Keep it ON: that is the question.
    ignoreDefaultArgs: ['--disable-popup-blocking'],
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  const popups = [];
  browser.on('targetcreated', async t => { if (t.type() === 'page') popups.push(t); });
  await page.goto(base);
  await page.waitForFunction('window.READY === true');

  const setUp = (delay, fail, id) => page.evaluate((d, f, i) => { window.READ_DELAY = d; window.READ_FAIL = f; window.RECEIPT_ID = i; window.NAIVE_DONE = false; window.NAIVE_WINDOW = undefined; }, delay, fail, id);
  // document.open() replaces the window's page, so ask it again and again until the wait is over.
  const settled = async p => {
    let html = '';
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      try { html = await Promise.race([p.content(), sleep(800).then(() => html)]); } catch (e) { html = 'ERR ' + e.message; }
      if (html && !html.includes('Preparing') && html.includes('Mark')) return html;
      await sleep(250);
    }
    console.log('  (never settled; last: ' + String(html).slice(0, 300) + '; dialogs: ' + JSON.stringify(dialogs) + '; page errors: ' + JSON.stringify(pageErrors) + ')');
    return html;
  };
  const printRequests = async p => {
    for (let i = 0; i < 40; i++) {
      if (await p.evaluate(() => window.__prints)) break;
      await sleep(100);
    }
    await sleep(800);     // long enough for a second request to show, if there were one
    return p.evaluate(() => window.__prints);
  };
  const newPopup = async before => { for (let i = 0; i < 40 && popups.length <= before; i++) await sleep(50); return popups[before]; };

  console.log('\nThe comparison: wait for the read, THEN open the window (what this change avoids)');
  await setUp(8000, false);
  await page.click('#naive');
  await page.waitForFunction('window.NAIVE_DONE === true', { timeout: 15000 });
  const naiveOpened = await page.evaluate(() => !!window.NAIVE_WINDOW);
  console.log('  read took 8 s, window afterwards: ' + (naiveOpened ? 'opened (not blocked)' : 'BLOCKED by the browser'));

  console.log('\nStatement, slow read (8 s), the new order');
  let before = popups.length;
  await setUp(8000, false);
  await page.click('#statement');
  const target = await newPopup(before);
  check('the window opened on the click', !!target);
  const popup = target && await target.page();
  await popup.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await sleep(300);
  check('it says Preparing while the read is on its way', popup && (await popup.content()).includes('Preparing'));
  const statement = await settled(popup);
  check('after the wait it holds the real statement', statement.includes('500.00') && statement.includes('Mark'));
  check('and the waiting text is gone', !statement.includes('Preparing'));
  check('the shared print style survived (A4, colours)', statement.includes('dacs-bw-print-style'));
  check('it asked to print exactly once, after the content', await printRequests(popup) === 1);
  await popup.setViewport({ width: 870, height: 1100 });
  await popup.screenshot({ path: path.join(OUT, 'statement.png') });
  await popup.close();

  console.log('\nStatement, the read fails');
  before = popups.length;
  dialogs.length = 0;
  await setUp(500, true);
  await page.click('#statement');
  const failedTarget = await newPopup(before);
  check('the window opened on the click', !!failedTarget);
  for (let i = 0; i < 60 && !dialogs.length; i++) await sleep(50);
  check('the message says nothing was printed', dialogs.length === 1 && /nothing was printed/.test(dialogs[0]), dialogs[0]);
  await sleep(500);
  check('the window closed', !browser.targets().includes(failedTarget));

  console.log('\nReceipt, slow read (8 s), the new order');
  before = popups.length;
  await setUp(8000, false, 'pay1');
  await page.click('#receipt');
  const receiptTarget = await newPopup(before);
  check('the window opened on the click', !!receiptTarget);
  const receipt = receiptTarget && await receiptTarget.page();
  await receipt.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  const receiptHtml = await settled(receipt);
  check('after the wait it holds the real receipt', receiptHtml.includes('300.00'));
  check('and the waiting text is gone', !receiptHtml.includes('Preparing'));
  check('the shared print style survived (A4, colours)', receiptHtml.includes('dacs-bw-print-style'));
  check('it asked to print exactly once, after the content', await printRequests(receipt) === 1);
  await receipt.setViewport({ width: 720, height: 960 });
  await receipt.screenshot({ path: path.join(OUT, 'receipt.png') });
  await receipt.close();

  console.log('\nReceipt, the entry was deleted from another tab');
  before = popups.length;
  dialogs.length = 0;
  await setUp(200, false, 'gone');
  await page.click('#receipt');
  await newPopup(before);
  for (let i = 0; i < 60 && !dialogs.length; i++) await sleep(50);
  check('the message says it no longer exists', dialogs.length === 1 && /no longer exists/.test(dialogs[0]), dialogs[0]);

  check('no script errors on the page', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

  console.log('\nOverhead, on the real admin.html, with the real scripts drawing it');
  const admin = await browser.newPage();
  await admin.setRequestInterception(true);
  admin.on('request', r => r.url().startsWith(base) ? r.continue() : r.abort());
  admin.on('dialog', d => d.dismiss());
  await admin.setViewport({ width: 1280, height: 1000 });
  await admin.goto(base + 'admin.html', { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const drawn = stateName => admin.evaluate(state => {
    document.querySelectorAll('#loginScreen,#loadingOverlay').forEach(e => { e.style.display = 'none'; });
    document.getElementById('dashboardScreen').style.display = 'grid';
    document.querySelectorAll('.content-view').forEach(e => { e.style.display = 'none'; });
    document.getElementById('expOverheadView').style.display = 'block';
    const now = new Date(), ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    _ovhdMonth = ym;
    _ovhdCostsRead = state !== 'nothing';
    _ovhdCostsFailed = state === 'nothing';
    _ovhdExpenses = state === 'nothing' ? [] : [
      { id: 'ov1', scope: 'project', folderId: 'f', expenseName: 'Fuel', category: 'Fuel', amount: 500, date: ym + '-02', status: 'paid' },
      { id: 'co1', scope: 'company', expenseName: 'Rent', category: 'Office Rent', amount: 70, date: ym + '-02', status: 'paid' }];
    expFolders = [{ id: 'f', name: 'ZZ Barlin' }];
    expProjects = [{ id: 'p', folderId: 'f', month: 'November', year: now.getFullYear() }];
    _ovAllPayroll = [{ id: 'ind1', projectId: 'p', workerName: 'Cora', role: 'Coordinator', laborType: 'indirect', totalSalary: 400, paymentDate: ym + '-07' }];
    _ovhdPayState = state === 'current' ? null : state === 'loading' ? 'loading' : 'failed';
    _ovhdShowPayNote();
    _ovhdRender();
    window.scrollTo(0, 0);
    const text = id => document.getElementById(id).innerText;
    return { note: text('ovhdPayrollNote'), company: text('ovhdCompanyAmount'), project: text('ovhdProjectAmount'), overall: text('ovhdOverallAmount'),
      trend: text('ovhdProjectTrend'), chartsShown: getComputedStyle(document.getElementById('ovhdChartsBlock')).display !== 'none',
      table: text('ovhdTableBody'), breakdown: text('ovhdBreakdownList') };
  }, stateName);

  const failed = await drawn('failed');
  check('Company overhead still shows its amount', /70\.00/.test(failed.company), failed.company);
  check('Project and Overall read Unavailable', failed.project === 'Unavailable' && failed.overall === 'Unavailable');
  check('Project operating costs show, labelled', /Operating costs only/.test(failed.trend) && /500\.00/.test(failed.trend), failed.trend);
  check('the charts are hidden', !failed.chartsShown);
  check('the list shows the operating costs and no indirect pay', /Fuel/.test(failed.table) && /Rent/.test(failed.table) && !/Cora|400/.test(failed.table));
  check('the note says payroll is unavailable', /Payroll is unavailable/.test(failed.note));
  check('the breakdown says "of operating costs"', /of operating costs/.test(failed.breakdown) && !/of total/.test(failed.breakdown));
  await sleep(200);
  await admin.screenshot({ path: path.join(OUT, 'overhead-failed.png') });

  const nothing = await drawn('nothing');
  check('offline from the start: no false zero', nothing.company === 'Unavailable' && !/0\.00/.test(nothing.company + nothing.project + nothing.overall));
  check('offline from the start: says both are unavailable', /Payroll and operating costs are unavailable/.test(nothing.note));
  await sleep(200);
  await admin.screenshot({ path: path.join(OUT, 'overhead-nothing.png') });

  const loading = await drawn('loading');
  check('while reading: the note says so and nothing old shows', /Loading the latest payroll/.test(loading.note) && loading.project === 'Loading…' && !/Cora/.test(loading.table));

  const current = await drawn('current');
  check('current: the figures, the charts and the indirect pay are all back', /900\.00/.test(current.project) && /970\.00/.test(current.overall) && current.chartsShown && /Cora/.test(current.table) && current.note === '');
  await sleep(200);
  await admin.screenshot({ path: path.join(OUT, 'overhead-current.png') });

  await browser.close();
  server.close();
  console.log('\n' + results.filter(Boolean).length + ' of ' + results.length + ' passed');
  console.log('comparison: read-then-open was ' + (naiveOpened ? 'NOT blocked' : 'BLOCKED'));
  process.exitCode = results.every(Boolean) ? 0 : 1;
})().catch(e => { console.error(e); try { server.close(); } catch (_) {} process.exit(2); });
```
