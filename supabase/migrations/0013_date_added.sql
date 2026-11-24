-- ---------------------------------------------------------------------------
-- The day a person was added to the directory
-- ---------------------------------------------------------------------------
--
-- An office wants to know who is new: the welcome letter, the newcomers'
-- lunch, "who joined this year" at the annual meeting. created_at looks like
-- that answer and is not one. It is when the row was made, which for everybody
-- brought in from a spreadsheet is the afternoon of the import, and it cannot
-- be corrected by the person who knows better. So this is a date of its own,
-- shown on the form and editable there.
--
-- A plain date, not a timestamp, like the background check dates: it is a day
-- on a calendar, and a time of day would only shift it across midnight
-- depending on where it was read.
--
-- New rows get today's date. The form fills it in itself, from the day it is
-- where the office is, so this default is for everything else that adds a
-- person - an import, chiefly - and it is the server's day, which is UTC.
--
-- People already in the directory are left blank rather than given today's
-- date. Today is the one date that is certainly wrong for all of them. That is
-- why the default is set in its own statement, after the column exists: added
-- in one step with the default, Postgres fills every existing row with it.
--
-- Additive and re-runnable, so it rewrites no data and drops nothing.
-- ---------------------------------------------------------------------------

alter table public.people
  add column if not exists added_on date;

alter table public.people
  alter column added_on set default current_date;

comment on column public.people.added_on is
  'The day the person was added to the directory. Editable. Blank for people added before it was recorded.';
