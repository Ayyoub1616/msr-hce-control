create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "app_state_read" on public.app_state;
drop policy if exists "app_state_write" on public.app_state;

create policy "app_state_read"
on public.app_state for select
to anon, authenticated
using (true);

create policy "app_state_write"
on public.app_state for all
to anon, authenticated
using (true)
with check (true);
