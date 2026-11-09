# WorkMate — Linked Labor Contracts MVP terms

Date: 4 November 2026

Written for: the owner, the designer/implementer and the reviewer.

Status: **Approved by the owner on 4 November 2026,** including section 8's editing rules, the Project Control-only MVP boundary and main-owner-only account linking. **Still open:** Additional Works progress and sensitive offline-cache behaviour need concrete proposals in the implementation plan (section 11). Linked Labor stays a separate stage from WorkMate 3b/0E, and its release timing is not chosen. Approving these terms does not approve a build, alter an existing implementation plan, authorize data linking, reset accounts, commit files or change the live system. No individual worker/contract progress feature is requested.

**Clarification, 9 November 2026 (wording only).** These terms first said staff "keep entering the typed name" and kept "staff contract-entry rights". That did not describe the existing workflow. In Project Control, **staff type a worker's name when they record a payment; they do not create contracts.** The two sentences in section 5 now say so. This changes no permission: account linking stays main-owner-only, and what staff can do on screen and on the server is exactly what it was.

## 1. Purpose

Connect existing Project Control labor contracts to WorkMate accounts without replacing today's New Labor Contract workflow. The office may continue creating a contract with a manually entered name and link the correct account later. A linked worker or responsible leader can see that agreement's scope, amounts and recorded payments on the phone, alongside the project's existing overall accomplishment percentage.

The worker keeps a main trade on their profile. Their job/trade and scope on each contract can differ from it, and editing a contract must not edit the profile or another contract.

## 2. Confirmed owner decisions

| Subject | Confirmed requirement |
|---|---|
| Existing contract workflow | Preserve the current New Labor Contract form and its existing arrangements. Account linking extends it; it is not a replacement form or a forced account-creation step. |
| Pakyaw crew agreement | One agreement with the leader/responsible worker. The owner pays that person; that person handles distribution to helpers. Do not require the leader to submit a helper roster or individual helper shares. |
| Manual entry first | Create the contract as today with a typed name. Link a WorkMate account when ready. Existing accounts may be selected at creation as a convenience, never a prerequisite to recording a legitimate agreement. |
| Main trade and actual job | Main trade belongs to the worker profile. The contract has its own editable job/trade and scope. A mason may have a ceiling or demolition agreement without changing their main trade. |
| Multiple sites | Workers may have agreements on several projects and move according to actual work, discussions and office instructions. Do not introduce a mandatory assignment roster, date approval, fixed schedule or new site-access gate. |
| Actual whereabouts | Existing attendance records where a worker attended. Do not treat a contract as proof of attendance or rewrite attendance from contracts. |
| Worker money visibility | The account explicitly linked to an agreement may see its own agreement amount, recorded payments and applicable balance. This is a narrow exception to the earlier no-pesos rule for workers. |
| Project completion | Show the project's existing overall completion/accomplishment percentage and existing completion status. Do not create a percentage for a worker, task or labor contract. The owner's earlier 30% example was explanatory only. |
| Contract editing safeguards | The owner requested a recommendation and approved section 8 on 4 November 2026. |

The two John Tapales accounts are the owner's testing accounts. Danilo Tapales and Mark Frias are real workers whose accounts the owner also used for testing. Test activity is not permission to delete their accounts/history or to link contracts to them automatically.

## 3. Existing system to extend

The current repository already has:

- A worker identity and main position/trade in `profiles`, including worker numbers.
- Project Control agreements in `labor_contracts`, with `worker_name`, `scope`, `trade`, `folder_id`, agreed amount, status, agreement documents and payment arrangement fields.
- Fixed/capped, daily/uncapped and combined-scope/lumpsum behaviour. Preserve the combinations the current form permits; do not invent a new payroll calculation.
- Payments linked by `payroll.contract_id`, including split rows, multi-contract allocation and payments without a contract.
- Worker cards, statements and other paths that currently group by typed names. A dropdown alone will not make these paths account-safe.
- Separate Project Management contracts and weekly-bill payments. They are not the same tables or payment path as Project Control.

Source references: `docs/DATABASE_SCHEMA.md` (payroll, labor contracts and attendance); `js/expenses-module.js` (`handleSaveLaborContract`, `lcWorkerContracts`, `lcPaid`, `lcStats`, payroll save/edit and contract picker paths); `js/portal-app.compiled.js` (worker tracker, payroll mapping and project accomplishment).

**Approved MVP boundary:** Project Control labor agreements, Dacs Web office linking and WorkMate's own-agreement view. Project Management contracts, vendor/business representative access and a new wage-distribution system are excluded unless the owner explicitly adds them. Existing manual vendor contracts remain usable and unchanged.

## 4. Core records and meanings

