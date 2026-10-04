-- ==============================================================================
-- UniVibe: Ownership-Based Deletion & Cascade Integrity Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Ensure Cascade Foreign Key Constraints
-- When a club is deleted, all club posts and memberships cascade delete.
-- When a post is deleted, all comments cascade delete.
-- When an event is deleted, all event comments and interests cascade delete.

do $$
begin
  -- 1a. posts -> clubs cascade
  if exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'clubs'
  ) and exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'posts'
  ) then
    -- Recreate constraint with ON DELETE CASCADE if needed
    alter table public.posts drop constraint if exists posts_club_id_fkey;
    alter table public.posts
      add constraint posts_club_id_fkey
      foreign key (club_id) references public.clubs(id)
      on delete cascade;
  end if;

  -- 1b. club_members -> clubs cascade
  if exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'club_members'
  ) then
    alter table public.club_members drop constraint if exists club_members_club_id_fkey;
    alter table public.club_members
      add constraint club_members_club_id_fkey
      foreign key (club_id) references public.clubs(id)
      on delete cascade;
  end if;

  -- 1c. comments -> posts cascade
  if exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'comments'
  ) then
    alter table public.comments drop constraint if exists comments_post_id_fkey;
    alter table public.comments
      add constraint comments_post_id_fkey
      foreign key (post_id) references public.posts(id)
      on delete cascade;
  end if;

  -- 1d. event_interests -> events cascade
  if exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'event_interests'
  ) then
    alter table public.event_interests drop constraint if exists event_interests_event_id_fkey;
    alter table public.event_interests
      add constraint event_interests_event_id_fkey
      foreign key (event_id) references public.events(id)
      on delete cascade;
  end if;

  -- 1e. event_comments -> events cascade
  if exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'event_comments'
  ) then
    alter table public.event_comments drop constraint if exists event_comments_event_id_fkey;
    alter table public.event_comments
      add constraint event_comments_event_id_fkey
      foreign key (event_id) references public.events(id)
      on delete cascade;
  end if;
exception
  when others then
    raise notice 'Foreign key cascade adjustment notice: %', sqlerrm;
end $$;

-- 2. Verify & Enforce Row Level Security (RLS) on all tables
alter table if exists public.posts enable row level security;
alter table if exists public.clubs enable row level security;
alter table if exists public.events enable row level security;
alter table if exists public.comments enable row level security;
alter table if exists public.event_comments enable row level security;

-- 3. RLS DELETE Policies: Strict Creator/Owner Only (auth.uid() verification)

-- 3a. Posts: only creator (user_id = auth.uid()) can delete
drop policy if exists "Users can delete their own posts" on public.posts;
create policy "Users can delete their own posts"
  on public.posts for delete
  to authenticated
  using (auth.uid() = user_id);

-- 3b. Clubs: only club creator (created_by = auth.uid()) can delete
drop policy if exists "Creators can delete their own clubs" on public.clubs;
create policy "Creators can delete their own clubs"
  on public.clubs for delete
  to authenticated
  using (auth.uid() = created_by);

-- 3c. Events: only event creator (user_id = auth.uid()) can delete
drop policy if exists "Users can delete their own events" on public.events;
create policy "Users can delete their own events"
  on public.events for delete
  to authenticated
  using (auth.uid() = user_id);

-- 3d. Post Comments: only comment author (user_id = auth.uid()) can delete
drop policy if exists "Users can delete their own comments" on public.comments;
create policy "Users can delete their own comments"
  on public.comments for delete
  to authenticated
  using (auth.uid() = user_id);

-- 3e. Event Comments: only event comment author (user_id = auth.uid()) can delete
drop policy if exists "Users can delete their own event comments" on public.event_comments;
create policy "Users can delete their own event comments"
  on public.event_comments for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Explicit Grants
grant delete on public.posts to authenticated;
grant delete on public.clubs to authenticated;
grant delete on public.events to authenticated;
grant delete on public.comments to authenticated;
grant delete on public.event_comments to authenticated;

-- 5. Reload PostgREST schema cache
notify pgrst, 'reload schema';
