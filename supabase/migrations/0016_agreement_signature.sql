-- ════════════════════════════════════════════════════════════════════
-- FIRST-LOGIN AGREEMENT — digital signature + audit fields
-- The construction client/partner first-login agreement now records a typed
-- digital signature, the accepted timestamp, and (optionally) the client IP.
-- profiles.agreement_accepted already exists (0001_init.sql); add the rest.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists agreement_accepted_at timestamptz,
  add column if not exists agreement_signature   text,
  add column if not exists agreement_ip           text;
