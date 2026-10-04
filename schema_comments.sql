-- ==============================================================================
-- UniVibe: Comments & Discussion System Database Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Create public.comments table
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- 2. Indexes for efficient lookup and chronological sorting
create index if not exists idx_comments_post_id on public.comments(post_id);
create index if not exists idx_comments_created_at on public.comments(created_at);

-- 3. Row Level Security (RLS)
alter table public.comments enable row level security;

-- Select Policy: Anyone (anon + authenticated guests/users) can read comments
drop policy if exists "Anyone can read comments" on public.comments;
create policy "Anyone can read comments"
  on public.comments for select
  using (true);

-- Insert Policy: Authenticated users can insert comments where user_id = auth.uid()
drop policy if exists "Authenticated users can create comments" on public.comments;
create policy "Authenticated users can create comments"
  on public.comments for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Delete Policy: Authenticated users can delete only their own comments
drop policy if exists "Users can delete their own comments" on public.comments;
create policy "Users can delete their own comments"
  on public.comments for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Access Grants
grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;
