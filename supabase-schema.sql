-- algorithmssuck.com database schema
-- Run this in your Supabase SQL Editor

-- Users table (synced from Clerk)
create table if not exists public.users (
  id text primary key,              -- Clerk user ID
  email text,
  created_at timestamptz default now(),
  playlist_count integer default 0,
  free_credits integer default 3,   -- starts with 3 free playlists
  is_subscribed boolean default false,
  credits integer default 0,        -- purchased credit packs
  stripe_customer_id text
);

-- Playlists table
create table if not exists public.playlists (
  id uuid default gen_random_uuid() primary key,
  share_id text unique not null,    -- short ID for public URL
  created_at timestamptz default now(),
  user_id text references public.users(id) on delete set null,
  prompt text not null,
  title text not null,
  songs jsonb not null default '[]',
  spotify_url text,
  play_count integer default 0,     -- how many times the share page was viewed
  is_public boolean default true
);

-- Enable Row Level Security
alter table public.users enable row level security;
alter table public.playlists enable row level security;

-- Users: only the user can read/update their own record
create policy "Users can read own record"
  on public.users for select
  using (auth.uid()::text = id);

create policy "Users can update own record"
  on public.users for update
  using (auth.uid()::text = id);

-- Playlists: public ones are readable by anyone, inserts allowed for authenticated users
create policy "Public playlists are viewable by anyone"
  on public.playlists for select
  using (is_public = true);

create policy "Authenticated users can insert playlists"
  on public.playlists for insert
  with check (true);

create policy "Users can update own playlists"
  on public.playlists for update
  using (auth.uid()::text = user_id);

-- Service role bypass (for server-side API routes)
-- Your API routes use the service role key which bypasses RLS automatically

-- Index for fast share_id lookups
create index if not exists playlists_share_id_idx on public.playlists(share_id);
create index if not exists playlists_user_id_idx on public.playlists(user_id);
create index if not exists playlists_created_at_idx on public.playlists(created_at desc);
