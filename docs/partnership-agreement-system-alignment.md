# Partnership Agreement (AGR-PTN-001 v1.0) — System Alignment Review

Deep-study comparison of `Partnership_Agreement_DACS_v3.pdf` against how the DACS
web system actually works (admin dashboard, Project Management, Project Control,
Client portal, **Dacs Partnership portal**, Supabase auth). Each finding below
says what the agreement claims, what the system really does, and the proposed
revised wording.

> ⚠ These are OPERATIONAL alignment revisions only. The template itself says it
> must be reviewed by a Philippine lawyer before execution — that still applies.

---

## Finding 1 — Two different meanings of "Partner" (HIGH)

**Agreement:** "Partner" = co-owner architect of the Company (equity, profit
share, management rights).

**System:** the *Dacs Partnership portal* account (`CM_PORTAL_MODE='partner'`)
is a **per-project monitoring role**: it sees ONE construction project's direct
costs, weekly summaries, cash receipts, procurement, milestones and reports —
and it deliberately **cannot see the management fee, client payments, or SOA**.
Portal "partner" ≠ equity Partner; using one word for both invites disputes
(e.g. a portal partner claiming Art. 4.4 full-books rights).

**Proposed revision — add to Recitals/Definitions:**

> "Partner" refers exclusively to a party to this Agreement holding a
> partnership interest under Article III. Access credentials to the Company's
> "Partnership Portal" or any other monitoring system do not, by themselves,
> confer or evidence partnership status; conversely, a Partner's rights under
> this Agreement are not limited by the scope of any portal view.

---

## Finding 2 — Books of account: Art. 4.4 vs what the portal shows (HIGH)

**Agreement 4.4:** "Complete and transparent books of account shall be kept at
the principal office, and every Partner shall at all reasonable hours have
access to and may inspect and copy them."

**System:** the books are **electronic** (Supabase-hosted), not paper at the
principal office: weekly/daily bills (`weeklyBills`), payment requests with a
verification trail (pending → under review → paid), procurement, labor &
out-source capped contracts (pakyaw) with cap history, revolving-fund records,
gross-profit/margin views in Project Control. The Partnership portal shows a
partner **only direct costs** — the management-fee and client-payment views are
hidden by design. As written, 4.4 promises more than the portal delivers.

**Proposed revision — replace 4.4 with:**

> 4.4 Complete and transparent books of account shall be maintained in the
> Company's electronic records system, with backups, and shall constitute the
> official books of the partnership. Every Partner shall, upon reasonable
> notice, be given full access to inspect and copy the complete books —
> including billing, payments, management-fee computations, contracts, and
> fund records — pursuant to Article 1805 of the Civil Code. Any dashboard or
> portal view provided to a Partner is a convenience summary only and does not
> limit this right of full inspection.

---

## Finding 3 — No article covers the actual cash flow: Client → Partner → Admin (HIGH — biggest gap)

**System:** the partner **receives the client's cash** for a project ("Total
cash receipt", e.g. ₱140,000), pays project direct costs out of it, and the
Company **collects the fund from the partner weekly** (the repurposed
Revolving-Fund weekly collection; flow **Client → Partner → Admin**). The
portal even shows a negative "Remaining cash receipt" when direct cost exceeds
collections (e.g. −₱997).

**Agreement:** silent. Nothing obliges a Partner who holds client money to
remit it, keep it separate, or answer for deficits — the largest real-world
liability in the current operation.

**Proposed revision — new Section 4.5 (or Article IV-A):**

> 4.5 Handling of Client Collections. Where a Partner receives payments from a
> client on behalf of the partnership: (a) such funds are and remain
> partnership property held in trust by the receiving Partner; (b) the Partner
> shall record every receipt in the Company's records system within
> forty-eight (48) hours; (c) the Partner shall remit or account for the funds
> on the Company's weekly collection schedule, less only project disbursements
> supported by receipts recorded in the system; (d) any deficiency (project
> direct costs advanced beyond collections, or collections not remitted) shall
> be settled in the weekly reconciliation, and unremitted client funds shall
> bear interest at [To be filled]% per month and may be charged against the
> Partner's profit share; (e) willful failure to remit shall constitute a
> breach of fiduciary duty under Section 10.4(a).

---

## Finding 4 — Art. 8.4 requires 2FA the system doesn't have (MEDIUM)

**Agreement 8.4:** "…password standards, **two-factor authentication**, and the
one (1)-hour incident reporting rule."

