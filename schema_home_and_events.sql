-- ==============================================================================
-- UniVibe: Event Interests Database Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Create public.event_interests Table
create table if not exists public.event_interests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('interested', 'not_interested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_interests_user_event_unique unique (event_id, user_id)
);

-- 2. Indexes for fast lookup
create index if not exists idx_event_interests_user_id on public.event_interests(user_id);
create index if not exists idx_event_interests_event_id on public.event_interests(event_id);
create index if not exists idx_event_interests_event_status on public.event_interests(event_id, status);

-- 3. Enable Row Level Security (RLS)
alter table public.event_interests enable row level security;

-- 4. RLS Policies
-- Select Policy: Anyone (anon + authenticated) can view event interest
drop policy if exists "Anyone can read event interests" on public.event_interests;
create policy "Anyone can read event interests"
  on public.event_interests for select
  using (true);

-- Insert Policy: Authenticated users can only record their own interest
drop policy if exists "Authenticated users can insert own event interest" on public.event_interests;
create policy "Authenticated users can insert own event interest"
  on public.event_interests for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Update Policy: Authenticated users can only update their own interest
drop policy if exists "Authenticated users can update own event interest" on public.event_interests;
create policy "Authenticated users can update own event interest"
  on public.event_interests for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Delete Policy: Authenticated users can only delete their own interest (returns to neutral)
drop policy if exists "Authenticated users can delete own event interest" on public.event_interests;
create policy "Authenticated users can delete own event interest"
  on public.event_interests for delete
  to authenticated
  using (auth.uid() = user_id);

-- 5. Permissions / Grants
grant select on public.event_interests to anon, authenticated;
grant insert, update, delete on public.event_interests to authenticated;
