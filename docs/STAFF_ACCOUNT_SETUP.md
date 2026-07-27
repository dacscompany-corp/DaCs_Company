# Staff Account Setup Guide
## DAC's Building Design Services — Expenses-Only Staff Role

> ⚠️ **The most out-of-date doc in this folder.** It describes Firebase Auth and Firestore rules
> ~23 times; the app runs on **Supabase Auth + Postgres RLS** (`supabase/migrations/0002_rls.sql`).
> Staff accounts are created via the `admin-create-user` edge function, and access is enforced by
> RLS plus `profiles.role = 'staff'` / `profiles.allowed_modules`, **not** by Firestore rules.
> The *intent* of the staff role (no peso amounts, limited modules) is still correct; **every
> setup step involving the Firebase console is not.** See [ARCHITECTURE.md](ARCHITECTURE.md) §1.

This guide walks you through creating a **staff** account that only sees the **Expenses Tracker** modules and KPIs. Admin (owner) keeps full access to everything.

---

## What Staff Will See vs. Admin

| Module / View          | Admin (owner) | Staff |
|------------------------|:---:|:---:|
| Dashboard              | ✅  | ✅  |
| Appointments           | ✅  | ✅  |
| Analytics              | ✅  | ✅  |
| Feedback               | ✅  | ✅  |
| **Budget Overview**    | ✅  | ❌  |
| **Expenses**           | ✅  | ✅  |
| **Reports**            | ✅  | ❌  |
| Construction — Current Batch    | ✅  | ✅  |
| Construction — Urgent Requests  | ✅  | ✅  |
| Construction — Batch History    | ✅  | ✅  |
| Construction — Inventory        | ✅  | ✅  |
| **User Navigator**     | ✅  | ❌  |
| **Client Accounts**    | ✅  | ❌  |

Staff KPIs visible (inside Expenses module):
- Contract Value ❌
- Total Budget Received ❌
- Cover Expenses
- Period Budget 
- Budget Status (Healthy / On Track / Near Limit / Over Budget)

> **Contract Value / Total Budget Received are confidential, not just hidden.**
> These values are stored in owner-only Firestore collections (`folderBudgets`,
> `projectBudgets`) — staff cannot read them even via the API/console, not merely
> hidden in the UI. See **Confidential financials** below. User Navigator,
> Client Accounts and Reports are hidden from the staff navigation and blocked
> in `switchView`. Reports is a spending/budget dashboard from top to bottom —
> there is no partial version of it that is safe for staff.

### Labor screen — summaries are percentages, detail is not

The line here is **rolled-up totals vs. the individual records behind them**.
Owner view is unaffected throughout; all of this is `_staff()`-gated in
`js/portal-app.compiled.js`.

- **Percentage for staff** — the Total Agreed / Paid So Far / Remaining to Pay
  cards, the collapsed row caption (`17% paid · Worker`), and each contract's
  meta line (`Paid 16.7% · Remaining 83.3%`), via `_pctTxt`.
  Total Agreed shows `—`, not `100%`, which would read as "fully paid".
  Uncapped payments show a payment count — with no contract there is nothing to
  take a percentage of.
- **Removed for staff** — the per-row *Remaining* column. The badge already
  says `Ongoing · 17%`; restating it in pesos added nothing.
- **Full peso amounts, all roles** — the payment history table, Ledger, Worker
  Statement (SOA) and the per-payment receipt/invoice. Staff need these to do
  the recording; only the Reports module is withheld entirely.

---

## Step 1 — Create the Staff Firebase Auth Account

