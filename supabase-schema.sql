-- Pomofree — optional cross-device account sync schema.
--
-- This is only needed if you want to enable Supabase-backed sync (see
-- .env.example). Paste this whole file into your Supabase project's
-- SQL editor (Project > SQL Editor > New query) and run it once. Pomofree
-- works fully offline via localStorage without this — nothing here is
-- required to use the app.
--
-- Creates a single table, `user_data`, holding one row per signed-in user
-- with their settings/tasks/projects/sessions as JSON, plus row-level
-- security policies so each user can only ever read or write their own row.

create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb,
  tasks jsonb,
  projects jsonb,
  sessions jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "Users can select their own user_data row"
  on public.user_data
  for select
  using (auth.uid() = user_id);

create policy "Users can insert their own user_data row"
  on public.user_data
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own user_data row"
  on public.user_data
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own user_data row"
  on public.user_data
  for delete
  using (auth.uid() = user_id);
