-- ==============================================================================
-- UniVibe Phase 5 Database Schema: Media & Profile Picture Migration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Add avatar_url to public.profiles
alter table public.profiles add column if not exists avatar_url text;

-- 2. Add images text[] array to public.posts and public.events for fast query performance
alter table public.posts add column if not exists images text[] default '{}';
alter table public.events add column if not exists images text[] default '{}';

-- 3. Create normalized public.post_images table for relational media tracking
create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Enable RLS on public.post_images
alter table public.post_images enable row level security;

-- Policies on post_images
drop policy if exists "Anyone can read post images" on public.post_images;
create policy "Anyone can read post images"
  on public.post_images for select
  using (true);

drop policy if exists "Authenticated users can insert post images" on public.post_images;
create policy "Authenticated users can insert post images"
  on public.post_images for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own post images" on public.post_images;
create policy "Users can delete their own post images"
  on public.post_images for delete
  to authenticated
  using (auth.uid() = user_id);

grant select on public.post_images to anon, authenticated;
grant insert, update, delete on public.post_images to authenticated;

-- ==============================================================================
-- 4. Supabase Storage Buckets & Storage RLS
-- ==============================================================================

-- Create 'avatars' and 'univibe-media' public buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values 
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('univibe-media', 'univibe-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ensure RLS on storage.objects
alter table storage.objects enable row level security;

-- ------------------------------------------------------------------------------
-- Storage Policies for 'avatars' Bucket
-- ------------------------------------------------------------------------------
drop policy if exists "Public Avatar Read Access" on storage.objects;
create policy "Public Avatar Read Access"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Authenticated User Avatar Upload" on storage.objects;
create policy "Authenticated User Avatar Upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "User Avatar Update" on storage.objects;
create policy "User Avatar Update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars' 
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "User Avatar Delete" on storage.objects;
create policy "User Avatar Delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------------------------
-- Storage Policies for 'univibe-media' Bucket (Posts & Events)
-- ------------------------------------------------------------------------------
drop policy if exists "Public Media Read Access" on storage.objects;
create policy "Public Media Read Access"
  on storage.objects for select
  using (bucket_id = 'univibe-media');

drop policy if exists "Authenticated User Media Upload" on storage.objects;
create policy "Authenticated User Media Upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'univibe-media' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "User Media Update" on storage.objects;
create policy "User Media Update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'univibe-media' 
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'univibe-media' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "User Media Delete" on storage.objects;
create policy "User Media Delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'univibe-media' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );
