-- ════════════════════════════════════════════════════════════════════
-- Add the agreement-acceptance timestamp to profiles.
--
-- The construction client portal records WHEN a client accepts the Cost-Plus
-- Project Management Agreement (a binding confirmation "equivalent to a written
-- signature"). The app already writes `agreementAccepted` (→ agreement_accepted)
-- plus `agreementAcceptedAt` (→ agreement_accepted_at), but the latter column
-- was never created — so the write failed with:
--   "Could not find the 'agreement_accepted_at' column of 'profiles'"
-- and blocked clients from getting past the acceptance modal.
--
-- Run AFTER 0001_init.sql.
-- ════════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists agreement_accepted_at timestamptz;
