-- ════════════════════════════════════════════════════════════════════
-- 0053_invoice_signatories.sql
--
-- NAME THE PEOPLE ON THE SIGNATURE LINES.
--
-- The printed sales invoice has always ended with three bare rules
-- labelled "Prepared by / Received by / Approved by". Nothing in the
-- editor ever filled them in, so every invoice went out with three
-- blank lines to be written on by hand — and every invoice showed all
-- three, even when one of them made no sense for that document (a
-- self-billed progress invoice has no separate approver).
--
-- This column stores, per invoice, what is printed above each line and
-- whether that block prints at all:
--
--   {
--     "preparedBy": { "name": "Juan Dela Cruz",
--                     "org":  "DAC'S Building Design Services",
--                     "esign": true,  "show": true  },
--     "receivedBy": { "name": "", "org": "", "esign": false, "show": true  },
--     "approvedBy": { "name": "Maria Santos", "org": "Project Manager",
--                     "esign": false, "show": false }
--   }
--
--   name   — printed above the rule, bold
--   org    — company or position, the row under the name
--   esign  — stamp assets/images/dacs-signature.png above the name. Meant
--            for the company's own blocks; a client's Received-by line is
--            left blank for a wet signature.
--   show   — whether the block prints at all
--
-- Keys are OPTIONAL. A missing key, or a missing "show", is read by the
-- module as { name:'', org:'', esign:false, show:true } — which is exactly
-- today's output: an unnamed line that prints. So the default '{}' means
-- every invoice written before this migration prints byte-for-byte as it
-- does now, and there is no backfill to run. Adding further keys later
-- needs no migration either; the blob is free-form by design.
--
-- If all three blocks are hidden the whole signature row is omitted
-- rather than left as an empty gap above the footer.
--
-- PRESENTATION ONLY. This is who signs the paper, not what is owed.
-- Nothing here touches items, subtotal or total_amount, and no money
-- calculation reads this column.
--
-- One jsonb column rather than six scalar columns because these three
-- blocks are one editorial unit that is always read and written
-- together, and are never filtered or aggregated on — the same reason
-- payment_details is a single jsonb blob.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table invoices
  add column if not exists signatories jsonb not null default '{}'::jsonb;

comment on column invoices.signatories is
  'Presentation only. Per-invoice signature blocks: {preparedBy|receivedBy|approvedBy: {name, org, esign, show}}. name and org print above the rule (org = company or position); esign stamps assets/images/dacs-signature.png; show hides the block. A missing key or missing "show" means an unnamed line that prints, i.e. pre-0053 behaviour. Never affects subtotal, total_amount or any money calculation.';
