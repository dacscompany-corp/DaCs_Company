-- ════════════════════════════════════════════════════════════════════
-- RLS verification — run in the Supabase SQL editor AFTER migrating data.
-- Impersonates each role by setting the JWT claims, then asserts what is
-- and isn't visible. Replace the sample UUIDs/emails with real migrated ones.
--
-- Usage: run a block, read the NOTICE output. `set local` only lasts the txn,
-- so each block is wrapped in begin/rollback.
-- ════════════════════════════════════════════════════════════════════

-- Helper to impersonate: set role + jwt claims for the current transaction.
-- (Supabase: the `authenticated` role + request.jwt.claims drive auth.uid()/auth.jwt().)

-- ── 0. Pick real ids to test with ────────────────────────────────────
-- select id, email, role, owner_id, kind from profiles order by kind, role;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 1. STAFF must NOT see folder_budgets / project_budgets (money).    ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<STAFF_UUID>","email":"staff@example.com","role":"authenticated"}';
  do $$
  declare n int;
  begin
    select count(*) into n from folder_budgets;
    raise notice 'STAFF folder_budgets visible = % (EXPECT 0)', n;
    select count(*) into n from project_budgets;
    raise notice 'STAFF project_budgets visible = % (EXPECT 0)', n;
    select count(*) into n from folders;
    raise notice 'STAFF folders visible = % (EXPECT > 0 — owner''s shared data)', n;
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 2. OWNER sees their own budgets.                                   ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<OWNER_UUID>","email":"owner@example.com","role":"authenticated"}';
  do $$
  declare n int;
  begin
    select count(*) into n from folder_budgets;
    raise notice 'OWNER folder_budgets visible = % (EXPECT > 0)', n;
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 3. WORKER must NOT read inventory; can read requests/batches.      ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';
  do $$
  declare n int;
  begin
    select count(*) into n from inventory;
    raise notice 'WORKER inventory visible = % (EXPECT 0)', n;
    select count(*) into n from requests;
    raise notice 'WORKER requests visible = % (EXPECT >= 0, allowed)', n;
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 4. CLIENT sees ONLY their own folder/BOQ/invoices/payments.       ║
-- ║    Replace email with a real client's.                            ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<CLIENT_UUID>","email":"client@example.com","role":"authenticated"}';
  do $$
  declare n int; bad int;
  begin
    select count(*) into n   from folders where lower(client_email) = 'client@example.com';
    raise notice 'CLIENT own folders = % (EXPECT > 0)', n;
    select count(*) into bad from folders where coalesce(lower(client_email),'') <> 'client@example.com';
    raise notice 'CLIENT other folders leaked = % (EXPECT 0)', bad;
    select count(*) into n from folder_budgets;     -- only their own folder's budget
    raise notice 'CLIENT folder_budgets visible = % (EXPECT only own, small)', n;
    select count(*) into n from boq_documents where lower(client_email) = 'client@example.com';
    raise notice 'CLIENT own BOQ docs = % (EXPECT >= 0)', n;
  end $$;
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 5. payment_requests client transition guard (trigger).            ║
-- ║    An illegal client transition must RAISE.                       ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<CLIENT_UUID>","email":"client@example.com","role":"authenticated"}';
  -- Expect SUCCESS: pending -> partial_pending  (uncomment with a real row id)
  -- update payment_requests set status='partial_pending' where id='<PENDING_REQ_OF_CLIENT>';
  -- Expect FAILURE: pending -> verified
  -- update payment_requests set status='verified' where id='<PENDING_REQ_OF_CLIENT>';
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 6. Anti-escalation: a user cannot change their own role.          ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<ANY_UUID>","email":"u@example.com","role":"authenticated"}';
  -- Expect FAILURE (profiles_guard trigger raises):
  -- update profiles set role='owner' where id='<ANY_UUID>';
rollback;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 7. Public testimonials: anon reads only approved + rating>=4.     ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  do $$
  declare bad int;
  begin
    select count(*) into bad from testimonials where not (status='approved' and rating>=4);
    raise notice 'ANON non-approved testimonials leaked = % (EXPECT 0)', bad;
  end $$;
rollback;
