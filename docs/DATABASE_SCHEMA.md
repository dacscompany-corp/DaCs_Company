# DAC's — Firestore Database Schema (Full Field Map)

> Generated from a full read of every `.add()` / `.set()` / `.update()` write across
> `js/` + `src/`, cross-checked against `firestore.rules`.
> Firestore is schemaless — these are the fields the **code actually writes**. A `?`
> means the field is conditional (only written in some branches).

**Conventions**
- `userId` = the **owner's** Firebase UID. Staff write the owner's UID (via `ownerUid` indirection), so owner + staff share one dataset.
- `clientEmail` / `clientUid` = link to a customer; client read access is **email-matched**.
- `createdAt` / `updatedAt` = `serverTimestamp()` unless noted.

---

## 1. Identity & Accounts

### `users/{uid}` — admin-side accounts
| Field | Type | Set by | Notes |
|---|---|---|---|
| `displayName` | string | user-navigator | `first + last` |
| `email` | string | — | |
| `role` | string | user-navigator | `owner` \| `staff` \| `worker` \| `teamLeader` |
| `status` | string | user-navigator | `active` / inactive |
| `ownerUid` | string | user-navigator | for `staff`/workers → points to the owner whose data they share |
| `createdAt` | ts | — | |
**Rules:** anyone signed-in can **read**; you may only create/update your **own** doc and **cannot set/modify `role`**.

### `clientUsers/{uid}` — customer portal profiles (`client.html`)
| Field | Type | Notes |
|---|---|---|
| `firstName`, `lastName`, `email` | string | self-set at signup |
| `createdAt` | ts | |
| (profile edits) | — | phone/address etc. added via profile editor |
**Rules:** client reads/writes own; owner/staff read all.

### `constructionClientUsers/{uid}` — construction-side client profiles
| Field | Type | Notes |
|---|---|---|
| `firstName`, `lastName`, `email` | string | |
| `role` | string | `'client'` |
| `status` | string | `'active'` |
| `agreementAccepted` | bool | starts `false` |
| `agreementAcceptedAt` | ts | set when the client accepts the Cost-Plus agreement |
| `createdAt` | ts | |

---

## 2. Expenses & Budgets (`expenses-module.js`) — **core financials**

Hierarchy: **`folders` → `projects` (a month) → `expenses` / `payroll`**. Money is split into confidential sibling collections.

### `folders/{id}` — project/client container
| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner |
| `name`, `description` | string | |
| `clientEmail` | string | synced **from the BOQ** on save — unlocks client read access |
| `createdAt` | ts | |

### `projects/{id}` — a billing **month/period** inside a folder
| Field | Type | Notes |
|---|---|---|
| `userId` | string | |
| `folderId` | string\|null | parent |
| `month`, `year` | string/number | |
| `fundingType` | string | `progress` \| `president` (president = "cover/overflow" pool, hidden from clients) |
| `billingNumber?` | number | only for `progress` periods |
| `createdAt` | ts | |

### `folderBudgets/{folderId}` 🔒 — **confidential contract value**
| `userId` | string |
| `totalBudget` | number — the contract value |
**Rules:** **owner-only** + the assigned client. Staff are blocked. Code only writes if role ≠ staff.

### `projectBudgets/{projectId}` 🔒 — **confidential fund allocated**
| `userId` | string |
| `monthlyBudget` | number |
**Rules:** owner-only + assigned client.

### `expenses/{id}` — material / misc spend (written in batches, can **split** across funding sources)
| Field | Type | Notes |
|---|---|---|
| `projectId` | string | which period it's charged to |
| `userId` | string | |
| `expenseName` | string | `(1/2)` suffix when split |
| `category` | string | |
| `quantity`, `amount` | number | |
| `dateTime` | string | |
| `notes` | string | |
| `paymentMethod?` | string | |
| `poImageUrl?` `deliveryReceiptUrl?` `supplierInvoiceUrl?` `paymentReceiptUrl?` | base64 | docs (PO/DR/SI/PR), only on first split |
| `inInventory?` | bool | mirrored to `inventory` |
| `coverExpense?` | bool | overflow charged to president fund |
| `splitGroup?` `splitIndex?` `splitTotal?` | — | multi-source split metadata |
| `createdAt` | ts | |

### `payroll/{id}` — labor spend (also batch + split)
| Field | Type | Notes |
|---|---|---|
| `projectId`, `userId` | string | |
| `workerName`, `role`, `laborType` | string | |
| `daysWorked`, `dailyRate`, `totalSalary` | number | |
| `paymentDate`, `notes` | string | |
| `receiptImages` | base64[] | only on first split |
| `coverExpense?` / `splitGroup?` / `splitIndex?` / `splitTotal?` | — | as expenses |
| `createdAt` | ts | |

