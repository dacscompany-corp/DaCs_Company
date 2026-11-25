-- 0115 (no payment list on the phone) — live checks. READ-ONLY: it only
-- selects from the catalog. Safe in the Supabase SQL editor.
--
-- Run it BEFORE applying 0115 and AFTER, and keep both results:
--   · Part 1 must read true in every column AFTER (before, 'no_payments' is
--     false — that is 0113).
--   · Part 2 lists a fingerprint of every other Linked Labor function. The two
--     lists must be identical: 0115 changes ll_my_agreements() only.
-- Spec: docs/superpowers/specs/2026-11-17-workmate-agreements-no-payment-list-design.md

-- ── Part 1: ll_my_agreements() itself ──
select
  count(*) = 1                                                    as exists_once,
  bool_and(p.prosecdef)                                           as security_definer,
  bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as authenticated_can_run,
  bool_and(not has_function_privilege('anon', p.oid, 'execute'))  as anon_cannot_run,
  bool_and(p.prosrc like '%''balance''%' and p.prosrc like '%''paid''%' and p.prosrc like '%''agreed''%')
                                                                  as keeps_agreed_paid_balance,
  bool_and(p.prosrc not like '%''payments''%' and p.prosrc not like '%payment_method%')
                                                                  as no_payments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'll_my_agreements';

-- ── Part 2: every other Linked Labor function, unchanged (compare before/after) ──
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function,
       md5(replace(p.prosrc, chr(13), '')) as body_md5
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'lc\_%' or p.proname like 'll\_%')
  and p.proname <> 'll_my_agreements'
order by 1;
