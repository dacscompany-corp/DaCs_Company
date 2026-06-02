# Project Management & Procurement Module — MVP

## Overview
A new module for DAC'S Building Design Services based on a **Cost-Plus** contract model.
Admin manages and inputs all data. Client views, tracks, and pays.

---

## Navigation Structure

**Parent Menu:** Project Management
- Weekly Summary
- Materials Procurement List
- Revolving Fund
- Payment

---

## MVP Modules

### 1. Weekly Summary
- Admin inputs **total labor** (overall amount only, no per-worker breakdown) and **total materials** for the week
- System auto-computes **15% management fee** on total direct costs
- Formula: `(Labor + Materials) x 15% = Management Fee`
- Grand Total: `Labor + Materials + Management Fee`
- Submitted every **Friday**

---

### 2. Materials Procurement List
- Admin creates a list of items needed to purchase (item name, quantity, estimated price)
- Each item can be purchased by either the **client** or the **company (admin)**
- **Client buys:** Client marks item as bought, inputs actual amount paid, uploads proof of receipt
- **Company buys:** Admin marks item as bought, inputs actual amount paid, uploads proof of receipt
- All purchases (amount + receipt) visible to both parties for full transparency
- Item status: `Pending` | `Bought by Client` | `Bought by Company`

---

### 3. Revolving Fund
- Client provides an initial revolving fund to admin for minor/urgent purchases
- Admin records expenses drawn from the fund during the week
- Fund is replenished every Friday alongside the weekly payment
- Tracks: `Initial Fund` | `Total Spent` | `Remaining Balance` | `Replenishment Amount`

---

### 4. Payment System

#### Payment Request Triggers (3 ways)
1. **Admin manual** — admin sends a payment request anytime
2. **Client self-pay** — client initiates payment without waiting for a request
3. **Auto-generated** — system automatically creates a payment request every Friday based on the weekly summary

#### Payment Rules
- Partial payment allowed, maximum shortage is **₱5,000**
- Unpaid balance carries over and is added to the next Friday's payment
- If client made a partial payment → next Friday is **automatically strict**
- Admin can manually mark any specific week as **strict**
- **Strict mode** = exact amount only, no partial, no exceptions
- No cover expenses ever — admin never advances any cost

#### Amount
- Auto-computed from weekly summary
- Editable by **admin only** before client sees it

#### Payment Reminders
- **Wednesday** — reminder notification sent to client (payment is coming Friday)
- **Friday** — automatic payment request generated

---

## Access Control

| Feature | Admin | Client |
|---|---|---|
| Input weekly labor & materials | Yes | No |
| View weekly summary | Yes | Yes |
| Create materials procurement list | Yes | No |
| Mark item as bought (company) | Yes | No |
| Mark item as bought (client) | No | Yes |
| Upload proof of receipt | Yes | Yes |
| View all receipts & transactions | Yes | Yes |
| Edit payment request amount | Yes | No |
| Manually send payment request | Yes | No |
| Self-pay | No | Yes |
| Mark week as strict | Yes | No |
| View payment history | Yes | Yes |

---

## Payment Flow Summary

```
Monday - Thursday   → Admin inputs labor, materials, procurement list
Wednesday           → System sends payment reminder to client
Friday              → System auto-generates payment request
                    → Admin can edit amount if needed
                    → Client pays (full or partial up to ₱5,000 short)
                    → Revolving fund replenished

If partial paid     → Next Friday is auto-strict (full amount required)
If admin marks strict → That Friday is strict regardless of history
```

---

## Out of Scope (Not in MVP)
- Per-worker payroll breakdown (labor is total only)
- Cover expenses / cash advances by admin
- Partial payments beyond ₱5,000 shortage
- Client editing payment amounts