### `categories/{id}` — expense categories
`userId`, `name`, `color`, `createdAt`

### `overheadExpenses/{id}` (`overhead-module.js`) — company overhead
`userId`, `category`, `amount` (number), `date` (string), `description`, `createdAt`

---

## 3. BOQ / Accomplishment Reports (`boq-module.js`)

### `boqDocuments/{id}` — Bill of Quantities / progress report
| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner |
| `folderId` | string | parent folder |
| `date`, `projectName`, `area`, `ownerName`, `location`, `subject` | string | header |
| `costItems` | array | **3-level nested** line items (item → sub-item → line) with qty/unit/price/% complete + photos (base64) |
| `discount` | number | |
| `clientEmail` | string | drives client access (also copied up to folder) |
| `status` | string | `draft` \| `submitted` \| `approved` |
| `terms` | object/string | |
| `createdAt`, `updatedAt` | ts | |
**On save:** copies `clientEmail` to the parent `folders` doc + pushes a notification to the client.
**Known quirk:** historically multiple docs per folder existed (save bug); code picks the "best" one. See `cleanup-boq-duplicates.js`.

### `boqTemplates/{id}` — reusable templates
`userId`, `name`, `costItems` (deep-copied), `createdAt`

---

## 4. Invoices (`invoice-module.js`, `labor-invoice-module.js`)

### `invoices/{id}` — sales/material invoices
| Field | Type | Notes |
|---|---|---|
| `userId` | string | |
| `invoiceNo`, `date` | string | |
| `businessName`, `businessTin`, `businessAddress` | string | seller |
| `clientName`, `clientTin`, `clientAddress` | string | buyer |
| `items` | array | `{description, qty, unitPrice, discount, amount}` |
| `subtotal`, `totalAmount` | number | |
| `paymentDetails` | object | `{method:'gcash', gcashNumber, gcashName}` **or** `{method:'bank', bank, accountNo, accountName, branch}` |
| `notes` | string | |
| `status` | string | `draft` \| issued |
| `clientEmail?`, `clientUid?` | string | for client read access |
| `createdAt`, `updatedAt` | ts | |

### `laborInvoices/{id}` — labor-only invoices
Same shape as `invoices`; `items` are labor lines auto-built from `weeklyBills` entries. Defaults persist to `settings/invoiceDefaults`.

---

## 5. Payment Requests (`paymentRequests` — **one collection, TWO workflows**)

⚠️ This collection is shared by two different systems with **different status vocabularies**.

### A) Construction PM flow (`pm-admin.js`, created by admin)
| Field | Type | Notes |
|---|---|---|
| `weekEndingDate` | string | |
| `amount`, `carryover`, `totalAmount` | number | |
| `amountPaid` | number | starts 0 |
| `strict` | bool | exact-amount-only week |
| `notes`, `billingPeriod` | string | |
| `status` | string | `unpaid` \| `partial` \| `paid` |
| `source` | string | `'pm-admin'` |
| `clientEmail`, `clientName`, `projectName` | string | |
| `constructionProjectId` | string | links to `constructionProjects` |
| `createdAt`, `updatedAt` | ts | |

### B) Cost-Plus / client-submit flow (`client-payment.js`, `payment-requests.js`)
| Field | Type | Notes |
|---|---|---|
| `clientEmail`, `clientUid` | string | |
| `ownerUid` | string | |
| `status` | string | `pending` → `partial_pending` ↔ `pending` → `submitted` → (`partial_approved`) → `rejected`/verified |
| `paidAmount` | number | |
| `proofBase64` | base64 | payment screenshot |
| `referenceNumber` | string | |
| `partialReason?` | string | |
| `submittedAt`, `verifiedAt`, `verifiedBy`, `rejectedReason`, `rejectedAt` | mixed | lifecycle stamps |
| `createdBy`, `createdAt` | string/ts | |
**Rules (B):** clients may only perform **specific status transitions** (e.g. `rejected → submitted`), never arbitrary edits.

---

## 6. Construction Project Management

### `constructionProjects/{id}` (`pm-admin.js`)
| Field | Type | Notes |
|---|---|---|
| `clientName`, `clientEmail` | string | |
| `projectName`, `address` | string | |
| `status` | string | `active` \| `on-hold` \| `completed` \| `terminated` |
| `startDate` | string | |
| `createdAt` | ts | |

**Subcollections** (owner/staff full access; client read-only of own; client write **only** `procurementList`):

