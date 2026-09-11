-- ---------------------------------------------------------------------------
-- When a person's background check was done, and when the next one is due
-- ---------------------------------------------------------------------------
--
-- Anyone working with children or handling money gets a background check, and
-- a check has a shelf life: most churches renew every two or three years, and
-- an insurer or a denomination will ask to see that the renewals happened. It
-- is kept today on a spreadsheet beside the directory, or in a drawer, which
-- is the usual sign that a field is missing - and the one thing nobody wants
-- to find out late is that the person who has been driving the youth bus was
-- cleared four years ago.
--
-- Two dates rather than one, because the second is not reliably the first plus
-- a constant. How long a check lasts depends on the state, the agency and
-- sometimes the role, a church can shorten it for the nursery, and a renewal
-- booked for a particular week is a fact rather than an arithmetic result. The
-- form suggests three years on from the last one and then leaves it alone,
-- exactly as the family name suggestion does.
--
-- Both nullable, and null is a real answer rather than a gap. Most of a
-- congregation is never checked at all - a directory is not a staff register -
-- so somebody with neither date is untracked, not overdue, and nothing in the
-- app nags about them. A due date on its own is the other useful shape: a
-- volunteer who needs a check and has never had one.
--
-- Nothing here prints. This is office-only, alongside the notes field, and it
-- is deliberately a date and not the check itself: no reference numbers, no
-- agency, no result, no scan of the certificate. Those belong wherever the
-- church's safeguarding records already live, behind whatever access that
-- place has. What a directory needs is the reminder.
--
-- Additive and re-runnable, so it rewrites no data and drops nothing.
-- ---------------------------------------------------------------------------

alter table public.people
  add column if not exists background_check_on date,
  add column if not exists background_check_due date;

comment on column public.people.background_check_on is
  'When the last background check was completed. Null where none has been recorded. Never printed.';
comment on column public.people.background_check_due is
  'When the next background check is due. Null means the person is not tracked, not that they are clear.';

-- No index, deliberately. Every read of this table is the whole table - the
-- app loads the congregation once and asks all of its questions in the
-- browser - so an index on either column would never be reached, and would
-- only be one more thing to maintain on every write.
