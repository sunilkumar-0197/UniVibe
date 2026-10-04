-- ==============================================================================
-- UniVibe Phase 2 Database Schema & Row Level Security (RLS)
-- ==============================================================================

-- 1. Ensure profiles table exists for author details (name, handle, email)
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

-- Profiles Policies
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

-- Backfill profiles for any users already created in auth.users
insert into public.profiles (id, name, handle, email)
select 
  id,
  coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1), 'Student'),
  coalesce(raw_user_meta_data->>'handle', '@' || lower(split_part(email, '@', 1)), '@student'),
  email
from auth.users
on conflict (id) do nothing;

-- 2. Create posts table
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  content text not null,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

-- Ensure title and tags columns exist if table was already created
alter table public.posts add column if not exists title text;
alter table public.posts add column if not exists tags text[] default '{}';

-- Foreign key relationship to profiles for embedded PostgREST queries
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_user_id_profiles_fk'
  ) then
    alter table public.posts
      add constraint posts_user_id_profiles_fk
      foreign key (user_id) references public.profiles(id)
      on delete cascade;
  end if;
exception
  when others then null;
end $$;

-- 3. Enable Row Level Security on posts
alter table public.posts enable row level security;

-- Drop existing policies if any
drop policy if exists "Anyone can read posts" on public.posts;
drop policy if exists "Authenticated users can create their own posts" on public.posts;
drop policy if exists "Users can delete their own posts" on public.posts;

-- Policy 1: Anyone can read posts, including guests
create policy "Anyone can read posts"
  on public.posts for select
  using (true);

-- Policy 2: Authenticated users can create their own posts (enforcing user_id = auth.uid())
create policy "Authenticated users can create their own posts"
  on public.posts for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Policy 3: Users can only delete their own posts
create policy "Users can delete their own posts"
  on public.posts for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Trigger to automatically populate profile when a user signs up
create or replace function public.handle_new_user()
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Create events table
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

-- Enable Row Level Security (RLS) on events
alter table public.events enable row level security;

-- Drop existing policies if any
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

-- Grants
grant select on public.events to anon, authenticated;
grant insert, delete on public.events to authenticated;

