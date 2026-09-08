-- ---------------------------------------------------------------------------
-- Who touched this last
-- ---------------------------------------------------------------------------
--
-- Three people share the work in a church office, and until now the directory
-- remembered when a record changed but not who changed it. "The Alvarez
-- address is wrong again" has no answer, and the person who would know is
-- whoever was on the phone that afternoon.
--
-- updated_at was already here and already maintained by a trigger. This is the
-- other half of the same sentence.
--
-- Set by the database, never by the browser. The app could perfectly well send
-- its own user id on every write, and any editor could then send somebody
-- else's - which would make the line on screen worse than no line at all,
-- because it would be believed. auth.uid() is read inside the trigger, where
-- the request's own identity is the only thing available.
--
-- On insert as well as update: a record's first author is worth as much as its
-- last, and a family added in March by somebody who has since left is exactly
-- the row an office wants explained.
--
-- Null is a real and ordinary value here. Every row that existed before this
-- migration has no author, and so does anything written by the seed script or
-- another service-role tool, where there is no signed-in person to name. The
-- app treats null as "not recorded" and says nothing rather than guessing.
--
-- Nullable and additive, so this rewrites no data and drops nothing. Safe to
-- run more than once, and safe to run before or after the app that uses it -
-- the app reads the column when it is there and simply shows no line when it
-- is not.

alter table public.households add column if not exists updated_by uuid
  references auth.users (id) on delete set null;
alter table public.people     add column if not exists updated_by uuid
  references auth.users (id) on delete set null;
alter table public.projects   add column if not exists updated_by uuid
  references auth.users (id) on delete set null;

comment on column public.households.updated_by is
  'Who wrote this row last. Set by a trigger from auth.uid(); null for rows older than 0005 and for service-role writes.';
comment on column public.people.updated_by is
  'Who wrote this row last. Set by a trigger from auth.uid(); null for rows older than 0005 and for service-role writes.';
comment on column public.projects.updated_by is
  'Who wrote this row last. Set by a trigger from auth.uid(); null for rows older than 0005 and for service-role writes.';

-- Whatever the caller sent in this column is discarded and replaced. That is
-- the point: a value the browser chose is a claim, and this is meant to be a
-- record.
--
-- A restore is the clearest case. It sends rows exactly as the backup holds
-- them, authorship included, and every one of those rows really is being
-- written now, by the person pressing the button. Stamping them with that
-- person is the honest answer, and it is what this does.
create or replace function public.stamp_updated_by()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists households_stamp_author on public.households;
create trigger households_stamp_author before insert or update on public.households
  for each row execute function public.stamp_updated_by();

drop trigger if exists people_stamp_author on public.people;
create trigger people_stamp_author before insert or update on public.people
  for each row execute function public.stamp_updated_by();

drop trigger if exists projects_stamp_author on public.projects;
create trigger projects_stamp_author before insert or update on public.projects
  for each row execute function public.stamp_updated_by();
