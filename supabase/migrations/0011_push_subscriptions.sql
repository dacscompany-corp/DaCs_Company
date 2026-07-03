-- 0011_push_subscriptions.sql
-- Web Push subscriptions for the admin's nightly Project Management summary.
-- One row per device (endpoint) + project the admin opted into. Admin-only.

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  legacy_id   text unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  project_id  text,                 -- constructionProjects.id the device subscribed to
  endpoint    text not null,        -- push service endpoint (unique per device/browser)
  p256dh      text,                 -- subscription public key
  auth        text,                 -- subscription auth secret
  created_at  timestamptz default now()
);
create index if not exists push_subs_owner_idx   on push_subscriptions(owner_id);
create index if not exists push_subs_project_idx on push_subscriptions(project_id);

alter table push_subscriptions enable row level security;

create policy push_subs_admin on push_subscriptions for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
