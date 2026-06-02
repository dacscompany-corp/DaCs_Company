# Overhead Expenses — Firebase Setup Guide

The overhead module uses the **same Firebase project** (`dacs-building-design`) already
configured in your app. No new project or credentials needed.

---

## What's Already Done ✅

- Firebase SDK loaded in `admin.html`
- `firebase-config.js` initializes `db` and `auth`
- `overhead-module.js` reads/writes to `db.collection('overheadExpenses')`
- Security rule for `overheadExpenses` added to `firestore.rules`

---

## Steps to Complete the Connection

### Step 1 — Deploy the Updated Firestore Rules

You need to publish the updated `firestore.rules` so Firebase allows read/write
on the `overheadExpenses` collection.

**Option A — Firebase Console (easiest, no CLI needed)**

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Select your project: **dacs-building-design**
3. In the left sidebar click **Firestore Database**
4. Click the **Rules** tab at the top
5. Replace the entire content with the contents of your `firestore.rules` file
6. Click **Publish**

---

**Option B — Firebase CLI (terminal)**

If you have Firebase CLI installed:

```bash
# Inside the project folder
firebase deploy --only firestore:rules
```

---

### Step 2 — Create the Composite Index

The query in `_ovhdSubscribe()` filters by `userId` AND orders by `date desc`.
Firestore requires a **composite index** for this.

**You will see an error in the browser console the first time you open Overhead:**

```
FirebaseError: The query requires an index...
```

The error message contains a **direct link** to create the index automatically.

#### How to create it:

1. Open the browser **DevTools → Console** (press `F12`)
2. Click the Overhead nav item to trigger the query
3. In the console, find the error — it looks like:

   ```
   The query requires an index. You can create it here: https://console.firebase.google.com/...
   ```

4. **Click that link** — it opens Firebase Console with the index pre-filled
5. Click **Create Index**
6. Wait ~1–2 minutes for it to build (status changes from "Building" to "Enabled")
7. Refresh the page — data will load

#### Or create it manually:

1. Go to Firebase Console → **Firestore Database → Indexes → Composite**
2. Click **Add Index**
3. Fill in:
   - **Collection ID:** `overheadExpenses`
   - **Field 1:** `userId` — Ascending
   - **Field 2:** `date` — Descending
   - **Query scope:** Collection
4. Click **Create**

---

### Step 3 — Test It

1. Open the admin dashboard and log in
2. Click **Overhead** in the sidebar
3. Click **+ Add Expense**, fill in the form, click **Save Expense**
4. The entry should appear in the table immediately (real-time listener)
5. The KPI cards (Total Overhead, Total Entries, Average per Entry) should update

---

## Data Structure

Each document saved in `overheadExpenses` looks like this:

```json
{
  "userId":      "abc123uid",
  "category":    "Office Rent",
  "amount":      15000,
  "date":        "2026-03-01",
  "description": "March office rent payment",
  "createdAt":   "<server timestamp>"
}
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Data not loading, console shows index error | Follow Step 2 — click the link in the console |
| "Missing or insufficient permissions" | Firestore rules not published yet — do Step 1 |
| Add expense does nothing | Check console for errors; make sure you're logged in |
| Data loads but shows ₱0 | Check the month picker matches the date of your entries |
