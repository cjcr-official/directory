-- ===========================================================================
-- Church Directory - initial schema
--
-- Run this in the Supabase SQL editor (or `supabase db push`) on a new project.
-- It is written to be re-runnable: every object is created with IF NOT EXISTS
-- or dropped first, so applying it twice is harmless.
--
-- Model
--   profiles    - one row per administrator, mirrors auth.users, carries role
--   households  - a family; the unit that prints as one card in the book
--   people      - a person; may belong to a household or stand alone
--   tags        - reusable labels ("Choir", "Youth 2026") used to pick who
--                 goes into a smaller event directory
--   projects    - a saved recipe for one printable book
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Administrators
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       text not null default 'viewer'
               check (role in ('owner', 'editor', 'viewer')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Administrators of the directory. The first account to sign up becomes the owner; every later account starts with no access at all.';

-- The first person to sign up owns the directory, which solves the
-- chicken-and-egg problem of granting the very first role without a service key.
--
-- Everyone after them is created INACTIVE. Sign-up is open to anyone who can
-- reach the app, so an active row here would hand a stranger the whole
-- congregation's addresses and phone numbers - every read policy below is
-- satisfied by is_member(), and a viewer is a member. An inactive row passes
-- nothing, so a new account sees the "waiting for access" screen until an owner
-- turns it on.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  -- Serialise concurrent sign-ups so two people cannot both read an empty
  -- table and both become owner.
  lock table public.profiles in exclusive mode;

  select count(*) = 0 into is_first from public.profiles;

  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when is_first then 'owner' else 'viewer' end,
    is_first
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role lookups used by every policy below. SECURITY DEFINER so that reading a
-- caller's own role does not itself go through the profiles policies (which
-- would recurse).
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('owner', 'editor')
  )
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role = 'owner'
  )
$$;

-- ---------------------------------------------------------------------------
-- Households (families)
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,                -- "The Alvarez Family"
  sort_name     text not null,                -- "Alvarez" - drives alphabetical order
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  postal_code   text,
  country       text,
  phone         text,
  email         text,
  anniversary   date,
  photo_path    text,                         -- object key in the photos bucket
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists households_sort_name_idx
  on public.households (lower(sort_name));

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table if not exists public.people (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid references public.households (id) on delete set null,
  household_role        text check (household_role in ('head', 'spouse', 'child', 'other')),
  first_name            text not null,
  last_name             text not null,
  preferred_name        text,                 -- "Bill" for a William
  email                 text,
  phone                 text,
  date_of_birth         date,
  anniversary           date,
  use_household_address boolean not null default true,
  address_line1         text,
  address_line2         text,
  city                  text,
  state                 text,
  postal_code           text,
  country               text,
  photo_path            text,
  notes                 text,
  sort_order            integer not null default 0,  -- order within the household
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists people_household_idx
  on public.people (household_id, sort_order);
create index if not exists people_name_idx
  on public.people (lower(last_name), lower(first_name));

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  color       text not null default '#4f6d7a',
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.household_tags (
  household_id uuid not null references public.households (id) on delete cascade,
  tag_id       uuid not null references public.tags (id) on delete cascade,
  primary key (household_id, tag_id)
);

create table if not exists public.person_tags (
  person_id uuid not null references public.people (id) on delete cascade,
  tag_id    uuid not null references public.tags (id) on delete cascade,
  primary key (person_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Projects - one saved, printable book
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  kind           text not null default 'directory'
                   check (kind in ('directory', 'event')),
  description    text,
  selection_mode text not null default 'all'
                   check (selection_mode in ('all', 'tags', 'manual')),
  settings       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.project_tags (
  project_id uuid not null references public.projects (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  primary key (project_id, tag_id)
);

-- Explicit picks for selection_mode = 'manual', and custom ordering for any mode.
create table if not exists public.project_entries (
  project_id uuid not null references public.projects (id) on delete cascade,
  entry_type text not null check (entry_type in ('household', 'person')),
  ref_id     uuid not null,
  position   integer not null default 0,
  primary key (project_id, entry_type, ref_id)
);

create index if not exists project_entries_position_idx
  on public.project_entries (project_id, position);

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists households_touch on public.households;
create trigger households_touch before update on public.households
  for each row execute function public.touch_updated_at();

drop trigger if exists people_touch on public.people;
create trigger people_touch before update on public.people
  for each row execute function public.touch_updated_at();

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The web app ships with the anon key, which is public by design, so RLS is the
-- only thing standing between a stranger and the congregation's phone numbers.
-- Every table therefore requires an active profile; nothing is readable
-- anonymously.
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.households      enable row level security;
alter table public.people          enable row level security;
alter table public.tags            enable row level security;
alter table public.household_tags  enable row level security;
alter table public.person_tags     enable row level security;
alter table public.projects        enable row level security;
alter table public.project_tags    enable row level security;
alter table public.project_entries enable row level security;

-- profiles: everyone signed in can see the roster; you may edit your own name;
-- only an owner may change roles or deactivate an account.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (public.is_member() or id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_app_role());

drop policy if exists profiles_owner_manage on public.profiles;
create policy profiles_owner_manage on public.profiles
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Directory data: any active administrator can read; editors and owners write.
do $$
declare
  t text;
begin
  foreach t in array array[
    'households', 'people', 'tags', 'household_tags',
    'person_tags', 'projects', 'project_tags', 'project_entries'
  ]
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format(
      'create policy %I_read on public.%I for select to authenticated using (public.is_member())',
      t, t);

    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated '
      'using (public.is_editor()) with check (public.is_editor())',
      t, t);
  end loop;
end
$$;