1. Go to [Firebase Console](https://console.firebase.google.com) → your project
2. Navigate to **Authentication → Users**
3. Click **Add user**
4. Enter the staff email and a strong password (e.g. `staff@dacsbuilding.com`)
5. Click **Add user** — copy the generated **UID** (you'll need it next)

---

## Step 2 — Set the `staff` Role in Firestore

1. In Firebase Console → **Firestore Database**
2. Go to the `users` collection (create it if it doesn't exist)
3. Click **Add document**
4. Set the **Document ID** = the UID you copied in Step 1
5. Add this field:

```
Field:  role
Type:   string
Value:  staff
```

6. Click **Save**

> **Why manual?** The Firestore rules block users from setting their own `role` field — only the Console (or Admin SDK) can write it. This is a security feature.

---

## Step 3 — Update Firestore Security Rules

Open `firestore.rules` and add the `isStaff()` helper function, then update the expenses collections to allow staff access.

### 3a — Add the `isStaff()` helper (after the existing `isWorker()` function)

```js
function isStaff() {
  return isAuthenticated() && getUserRole() == 'staff';
}
```

### 3b — Update expenses-related collection rules

Replace the existing rules for `folders`, `projects`, `expenses`, `payroll`, and `categories` with these updated versions that allow both owner (`admin`) and staff:

```js
// ── Project Folders ───────────────────────────────────
match /folders/{folderId} {
  allow read, update, delete: if isAuthenticated()
                              && resource.data.userId == request.auth.uid;
  allow create: if isAuthenticated()
                && request.resource.data.userId == request.auth.uid;
}

// ── Monthly Projects ──────────────────────────────────
match /projects/{projectId} {
  allow read, update, delete: if isAuthenticated()
                              && resource.data.userId == request.auth.uid;
  allow create: if isAuthenticated()
                && request.resource.data.userId == request.auth.uid;
}

// ── Expenses ──────────────────────────────────────────
match /expenses/{expenseId} {
  allow read, update, delete: if isAuthenticated()
                              && resource.data.userId == request.auth.uid;
  allow create: if isAuthenticated()
                && request.resource.data.userId == request.auth.uid;
}

// ── Payroll ───────────────────────────────────────────
match /payroll/{payrollId} {
  allow read, update, delete: if isAuthenticated()
                              && resource.data.userId == request.auth.uid;
  allow create: if isAuthenticated()
                && request.resource.data.userId == request.auth.uid;
}

// ── Categories ────────────────────────────────────────
match /categories/{categoryId} {
  allow read, update, delete: if isAuthenticated()
                              && resource.data.userId == request.auth.uid;
  allow create: if isAuthenticated()
                && request.resource.data.userId == request.auth.uid;
}
```

> These rules already work per-user by `userId == request.auth.uid`, so staff data is naturally isolated from admin data. No changes needed here — just deploy the rules with the new `isStaff()` helper added.

### 3c — Deploy the updated rules

In your terminal (Firebase CLI):
```bash
firebase deploy --only firestore:rules
```

---

## Step 4 — Fetch and Store Role in `admin.js`

In `admin.js`, update `checkAuthState()` / `showDashboard()` to fetch the user's role from Firestore and store it globally so the UI can react.

### 4a — Add a global role variable (top of `admin.js`)

```js
let currentUser = null;
let currentUserRole = null;   // ← ADD THIS LINE
```

### 4b — Update `checkAuthState()` to load the role

Replace:
```js
function checkAuthState() {
    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            showDashboard();
            loadData();
        } else {
            showLogin();
        }
    });
}
```

With:
```js
function checkAuthState() {
    auth.onAuthStateChanged(async user => {
        if (user) {
            currentUser = user;
            // Fetch role from Firestore
            try {
                const userDoc = await db.collection('users').doc(user.uid).get();
                currentUserRole = userDoc.exists ? (userDoc.data().role || 'owner') : 'owner';
            } catch (e) {
                currentUserRole = 'owner'; // fallback
            }
            applyRoleBasedUI();
            showDashboard();
            loadData();
        } else {
            showLogin();
        }
    });
}
```

### 4c — Add the `applyRoleBasedUI()` function

Add this new function anywhere in `admin.js` (e.g. after `showDashboard()`):

```js
// Apply role-based sidebar and view restrictions
function applyRoleBasedUI() {
    if (currentUserRole === 'staff') {
        // Hide all non-expenses nav items
        const hiddenViews = ['dashboard', 'appointments', 'analytics', 'feedback',
                             'consBatch', 'consUrgent', 'consBatchHistory', 'consInventory'];
        hiddenViews.forEach(view => {
            const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
            if (navItem) navItem.style.display = 'none';
        });

        // Hide Construction section label
        document.querySelectorAll('.nav-group-label').forEach(label => {
            if (label.textContent.trim() === 'CONSTRUCTION') {
                label.style.display = 'none';
            }
        });

        // Hide the notification bell (construction-specific)
        const bell = document.getElementById('consNotificationBell');
        if (bell) bell.style.display = 'none';

        // Set default landing view to Budget Overview
        setTimeout(() => switchView('expOverview'), 100);
    }
}
```

### 4d — Guard `switchView` to prevent staff accessing restricted views

In the `switchView` function (inline `<script>` at bottom of `admin.html`), add a role check at the top:

```js
window.switchView = function(view) {
    // Role guard — staff can only access expenses views
    const staffAllowedViews = ['expOverview', 'expExpenses', 'expReports'];
    if (typeof currentUserRole !== 'undefined' && currentUserRole === 'staff') {
        if (!staffAllowedViews.includes(view)) {
            view = 'expOverview'; // redirect to expenses
        }
    }

    // ... rest of existing switchView code unchanged
```

---

## Step 5 — Update `admin.html` Login Hint (Optional UX)

In the login form placeholder, you can optionally update to be more generic:

```html
<!-- Change from: -->
<input type="email" id="loginEmail" required placeholder="admin@dacsbuilding.com">

<!-- To: -->
<input type="email" id="loginEmail" required placeholder="Enter your email">
```

---

## Step 6 — Test the Staff Account

1. Log out of the admin account
2. Log in with the staff credentials (`staff@dacsbuilding.com`)
3. Verify the sidebar shows **only**:
   - `EXPENSES TRACKER` label
   - Budget Overview
   - Expenses
   - Reports
4. Verify the Dashboard, Appointments, Analytics, Feedback, and all Construction items are **hidden**
5. Try typing a restricted URL hash manually (e.g. `#dashboard`) — it should redirect to Budget Overview
6. Verify KPI cards show correctly in Budget Overview (Contract Value, Budget Received, etc.)
7. Log out and log back in as admin — verify admin still sees everything

---

## Step 7 — Sharing Expenses Data Between Admin and Staff (Optional)

By default, each user's data is **isolated by `userId`** in Firestore. This means:
- Admin folders/expenses are only visible to the admin account
- Staff folders/expenses are only visible to the staff account

**If you want staff to view/edit the same expenses data as admin**, you need to either:

### Option A — Use the admin account's UID as `userId` for all expenses data
Staff creates/reads data stamped with the admin UID. Requires a Firestore rule update to allow cross-user access with an explicit allow list.

### Option B — Create a shared `orgId` field
Add `orgId` to all documents, and allow any authenticated user with matching `orgId` to access data.

### Option C — Keep separate data (default, no changes needed)
Staff manages their own expenses independently from admin. Both use the same module but with separate data stores.

> **Recommendation:** For a small team, **Option C** (separate data) is the simplest and most secure starting point. You can revisit shared data later.

---

## Summary Checklist

- [ ] Step 1: Created staff Firebase Auth account, copied UID
- [ ] Step 2: Set `role: "staff"` in Firestore `/users/{uid}`
- [ ] Step 3: Added `isStaff()` to `firestore.rules` and deployed
- [ ] Step 4a: Added `currentUserRole` global in `admin.js`
- [ ] Step 4b: Updated `checkAuthState()` to fetch role
- [ ] Step 4c: Added `applyRoleBasedUI()` function
- [ ] Step 4d: Added role guard in `switchView()`
- [ ] Step 5: (Optional) Updated login placeholder
- [ ] Step 6: Tested staff login — only expenses modules visible
- [ ] Step 7: Decided on data sharing strategy

---

## Role Reference

| Role | Set In | Access |
|------|--------|--------|
| `owner` | Firestore `/users/{uid}.role` | Full admin — all modules |
| `staff` | Firestore `/users/{uid}.role` | Expenses tracker only |
| `worker` | Firestore `/users/{uid}.role` | Construction requests only |
| `teamLeader` | Firestore `/users/{uid}.role` | Same as worker |
| *(none)* | — | Public website only |

---

## Confidential financials (enforced, not just hidden)

Staff share the owner's `folders` and `projects` data, so hiding contract value
and fund-allocated in the UI alone is **not** enough — a staff user could read the
raw documents via the API/console. To make these values genuinely confidential,
they live in two **owner-only** collections:

| Value | Old location (staff-readable) | New location (owner-only) |
|-------|-------------------------------|---------------------------|
| Contract Value | `folders/{id}.totalBudget` | `folderBudgets/{folderId}.totalBudget` |
| Fund Allocated | `projects/{id}.monthlyBudget` | `projectBudgets/{projectId}.monthlyBudget` |

Security rules (already in `firestore.rules`):

```js
match /folderBudgets/{folderId} {
  allow read, write: if isOwner();                 // staff intentionally excluded
  allow read: if isAuthenticated()
              && get(/databases/$(database)/documents/folders/$(folderId))
                   .data.get('clientEmail', '') == request.auth.token.email;
}
match /projectBudgets/{projectId} {
  allow read, write: if isOwner();
  allow read: if isAuthenticated()
              && get(/databases/$(database)/documents/folders/$(
                   get(/databases/$(database)/documents/projects/$(projectId)).data.folderId))
                   .data.get('clientEmail', '') == request.auth.token.email;
}
```

The app reads these through a merge-on-load: `loadProjects()` (admin) and the
client portal fetch the budget docs and attach `totalBudget` / `monthlyBudget`
back onto the in-memory folder/project objects, so all existing UI code is
unchanged. For staff sessions the budget listeners are skipped, so both values
resolve to `0` (and remain hidden in the UI).

### Migrating existing data

Existing folders/projects still carry the old fields. After deploying the rules,
run the one-time migration **as the owner** (see `tools/migrate-budgets.js`):

1. Deploy `firestore.rules`.
2. Log into `admin.html` as the **owner**, open the DevTools console.
3. Paste `tools/migrate-budgets.js` → it does a **dry run** first.
4. Apply with `migrateBudgets({ dryRun: false })`.

This copies each value into the new collection and deletes the field from the
original staff-readable document.
