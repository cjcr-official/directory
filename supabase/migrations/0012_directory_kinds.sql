-- ---------------------------------------------------------------------------
-- A directory is the main one, a group's, or an event's - and only one is main
-- ---------------------------------------------------------------------------
--
-- A directory's kind was "directory" or "event", and the app called the
-- first "Main" - so a church with a choir booklet and a youth list as well as
-- its real directory had three directories all labelled Main. There are three
-- kinds now: main, group and event. There is one main directory, and the
-- database is what holds that, with a unique index over the rows that claim
-- to be it.
--
-- "directory" stays allowed, and no row is changed here. Which of several
-- old "directory" rows is the church's main one is not something a migration
-- can know, so the app works it out for display - the oldest, when none has
-- been chosen - and the choice becomes real the first time a directory is
-- saved with a kind. Rewriting the rows here would be a guess made
-- permanently, in a file nobody sees again.
--
-- New directories default to group.
--
-- Nothing here changes or removes existing data.
-- ---------------------------------------------------------------------------

alter table public.projects drop constraint if exists projects_kind_check;
alter table public.projects
  add constraint projects_kind_check
  check (kind in ('main', 'group', 'event', 'directory'));

alter table public.projects alter column kind set default 'group';

create unique index if not exists projects_one_main
  on public.projects (kind)
  where kind = 'main';

comment on column public.projects.kind is
  'main (one only), group or event. "directory" is the old value for a directory saved before 0012.';
