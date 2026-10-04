-- ==============================================================================
-- UniVibe: Campus-Wide General Chat System Database Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Create public.chat_messages table
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room text not null default 'general',
  content text not null check (char_length(trim(content)) > 0 and char_length(content) <= 1000),
  created_at timestamptz not null default now()
);

-- 2. Foreign Key relationship to public.profiles for single-query relational joins
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_chat_messages_profile'
  ) then
    alter table public.chat_messages
      add constraint fk_chat_messages_profile
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- 3. Indexes for fast room filtering and chronological message ordering
create index if not exists idx_chat_messages_room_created 
  on public.chat_messages(room, created_at asc);

create index if not exists idx_chat_messages_user_id 
  on public.chat_messages(user_id);

-- 4. Enable Row Level Security (RLS)
alter table public.chat_messages enable row level security;

-- Select Policy: Anyone (anon guests + authenticated users) can view messages
drop policy if exists "Anyone can read chat messages" on public.chat_messages;
create policy "Anyone can read chat messages"
  on public.chat_messages for select
  using (true);

-- Insert Policy: Authenticated users can insert their own messages
drop policy if exists "Authenticated users can create chat messages" on public.chat_messages;
create policy "Authenticated users can create chat messages"
  on public.chat_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Delete Policy: Authenticated users can delete only their own messages
drop policy if exists "Users can delete their own chat messages" on public.chat_messages;
create policy "Users can delete their own chat messages"
  on public.chat_messages for delete
  to authenticated
  using (auth.uid() = user_id);

-- 5. Access Grants
grant select on public.chat_messages to anon, authenticated;
grant insert, delete on public.chat_messages to authenticated;

-- 6. Enable Supabase Realtime for chat_messages
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
      and schemaname = 'public' 
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
