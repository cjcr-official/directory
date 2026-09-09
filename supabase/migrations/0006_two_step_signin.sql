-- ---------------------------------------------------------------------------
-- Two-step sign-in, enforced by the database
-- ---------------------------------------------------------------------------
--
-- An administrator can now add an authenticator app to their account, and be
-- asked for a six-digit code as well as a password. Supabase does the
-- enrolling and the checking; what this file adds is the part that matters,
-- which is that the answer is believed by the database and not only by the
-- app.
--
-- Without this, the second step would be a screen. The anon key ships inside
-- the browser bundle, so anybody holding a stolen password can talk to the API
-- directly and never see a screen at all - and every read policy would hand
-- over the congregation's addresses to that session exactly as before. A
-- second factor nothing checks is a second factor for the honest.
--
-- So the check goes where the rest of the boundary already is. Every policy in
-- 0001 and 0002 is written in terms of three functions - is_member,
-- is_editor, is_owner - which is what makes this a small change rather than a
-- rewrite of eighteen policies: they each gain one more condition and every
-- table, the photo bucket included, follows.
--
-- The condition itself is deliberately narrow. It is not "everyone must use an
-- authenticator": that would lock out every account the day this is applied,
-- and a congregation's Sunday volunteer is not going to be issued one. It is
-- "if this account has an authenticator, this session must have been through
-- it" - so an account without one is completely unaffected, and an account
-- with one cannot be reached with the password alone.
--
-- Safe to run more than once. Nothing here is dropped or rewritten; the three
-- functions are replaced with the same functions plus a clause.

-- ---------------------------------------------------------------------------
-- Has this session done what this account asks of it?
-- ---------------------------------------------------------------------------
--
-- aal is the assurance level Supabase stamps into the access token: aal1 for a
-- password, aal2 once a factor has been verified in this session. It cannot be
-- set by the browser - it is inside a signed token - which is what makes it
-- worth reading here.
--
-- auth.mfa_factors is Supabase's own table of enrolled factors, and only
-- 'verified' ones count. An enrolment that was started and abandoned leaves an
-- unverified row behind, and treating that as protection would lock somebody
-- out of their own directory over a QR code they closed the tab on.
--
-- security definer, like the three below it, so that answering the question
-- does not depend on the caller's rights over the auth schema.
--
-- If this file fails to apply with "relation auth.mfa_factors does not exist",
-- the project is running a Supabase release older than multi-factor
-- authentication. Nothing is half-applied - the whole file is one transaction -
-- and the app carries on exactly as before, without the second step.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors
      where user_id = auth.uid() and status = 'verified'
    )
$$;

comment on function public.mfa_satisfied() is
  'True unless this account has a verified authenticator that this session has not been through. Read by is_member, is_editor and is_owner, so it reaches every policy.';

-- ---------------------------------------------------------------------------
-- The three doors, with the same lock added to each
-- ---------------------------------------------------------------------------
--
-- Word for word the definitions from 0001, plus one condition. Repeated in
-- full rather than patched, because a policy helper is the kind of thing that
-- has to be readable in one piece: what a person needs to see here is the
-- whole rule, not a diff against a file they would have to go and open.

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
     and public.mfa_satisfied()
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
  ) and public.mfa_satisfied()
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
  ) and public.mfa_satisfied()
$$;

-- current_app_role() is deliberately left alone. It is not a door: it answers
-- "what is this account's role", and the one policy using it - the self-update
-- in 0001 that lets anybody fix their own name - is already limited to the
-- caller's own row. Locking that too would stop somebody correcting their name
-- and protect nothing: the profiles_select policy lets a session read its own
-- row whatever its assurance level, which is exactly what the code screen
-- needs in order to say who is signing in.
