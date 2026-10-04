-- ==============================================================================
-- UniVibe Phase 3 Database Schema: Events Table & Row Level Security (RLS)
-- ==============================================================================
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql

-- 1. Create public.events table
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  event_date date not null,
  event_time time not null,
  location text not null,
  created_at timestamptz not null default now()
);

-- Foreign key relationship to profiles for author lookups
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_user_id_profiles_fk'
  ) then
    alter table public.events
      add constraint events_user_id_profiles_fk
      foreign key (user_id) references public.profiles(id)
      on delete cascade;
  end if;
exception
  when others then null;
end $$;

-- 2. Enable Row Level Security (RLS) on public.events
alter table public.events enable row level security;

-- Drop existing policies if any to avoid duplicates
drop policy if exists "Anyone can read events" on public.events;
drop policy if exists "Authenticated users can create events" on public.events;
drop policy if exists "Users can delete their own events" on public.events;

-- Policy 1: Anyone, including guests, can read events
create policy "Anyone can read events"
  on public.events for select
  using (true);

-- Policy 2: Authenticated users can create events (enforcing user_id = auth.uid())
create policy "Authenticated users can create events"
  on public.events for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Policy 3: Users can only delete their own events
create policy "Users can delete their own events"
  on public.events for delete
  to authenticated
  using (auth.uid() = user_id);

-- 3. Configure Data API permissions/grants
grant select on public.events to anon, authenticated;
grant insert, delete on public.events to authenticated;

-- 4. Reload PostgREST schema cache
notify pgrst, 'reload schema';