1. **Person/account:** the persistent identity, selected by name plus worker number and linked by immutable account ID, not spelling. Main trade is a profile attribute; account role controls app authority.
2. **Project:** the agreement's existing Project Control folder. `projects` in this repository means billing periods, not the site. Never substitute a `construction_projects` ID for a `folders` ID.
3. **Agreement:** one existing labor contract with its own terms, scope, category and payment basis. Add a real nullable account-link field through a new migration; do not hide the relationship inside notes or a typed name.
4. **Payment:** the existing recorded payroll/payment allocations against the agreement. Linking creates no payment, expense, charge or copy of an agreement.

One account may have several agreements on the same project and agreements across several projects. One crew agreement remains one agreement and one agreed amount regardless of how many helpers work on it. No helper roster is required for this feature.

The linked account represents the agreement holder/responsible leader, not every beneficiary the leader may later pay. The phone must not imply that a payment to the leader proves the helpers were paid.

## 5. New Contract and later linking

### Create

- Keep manual name entry, scope, trade, notes, agreement documents and existing payment/contract options.
- Optionally, the main owner selects an existing worker account using name and worker number. Show which account will receive phone access before saving. Staff do not create contracts; they type a worker's name when they record a payment (clarified 9 November 2026).
- Selection may prefill the name and main trade as defaults. The office can edit the **contract's** job/trade and scope without writing to `profiles.position`.
- Do not infer a Team Leader role from the contract's job title, pay type, scope or the fact that the person distributes money to helpers.
- Do not require a team, a helper list or a project assignment record to save the contract.

### Link an existing manual-name agreement

- The main owner explicitly selects the account and confirms the agreement, project and worker number. **Approved authority: only the main owner grants or changes this financial access**, while staff access stays exactly as it was (clarified 9 November 2026: staff record payments and do not create contracts).
- Check active eligible worker/team-leader account, company ownership and agreement ownership on the server. Do not accept an account from another company, or a client/partner account.
- Keep the same contract ID, category, agreed amount, payment basis, payments, funding allocations and signed documents. Preserve the original recorded name and an audit of the link.
- A suggested name match is never an approved link. “Danilo”, “Danilo Tapales” and duplicate names require the main owner's confirmation.
- Choosing an account does not merge other name-matched contracts, rename old payroll or grant access to all contracts bearing that name.
- No mass linking or backfill without a separately reviewed list approved by the owner. Unlinked records continue working in the office.

## 6. WorkMate view and privacy

The account explicitly linked to an agreement may read:

- Project name, existing completion status and existing overall accomplishment percentage.
- Agreement scope, contract job/trade, payment basis and applicable work names.
- Agreed amount for capped agreements, paid-to-date and remaining/overpaid amount under the existing rules.
- Its own recorded payment allocations, with dates and safe descriptive fields.

Daily/uncapped contracts show paid-to-date and their daily basis. They must not show a fictional agreed total, percentage paid or remaining balance. A paid-in-full agreement is not proof that work is complete. No percentage is calculated from payments.

**Financial access boundary:** helpers, teammates, another leader and another account with the same name gain no access through membership, role or name alone. A leader may see other operational team information only under the existing team rules, not other people's agreement money.

Do not expose client contract value, project profit, budgets, funding/Cover balances, other workers' payments, indirect payroll, overhead or company-wide totals. The independent staff/Overhead decision remains separate. Do not open existing broad payroll or contract table access to workers; provide a server-checked own-agreement response containing only permitted fields.

A payment split across agreements or billing periods must appear under this agreement only for its attributable amount, without double counting or showing another party's allocations. Mixed-party receipts, notes, statements and signed documents are **not automatically phone-visible**; each requires a deliberate safe response or separate approval.

Recorded payments are described as company records, not as worker acknowledgements of receiving cash. Receipt confirmation/disputes are not added by this MVP.

Cached and offline data must be per account, cleared on sign-out as appropriate and revalidated after access changes. The implementation plan must define cache expiry and revocation behaviour for this newly sensitive financial data. A failed refresh must not present an old balance as current; visibly label any permitted saved copy, or show unavailable.

## 7. Project progress and flexible site work

- Reuse the existing Project Control overall accomplishment result. Return the permitted percentage/status only, not the BOQ amounts, revenue or other inputs that would reveal confidential values.
- Label it **Overall project progress**. It is not the linked worker's accomplishment and does not determine their pay.
- Preserve current handling of Main Contract and Additional Works. The plan must identify the exact existing source and aggregation; do not invent a new percentage or silently substitute the parent project's value for an Additional Works agreement.
- If no meaningful project accomplishment figure exists, say that progress has not been recorded. Do not turn the money model's forecast/revenue fallback into a displayed 100% completion.
- A completed project and its linked agreements remain available as authorized history. Completion does not mark a balance paid, create payroll or erase tools/attendance.
- Account links do not change Attendance, Allow requests, Item history, My Work or team authority. Site permissions continue to operate under their existing rules. A contract does not prove which site someone visited that day.
- Ending a contract must not prevent legitimate Time Out, a delayed valid attendance sync or an authorized tool return under existing rules.

## 8. Editing and history rules — approved by the owner, 4 November 2026

