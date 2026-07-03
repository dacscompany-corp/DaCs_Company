-- 0017_partner_agreement_fields.sql
-- Partners sign the PARTNERSHIP agreement (fund-in-trust / weekly-remittance
-- terms shown in Dacs Partnership.html), which is a different document from the
-- client's Cost-Plus agreement — so acceptance is tracked in separate columns
-- on the shared profiles table. One account can use both portals; signing one
-- document must never mark the other as accepted.
-- See docs/partnership-agreement-system-alignment.md (Findings 1–3).

alter table profiles
  add column if not exists partner_agreement_accepted        boolean default false,
  add column if not exists partner_agreement_accepted_at     timestamptz,
  add column if not exists partner_agreement_signature       text,
  add column if not exists partner_agreement_signature_image text,
  add column if not exists partner_agreement_ip              text;
