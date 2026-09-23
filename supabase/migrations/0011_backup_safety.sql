-- ---------------------------------------------------------------------------
-- Backups: a shared record of when one was last taken, and a restore that
-- replaces the directory in one transaction
-- ---------------------------------------------------------------------------
--
-- Two things the backup screen could not do safely from the browser alone.
--
-- The date of the last backup lived in whichever browser took it, so the
-- office PC could say "yesterday" while every phone said "never", and nobody
-- was told when backups stopped. backup_log is one row per download, readable
-- by every administrator, so they all see the same date and the same warning
-- when it is overdue. Rows are only ever added: nobody edits or deletes the
-- history, and taken_by is always the account that actually wrote the row.
--
-- "Replace everything" emptied four tables and then refilled them in a series
-- of separate requests. A connection that dropped part way through left the
-- directory empty or half-full for everybody. replace_directory does the
-- delete and every insert inside the single transaction a function body runs
-- in, so it either lands whole or changes nothing. It checks for an owner
-- itself, so the rule that only owners may replace the directory no longer
-- rests on a disabled button.
--
-- Security invoker, deliberately: the row level security on every table still
-- applies underneath the owner check, rather than being bypassed by it.
--
-- Rows are read with jsonb_populate_recordset against each table's own row
-- type. A key the table does not have - a backup taken after a later
-- migration, restored into a project that has not run it - is ignored rather
-- than failing the restore.
--
-- Nothing here changes or removes existing data.
-- ---------------------------------------------------------------------------

create table if not exists public.backup_log (
  id              uuid primary key default gen_random_uuid(),
  taken_at        timestamptz not null default now(),
  taken_by        uuid default auth.uid() references auth.users (id) on delete set null,
  photos_included boolean not null default true,
  households      integer not null default 0,
  people          integer not null default 0
);

create index if not exists backup_log_taken_at_idx on public.backup_log (taken_at desc);

comment on table public.backup_log is
  'One row per backup downloaded from the app, so every administrator sees when the last one was taken.';

alter table public.backup_log enable row level security;

drop policy if exists backup_log_read on public.backup_log;
create policy backup_log_read on public.backup_log
  for select to authenticated
  using (public.is_member());

drop policy if exists backup_log_insert on public.backup_log;
create policy backup_log_insert on public.backup_log
  for insert to authenticated
  with check (public.is_editor() and taken_by = auth.uid());

grant select, insert on public.backup_log to authenticated;

create or replace function public.replace_directory(p_directory jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an owner can replace the whole directory.'
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_directory -> 'households') is distinct from 'array'
     or jsonb_typeof(p_directory -> 'people') is distinct from 'array'
     or jsonb_typeof(p_directory -> 'tags') is distinct from 'array' then
    raise exception 'The directory to restore is missing its records.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Children go with their owners by cascade: project_tags and
  -- project_entries with projects, the two tag link tables with their records.
  delete from public.projects where id is not null;
  delete from public.people where id is not null;
  delete from public.households where id is not null;
  delete from public.tags where id is not null;

  insert into public.tags
    select * from jsonb_populate_recordset(null::public.tags, p_directory -> 'tags');
  insert into public.households
    select * from jsonb_populate_recordset(null::public.households, p_directory -> 'households');
  insert into public.people
    select * from jsonb_populate_recordset(null::public.people, p_directory -> 'people');
  insert into public.household_tags
    select * from jsonb_populate_recordset(null::public.household_tags,
      coalesce(p_directory -> 'household_tags', '[]'::jsonb));
  insert into public.person_tags
    select * from jsonb_populate_recordset(null::public.person_tags,
      coalesce(p_directory -> 'person_tags', '[]'::jsonb));
  insert into public.projects
    select * from jsonb_populate_recordset(null::public.projects,
      coalesce(p_directory -> 'projects', '[]'::jsonb));
  insert into public.project_tags
    select * from jsonb_populate_recordset(null::public.project_tags,
      coalesce(p_directory -> 'project_tags', '[]'::jsonb));
  insert into public.project_entries
    select * from jsonb_populate_recordset(null::public.project_entries,
      coalesce(p_directory -> 'project_entries', '[]'::jsonb));
end;
$$;

comment on function public.replace_directory(jsonb) is
  'Empties the directory and loads the given rows in one transaction. Owners only.';

revoke all on function public.replace_directory(jsonb) from public;
grant execute on function public.replace_directory(jsonb) to authenticated;
