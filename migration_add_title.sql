-- ==============================================================================
-- UniVibe Migration: Add Title and Tags to public.posts
-- ==============================================================================
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql

-- 1. Add title column to public.posts
alter table public.posts 
  add column if not exists title text;

-- 2. Add tags column to public.posts
alter table public.posts 
  add column if not exists tags text[] default '{}';

-- 3. Notify schema cache to reload
notify pgrst, 'reload schema';
