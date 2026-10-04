-- ==============================================================================
-- UniVibe: Profiles Table & RLS Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Create public.profiles Table
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text,
  handle text,
  bio text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Ensure bio column exists if table already existed
alter table public.profiles add column if not exists bio text;

-- 2. Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- 3. RLS Policies
-- Anyone (anon + authenticated) can view student profiles to display real authors
drop policy if exists "Anyone can read profiles" on public.profiles;
create policy "Anyone can read profiles"
  on public.profiles for select
  using (true);

-- Authenticated users can insert their own profile
drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Authenticated users can update their own profile
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 4. Permissions / Grants
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

-- 5. Backfill existing auth users into profiles (read-only from auth.users; does NOT touch auth.users)
insert into public.profiles (id, name, handle, email)
select 
  id,
  coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1)),
  coalesce(raw_user_meta_data->>'handle', '@' || lower(split_part(email, '@', 1))),
  email
from auth.users
on conflict (id) do update set
  name = coalesce(profiles.name, excluded.name),
  handle = coalesce(profiles.handle, excluded.handle),
  email = coalesce(profiles.email, excluded.email),
  updated_at = now();