| Situation | Approved behaviour |
|---|---|
| Draft, no signed agreement and no payments | Edit normally; retain normal audit information. |
| Wording correction after signing/payment | Reason required; preserve previous terms, actor and time. Never overwrite the original signed file silently. |
| Extra work under the same agreement | An explicit amendment records added scope and any separately approved change in price; existing payments remain counted once. |
| Separate job/agreement | Another contract for the same account is allowed, including on the same project. |
| Price change | Preserve old and new agreed amounts, reason and time; no payment or expense is created by the amendment. Existing cap/overpayment rules still apply. |
| Daily/fixed or individual/crew identity change | Do not silently convert an established agreement. Specify a reviewed correction process before enabling such changes. |
| Replace or unlink the account | Treat as a financial-access correction by the main owner, with audit and confirmation. Revoke the old account's access and handle its cached copy; never move money or silently reassign the contracting party. |
| Main trade/name changes | Do not rewrite historical contract terms, payroll labels, attendance snapshots or signed documents. Current identity may be shown alongside the recorded historical name. |
| End an agreement or deactivate a worker | Preserve the relationship and history; deny new actions as appropriate without deleting records or preventing office settlement. |

Do not remove the current contract tools without an approved replacement. Existing merge, delete, print and statement paths must be reviewed: none may combine different linked people merely because their names match, or discard account ownership as a side effect.

## 9. Money rules that must remain intact

- Linking, viewing, selecting an account and editing descriptive scope create **no new payroll, expense, supplier payment or client bill**.
- Existing payroll allocations remain the source of paid-to-date. Contract terms are not a second spend ledger.
- Preserve fixed, daily and lumpsum semantics, split rows, contract allocations, funding periods, Cover treatment and overpayment reporting.
- Indirect labor remains Overhead, counted once. Overhead pay must never draw down a pakyaw contract. A different trade/scope text must not silently reclassify recorded pay.
- Attendance, task status and project accomplishment do not automatically create wages, payments, reward eligibility or contract drawdowns.
- Keep Project Management and Project Control payment paths distinct. No automatic replication between them.
- Preserve all real contracts, payments, attendance, account identities and original signed records. No name-based financial migration or test cleanup against real data.

## 10. Required implementation review and proof

The implementation plan must list every affected create, edit, save, grouping, picker, merge, delete, statement, receipt, print and export path, plus worker authorization and offline storage. The shim requires real columns and appropriate field mapping; the next migration number is chosen from the highest on disk at implementation time.

Required acceptance cases:

1. Manual-name contract creation still works with no account or helper list. Selecting an account prefills defaults without changing the profile.
2. One account: different jobs on two projects and two agreements on one project; scope edits remain local to the chosen agreement.
3. Duplicate names: only the explicitly linked worker number/account receives access. Renaming or changing main trade preserves historical identity and terms.
4. One crew cap and one payment stream: helpers do not multiply agreed amounts, balances or Spent, and gain no automatic money access.
5. Later linking of a paid contract preserves its ID, allocations, balance, statements and signed documents exactly.
6. Capped, daily, lumpsum, mixed funding and split-payment cases retain existing totals and do not reveal another agreement's money.
7. Helper, unrelated worker, unrelated leader, client, another company and deactivated-account access are refused server-side. Stale sessions and offline copies follow the approved sensitive-data rules.
8. Overall project progress matches the established office figure without revealing monetary inputs. No accomplishment data is not shown as 100%; no individual job-progress field exists.
9. Project completion retains authorized history without marking unpaid agreements paid. Site selection and attendance remain unchanged.
10. Approved editing/link corrections preserve history and revoke obsolete financial access. Unrelated records and financial totals are unchanged.
11. Browser, phone, server and money-invariant checks cover actual behaviour, including failed reads and retries; tests are not limited to source-string checks.
12. Any pilot uses clearly identified synthetic records, preserves all real data and has a reviewed guarded cleanup. No existing attendance is deleted or invented.

## 11. Scope boundaries and next decisions

Not included: helper wage distribution, compulsory crew rosters, site scheduling/assignment approvals, new attendance/payroll calculations, individual work-progress percentages, automatic completion-based pay, new rewards, automatic historical linking, vendor/business logins, or changes to existing staff Overhead permissions.

**Approved by the owner on 4 November 2026:**

- Section 8's editing/history rules.
- The Project Control-only MVP boundary and main-owner-only financial linking.

**Still open:** the implementation plan must make concrete proposals for these two items, and the owner must approve them before that plan is treated as final:

- The exact Additional Works progress behaviour.
- The sensitive offline-cache policy.

Linked Labor stays a separate stage from 3b/0E, and its release timing is not chosen. Worker-account linking is not permission to silently change the approved Tools behaviour. Messenger remains official attendance until the owner explicitly approves the switch-over date; no deployment or switch-over date is set here.

Next step: prepare a scratch-tested implementation plan, including the two concrete proposals above. Do not begin product code, apply migrations, publish, change accounts or link real contracts merely because these terms are approved.
