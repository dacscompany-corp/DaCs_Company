# Staff Account Setup Guide
## DAC's Building Design Services — Expenses-Only Staff Role

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
| **Reports**            | ✅  | ✅  |
| Construction — Current Batch    | ✅  | ✅  |
| Construction — Urgent Requests  | ✅  | ✅  |
| Construction — Batch History    | ✅  | ✅  |
| Construction — Inventory        | ✅  | ✅  |

Staff KPIs visible (inside Expenses module):
- Contract Value ❌
- Total Budget Received ❌
- Cover Expenses
- Period Budget 
- Budget Status (Healthy / On Track / Near Limit / Over Budget)

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
