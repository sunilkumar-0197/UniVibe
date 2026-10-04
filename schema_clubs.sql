-- ==============================================================================
-- UniVibe Phase 4: Clubs & Club Members Migration
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Create public.clubs table
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Optional FK to profiles if profiles table exists
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clubs_created_by_profiles_fk'
  ) then
    alter table public.clubs
      add constraint clubs_created_by_profiles_fk
      foreign key (created_by) references public.profiles(id)
      on delete cascade;
  end if;
exception
  when others then null;
end $$;

-- 2. Create public.club_members table
create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- Optional FK to profiles if profiles table exists
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'club_members_user_id_profiles_fk'
  ) then
    alter table public.club_members
      add constraint club_members_user_id_profiles_fk
      foreign key (user_id) references public.profiles(id)
      on delete cascade;
  end if;
exception
  when others then null;
end $$;

-- 3. Enable Row Level Security (RLS)
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;

-- Drop existing policies if any
drop policy if exists "Anyone can read clubs" on public.clubs;
drop policy if exists "Authenticated users can create clubs" on public.clubs;
drop policy if exists "Creators can delete their own clubs" on public.clubs;

drop policy if exists "Anyone can read club members" on public.club_members;
drop policy if exists "Authenticated users can join clubs" on public.club_members;
drop policy if exists "Authenticated users can leave clubs" on public.club_members;

-- Policies for public.clubs
-- Anyone (including guests) can read clubs
create policy "Anyone can read clubs"
  on public.clubs for select
  using (true);

-- Authenticated users can create clubs (created_by must equal auth.uid())
create policy "Authenticated users can create clubs"
  on public.clubs for insert
  to authenticated
  with check (auth.uid() = created_by);

-- Creators can delete their own clubs
create policy "Creators can delete their own clubs"
  on public.clubs for delete
  to authenticated
  using (auth.uid() = created_by);

-- Policies for public.club_members
-- Anyone (including guests) can read club memberships to see counts and status
create policy "Anyone can read club members"
  on public.club_members for select
  using (true);

-- Authenticated users can join clubs (insert themselves)
create policy "Authenticated users can join clubs"
  on public.club_members for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Authenticated users can leave clubs (remove themselves)
create policy "Authenticated users can leave clubs"
  on public.club_members for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Grant table access to anon and authenticated roles
grant select on public.clubs to anon, authenticated;
grant insert, update, delete on public.clubs to authenticated;

grant select on public.club_members to anon, authenticated;
grant insert, delete on public.club_members to authenticated;

-- ==============================================================================
-- 5. Add club_id to public.posts referencing public.clubs(id)
-- ==============================================================================
alter table public.posts
  add column if not exists club_id uuid references public.clubs(id) on delete cascade;

create index if not exists idx_posts_club_id on public.posts(club_id);

-- Update RLS on public.posts for club membership enforcement
drop policy if exists "Authenticated users can create their own posts" on public.posts;
drop policy if exists "Authenticated users can create posts" on public.posts;

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

grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;