**System (verified in code):** Supabase email + password login with a
Cloudflare **Turnstile captcha** on all auth flows; accounts are
**admin-provisioned** (no self-signup); **no 2FA/MFA exists anywhere** in the
codebase. A signed agreement asserting 2FA compliance would be false on day 1.

**Option A (recommended) — revise 8.4 to match reality, keep 2FA as a goal:**

> 8.4 IT and Cybersecurity. Partners shall use Company IT resources in
> accordance with Annexes D and E, including: use of individually provisioned
> accounts only, with no credential sharing; compliance with the Company's
> password standards; completion of any human-verification challenge on login;
> multi-factor authentication **once made available** by the Company; and the
> one (1)-hour incident reporting rule.

**Option B — keep the clause and implement 2FA** (Supabase supports TOTP MFA;
it would need to be wired into every login flow: admin, client, partner).

---

## Finding 5 — Offboarding: name the real mechanism (LOW)

**Agreement 10.2:** withdrawal requires "revocation of accounts and access".

**System:** this exists — the admin User Navigator has **Deactivate
User/Account** toggles per account. Aligned; suggested tightening only:

> …including deactivation of all Company system accounts (administrative,
> client-portal, and partnership-portal credentials) by the Managing Partner
> or their designee, effected in the Company's user-management system on or
> before the Partner's effective date of separation.

---

## Finding 6 — Notices & records the system can already serve (LOW)

- **6.3 Meetings/minutes:** no minutes module exists; keep minutes as documents
  (out of system scope). Video-conference attendance clause is fine.
- **10.6 Abandonment notices** (registered mail + e-mail): the system has
  e-mail + web-push notifications; consider adding "notice via the Company's
  official e-mail and recorded in the Company's notification system is
  sufficient written notice" for speed, keeping registered mail as backup.
- **2.3 Certificate of Partnership Interest:** manual document; no system
  artifact needed.
- **5.2 PRC license tracking:** optional enhancement — add PRC license no. /
  expiry fields to partner profiles so the 48-hour disclosure duty has a place
  to live in the system.

---

## Findings with NO mismatch (checked, aligned)

| Agreement | System reality | Verdict |
|---|---|---|
| 4.1–4.3 profit split, drawings | Project Control computes Gross Profit (Revenue − Actual cost) & margin per project; distributions themselves are manual | OK (distributions out of system scope) |
| 7.2 Partners exempt from employee-only policies | Portal treats partner as monitoring role, not staff; staff-only amount hiding is separate | OK |
| 5.4 Partners are duty-holders, not workers | No timekeeping applied to partners in system | OK |
| 8.1–8.3 confidentiality / IP | Procedural; portal scoping (per-project data isolation, incl. the new `constructionProjectId` SOA scoping) supports client confidentiality | OK |
| 11 Grievance / mediation / arbitration | Procedural, no system dependency | OK |

---

## ADDENDUM (2026-07-02) — Partner Retention & Anti-Abandonment Provisions
### Researched industry-standard "assurance" clauses — proposed new ARTICLE XIV

The template's only real protections against a partner walking out are the 60-day
notice (10.2) and expulsion after 60 days of silence (10.4e/10.6) — both REACTIVE.
Professional-services firms worldwide use a standard toolkit that makes abandonment
financially irrational, and the Philippine Civil Code explicitly supports it:

**Legal foundations (PH):**
- **Art. 1785** — a partnership may be for a FIXED TERM; leaving before the term is
  withdrawal *in contravention of the agreement*.
- **Art. 1837** — wrongful dissolution: the innocent partners (a) get **damages**,
  (b) may **continue the business** in the same name, and (c) pay the wrongdoer the
  value of his interest **LESS damages and EXCLUDING goodwill**. Goodwill forfeiture
  for bad leavers is literally in the Code.
- **Art. 1226** — penal clauses / liquidated damages are enforceable if stipulated
  in advance (courts may equitably reduce unconscionable amounts — so set realistic
  figures).
- **R.A. 9266** — the architect-of-record's "responsible charge" cannot simply be
  dropped; orderly turnover to another licensed architect is required.

### ★ TOP-3 PRIORITY (adopted 2026-07-02 — also live in the portal agreement §8)
1. **14.1 Minimum Commitment Period** — recommended term: **three (3) years**. The
   foundation: converts early exit into *wrongful withdrawal* (Arts. 1785/1837),
   unlocking damages + goodwill exclusion + business continuation.
