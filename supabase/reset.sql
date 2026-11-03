-- SafePick database reset: drops every SafePick table, trigger, and function, then creates them again empty.
-- ALL profiles, analysis history, and saved listings are deleted and cannot be recovered.
-- Run it by hand in the Supabase SQL Editor (development projects). It is deliberately kept out of
-- supabase/migrations so that `supabase db push` never runs it. The schema below matches
-- migrations/20261103000000_accounts.sql; change both together.

begin;

-- 1. Remove what exists (safe to run when nothing exists yet).
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.create_profile();
drop table if exists public.saved_listings cascade;
drop table if exists public.analyses cascade;
drop table if exists public.profiles cascade;

-- Sign-ins (Kakao/Google accounts) live in auth.users and are kept. To remove them as well, uncomment:
-- delete from auth.users;

-- 2. Create the schema again.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text check (char_length(nickname) <= 40),
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_url text not null check (char_length(product_url) <= 2048),
  page_title text check (char_length(page_title) <= 300),
  product_name text check (char_length(product_name) <= 300),
  seller_name text check (char_length(seller_name) <= 200),
  price text check (char_length(price) <= 60),
  level text not null check (level in ('high', 'moderate', 'low', 'undetermined')),
  label text not null check (char_length(label) <= 20),
  score integer check (score between 0 and 100),
  summary text check (char_length(summary) <= 1000),
  -- The analysis response without the collected page text, which may hold what the shopper pasted.
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index analyses_user_created on public.analyses (user_id, created_at desc);

create table public.saved_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_url text not null check (char_length(product_url) <= 2048),
  page_title text check (char_length(page_title) <= 300),
  product_name text check (char_length(product_name) <= 300),
  seller_name text check (char_length(seller_name) <= 200),
  price text check (char_length(price) <= 60),
  level text check (level in ('high', 'moderate', 'low', 'undetermined')),
  label text check (char_length(label) <= 20),
  score integer check (score between 0 and 100),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, product_url)
);
create index saved_listings_user_created on public.saved_listings (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.analyses enable row level security;
alter table public.saved_listings enable row level security;

create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "own analyses" on public.analyses for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own saved listings" on public.saved_listings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'nickname',
                                new.raw_user_meta_data ->> 'full_name', ''), 40));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.create_profile();

-- 3. Give users who signed in before the reset their profile back (the trigger only fires on new sign-ins).
insert into public.profiles (id, nickname)
select id, left(coalesce(raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'nickname',
                         raw_user_meta_data ->> 'full_name', ''), 40)
from auth.users
on conflict (id) do nothing;

commit;
