-- ==============================================================================
-- UniVibe: Auto-Confirm Users & Profiles Sync Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Auto-Confirm Trigger for New Users
-- This ensures that any account created via UniVibe's Sign Up flow is immediately
-- confirmed (just like accounts created manually in Supabase Dashboard), allowing
-- users to log in immediately with email & password.
create or replace function public.auto_confirm_new_user()
returns trigger as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  if new.confirmed_at is null then
    new.confirmed_at := now();
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_auto_confirm on auth.users;
create trigger on_auth_user_auto_confirm
  before insert on auth.users
  for each row
  execute function public.auto_confirm_new_user();

-- 2. Confirm any existing unconfirmed users in auth.users
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now()),
    confirmed_at = coalesce(confirmed_at, now())
where email_confirmed_at is null;

-- 3. Ensure public.profiles table exists
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text,
  handle text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS on profiles
alter table public.profiles enable row level security;

-- Profiles RLS Policies
drop policy if exists "Anyone can read profiles" on public.profiles;
create policy "Anyone can read profiles"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

-- 4. Trigger: automatically populate public.profiles from raw_user_meta_data
create or replace function public.handle_new_user_profile()
returns trigger as $$
begin
  insert into public.profiles (id, name, handle, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Student'),
    coalesce(new.raw_user_meta_data->>'handle', '@' || lower(split_part(new.email, '@', 1)), '@student'),
    new.email
  )
  on conflict (id) do update set
    name = coalesce(excluded.name, profiles.name),
    handle = coalesce(excluded.handle, profiles.handle),
    email = coalesce(excluded.email, profiles.email),
    updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Backfill profiles for all existing auth.users
insert into public.profiles (id, name, handle, email)
select 
  id,
  coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1), 'Student'),
  coalesce(raw_user_meta_data->>'handle', '@' || lower(split_part(email, '@', 1)), '@student'),
  email
from auth.users
on conflict (id) do update set
  name = coalesce(excluded.name, profiles.name),
  handle = coalesce(excluded.handle, profiles.handle),
  email = coalesce(excluded.email, profiles.email),
  updated_at = now();
