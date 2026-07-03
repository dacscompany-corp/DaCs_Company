-- ════════════════════════════════════════════════════════════════════
-- 0023_agreement_doc_versions.sql
--
-- Versioned agreement templates. Admins can now edit the Cost-Plus and
-- Partnership agreement section text (User Navigator → "Agreements");
-- the current text + full version history live in settings docs
-- agreementDoc_client / agreementDoc_partner (version 1 = the standard
-- text hardcoded in js/print-utils.js).
--
-- These columns record WHICH version each signer accepted, so reprints
-- always render the text in force at signing — editing the template can
-- never rewrite an already-signed document.
-- ════════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists agreement_doc_version         int,
  add column if not exists partner_agreement_doc_version int;

alter table agreement_events
  add column if not exists doc_version int;

-- Signers must be able to READ the current template: settings is otherwise
-- admin-only (0002 exposes only paymentQR to authed users). Without this,
-- clients/partners would silently render the standard text while the admin
-- believes they see the edited version.
drop policy if exists settings_agreement_docs_read on settings;
create policy settings_agreement_docs_read on settings for select
  using (key in ('agreementDoc_client', 'agreementDoc_partner') and auth.uid() is not null);

notify pgrst, 'reload schema';
