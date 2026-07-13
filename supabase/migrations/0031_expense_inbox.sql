-- 0031_expense_inbox.sql
--
-- EXPENSE INBOX. Admin currently sends payment/receipt pictures to staff over
-- Messenger; staff re-types them into the system and photos get lost in chat.
-- This table is the replacement channel: one row per shared image, tagged by
-- the admin at share time (project, type, category / laborer name), consumed
-- by staff who encodes the real expense through the normal forms and then
-- marks the row 'encoded'. The pending set = "what staff has not input yet".
--
-- NO amounts are stored here — the receipt image carries the amount and the
-- row never participates in money math. Images live in the private `uploads`
-- bucket (0027) under expenseInbox/; the stored URL is signed at view time by
-- the shim (supabase-config.js §11b).
--
-- Serves BOTH project systems, which have different id spaces:
--   system='pc' → folder_id     references folders               (Project Control)
--   system='pm' → pm_project_id references construction_projects (Project Management)
--
-- Admin-only (owner/staff), like revolving_fund_requests. Idempotent.

create table if not exists expense_inbox (
  id            uuid primary key default gen_random_uuid(),
  system        text not null check (system in ('pc','pm')),
  folder_id     uuid references folders(id) on delete cascade,
  pm_project_id uuid references construction_projects(id) on delete cascade,
  image_url     text not null,        -- stored public-format URL in `uploads` (signed on use)
  image_name    text,                 -- original filename, display only
  entry_type    text,                 -- pc: materials|labor|overhead · pm: labor|materials|both
  category      text,                 -- when entry_type = materials
  labor_name    text,                 -- when entry_type = labor
  note          text,
  status        text not null default 'pending' check (status in ('pending','encoded')),
  created_by    text,                 -- email of the admin who shared it
  encoded_by    text,                 -- email of whoever marked it encoded
  encoded_at    timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint expense_inbox_target check (
    (system = 'pc' and folder_id is not null) or
    (system = 'pm' and pm_project_id is not null)
  )
);

create index if not exists expense_inbox_folder_idx on expense_inbox(folder_id) where folder_id is not null;
create index if not exists expense_inbox_pm_idx     on expense_inbox(pm_project_id) where pm_project_id is not null;
create index if not exists expense_inbox_status_idx on expense_inbox(status);

alter table expense_inbox enable row level security;

-- Owner + staff full access; never exposed to clients/partners.
drop policy if exists expense_inbox_admin on expense_inbox;
create policy expense_inbox_admin on expense_inbox for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
