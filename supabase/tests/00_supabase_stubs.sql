-- ===========================================================================
-- Stand-ins for the parts of Supabase the migrations depend on, so the real
-- policy files can be run and exercised against a plain PostgreSQL instance.
--
-- This file is for testing only. Never run it against a Supabase project - it
-- would shadow the real auth and storage schemas.
-- ===========================================================================

create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists storage;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;

do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;

grant usage on schema public, auth, storage to anon, authenticated;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Matches Supabase's own definition: the signed-in user comes from the request
-- JWT, which the tests set with `set local request.jwt.claims`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

-- The claims of the request's own token, the way Supabase defines it. The
-- policies added by 0006 read `aal` out of this: aal1 for a session that has
-- only been through a password, aal2 for one that has also answered a factor.
-- It lives inside a signed token in the real thing, which is what makes it
-- worth believing; here the tests set it directly.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- Supabase's own table of enrolled second factors. Only the columns 0006
-- reads: whose it is, and whether the enrolment was ever finished. `status` is
-- an enum in the real schema and text here, which the comparison against
-- 'verified' does not care about either way.
create table if not exists auth.mfa_factors (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type   text not null default 'totp',
  status        text not null default 'unverified',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text not null,
  owner     uuid
);

alter table storage.objects enable row level security;

grant select, insert, update, delete on storage.objects to authenticated, anon;
grant select on storage.buckets to authenticated, anon;
