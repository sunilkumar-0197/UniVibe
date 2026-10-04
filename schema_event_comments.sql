-- ==============================================================================
-- UniVibe: Event Comments & Community Discussion Database Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Create public.event_comments table
create table if not exists public.event_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- 2. Indexes for efficient lookup and chronological sorting
create index if not exists idx_event_comments_event_id on public.event_comments(event_id);
create index if not exists idx_event_comments_created_at on public.event_comments(created_at);

-- 3. Row Level Security (RLS)
alter table public.event_comments enable row level security;

-- Select Policy: Anyone (anon + authenticated guests/users) can read event comments
drop policy if exists "Anyone can read event comments" on public.event_comments;
create policy "Anyone can read event comments"
  on public.event_comments for select
  using (true);

-- Insert Policy: Authenticated users can insert comments where user_id = auth.uid()
drop policy if exists "Authenticated users can create event comments" on public.event_comments;
create policy "Authenticated users can create event comments"
  on public.event_comments for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Delete Policy: Authenticated users can delete only their own comments
drop policy if exists "Users can delete their own event comments" on public.event_comments;
create policy "Users can delete their own event comments"
  on public.event_comments for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Access Grants
grant select on public.event_comments to anon, authenticated;
grant insert, delete on public.event_comments to authenticated;
