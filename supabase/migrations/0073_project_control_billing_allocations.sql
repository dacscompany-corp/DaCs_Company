-- Project Control planning percentages. These never enter Spent/Earned/Profit
-- or the client-readable budget tables. Existing periods remain unconfigured.
begin;

create table if not exists public.project_control_allocation_policies (
  folder_id uuid primary key references public.folders(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  direct_pct numeric(5,2) not null default 70,
  indirect_pct numeric(5,2) not null default 20,
  target_margin_pct numeric(5,2) not null default 10,
  updated_at timestamptz not null default now(),
  constraint project_control_policy_total_chk check (
    direct_pct >= 0 and indirect_pct >= 0 and target_margin_pct >= 0
    and abs(direct_pct + indirect_pct + target_margin_pct - 100) < 0.005
  )
);

create table if not exists public.project_control_billing_allocations (
  project_id uuid primary key references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  direct_pct numeric(5,2) not null,
  indirect_pct numeric(5,2) not null,
  target_margin_pct numeric(5,2) not null,
  updated_at timestamptz not null default now(),
  constraint project_control_billing_allocation_total_chk check (
    direct_pct >= 0 and indirect_pct >= 0 and target_margin_pct >= 0
    and abs(direct_pct + indirect_pct + target_margin_pct - 100) < 0.005
  )
);

create table if not exists public.billing_allocation_adjustments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  old_direct_pct numeric(5,2),
  old_indirect_pct numeric(5,2),
  old_target_margin_pct numeric(5,2),
  new_direct_pct numeric(5,2) not null,
  new_indirect_pct numeric(5,2) not null,
  new_target_margin_pct numeric(5,2) not null,
  reason text not null check (btrim(reason) <> ''),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint billing_allocation_adjustment_old_total_chk check (
    (old_direct_pct is null and old_indirect_pct is null and old_target_margin_pct is null)
    or (old_direct_pct is not null and old_indirect_pct is not null and old_target_margin_pct is not null
      and old_direct_pct >= 0 and old_indirect_pct >= 0 and old_target_margin_pct >= 0
      and abs(old_direct_pct + old_indirect_pct + old_target_margin_pct - 100) < 0.005)
  ),
  constraint billing_allocation_adjustment_new_total_chk check (
    new_direct_pct >= 0 and new_indirect_pct >= 0 and new_target_margin_pct >= 0
    and abs(new_direct_pct + new_indirect_pct + new_target_margin_pct - 100) < 0.005
  )
);

create index if not exists project_control_allocation_policies_owner_idx
  on public.project_control_allocation_policies(owner_id);
create index if not exists project_control_billing_allocations_owner_idx
  on public.project_control_billing_allocations(owner_id);
create index if not exists billing_allocation_adjustments_owner_idx
  on public.billing_allocation_adjustments(owner_id);
create index if not exists billing_allocation_adjustments_project_created_idx
  on public.billing_allocation_adjustments(project_id, created_at desc);
create index if not exists billing_allocation_adjustments_created_by_idx
  on public.billing_allocation_adjustments(created_by);

alter table public.overhead_expenses
  add column if not exists billing_period_id uuid references public.projects(id) on delete set null;
create index if not exists overhead_expenses_billing_period_idx
  on public.overhead_expenses(billing_period_id);

alter table public.project_control_allocation_policies enable row level security;
alter table public.project_control_billing_allocations enable row level security;
alter table public.billing_allocation_adjustments enable row level security;

-- Defaults may change freely, but must refer to a folder this owner owns.
-- Role checks also exclude staff accounts that happen to own an old data row.
drop policy if exists project_control_allocation_policies_owner on public.project_control_allocation_policies;
create policy project_control_allocation_policies_owner
  on public.project_control_allocation_policies for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.kind = 'admin' and u.role = 'owner')
  )
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.kind = 'admin' and u.role = 'owner')
    and exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = (select auth.uid()))
  );

drop policy if exists project_control_billing_allocations_owner_read on public.project_control_billing_allocations;
create policy project_control_billing_allocations_owner_read
  on public.project_control_billing_allocations for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.kind = 'admin' and u.role = 'owner')
  );

-- Initial snapshots use INSERT, not the shim's .set() (an upsert). Once
-- created, they can only change through the audited RPC below. Retain a
-- dormant snapshot when switching a period to president/cover funding.
drop policy if exists project_control_billing_allocations_owner_insert on public.project_control_billing_allocations;
create policy project_control_billing_allocations_owner_insert
  on public.project_control_billing_allocations for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.kind = 'admin' and u.role = 'owner')
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );

-- Only the RPC may write audit rows. No client INSERT/UPDATE/DELETE policy.
drop policy if exists billing_allocation_adjustments_owner_read on public.billing_allocation_adjustments;
create policy billing_allocation_adjustments_owner_read
  on public.billing_allocation_adjustments for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.profiles u where u.id = (select auth.uid()) and u.kind = 'admin' and u.role = 'owner')
  );

-- Explicit Data API grants work both with and without automatic exposure.
-- Remove inherited defaults before granting only the browser operations used.
revoke all on table public.project_control_allocation_policies from public, anon, authenticated;
revoke all on table public.project_control_billing_allocations from public, anon, authenticated;
revoke all on table public.billing_allocation_adjustments from public, anon, authenticated;
grant select, insert, update, delete on table public.project_control_allocation_policies to authenticated;
grant select, insert on table public.project_control_billing_allocations to authenticated;
grant select on table public.billing_allocation_adjustments to authenticated;

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
    where u.id = auth.uid() and u.kind = 'admin' and u.role = 'owner'
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

revoke all on function public.update_project_control_billing_allocation(uuid, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.update_project_control_billing_allocation(uuid, numeric, numeric, numeric, text) to authenticated;

-- The shim's onSnapshot() requires publication membership for live updates.
do $$
declare
  t text;
begin
  foreach t in array array[
    'project_control_allocation_policies',
    'project_control_billing_allocations',
    'billing_allocation_adjustments'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

commit;
