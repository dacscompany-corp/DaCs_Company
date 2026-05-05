# DAC's Building Design Services — Budget Overview Module

> **Admin Dashboard · Expenses Tracker · MVP Documentation**
> Last updated: March 2026

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Tech Stack](#tech-stack)
3. [File Structure](#file-structure)
4. [Firestore Collections](#firestore-collections)
5. [Funding Types](#funding-types)
6. [View Modes](#view-modes)
7. [KPI Cards](#kpi-cards)
8. [Budget Variance Card](#budget-variance-card)
9. [Billing Summary Analytics](#billing-summary-analytics)
10. [Add Month Modal](#add-month-modal)
11. [Sidebar Month Rows](#sidebar-month-rows)
12. [State Variables](#state-variables)
13. [Core Functions](#core-functions)
14. [Budget Status Thresholds](#budget-status-thresholds)
15. [Business Rules](#business-rules)

---

## System Overview

A real-time budget tracking module for a construction company. Projects are organized into:

- **Folders** → represent construction contracts (e.g., WJTV, HOMAC, Barlin)
- **Monthly Billing Periods** → individual months within a contract, each with a funding type

The module tracks **client billing vs. actual expenses and payroll**, computes variances, and displays analytics for each billing stage.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (SPA, no framework) |
| Database | Firebase Firestore (real-time listeners) |
| Auth | Firebase Authentication |
| Styling | Custom CSS (no CSS framework) |
| Icons | Lucide Icons |
| Charts | Chart.js 4.4.0 |

---

## File Structure

```
Dacs Web/
├── admin.html               # Main dashboard HTML (all views)
├── expenses-module.js       # All budget overview logic (~1400+ lines)
├── expenses-module.css      # All styles for the budget module
└── EXPENSES_README.md       # This file
```

---

## Firestore Collections

### `folders` — Project Contracts

```js
{
  name:        string,   // e.g. "WJTV", "HOMAC", "Barlin"
  description: string,   // e.g. "BGC", "Pasig City"
  totalBudget: number,   // Total contract value in Pesos
  userId:      string,
  createdAt:   timestamp
}
```

### `projects` — Monthly Billing Periods

```js
{
  month:         string,   // e.g. "January", "February"
  year:          number,   // e.g. 2026
  monthlyBudget: number,   // Budget for this month (0 for Cover Expenses)
  fundingType:   string,   // See Funding Types section
  billingNumber: number,   // Auto-incremented for progress billings only
  folderId:      string,   // Parent folder ID (nullable)
  userId:        string,
  createdAt:     timestamp,

  // Computed locally (NOT stored in Firestore)
  _spent:        number    // Total expenses + payroll for this month
}
```

### `expenses` — Material / Direct Costs

```js
{
  projectId:   string,    // Parent project (month) ID
  expenseName: string,
  category:    string,    // Matches categories collection
  amount:      number,    // Amount in Pesos
  quantity:    number,    // Default: 1
  dateTime:    timestamp,
  notes:       string,
  receipts:    array,     // File references / thumbnails
  userId:      string
}
```

### `payroll` — Labor Costs

```js
{
  projectId:   string,    // Parent project (month) ID
  workerName:  string,
  role:        string,    // Job role/position
  daysWorked:  number,
  dailyRate:   number,    // Rate per day in Pesos
  totalSalary: number,    // Computed: daysWorked × dailyRate
  paymentDate: timestamp,
  notes:       string,
  receipts:    array,
  userId:      string
}
```

### `categories` — Custom Expense Categories

```js
{
  name:      string,   // Category label
  color:     string,   // Hex color, default: #00D084
  userId:    string,
  createdAt: timestamp
}
```

---

## Funding Types

Each billing month has one of these five funding types:

| Value | Display Label | Icon | Budget Required | Counted as Client Billing |
|-------|--------------|------|-----------------|--------------------------|
| `mobilization` | Mobilization | 🚧 | Yes | Yes |
| `downpayment` | Downpayment | 💰 | Yes | Yes |
| `progress` | Progress Billing #N | 📋 | Yes | Yes |
| `final` | Final Payment | 🏁 | Yes | Yes |
| `president` | Cover Expenses | 🏦 | No (budget = 0) | No |

### Funding Type Tag Colors

| Type | Background | Text |
|------|-----------|------|
| Mobilization | Orange `#ffedd5` | `#9a3412` |
| Downpayment | Yellow `#fef9c3` | `#854d0e` |
| Progress Billing | Purple `#ede9fe` | `#5b21b6` |
| Final Payment | Green `#dcfce7` | `#166534` |
| Cover Expenses | Pink `#fce7f3` | `#9d174d` |

### Special Rules

- **Progress Billing** auto-increments `billingNumber` sequentially per folder. The modal shows a hint: *"This will be Progress Billing #N"*
- **Cover Expenses** months have `monthlyBudget = 0`. They display `_spent` (actual expenses) instead of budget. They are excluded from Total Budget Received calculations.

---

## View Modes

The module has two display modes that affect all KPI calculations:

### Folder View (Aggregate)

Triggered when the user clicks a folder header to expand it.

```
expCurrentFolder  = folder object
expCurrentProject = null
```

- Badge shows: `[Folder Name] — All Months`
- Loads all expenses + payroll across ALL months in the folder via Firestore `in` query (chunked at 30 IDs)
- **Hides:** Period Budget KPI card, Period (month) variance row
- Computes `_spent` per project and updates sidebar month rows

### Month View (Single Period)

Triggered when the user clicks an individual month row.

```
expCurrentProject = project object
expCurrentFolder  = null
```

- Badge shows: `Active: [Month] [Year]`
- Loads expenses + payroll only for that month
- All 5 KPI cards visible (Period Budget card label changes for Cover Expenses months)

### Cover Expenses Month (Special Month View)

When the selected month has `fundingType === 'president'`:

- Period Budget card → renamed to **"Total Month Expenses"**
- Value shows actual `_spent` instead of budget
- Total Budget Received KPI card → **hidden**
- Period (month) variance row → **hidden**
- Sub-label shows: *"🏦 Cover Expenses · [Month] [Year]"*

---

## KPI Cards

Five cards displayed in an `auto-fit` responsive grid (min 190px each):

| # | Element ID | Label | Computation |
|---|-----------|-------|-------------|
| 1 | `expKpiContract` | Contract Value | `folder.totalBudget` |
| 2 | `expKpiAllocated` | Total Budget Received | Sum of `monthlyBudget` for all non-president months |
| 3 | `expKpiPresident` | Cover Expenses | Sum of `_spent` for all president months |
| 4 | `expKpiPeriod` | Period Budget / Total Month Expenses | Current month `monthlyBudget` (or `_spent` for president) |
| 5 | `expKpiStatus` | Budget Status | Health badge + utilization % |

### Visibility Rules

| View Mode | Contract | Budget Received | Cover Expenses | Period Budget | Status |
|-----------|----------|----------------|----------------|---------------|--------|
| Folder | ✅ | ✅ | ✅ | ❌ hidden | ✅ |
| Month (client) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Month (president) | ✅ | ❌ hidden | ✅ | ✅ (renamed) | ✅ |

---

## Budget Variance Card

Located in the cost breakdown row, contains three sub-rows:

| Row ID | Label | Formula | Visibility |
|--------|-------|---------|------------|
| `expVariancePeriodRow` | Period (month) | `monthlyBudget − spent` | Hidden in folder & president views |
| `expContractVariance` | Contract (total) | `contractValue − totalSpent` | Always visible |
| `expNetBalance` | Budget Received − Cover Expenses | `clientBillingTotal − presidentSpent` | Always visible |

- **Positive** values → green color + "Remaining available"
- **Negative** values → red color + "Over budget — immediate review needed"
- Net Balance negative → *"Cover expenses exceeded billing received"*

---

## Billing Summary Analytics

A dedicated analytics section below the utilization bar showing all billing stages:

### Summary Stat Pills (3 columns)

| Pill | Value | Color |
|------|-------|-------|
| Total Billed | Sum of all non-president month budgets | Default |
| Total Spent | Sum of all `_spent` across all months | Amber |
| Net Balance | Total Billed − Total Spent | Green (+) / Red (−) |

### Per Entry Rows

Each billing month renders:
- **Left:** Type icon + label (e.g., `📋 Progress Billing #2`) + month/year period
- **Right:** Amount received + balance badge (`+₱X` green / `-₱X` red)
- **Progress bar:** Blue = received, Amber = spent (relative widths)
- **Bar labels:** `₱X received` (blue) · `₱X spent` (amber)
- Cover Expenses rows: purple bar, shows *"Covers ₱X expenses"*

### Grand Total Block

- **Grand Total Balance** = sum of all `(received − spent)` across all entries
- **Breakdown list:** Each billing stage listed with its individual +/− contribution

### Sort Order

```
mobilization → downpayment → progress (by billingNumber) → final → president
```

---

## Add Month Modal

### Funding Source Grid (2×3)

```
[ 🚧 Mobilization    ]  [ 📋 Progress Billing ]
[ 🏁 Final Payment   ]  [ 🏦 Cover Expenses   ]
[ 💰 Downpayment     ]
```

### Dynamic Behavior

| Selection | Budget Input Label | Budget Input Visible | Hint Shown |
|-----------|-------------------|---------------------|------------|
| Mobilization | Mobilization Amount (₱) | Yes | No |
| Downpayment | Downpayment Amount (₱) | Yes | No |
| Progress Billing | Progress Billing Amount (₱) | Yes | Yes: *"📋 This will be Progress Billing #N"* |
| Final Payment | Final Payment Amount (₱) | Yes | No |
| Cover Expenses | — | **No** | No |

---

## Sidebar Month Rows

Each month row in the expanded folder panel displays:

```
● September 2025          👁  ✏  🗑
  🚧 Mobilization
  ₱50,000.00
```

- **Active row:** green border + gradient background
- **Funding tag:** color-coded pill (see Funding Type Tag Colors)
- **Amount:** `monthlyBudget` for client types, `_spent` for Cover Expenses (or *"covers expenses"* if `_spent = 0`)
- **Action buttons:** View (👁 always visible), Edit (✏), Delete (🗑) — edit/delete fade in on hover

---

## State Variables

```js
// Core data
let expProjects    = [];   // All projects for current user (real-time)
let expFolders     = [];   // All folders for current user (real-time)
let expCategories  = [];   // Custom expense categories

// Current selection
let expCurrentProject = null;  // Currently selected month
let expCurrentFolder  = null;  // Currently selected folder

// Loaded data for current selection
let expExpenses = [];   // Expenses for current project/folder
let expPayroll  = [];   // Payroll for current project/folder

// Firestore listener cleanup
let expUnsubscribers = [];  // Array of unsubscribe functions
let _foldersUnsub    = null;
let _projectsUnsub   = null;

// UI state
let _expandedFolders = new Set();  // Folder IDs currently expanded
let _pendingFolderId = null;       // Folder ID for new month modal

// Search filters
let _expSearch = { name: '', category: '', amtMin: '', amtMax: '', month: '' };
let _paySearch = { name: '' };
```

---

## Core Functions

### View Switching

| Function | Trigger | Action |
|----------|---------|--------|
| `toggleFolder(folderId)` | Click folder header | Expand/collapse folder, calls `selectFolder()` |
| `selectFolder(folderId)` | `toggleFolder()` | Set folder state, clear project state, call `subscribeFolderData()` |
| `selectProject(id)` | Click month row | Set project state, clear folder state, subscribe to expenses/payroll |

### Data Loading

| Function | Purpose |
|----------|---------|
| `subscribeExpenses()` | Real-time listener for current month's expenses |
| `subscribePayroll()` | Real-time listener for current month's payroll |
| `subscribeFolderData(folderId)` | Firestore `in` query across all project IDs in folder (chunked at 30) |

### KPI Rendering

| Function | Purpose |
|----------|---------|
| `updateBudgetOverview()` | Route to folder or month KPI renderer |
| `_updateBudgetOverviewFolder()` | Compute and render folder-level aggregate KPIs |
| `_updateBillingSummary(projects)` | Render full billing analytics section |
| `_setPeriodVisibility(showCard, showVarianceRow, showAllocated, cardLabel)` | Toggle Period card + row visibility |

### Sidebar

| Function | Purpose |
|----------|---------|
| `renderProjectPanel(containerId)` | Render full folder/month sidebar list |
| `_renderAllPanels()` | Re-render all three panel lists (overview, expenses, payroll) |

### Modal Handlers

| Function | Purpose |
|----------|---------|
| `onFundingTypeChange()` | Show/hide budget input, update label, show progress billing hint |
| `handleCreateProject(e)` | Save new billing month to Firestore with `billingNumber` auto-assignment |
| `openCreateMonthModal(folderId)` | Open Add Month modal pre-set to a folder |

---

## Budget Status Thresholds

| Utilization | Status | Badge Color | Icon |
|-------------|--------|------------|------|
| 0% – 60% | HEALTHY | Green | shield-check |
| 60% – 85% | ON TRACK | Green | shield-check |
| 85% – 100% | NEAR LIMIT | Yellow/Amber | shield-alert |
| > 100% | OVER BUDGET | Red | shield-x |

**Budget Reference for %:**
- Regular months: `monthlyBudget`
- President months: `_spent` (always 100%)
- Folder view: `totalAlloc` (or `contractVal` if all months are president-covered)

---

## Business Rules

1. **Auto-select on load:** On first load, if no project is selected and projects exist, auto-select the first project — unless a folder is active.

2. **Progress Billing numbering:** `billingNumber` = count of existing `progress` type months in the same folder + 1. Stored permanently in Firestore.

3. **`_spent` updates:**
   - In month view: updated after expenses/payroll Firestore snapshots fire
   - In folder view: computed per project from aggregated `expExpenses`/`expPayroll` arrays before re-rendering sidebar

4. **Chunk limit:** Firestore `in` queries are limited to 30 values. `subscribeFolderData()` splits project IDs into chunks of 30 automatically.

5. **Duplicate month prevention:** Cannot create two months with the same `month + year` in the same folder.

6. **Cover Expenses budget:** Always saved as `monthlyBudget: 0` in Firestore. Display uses `_spent` dynamically.

7. **Net Balance logic:**
   - `clientBillingTotal` = sum of `monthlyBudget` for all non-president months in folder
   - `presidentSpent` = sum of `_spent` for all president months in folder
   - Net Balance = `clientBillingTotal - presidentSpent`

8. **Folder total budget bar:** Progress bar shown only when `folder.totalBudget > 0`.

9. **Fallback budget reference:** In folder view, when `totalAlloc = 0` (all months are Cover Expenses), percentage calculations fall back to `contractVal` to avoid division by zero.

10. **Listener cleanup:** All Firestore listeners are stored in `expUnsubscribers[]` and unsubscribed before switching views to prevent memory leaks and double-rendering.

---

*DAC's Building Design Services — Internal Development Documentation*
