-- ════════════════════════════════════════════════════════════════════
-- 0099 — Map the existing PM projects to the main owner's company.
-- Owner verification: 2026-10-19, "all six listed projects belong to your
-- company, and both completed “Los Churreros” records are real, separate
-- jobs." (Dapitan, Manila — WR-2026-0001; San Rafael — WR-2026-0002.)
-- Explicit ids only — never "all projects". Fails loudly if an id is
-- missing, there is not exactly one active main owner, or an id is
-- already mapped to another company. Rows record source owner_verified.
-- Re-running is harmless (on conflict do nothing).
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_ids   uuid[] := array[
    '6236abf5-4f32-4bee-a0d0-8aa738a6a5b0',  -- Los Churreros, Dapitan, Manila (completed 2026-08-02, WR-2026-0001)
    '4b22ede3-180f-415b-b793-9998d34e0aec',  -- Los Churreros, San Rafael (completed 2026-08-02, WR-2026-0002)
    '732f858e-603d-477e-b88f-3049ca421bea',  -- Los Churreros System Plus, Pampanga
    '49426a37-cca0-4eba-ba5f-e6bb48729872',  -- Los Churreros Crossroad, Crossroad Sangandaan
    'f18d349b-133e-4908-9bdc-30c2741fbfca',  -- Los Churreros Baliuag
    'a62714db-fa03-47c9-81ef-6067f4adf6e5'   -- Los Churreros SM North Dining Extention
  ]::uuid[];
  v_owner uuid;
  v_n     int;
begin
  select count(*) into v_n from profiles
   where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active';
  if v_n <> 1 then raise exception 'expected exactly one active main owner, found %', v_n; end if;
  select id into v_owner from profiles
   where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active';

  select count(*) into v_n from construction_projects where id = any(v_ids);
  if v_n <> array_length(v_ids, 1) then
    raise exception 'a verified project id is missing (% of %)', v_n, array_length(v_ids, 1);
  end if;

  if exists (select 1 from pm_project_companies where project_id = any(v_ids) and company_owner_id <> v_owner) then
    raise exception 'a verified project is already mapped to another company';
  end if;

  insert into pm_project_companies (project_id, company_owner_id, mapped_by, source)
  select unnest(v_ids), v_owner, v_owner, 'owner_verified'
  on conflict (project_id) do nothing;
end $$;
