-- ==============================================================================
-- UniVibe Phase 4B: Club Posts Database Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Add club_id column to public.posts referencing public.clubs(id)
alter table public.posts
  add column if not exists club_id uuid references public.clubs(id) on delete cascade;

-- 2. Create index on club_id for efficient feed queries
create index if not exists idx_posts_club_id on public.posts(club_id);

-- 3. Update Row Level Security (RLS) policies on public.posts
alter table public.posts enable row level security;

-- Drop previous insert policies to update them with club membership verification
drop policy if exists "Authenticated users can create their own posts" on public.posts;
drop policy if exists "Authenticated users can create posts" on public.posts;

-- Insert Policy:
-- Authenticated users can insert their own posts (user_id = auth.uid()).
-- If club_id is NULL -> campus-wide post (allowed for any authenticated user).
-- If club_id is NOT NULL -> post belongs to that club, allowed ONLY if user is a member in public.club_members.
create policy "Authenticated users can create posts"
  on public.posts for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      club_id is null
      or exists (
        select 1 from public.club_members
        where public.club_members.club_id = posts.club_id
        and public.club_members.user_id = auth.uid()
      )
    )
  );

-- Select Policy:
-- Anyone (including guests) can read posts (both campus-wide and club posts)
drop policy if exists "Anyone can read posts" on public.posts;
create policy "Anyone can read posts"
  on public.posts for select
  using (true);

-- Delete Policy:
-- Users can delete their own posts
drop policy if exists "Users can delete their own posts" on public.posts;
create policy "Users can delete their own posts"
  on public.posts for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Ensure correct grants
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;
