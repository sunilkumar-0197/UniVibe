-- ==============================================================================
-- UniVibe: Threaded Replies Migration for Comments & Event Comments
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wmzavctapwxvjchabdtd/sql
-- ==============================================================================

-- 1. Add self-referencing parent_id column to public.comments (Campus & Club posts)
alter table if exists public.comments
  add column if not exists parent_id uuid null references public.comments(id) on delete cascade;

-- Create index for fast nested replies retrieval
create index if not exists idx_comments_parent_id on public.comments(parent_id);

-- 2. Add self-referencing parent_id column to public.event_comments (Event discussions)
alter table if exists public.event_comments
  add column if not exists parent_id uuid null references public.event_comments(id) on delete cascade;

-- Create index for fast nested event replies retrieval
create index if not exists idx_event_comments_parent_id on public.event_comments(parent_id);

-- 3. Ensure permissions and grants
grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;

grant select on public.event_comments to anon, authenticated;
grant insert, delete on public.event_comments to authenticated;

-- 4. Notify PostgREST to reload schema cache
notify pgrst, 'reload schema';