2. **14.5 Transition Duty / No Walk-Off** — **no payout of any kind until the
   Managing Partner certifies complete turnover** of every assigned project
   (collections remitted & reconciled, records/credentials handed over, R.A. 9266
   responsible-charge formally transferred).
3. **14.6 Deferred Holdback** — recommended: **20% of each profit distribution,
   released 12 months later**, forfeited by a Bad Leaver. Self-enforcing — the
   deterrent money is already in the Company's hands; no court needed.

### Proposed clauses (ready to paste, fill the [blanks])

> **14.1 Minimum Commitment Period.** Each Incoming Partner commits to an initial
> term of [three (3)] years from admission (the "Commitment Period"). Voluntary
> withdrawal before the end of the Commitment Period, and any abandonment under
> Section 10.6, constitute withdrawal in contravention of this Agreement under
> Articles 1785 and 1837 of the Civil Code.

> **14.2 Leaver Classification.** A departing Partner is a **Good Leaver** if the
> departure is due to death, permanent incapacity, retirement at or after the agreed
> age, or withdrawal after the Commitment Period with full notice and turnover; a
> **Bad Leaver** if the departure is by abandonment (10.6), expulsion for just cause
> (10.4), withdrawal within the Commitment Period without unanimous consent, or
> withdrawal without completing the notice and turnover duties of Section 10.2.

> **14.3 Vesting of Goodwill Interest.** Each Partner's share in firm goodwill vests
> in equal annual tranches over [five (5)] years from admission. A Good Leaver is
> paid capital plus the VESTED portion of goodwill; a **Bad Leaver is paid book
> value of capital only — excluding goodwill entirely** (Art. 1837), less damages
> and less all amounts owed to the partnership.

> **14.4 Liquidated Damages for Abandonment.** A Partner who abandons the
> partnership (10.6) or withdraws in contravention of Section 14.1 shall pay the
> partnership liquidated damages of PHP [amount] (or [__]% of the Partner's average
> annual profit share, whichever is higher) under Article 1226 of the Civil Code,
> without prejudice to proof of greater actual damages. Such damages are first
> offset against the Partner's capital, undistributed profits, and buy-out proceeds.

> **14.5 Transition Duty (No Walk-Off).** No withdrawing Partner may cease work on
> an active project without either (a) completing their responsible-charge duties,
> or (b) a formal written turnover to another duly licensed Architect accepted by
> the Company and, where required, the client (R.A. 9266). During the notice period
> the Partner shall complete the handover checklist: remittance and reconciliation
> of ALL client collections, turnover of drawings/files/credentials, and joint
> client introductions to the successor. The buy-out clock does not start until the
> turnover is certified complete by the Managing Partner.

> **14.6 Deferred Distribution Holdback.** [Twenty percent (20%)] of each Partner's
> annual profit share is retained and released [twelve (12)] months later, provided
> the Partner has not become a Bad Leaver. Holdbacks of a Bad Leaver are forfeited
> to the partnership as partial liquidated damages.

> **14.7 Payout Schedule & Set-Off.** Buy-out proceeds are payable in [equal
> monthly/quarterly] installments over [24] months, each installment conditional on
> continued compliance with Articles VIII (confidentiality/IP) and IX (non-compete /
> non-solicitation). Any unremitted client collections, unliquidated advances, or
> project deficits (Section 4.5) are deducted from the first installments.

> **14.8 Continuation Consent.** Each Partner consents in advance that, upon any
> Partner's withdrawal, expulsion, abandonment, incapacity, or death, the remaining
> Partners may continue the business under the same name without posting the court
> bond contemplated in Article 1837, the departing Partner's interest being settled
> exclusively per Sections 10.3 and 14.3–14.7.

> **14.9 Injunctive Relief.** Breach of Sections 14.5, VIII, or IX causes
> irreparable harm; the partnership is entitled to injunctive relief in addition to
> damages, notwithstanding the arbitration clause (Art. XI).

> *(Optional)* **14.10 Key-Person Insurance.** The partnership may procure and own
> key-person life/disability insurance on each Partner to fund buy-outs under 10.3.

### How the DACS system already backs these up
- All work product, costs, contracts, and client records live in the **Company's
  system**, not a partner's personal files — an abandoning partner takes nothing.