| Subcollection | Key fields |
|---|---|
| `weeklyBills/{id}` | `weekEndingDate`, `labor`, `materials`, `managementFee` (=15% of L+M), `grandTotal`, `notes`, `status` (`Submitted`/`Partial`/`Paid`), `createdAt`,`updatedAt` |
| `procurementList/{id}` | `item`, `qty`, `estPrice`, `notes`, `status` (`Pending`/`Assigned…`/`Bought…`), `boughtBy` (`client`/`company`/null), `actualAmount`, `receiptUrl`, timestamps |
| `revolvingFund/summary` | `initialFund`, `totalReplenished`, `notes`, `updatedAt` (single doc id `summary`) |
| `revolvingFundExpenses/{id}` | `date`, `amount`, `description`, `notes`, `createdAt` |
| `revolvingFundReplenishments/{id}` | `date`, `amount`, `notes`, `createdAt` |
| `dailyLogs`, `milestones`, `accomplishmentReports`, `walkthroughs` | site-progress docs (read by `client-management-app.js`) |

---

## 7. Construction Procurement / Inventory (`construction-module.js`)

### `requests/{id}` — material requests (created by **workers**)
| Field | Type | Notes |
|---|---|---|
| `requestedBy` | string | worker uid (rule-enforced) |
| `items` | array | each: `{id, name, unit, quantity, status (pending/purchased/delivered), purchasedDate?, deliveredDate?}` |
| `status` | string | overall: `pending`/`purchased`/`delivered` (derived) |
| `batchId` | string | groups into a batch |
| `isUrgent` | bool | surfaces in urgent list |
| `isEditable` | bool | |
| `createdAt`, `updatedAt` | ts | |
**Rules:** worker creates own (`status='pending'`, non-empty `items`); owner/staff manage.

### `batches/{id}` — delivery batches
`status` (`open`/`closed`/`delivered`), `deliveryDate` (Timestamp), `cutoffDate?`, `createdBy`, `createdAt`, `totalItems`, `closedAt?`, `closedBy?`

### `inventory/{id}` — stock (**owner/staff only**, workers blocked)
`itemName`, `unit`, `currentStock`, `minStock?`, `notes`, `lastUpdated`, `lastAdjustedBy`, `createdAt`. Auto-fed from delivered requests and from expenses flagged `inInventory`.

---

## 8. Requests from Clients

### `sowaRequests/{id}` — Statement of Work Accomplished request
`clientEmail`, `clientName`, `clientUid`, `ownerUid`, `status` (`pending`/viewed/shared), `requestedAt`

### `terminationRequests/{id}` — client requests project termination
`clientUid`, `clientEmail`, `clientName`, `projectId`, `projectName`, `totalLabor`, `totalMaterials`, `managementFee`, `grandTotal`, `totalPaid`, `remainingBalance`, `status` (`pending`/approved/rejected), `requestedAt`

---

## 9. Notifications, Public & Settings

### `notifications/{userId}/items/{id}` — cross-system messaging
`type` (e.g. `report_shared`, `report_approved`, `payment_*`, `sowa_request`, `termination_approved`), `message`, `isRead` (bool), `relatedId?`, `createdAt`.
**Rules:** anyone signed-in can **create** (for any recipient); only the **recipient** reads/updates/deletes theirs.

### `appointments/{id}` (public booking, `script.js`)
`fullname`, `email`, `contact`, `service`, `message`, `status` (`pending`), `createdAt`, `updatedAt`.
**Rules:** anyone can create; admins read/manage.

### `testimonials/{id}` (public feedback)
`name`, `location`, `rating` (1–5), `message`, `status` (`approved` if rating ≥4 else `pending`), `createdAt`.
**Rules:** public creates only as `pending`; public reads only `approved` + rating ≥4.

### `settings/{id}`
- `settings/paymentQR` — payment QR (clients can read)
- `settings/invoiceDefaults` — `businessName/Tin/Address`, `vatRate`, `paymentDetails`
- other config: owner/staff only.

### `stats/{…}` — read-only aggregates (no client writes).

---

## 10. ⚠️ Defined in rules but UNUSED by code (planned SOA module)
`soa_requests`, `soa_records`, `payments`, `billings` have full security rules in `firestore.rules` but **no JavaScript references them**. Either finish the module or remove the rules to shrink attack surface. (The live "SOWA" feature uses `sowaRequests` — camelCase — instead.)

---

## Relationship map
```
users(owner) ──owns──> folders ──> projects ──> expenses / payroll
   │  ownerUid           │  └─ projectBudgets 🔒        
 staff/workers           └─ folderBudgets 🔒
                         │
boqDocuments ──folderId──┘   (clientEmail copied up to folder → client read unlock)
   └─ clientEmail ──────────────> clientUsers (email match)

constructionProjects ──> weeklyBills / procurementList / revolvingFund* / logs
   └─ clientEmail ─────> constructionClientUsers
   └─ id ──────────────> paymentRequests (constructionProjectId)

requests ──batchId──> batches ;  delivered items ──> inventory
notifications/{uid}/items  = glue between admin & client
```
