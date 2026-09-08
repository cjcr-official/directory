-- ===========================================================================
-- Row level security tests.
--
-- The app ships its anon key in the browser, so these policies are the entire
-- boundary between a stranger and the congregation's addresses. Each case
-- raises an exception on failure, so the script exits non-zero if any regress.
--
-- Run with:  npm run test:rls
-- ===========================================================================

\set ON_ERROR_STOP on

create or replace function assert(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', description;
  else
    raise exception 'FAIL  %', description;
  end if;
end $$;

-- Runs a query as a signed-in (or anonymous) user and counts the rows it can
-- see, exactly as PostgREST would.
create or replace function count_as(actor uuid, query text)
returns integer language plpgsql as $$
declare
  total integer;
begin
  set local role authenticated;
  if actor is null then
    set local role anon;
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', actor)::text, true);
  end if;
  execute format('select count(*) from (%s) t', query) into total;
  reset role;
  return total;
end $$;

-- Attempts a write as one actor and reports how much of the table it actually
-- changed.
--
-- Row counts matter, not exceptions: a USING clause filters rows away silently,
-- so an UPDATE a policy forbids "succeeds" while touching nothing. Only a failed
-- WITH CHECK raises. Returns -1 when the statement was refused outright, and
-- otherwise the number of rows written - so 0 and -1 both mean "not allowed",
-- and anything above 0 means the write went through.
create or replace function rows_written(actor uuid, statement text)
returns integer language plpgsql as $$
declare
  written integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', actor)::text, true);
  begin
    execute statement;
    get diagnostics written = row_count;
  exception when insufficient_privilege or check_violation then
    reset role;
    return -1;
  end;
  reset role;
  return written;
end $$;

-- --------------------------------------------------------------------------
-- Four accounts, created the way the app creates them: through auth.users,
-- letting the sign-up trigger assign the role.
-- --------------------------------------------------------------------------

insert into auth.users (email, raw_user_meta_data)
values ('owner@example.test', '{"full_name":"First Owner"}'::jsonb);

insert into auth.users (email, raw_user_meta_data)
values ('stranger@example.test', '{"full_name":"Passing Stranger"}'::jsonb);

insert into auth.users (email, raw_user_meta_data)
values ('editor@example.test', '{"full_name":"Church Office"}'::jsonb);

insert into auth.users (email, raw_user_meta_data)
values ('viewer@example.test', '{"full_name":"Sunday Volunteer"}'::jsonb);

select id as owner_id from public.profiles where email = 'owner@example.test' \gset
select id as stranger_id from public.profiles where email = 'stranger@example.test' \gset
select id as editor_id from public.profiles where email = 'editor@example.test' \gset
select id as viewer_id from public.profiles where email = 'viewer@example.test' \gset

-- The office account is promoted by the owner; the stranger is left alone.
update public.profiles set role = 'editor', is_active = true where id = :'editor_id';

-- And the volunteer is let in as a viewer, which is exactly what the
-- Administrators screen writes when an owner picks that role: the role named
-- and the account switched on, in one patch.
update public.profiles set role = 'viewer', is_active = true where id = :'viewer_id';

-- Some directory data to try to steal.
insert into public.households (display_name, sort_name, address_line1, phone)
values ('The Alvarez Family', 'Alvarez', '194 Meeting House Way', '(216) 555-0142');

insert into public.people (first_name, last_name, email, date_of_birth)
values ('Miriam', 'Bennett', 'miriam@example.test', '1961-03-04');

-- --------------------------------------------------------------------------
-- Sign-up defaults
-- --------------------------------------------------------------------------

select assert(
  (select role = 'owner' and is_active from public.profiles where id = :'owner_id'),
  'first sign-up becomes an active owner');

select assert(
  (select role = 'viewer' and not is_active from public.profiles where id = :'stranger_id'),
  'a later sign-up is inactive and cannot be a member');

-- --------------------------------------------------------------------------
-- Reading the congregation
-- --------------------------------------------------------------------------

select assert(count_as(null, 'select * from public.households') = 0,
  'anonymous cannot read households');
select assert(count_as(null, 'select * from public.people') = 0,
  'anonymous cannot read people');

select assert(count_as(:'stranger_id', 'select * from public.households') = 0,
  'a self-signed-up stranger cannot read households');
select assert(count_as(:'stranger_id', 'select * from public.people') = 0,
  'a self-signed-up stranger cannot read people');
select assert(count_as(:'stranger_id', 'select * from public.tags') = 0,
  'a self-signed-up stranger cannot read groups');
select assert(count_as(:'stranger_id', 'select * from public.projects') = 0,
  'a self-signed-up stranger cannot read projects');

select assert(count_as(:'owner_id', 'select * from public.households') = 1,
  'an owner reads households');
select assert(count_as(:'editor_id', 'select * from public.people') = 1,
  'an editor reads people');

-- --------------------------------------------------------------------------
-- Writing
-- --------------------------------------------------------------------------

select assert(
  rows_written(:'stranger_id',
    $q$insert into public.households (display_name, sort_name) values ('Intruder', 'Intruder')$q$) <= 0,
  'a stranger cannot insert a household');

select assert(
  rows_written(:'stranger_id', $q$delete from public.people$q$) <= 0,
  'a stranger cannot delete people');

select assert((select count(*) from public.people) = 1,
  'the people table is untouched after the stranger tried to empty it');

select assert(
  rows_written(:'editor_id',
    $q$insert into public.households (display_name, sort_name) values ('The Chen Family', 'Chen')$q$) = 1,
  'an editor can insert a household');

-- --------------------------------------------------------------------------
-- Privilege escalation
-- --------------------------------------------------------------------------

select assert(
  rows_written(:'stranger_id',
    format($q$update public.profiles set role = 'owner' where id = '%s'$q$, :'stranger_id')) <= 0,
  'an inactive stranger cannot promote themselves to owner');

select assert(
  rows_written(:'stranger_id',
    format($q$update public.profiles set is_active = true where id = '%s'$q$, :'stranger_id')) <= 0,
  'an inactive stranger cannot activate their own account');

select assert(
  rows_written(:'editor_id',
    format($q$update public.profiles set role = 'owner' where id = '%s'$q$, :'editor_id')) <= 0,
  'an editor cannot promote themselves to owner');

select assert(
  rows_written(:'editor_id',
    format($q$update public.profiles set is_active = true where id = '%s'$q$, :'stranger_id')) <= 0,
  'an editor cannot grant access to somebody else');

select assert(
  rows_written(:'editor_id',
    format($q$update public.profiles set role = 'owner' where id = '%s'$q$, :'stranger_id')) <= 0,
  'an editor cannot promote somebody else');

-- A viewer may fix their own name, and must not be able to do more than that.
select assert(
  rows_written(:'editor_id',
    format($q$update public.profiles set full_name = 'Renamed' where id = '%s'$q$, :'editor_id')) = 1,
  'an active administrator can edit their own name');

select assert(
  (select role = 'viewer' and not is_active from public.profiles where id = :'stranger_id'),
  'the stranger is still an inactive viewer after every attempt');

select assert(
  rows_written(:'owner_id',
    format($q$update public.profiles set is_active = true where id = '%s'$q$, :'stranger_id')) = 1,
  'an owner can grant access');

-- --------------------------------------------------------------------------
-- Photographs
-- --------------------------------------------------------------------------

insert into storage.objects (bucket_id, name) values ('directory-photos', 'people/portrait.jpg');

-- The stranger was just granted access above, so re-suspend before testing.
update public.profiles set is_active = false where id = :'stranger_id';

select assert(count_as(null, $q$select * from storage.objects$q$) = 0,
  'anonymous cannot list photographs');
select assert(count_as(:'stranger_id', $q$select * from storage.objects$q$) = 0,
  'a stranger without access cannot list photographs');
select assert(count_as(:'owner_id', $q$select * from storage.objects$q$) = 1,
  'an owner can read photographs');

select assert(
  rows_written(:'stranger_id',
    $q$insert into storage.objects (bucket_id, name) values ('directory-photos', 'x.jpg')$q$) <= 0,
  'a stranger cannot upload a photograph');

select assert(
  (select not public from storage.buckets where id = 'directory-photos'),
  'the photo bucket is private');

-- --------------------------------------------------------------------------
-- The link-setting functions from 0003
--
-- They are a second door into the same tables, and they are security invoker
-- precisely so it is the same door. A definer function here would run as the
-- owner and hand a viewer a way past every policy above, so these ask the new
-- path the same questions the direct writes were asked.
-- --------------------------------------------------------------------------

insert into public.households (id, sort_name, display_name)
  values ('dddddddd-0000-0000-0000-00000000000d', 'Probe', 'The Probe Family')
  on conflict do nothing;
insert into public.tags (id, name, color)
  values ('eeeeeeee-0000-0000-0000-00000000000e', 'Probe group', '#2f6d63')
  on conflict do nothing;

-- One statement per step: an assertion that both performs a write and counts
-- the rows it wrote is at the mercy of whichever side the planner evaluates
-- first, which is not a thing to leave to chance in a security test.

select assert(
  rows_written(:'stranger_id',
    $q$select public.set_household_tags(
         'dddddddd-0000-0000-0000-00000000000d',
         array['eeeeeeee-0000-0000-0000-00000000000e']::uuid[])$q$) <= 0,
  'a stranger is refused by set_household_tags');

select assert(
  (select count(*) from public.household_tags
     where household_id = 'dddddddd-0000-0000-0000-00000000000d') = 0,
  'and the stranger changed no groups');

-- The other half, so the assertions above are about the policy rather than
-- about the function simply not working.
select assert(
  rows_written(:'editor_id',
    $q$select public.set_household_tags(
         'dddddddd-0000-0000-0000-00000000000d',
         array['eeeeeeee-0000-0000-0000-00000000000e']::uuid[])$q$) >= 0,
  'an editor is allowed through set_household_tags');

select assert(
  (select count(*) from public.household_tags
     where household_id = 'dddddddd-0000-0000-0000-00000000000d') = 1,
  'and the group the editor set is there');

-- --------------------------------------------------------------------------
-- The viewer
--
-- The role the README tells a church to hand out most freely - "browse and
-- print, no changes" - and until now the only one whose half of that sentence
-- was never asked. Every read policy is satisfied by is_member(), and a viewer
-- is a member, so the reading half is deliberate. The writing half rests
-- entirely on is_editor() appearing in the other policy of every pair, and a
-- pair that lost its second half would look exactly like a working directory
-- until the day a volunteer deleted a family.
--
-- So this asks both halves: that a viewer really can read the congregation,
-- and that every door out of that - the tables, the link functions, the photo
-- bucket, and their own row - is shut.
-- --------------------------------------------------------------------------

-- A directory to read and to aim the project functions at. The other fixtures
-- are already here: families, a person, a group, a photograph, and the group
-- link an editor set above.
insert into public.projects (id, name)
  values ('ffffffff-0000-0000-0000-00000000000f', 'Spring Directory')
  on conflict do nothing;

select id as person_id from public.people where email = 'miriam@example.test' \gset

select assert(
  (select role = 'viewer' and is_active from public.profiles where id = :'viewer_id'),
  'the volunteer is an active viewer');

-- Non-empty, or every "sees what an owner sees" below would pass by comparing
-- nothing with nothing.
select assert(
  count_as(:'owner_id', 'select * from public.households') > 0
    and count_as(:'owner_id', 'select * from public.people') > 0
    and count_as(:'owner_id', 'select * from public.tags') > 0
    and count_as(:'owner_id', 'select * from public.projects') > 0,
  'there is something in the directory for a viewer to read');

-- Compared against the owner rather than against a number: the counts then
-- cannot drift out of step with the fixtures above, and the property being
-- asserted is the real one - a viewer is shown the whole congregation.
select assert(
  count_as(:'viewer_id', 'select * from public.households')
    = count_as(:'owner_id', 'select * from public.households'),
  'a viewer reads every family an owner reads');

select assert(
  count_as(:'viewer_id', 'select * from public.people')
    = count_as(:'owner_id', 'select * from public.people'),
  'a viewer reads every person an owner reads');

select assert(
  count_as(:'viewer_id', 'select * from public.tags')
    = count_as(:'owner_id', 'select * from public.tags'),
  'a viewer reads every group an owner reads');

select assert(
  count_as(:'viewer_id', 'select * from public.projects')
    = count_as(:'owner_id', 'select * from public.projects'),
  'a viewer reads every directory an owner reads');

select assert(
  count_as(:'viewer_id', $q$select * from storage.objects$q$)
    = count_as(:'owner_id', $q$select * from storage.objects$q$),
  'a viewer can see the photographs, which is what printing needs');

-- --------------------------------------------------------------------------
-- ...and cannot change a single row of it
-- --------------------------------------------------------------------------

select assert(
  rows_written(:'viewer_id',
    $q$insert into public.households (display_name, sort_name) values ('Sneaked', 'Sneaked')$q$) <= 0,
  'a viewer cannot add a family');

select assert(
  rows_written(:'viewer_id',
    $q$update public.households set phone = '(000) 000-0000'$q$) <= 0,
  'a viewer cannot edit a family');

select assert(
  rows_written(:'viewer_id', $q$delete from public.households$q$) <= 0,
  'a viewer cannot delete families');

select assert(
  rows_written(:'viewer_id',
    $q$insert into public.people (first_name, last_name) values ('Sneaked', 'Person')$q$) <= 0,
  'a viewer cannot add a person');

select assert(
  rows_written(:'viewer_id',
    $q$update public.people set email = 'redirected@example.test'$q$) <= 0,
  'a viewer cannot edit a person');

select assert(
  rows_written(:'viewer_id', $q$delete from public.people$q$) <= 0,
  'a viewer cannot delete people');

select assert(
  rows_written(:'viewer_id',
    $q$insert into public.tags (name, color) values ('Sneaked group', '#000000')$q$) <= 0,
  'a viewer cannot add a group');

select assert(
  rows_written(:'viewer_id', $q$delete from public.tags$q$) <= 0,
  'a viewer cannot delete groups');

select assert(
  rows_written(:'viewer_id',
    $q$insert into public.projects (name) values ('Sneaked directory')$q$) <= 0,
  'a viewer cannot add a directory');

select assert(
  rows_written(:'viewer_id',
    $q$update public.projects set settings = '{"showAddress":false}'::jsonb$q$) <= 0,
  'a viewer cannot change how a directory prints');

-- --------------------------------------------------------------------------
-- The link functions, which are the second door into those same tables
--
-- The stranger above already asks these, and catches a `security definer`
-- slipped into 0003. What it cannot catch is the link tables' own policy
-- drifting from is_editor() to is_member(): a stranger is not a member, so
-- they stay out either way and the assertion goes on passing. A viewer is a
-- member, which is what makes them the actor this door has to be tried by.
--
-- Each is asked with a non-empty array, so the refusal comes from the insert
-- half rather than from a delete that quietly matched nothing.
-- --------------------------------------------------------------------------

select assert(
  rows_written(:'viewer_id',
    $q$select public.set_household_tags(
         'dddddddd-0000-0000-0000-00000000000d',
         array['eeeeeeee-0000-0000-0000-00000000000e']::uuid[])$q$) <= 0,
  'a viewer is refused by set_household_tags');

select assert(
  rows_written(:'viewer_id',
    format($q$select public.set_person_tags(
         '%s', array['eeeeeeee-0000-0000-0000-00000000000e']::uuid[])$q$, :'person_id')) <= 0,
  'a viewer is refused by set_person_tags');

select assert(
  rows_written(:'viewer_id',
    $q$select public.set_project_tags(
         'ffffffff-0000-0000-0000-00000000000f',
         array['eeeeeeee-0000-0000-0000-00000000000e']::uuid[])$q$) <= 0,
  'a viewer is refused by set_project_tags');

select assert(
  rows_written(:'viewer_id',
    $q$select public.set_project_entries(
         'ffffffff-0000-0000-0000-00000000000f',
         '[{"entry_type":"household","ref_id":"dddddddd-0000-0000-0000-00000000000d"}]'::jsonb)$q$) <= 0,
  'a viewer is refused by set_project_entries');

-- Each call above ends in a refused insert, and a refused insert takes the
-- delete that preceded it down with it - so the link surviving those proves
-- nothing about the delete half on its own.
--
-- This is the probe that does: an empty array is what the app sends when the
-- last group is unticked, and it runs the delete and then stops. Nothing
-- raises, so nothing is rolled back, and the link is still here only if the
-- policy filtered the delete away.
select rows_written(:'viewer_id',
  $q$select public.set_household_tags(
       'dddddddd-0000-0000-0000-00000000000d', array[]::uuid[])$q$);

select assert(
  (select count(*) from public.household_tags
     where household_id = 'dddddddd-0000-0000-0000-00000000000d') = 1,
  'a viewer cannot clear a family''s groups either');

-- --------------------------------------------------------------------------
-- Photographs, and their own row
-- --------------------------------------------------------------------------

select assert(
  rows_written(:'viewer_id',
    $q$insert into storage.objects (bucket_id, name) values ('directory-photos', 'viewer.jpg')$q$) <= 0,
  'a viewer cannot upload a photograph');

select assert(
  rows_written(:'viewer_id', $q$delete from storage.objects$q$) <= 0,
  'a viewer cannot remove a photograph');

select assert(
  rows_written(:'viewer_id',
    format($q$update public.profiles set role = 'editor' where id = '%s'$q$, :'viewer_id')) <= 0,
  'a viewer cannot promote themselves to editor');

select assert(
  rows_written(:'viewer_id',
    format($q$update public.profiles set role = 'owner' where id = '%s'$q$, :'viewer_id')) <= 0,
  'a viewer cannot promote themselves to owner');

select assert(
  rows_written(:'viewer_id',
    format($q$update public.profiles set is_active = true where id = '%s'$q$, :'stranger_id')) <= 0,
  'a viewer cannot grant access to somebody else');

-- The one write a viewer may make, so the refusals above are about the policy
-- rather than about the account being broken.
select assert(
  rows_written(:'viewer_id',
    format($q$update public.profiles set full_name = 'Renamed' where id = '%s'$q$, :'viewer_id')) = 1,
  'a viewer can still fix their own name');

select assert(
  (select role = 'viewer' and is_active from public.profiles where id = :'viewer_id'),
  'and is still a viewer after every attempt');

\echo ''
\echo 'All row level security checks passed.'