- The **weekly fund reconciliation** (§4.5) caps how much client money a partner
  can ever be holding when they walk.
- **Account deactivation** (User Navigator) cuts access on day one of separation.
- The **signed e-agreement** (stepper: read → e-sign → review) records signature,
  date/time, and IP — clean evidence the partner accepted these terms.
- *Possible future system support:* per-partner commitment-date + vesting-schedule
  fields, an exit/turnover checklist module, and holdback tracking in payouts.

> ⚠ Set liquidated-damages amounts realistically — PH courts reduce unconscionable
> penalties (Art. 1226/1229). All of Article XIV must be reviewed by a Philippine
> lawyer before adoption; goodwill valuation of professional firms is fact-specific.

---

## ADDENDUM 2 (2026-07-02) — Collection, Remittance & Commission structure
### The REAL money flow, and the industry agreement type that covers it

**Clarified flow:** the PARTNER collects the client's payments and keeps them;
what the Partner remits to the Company is only (1) the **revolving fund** for
project operations and (2) the Company's **commission**. This is not a simple
"remit everything weekly" trust — it is a **REVENUE-SHARING / COLLECTION-AND-
REMITTANCE arrangement with a waterfall**, which is a well-established agreement
type. Industry standards for it: a defined revenue base, a payment waterfall,
a remittance statement with every payment, audit rights, holdback/clawback, and
late-remittance interest.

**Legal anchors (PH):**
- **Art. 1891, Civil Code (Agency):** one who collects money on another's account
  must **render an account and deliver** what is due — and any stipulation
  exempting the collector from accounting is **VOID**. The Company's portions
  (fund + commission) inside each collection are held in trust until remitted.
- **Art. 1226:** interest/penalty on late remittance is enforceable if stipulated.
- ⚠ **Tax flag:** who issues the BIR Official Receipt to the client determines
  whose gross revenue the collection is (Company vs Partner). This MUST be set
  with the accountant — it changes VAT/percentage tax and income-tax exposure.

### Proposed ARTICLE XV — Collections, Commission & Remittance (ready to paste)

> **15.1 Collection Authority.** The Partner is authorized to receive payments
> from clients of assigned projects. Every collection shall be recorded in the
> Company system within forty-eight (48) hours, with the official receipt/
> acknowledgment issued in accordance with Section 15.6.

> **15.2 Waterfall.** From each collection, funds are applied in this order:
> (1) the **revolving fund** contribution for project operations, per the
> project's agreed funding schedule; (2) the **Company commission** equal to
> [__]% of [gross collections / the contract price portion collected]; (3) the
> balance retained by the Partner as their share. Amounts under (1) and (2) are
> Company funds **held in trust** by the Partner from the moment of collection
> (Art. 1891) and are not the Partner's money at any time.

> **15.3 Remittance & Statement.** Items (1) and (2) are remitted on the
> Company's **weekly schedule**, each remittance accompanied by a statement
> showing gross collections, the fund contribution, the commission computation,
> and the balance retained. The Company system's recorded receipts and
> disbursements are the basis of the statement.

> **15.4 Late Remittance.** Amounts not remitted when due bear interest of
> [__]% per month and are treated as outstanding partner liabilities in the
> weekly reconciliation; willful non-remittance of trust amounts is a breach of
> fiduciary duty and a ground under Section 10.4.

> **15.5 Audit & Clawback.** The Company may audit the Partner's collection
> records for assigned projects on reasonable notice. Over-retained amounts are
> returned (clawback) at the next reconciliation; the Company may additionally
> hold back [5–10]% of the Partner's retained share for [60–90] days against
> reversals or client refunds.

> **15.6 Receipts & Taxes.** Official receipts to clients are issued by
> [Company / Partner — SET WITH THE ACCOUNTANT], and each party bears the taxes
> on the revenue attributed to it. The Partner shall not issue receipts in the
> Company's name except as expressly authorized in writing.

*Sources: standard revenue-sharing agreement structures (remittance statements,
audit rights, 5–10% holdbacks, clawbacks); PH Civil Code Title X (Agency).*

---

## Blank fields still to be filled (unchanged from template)

Company name & address, partner names/PRC numbers, capital table & % interests,
distribution frequency, decision thresholds (₱), meeting cadence, non-compete
territory & years, buy-out valuation method & payout months, arbitration seat,
document dates/preparer/approver.

*Prepared 2026-06-30 from a code-level review of the DACS system. Not legal advice.*
