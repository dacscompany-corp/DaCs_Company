-- ════════════════════════════════════════════════════════════════════
-- 0074 — Billing allocations: owner check matches the rest of the app
--
-- 0073 invented its OWN owner test and made it stricter than every other
-- policy in the schema:
--
--     u.kind = 'admin' and u.role = 'owner'
--
-- `kind = 'admin'` appears nowhere else in the database. The canonical test
-- is is_owner() (0002), which is auth_role() = 'owner' — role ONLY:
--
--     create function is_owner() ... select auth_role() = 'owner'
--     create function auth_role() ... select role from profiles where id = auth.uid()
--
-- The browser agrees with is_owner(): js/admin.js reads `data.role` and never
-- looks at `kind` (currentUserRole = data.role || 'owner').
--
-- So a real owner whose profiles.kind is not 'admin' passes every other gate
-- — the portal shows them the contract, the profit and the allocation
-- controls — and is then refused by 0073 alone. Applying a policy to a
-- billing period died with P0001 'Owner access required', surfacing in the
-- UI as the generic "Failed to update project."
--
-- `kind` says WHICH PORTAL a person belongs to (admin | client |
-- construction_client). `role` says WHAT THEY MAY DO. Privilege is role's
-- job, and the login flow already rejects every non-admin role before the
-- dashboard loads. The extra clause guarded nothing and locked out owners.
--
-- This migration drops that one clause in all six places and changes nothing
-- else. The owner_id = auth.uid() ownership test, the folder and period
-- existence checks, the audit trail, the reason requirement and the 100%
-- validation are all preserved exactly as 0073 wrote them.
--
-- Idempotent: policies are dropped first, the function is CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════

-- Defaults may change freely, but must refer to a folder this owner owns.
-- Role checks also exclude staff accounts that happen to own an old data row.
drop policy if exists project_control_allocation_policies_owner on public.project_control_allocation_policies;
create policy project_control_allocation_policies_owner
  on public.project_control_allocation_policies for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.role = 'owner')
  )
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.role = 'owner')
    and exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = (select auth.uid()))
  );

drop policy if exists project_control_billing_allocations_owner_read on public.project_control_billing_allocations;
create policy project_control_billing_allocations_owner_read
  on public.project_control_billing_allocations for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.role = 'owner')
  );

-- Initial snapshots use INSERT, not the shim's .set() (an upsert). Once
-- created, they can only change through the audited RPC below. Retain a
-- dormant snapshot when switching a period to president/cover funding.
drop policy if exists project_control_billing_allocations_owner_insert on public.project_control_billing_allocations;
create policy project_control_billing_allocations_owner_insert
  on public.project_control_billing_allocations for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.role = 'owner')
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );

-- Only the RPC may write audit rows. No client INSERT/UPDATE/DELETE policy.
drop policy if exists billing_allocation_adjustments_owner_read on public.billing_allocation_adjustments;
create policy billing_allocation_adjustments_owner_read
  on public.billing_allocation_adjustments for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.role = 'owner')
  );

-- The audited adjustment RPC. Body is 0073's, with `u.kind = 'admin'` removed
-- from the owner guard. The profiles lookup stays INLINE and fully qualified
-- rather than calling public.is_owner(): this function runs with
-- `set search_path = ''`, and is_owner()'s body references auth_role()
-- unqualified, so resolving it from here would depend on the search_path this
-- function deliberately empties.
create or replace function public.update_project_control_billing_allocation(
  p_project_id uuid,
  p_direct_pct numeric,
  p_indirect_pct numeric,
  p_target_margin_pct numeric,
  p_reason text
)
returns public.project_control_billing_allocations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.project_control_billing_allocations%rowtype;
  v_new public.project_control_billing_allocations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.profiles u
    where u.id = auth.uid() and u.role = 'owner'
  ) then
    raise exception 'Owner access required';
  end if;

  -- Serialize adjustments even when a legacy period has no snapshot yet.
  perform 1 from public.projects
  where id = p_project_id and owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'Billing period not found or access denied';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Reason is required';
  end if;
  if p_direct_pct is null or p_indirect_pct is null or p_target_margin_pct is null
    or p_direct_pct < 0 or p_indirect_pct < 0 or p_target_margin_pct < 0
    or not (abs(p_direct_pct + p_indirect_pct + p_target_margin_pct - 100) < 0.005)
  then
    raise exception 'Allocation percentages must be non-negative and total 100';
  end if;

  -- SELECT INTO leaves all before values NULL for an unconfigured period.
  select * into v_old from public.project_control_billing_allocations
  where project_id = p_project_id
  for update;
  if found and v_old.owner_id is distinct from auth.uid() then
    raise exception 'Allocation owner does not match billing period';
  end if;

  insert into public.billing_allocation_adjustments (
    owner_id, project_id, old_direct_pct, old_indirect_pct, old_target_margin_pct,
    new_direct_pct, new_indirect_pct, new_target_margin_pct, reason, created_by
  ) values (
    auth.uid(), p_project_id, v_old.direct_pct, v_old.indirect_pct, v_old.target_margin_pct,
    p_direct_pct, p_indirect_pct, p_target_margin_pct, btrim(p_reason), auth.uid()
  );

  insert into public.project_control_billing_allocations (
    project_id, owner_id, direct_pct, indirect_pct, target_margin_pct, updated_at
  ) values (
    p_project_id, auth.uid(), p_direct_pct, p_indirect_pct, p_target_margin_pct, now()
  )
  on conflict (project_id) do update set
    direct_pct = excluded.direct_pct,
    indirect_pct = excluded.indirect_pct,
    target_margin_pct = excluded.target_margin_pct,
    updated_at = excluded.updated_at
  returning * into v_new;

  return v_new;
end;
$$;
